import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Per-order message threads. Each order has its own thread in
 * `public.order_messages` — there is no global customer chat, and messages can
 * never cross between orders because every read and write is filtered by
 * `order_id` here on the server.
 *
 * Access mirrors the existing rules: the customer who owns the order, or an
 * owner/manager/staff member holding the existing online order permissions.
 */

export interface OrderMessage {
  id: string;
  orderId: string;
  senderRole: "customer" | "staff";
  senderName: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
}

export interface OrderThread {
  orderId: string;
  orderCode: string;
  viewerRole: "customer" | "staff";
  messages: OrderMessage[];
}

type OrderRow = {
  id: string;
  code: string;
  user_id: string | null;
  customer_name: string;
  channel: string | null;
};

/** Is this caller the order's customer, or authorized staff? Throws otherwise. */
async function authorizeThread(
  userId: string,
  orderId: string,
): Promise<{ order: OrderRow; viewerRole: "customer" | "staff" }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: order, error } = await supabaseAdmin
    .from("orders")
    .select("id, code, user_id, customer_name, channel")
    .eq("id", orderId)
    .maybeSingle();

  if (error) {
    console.error("Order message lookup failed", error);
    throw new Error("We couldn't open this message thread. Please try again.");
  }
  if (!order) throw new Error("This order no longer exists.");

  if (order.user_id && order.user_id === userId) {
    return { order: order as OrderRow, viewerRole: "customer" };
  }

  const { assertAnyPermission } = await import("@/lib/owner.server");
  await assertAnyPermission(userId, ["online_orders", "order_management"], "view");
  return { order: order as OrderRow, viewerRole: "staff" };
}

export const listOrderMessages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ orderId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<OrderThread> => {
    const { order, viewerRole } = await authorizeThread(context.userId, data.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: rows, error } = await supabaseAdmin
      .from("order_messages")
      .select("id, order_id, sender_role, sender_user_id, sender_name, body, created_at")
      .eq("order_id", order.id)
      .order("created_at", { ascending: true })
      .limit(200);

    if (error) {
      console.error("Order message list failed", error);
      throw new Error("We couldn't load these messages. Please try again.");
    }

    // Opening the thread clears the unread flag for this side only.
    await supabaseAdmin
      .from("order_messages")
      .update(viewerRole === "staff" ? { read_by_staff: true } : { read_by_customer: true })
      .eq("order_id", order.id)
      .eq("sender_role", viewerRole === "staff" ? "customer" : "staff");

    return {
      orderId: order.id,
      orderCode: order.code,
      viewerRole,
      messages: (rows ?? []).map((r) => ({
        id: r.id,
        orderId: r.order_id,
        senderRole: r.sender_role as "customer" | "staff",
        senderName: r.sender_name,
        body: r.body,
        createdAt: r.created_at,
        mine: r.sender_user_id === context.userId,
      })),
    };
  });

export const sendOrderMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        body: z.string().trim().min(1).max(1000),
      })
      .parse(input),
  )
  .handler(async ({ data, context }): Promise<OrderMessage> => {
    const { order, viewerRole } = await authorizeThread(context.userId, data.orderId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    let senderName: string | null = viewerRole === "customer" ? order.customer_name : "Flamio team";
    if (viewerRole === "customer") {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("full_name")
        .eq("id", context.userId)
        .maybeSingle();
      senderName = profile?.full_name ?? order.customer_name;
    }

    const { data: row, error } = await supabaseAdmin
      .from("order_messages")
      .insert({
        order_id: order.id,
        sender_role: viewerRole,
        sender_user_id: context.userId,
        sender_name: senderName,
        body: data.body,
        read_by_staff: viewerRole === "staff",
        read_by_customer: viewerRole === "customer",
      })
      .select("id, order_id, sender_role, sender_user_id, sender_name, body, created_at")
      .single();

    if (error || !row) {
      console.error("Order message insert failed", error);
      throw new Error("We couldn't send this message. Please try again.");
    }

    // Notifications reuse the EXISTING notifications table; notifyUsers adds
    // the real phone push on top of the same row.
    const { notifyUsers } = await import("@/lib/push.server");
    const preview = data.body.slice(0, 160);

    if (viewerRole === "customer") {
      const recipients = await staffRecipients();
      if (recipients.length > 0) {
        await notifyUsers(
          recipients.map((userId) => ({
            userId,
            kind: "order_message" as const,
            status: "order_message_staff",
            title: `New message — ${order.code}`,
            body: preview,
            orderId: order.id,
            orderCode: order.code,
          })),
          {
            title: `New message — ${order.code}`,
            body: preview,
            url: `/owner/orders?order=${order.id}`,
            tag: `order-message-${order.id}`,
            urgency: "high",
          },
        );
      }
    } else if (order.user_id) {
      await notifyUsers(
        [
          {
            userId: order.user_id,
            kind: "order_message",
            status: "order_message",
            title: `Flamio replied — ${order.code}`,
            body: preview,
            orderId: order.id,
            orderCode: order.code,
          },
        ],
        {
          title: `Flamio replied — ${order.code}`,
          body: preview,
          url: `/order/${order.id}`,
          tag: `order-message-${order.id}`,
        },
      );
    }

    return {
      id: row.id,
      orderId: row.order_id,
      senderRole: row.sender_role as "customer" | "staff",
      senderName: row.sender_name,
      body: row.body,
      createdAt: row.created_at,
      mine: true,
    };
  });

/** Owners, managers and staff who may manage online orders. */
async function staffRecipients(): Promise<string[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const [{ data: roles }, { data: perms }] = await Promise.all([
    supabaseAdmin.from("user_roles").select("user_id, role").in("role", ["owner", "admin"]),
    supabaseAdmin
      .from("staff_permissions")
      .select("user_id, permission")
      .in("permission", ["online_orders", "order_management"]),
  ]);

  const ids = new Set<string>();
  for (const r of roles ?? []) ids.add(r.user_id);
  for (const p of perms ?? []) ids.add(p.user_id);
  return [...ids];
}
