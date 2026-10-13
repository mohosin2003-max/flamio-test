import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Kitchen Display System endpoints. These reuse the EXISTING `orders` /
 * `order_items` tables and the existing order status lifecycle — no parallel
 * order or status system. Access is enforced server-side via `assertKitchen`.
 */

export interface KitchenOrderItem {
  productId: string | null;
  name: string;
  variantName: string | null;
  quantity: number;
  imageUrl: string | null;
  comboName: string | null;
}

export interface KitchenOrder {
  id: string;
  code: string;
  status: string;
  fulfillment: "delivery" | "pickup";
  createdAt: string;
  deliveryNotes: string | null;
  items: KitchenOrderItem[];
}

/** Does the caller have kitchen access (owner, admin or staff)? */
export const getKitchenAccess = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { getAccessProfile } = await import("@/lib/owner.server");
    const access = await getAccessProfile(context.userId);
    return {
      hasAccess: access.isManager || access.permissions.includes("kitchen"),
      roles: access.isManager ? ["owner"] : access.isStaff ? ["staff"] : [],
    };
  });

/**
 * Active kitchen queue. Only kitchen-relevant fields are returned — no
 * customer address, phone or payment data, preserving customer privacy.
 */
export const kitchenListOrders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KitchenOrder[]> => {
    const { assertKitchen } = await import("@/lib/kitchen.server");
    await assertKitchen(context.userId, "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select(
        "id, code, status, fulfillment, created_at, delivery_notes, order_items(product_id, product_name, variant_name, quantity, image_url, combo_name, created_at)",
      )
      .in("status", ["placed", "confirmed", "preparing", "ready"])
      .eq("channel", "online")
      .order("created_at", { ascending: true })
      .limit(80);

    if (error) {
      console.error("Kitchen order list failed", error);
      throw new Error("We couldn't load the kitchen queue. Please try again.");
    }

    const productIds = Array.from(new Set((data ?? []).flatMap((o) =>
      (o.order_items ?? []).filter((item) => !item.image_url && item.product_id).map((item) => item.product_id as string),
    )));
    const currentImages = new Map<string, string>();
    if (productIds.length > 0) {
      const { data: images } = await supabaseAdmin
        .from("product_images")
        .select("product_id, url, is_primary, sort_order")
        .in("product_id", productIds)
        .not("url", "is", null)
        .order("is_primary", { ascending: false })
        .order("sort_order", { ascending: true });
      for (const image of images ?? []) {
        if (image.url && !currentImages.has(image.product_id)) currentImages.set(image.product_id, image.url);
      }
    }

    return (data ?? []).map((o) => ({
      id: o.id,
      code: o.code,
      status: o.status,
      fulfillment: o.fulfillment as "delivery" | "pickup",
      createdAt: o.created_at,
      deliveryNotes: o.delivery_notes,
      items: (o.order_items ?? [])
        .sort((a, b) => a.created_at.localeCompare(b.created_at))
        .map((i) => ({
          productId: i.product_id,
          name: i.product_name,
          variantName: i.variant_name,
          quantity: i.quantity,
          imageUrl: i.image_url ?? (i.product_id ? currentImages.get(i.product_id) ?? null : null),
          comboName: i.combo_name,
        })),
    }));
  });

/**
 * Advances an order through the existing status lifecycle. Kitchen users may
 * only set kitchen-relevant statuses; owner-only actions (cancel, delivery
 * dispatch) stay in the existing owner endpoint.
 */
export const kitchenUpdateOrderStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        orderId: z.string().uuid(),
        status: z.enum(["confirmed", "preparing", "ready", "completed"]),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertKitchen } = await import("@/lib/kitchen.server");
    await assertKitchen(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { isForwardTransition, isOnlineChannel } = await import("@/lib/order-flow");

    const { data: order, error: loadError } = await supabaseAdmin
      .from("orders")
      .select("id, status, channel, fulfillment")
      .eq("id", data.orderId)
      .maybeSingle();

    if (loadError) {
      console.error("Kitchen status lookup failed", loadError);
      throw new Error("We couldn't update this order. Please try again.");
    }
    if (!order) throw new Error("This order no longer exists.");

    if (!isOnlineChannel(order.channel)) {
      throw new Error("Counter and platform sales are already completed sales.");
    }
    if (order.status === data.status) return { ok: true, status: order.status };
    // Forward-only: only the immediate next status is accepted.
    if (!isForwardTransition(order.status, data.status, order.fulfillment as "delivery" | "pickup")) {
      throw new Error("Order status can only move forward one step.");
    }

    const { error } = await supabaseAdmin
      .from("orders")
      .update({ status: data.status })
      .eq("id", data.orderId)
      .eq("status", order.status);

    if (error) {
      console.error("Kitchen status update failed", error);
      throw new Error("We couldn't update this order. Please try again.");
    }
    return { ok: true, status: data.status };
  });

export interface KitchenStockRow {
  id: string;
  name: string;
  unit: string;
  currentStock: number;
  lowStockThreshold: number;
  isLow: boolean;
  isOut: boolean;
  usedToday: number;
}

/**
 * Kitchen-facing read-only view of the EXISTING inventory tables. No writes,
 * no parallel inventory system — stock changes still go through the owner
 * endpoints and the existing order consumption function.
 */
export const kitchenListInventory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<KitchenStockRow[]> => {
    const { assertKitchen } = await import("@/lib/kitchen.server");
    await assertKitchen(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [{ data: rows, error }, { data: used }] = await Promise.all([
      supabaseAdmin
        .from("inventory_items")
        .select("id, name, unit, current_stock, low_stock_threshold, is_active")
        .eq("is_active", true)
        .order("name"),
      supabaseAdmin
        .from("inventory_movements")
        .select("item_id, quantity")
        .eq("change_type", "order")
        .gte("created_at", since),
    ]);

    if (error) {
      console.error("Kitchen inventory list failed", error);
      throw new Error("We couldn't load ingredient stock. Please try again.");
    }

    const usedByItem = new Map<string, number>();
    for (const m of used ?? []) {
      usedByItem.set(m.item_id, (usedByItem.get(m.item_id) ?? 0) + Number(m.quantity));
    }

    return (rows ?? []).map((r) => {
      const currentStock = Number(r.current_stock);
      const lowStockThreshold = Number(r.low_stock_threshold);
      return {
        id: r.id,
        name: r.name,
        unit: r.unit,
        currentStock,
        lowStockThreshold,
        isLow: currentStock > 0 && currentStock <= lowStockThreshold,
        isOut: currentStock <= 0,
        usedToday: usedByItem.get(r.id) ?? 0,
      };
    });
  });
