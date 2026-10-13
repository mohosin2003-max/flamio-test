import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type ContactMessage = {
  id: string;
  senderRole: "customer" | "staff";
  senderName: string | null;
  body: string;
  createdAt: string;
  mine: boolean;
};

export type ContactThread = {
  id: string | null;
  customerUserId: string;
  customerName: string | null;
  customerPhone: string | null;
  unreadCount: number;
  lastMessageAt: string | null;
  messages: ContactMessage[];
};

async function db() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { looseDb } = await import("@/integrations/supabase/loose.server");
  return looseDb(supabaseAdmin);
}

async function profileName(userId: string): Promise<string | null> {
  const database = await db();
  const { data } = await database.from("profiles").select("full_name").eq("id", userId).maybeSingle();
  return data?.full_name ?? null;
}

async function assertCustomer(userId: string): Promise<void> {
  const database = await db();
  const { data } = await database.from("user_roles").select("role").eq("user_id", userId);
  if ((data ?? []).some((row) => ["owner", "admin", "staff"].includes(row.role))) {
    throw new Error("This inbox is for customer accounts.");
  }
}

async function threadMessages(conversationId: string, viewerId: string): Promise<ContactMessage[]> {
  const database = await db();
  const { data, error } = await database
    .from("customer_conversation_messages")
    .select("id, sender_role, sender_user_id, sender_name, body, created_at")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true })
    .limit(300);
  if (error) throw new Error("We couldn't load this conversation. Please try again.");
  return (data ?? []).map((row) => ({
    id: row.id,
    senderRole: row.sender_role as "customer" | "staff",
    senderName: row.sender_name,
    body: row.body,
    createdAt: row.created_at,
    mine: row.sender_user_id === viewerId,
  }));
}

export const getMyContactThread = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ContactThread> => {
    await assertCustomer(context.userId);
    const database = await db();
    const [{ data: conversation }, { data: profile }] = await Promise.all([
      database
        .from("customer_conversations")
        .select("id, last_message_at")
        .eq("customer_user_id", context.userId)
        .maybeSingle(),
      database.from("profiles").select("full_name, phone").eq("id", context.userId).maybeSingle(),
    ]);
    if (!conversation) {
      return {
        id: null,
        customerUserId: context.userId,
        customerName: profile?.full_name ?? null,
        customerPhone: profile?.phone ?? null,
        unreadCount: 0,
        lastMessageAt: null,
        messages: [],
      };
    }
    await database
      .from("customer_conversation_messages")
      .update({ read_by_customer: true })
      .eq("conversation_id", conversation.id)
      .eq("sender_role", "staff");
    return {
      id: conversation.id,
      customerUserId: context.userId,
      customerName: profile?.full_name ?? null,
      customerPhone: profile?.phone ?? null,
      unreadCount: 0,
      lastMessageAt: conversation.last_message_at,
      messages: await threadMessages(conversation.id, context.userId),
    };
  });

export const sendMyContactMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ body: z.string().trim().min(1).max(1000) }).parse(input))
  .handler(async ({ data, context }) => {
    await assertCustomer(context.userId);
    const database = await db();
    const { data: conversation, error: conversationError } = await database
      .from("customer_conversations")
      .upsert(
        { customer_user_id: context.userId, last_message_at: new Date().toISOString() },
        { onConflict: "customer_user_id" },
      )
      .select("id")
      .single();
    if (conversationError || !conversation) throw new Error("We couldn't open your inbox. Please try again.");
    const senderName = await profileName(context.userId);
    const { error } = await database.from("customer_conversation_messages").insert({
      conversation_id: conversation.id,
      sender_user_id: context.userId,
      sender_role: "customer",
      sender_name: senderName,
      body: data.body,
      read_by_customer: true,
      read_by_staff: false,
    });
    if (error) throw new Error("We couldn't send this message. Please try again.");
    const { recipientsWithPermission, notifyUsers } = await import("@/lib/push.server");
    const recipients = await recipientsWithPermission(["customers"]);
    if (recipients.length > 0) {
      await notifyUsers(
        recipients.map((userId) => ({
          userId,
          kind: "personal" as const,
          status: "contact_message_staff",
          title: "New customer message",
          body: data.body.slice(0, 160),
        })),
        { title: "New customer message", body: data.body.slice(0, 160), url: "/owner/inbox" },
      );
    }
    return { ok: true, conversationId: conversation.id };
  });

export const ownerListContactThreads = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ContactThread[]> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "customers", "view");
    const database = await db();
    const { data: conversations, error } = await database
      .from("customer_conversations")
      .select("id, customer_user_id, last_message_at")
      .order("last_message_at", { ascending: false });
    if (error) throw new Error("We couldn't load customer conversations. Please try again.");
    const ids = (conversations ?? []).map((row) => row.customer_user_id as string);
    const conversationIds = (conversations ?? []).map((row) => row.id as string);
    const [{ data: profiles }, { data: unread }] = await Promise.all([
      ids.length ? database.from("profiles").select("id, full_name, phone").in("id", ids) : Promise.resolve({ data: [] }),
      conversationIds.length
        ? database
            .from("customer_conversation_messages")
            .select("conversation_id")
            .in("conversation_id", conversationIds)
            .eq("sender_role", "customer")
            .eq("read_by_staff", false)
        : Promise.resolve({ data: [] }),
    ]);
    const profileById = new Map((profiles ?? []).map((row) => [row.id as string, row]));
    const unreadById = new Map<string, number>();
    for (const row of unread ?? []) unreadById.set(row.conversation_id, (unreadById.get(row.conversation_id) ?? 0) + 1);
    return (conversations ?? []).map((row) => {
      const profile = profileById.get(row.customer_user_id as string);
      return {
        id: row.id,
        customerUserId: row.customer_user_id,
        customerName: profile?.full_name ?? null,
        customerPhone: profile?.phone ?? null,
        unreadCount: unreadById.get(row.id) ?? 0,
        lastMessageAt: row.last_message_at,
        messages: [],
      };
    });
  });

export const ownerGetContactThread = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ conversationId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }): Promise<ContactThread> => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "customers", "view");
    const database = await db();
    const { data: conversation } = await database
      .from("customer_conversations")
      .select("id, customer_user_id, last_message_at")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conversation) throw new Error("This conversation no longer exists.");
    const { data: profile } = await database
      .from("profiles")
      .select("full_name, phone")
      .eq("id", conversation.customer_user_id)
      .maybeSingle();
    await database
      .from("customer_conversation_messages")
      .update({ read_by_staff: true })
      .eq("conversation_id", conversation.id)
      .eq("sender_role", "customer");
    return {
      id: conversation.id,
      customerUserId: conversation.customer_user_id,
      customerName: profile?.full_name ?? null,
      customerPhone: profile?.phone ?? null,
      unreadCount: 0,
      lastMessageAt: conversation.last_message_at,
      messages: await threadMessages(conversation.id, context.userId),
    };
  });

export const ownerSendContactReply = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ conversationId: z.string().uuid(), body: z.string().trim().min(1).max(1000) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "customers");
    const database = await db();
    const { data: conversation } = await database
      .from("customer_conversations")
      .select("id, customer_user_id")
      .eq("id", data.conversationId)
      .maybeSingle();
    if (!conversation) throw new Error("This conversation no longer exists.");
    const { error } = await database.from("customer_conversation_messages").insert({
      conversation_id: conversation.id,
      sender_user_id: context.userId,
      sender_role: "staff",
      sender_name: "Flamio team",
      body: data.body,
      read_by_customer: false,
      read_by_staff: true,
    });
    if (error) throw new Error("We couldn't send this reply. Please try again.");
    await database
      .from("customer_conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", conversation.id);
    const { notifyUsers } = await import("@/lib/push.server");
    await notifyUsers(
      [{
        userId: conversation.customer_user_id,
        kind: "personal",
        status: "contact_message",
        title: "Flamio replied",
        body: data.body.slice(0, 160),
      }],
      { title: "Flamio replied", body: data.body.slice(0, 160), url: "/account/inbox" },
    );
    return { ok: true };
  });
