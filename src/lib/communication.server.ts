/**
 * Customer communication sending layer (server only).
 *
 * ONE place decides whether a channel can reach a customer and records what
 * happened. It reuses everything that already exists:
 *
 *   in_app  → existing `customer_conversations` / `customer_conversation_messages`
 *   push    → existing `notifyUsers` / `push_tokens`
 *   sms     → existing `sms.server.ts` provider (the same provider as login codes,
 *             but a completely separate purpose; no OTP code path is touched)
 *   whatsapp/email → provider configuration in the existing `sms_providers` table
 *
 * Every send is logged once in `communication_messages` with a unique dedupe key,
 * so a double click, refresh, retry or webhook replay can never send twice.
 * Failures are contained here — a provider failure never throws into ordering,
 * checkout, POS, KDS, finance, CRM or login.
 */

import { normalizePhone } from "@/lib/phone";

export type CommChannel = "in_app" | "push" | "sms" | "whatsapp" | "email";
export type CommCategory = "transactional" | "service" | "marketing";
export type CommStatus = "queued" | "sending" | "sent" | "delivered" | "failed" | "cancelled";

export interface SendRequest {
  phone: string;
  channel: CommChannel;
  category: CommCategory;
  body: string;
  subject?: string | null;
  actorUserId: string;
  customerUserId: string | null;
  customerEmail?: string | null;
  orderId?: string | null;
  /** Client-supplied idempotency token; one send per token. */
  requestId: string;
}

export interface SendResult {
  ok: boolean;
  status: CommStatus;
  message: string;
  duplicate?: boolean;
}

const db = async () => {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  return untypedAdmin();
};

/** Marketing needs a stored opt-in; transactional/service do not. */
export async function categoryAllowed(
  phone: string,
  channel: CommChannel,
  category: CommCategory,
): Promise<boolean> {
  if (category !== "marketing") return true;
  const client = await db();
  const { data } = await client
    .from("customer_communication_preferences")
    .select("opted_in")
    .eq("customer_phone", normalizePhone(phone))
    .eq("channel", channel)
    .eq("category", "marketing")
    .maybeSingle();
  return Boolean(data?.opted_in);
}

export async function readPreferences(
  phone: string,
): Promise<{ channel: CommChannel; category: CommCategory; optedIn: boolean }[]> {
  const client = await db();
  const { data } = await client
    .from("customer_communication_preferences")
    .select("channel, category, opted_in")
    .eq("customer_phone", normalizePhone(phone));
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    channel: row['channel'] as CommChannel,
    category: row['category'] as CommCategory,
    optedIn: Boolean(row['opted_in']),
  }));
}

export async function setPreference(input: {
  phone: string;
  channel: CommChannel;
  category: CommCategory;
  optedIn: boolean;
  actorUserId: string;
}): Promise<void> {
  const client = await db();
  const phone = normalizePhone(input.phone);
  const { data: existing } = await client
    .from("customer_communication_preferences")
    .select("id")
    .eq("customer_phone", phone)
    .eq("channel", input.channel)
    .eq("category", input.category)
    .maybeSingle();

  if (existing?.id) {
    await client
      .from("customer_communication_preferences")
      .update({
        opted_in: input.optedIn,
        updated_by: input.actorUserId,
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
    return;
  }

  await client.from("customer_communication_preferences").insert({
    customer_phone: phone,
    channel: input.channel,
    category: input.category,
    opted_in: input.optedIn,
    source: "owner",
    updated_by: input.actorUserId,
  });
}

/** Claims the dedupe key. Returns null when this exact send already happened. */
async function claim(request: SendRequest): Promise<string | null> {
  const client = await db();
  const dedupeKey = `${request.channel}:${normalizePhone(request.phone)}:${request.requestId}`;
  const { data, error } = await client
    .from("communication_messages")
    .insert({
      customer_phone: normalizePhone(request.phone),
      customer_user_id: request.customerUserId,
      order_id: request.orderId ?? null,
      channel: request.channel,
      category: request.category,
      direction: "outbound",
      status: "sending",
      body_preview: request.body.slice(0, 200),
      actor_user_id: request.actorUserId,
      dedupe_key: dedupeKey,
    })
    .select("id")
    .maybeSingle();

  if (error) {
    // Unique violation on dedupe_key => this send was already accepted.
    if (String(error.code) === "23505" || /duplicate|unique/i.test(error.message ?? "")) return null;
    console.error("Communication log insert failed", error.message);
    throw new Error("We couldn't record this message. Please try again.");
  }
  return (data?.id as string | undefined) ?? null;
}

async function finish(
  id: string,
  status: CommStatus,
  patch: { providerSlug?: string | null; providerMessageId?: string | null; error?: string | null },
): Promise<void> {
  const client = await db();
  const now = new Date().toISOString();
  await client
    .from("communication_messages")
    .update({
      status,
      provider_slug: patch.providerSlug ?? null,
      provider_message_id: patch.providerMessageId ?? null,
      error_text: patch.error ?? null,
      sent_at: status === "sent" || status === "delivered" ? now : null,
      updated_at: now,
    })
    .eq("id", id);
}

/**
 * Sends one customer message. Never throws for provider problems — the caller
 * gets a result and the log row carries the outcome.
 */
export async function sendCustomerMessage(request: SendRequest): Promise<SendResult> {
  if (!(await categoryAllowed(request.phone, request.channel, request.category))) {
    return {
      ok: false,
      status: "cancelled",
      message: "This customer hasn't opted in to marketing messages on this channel.",
    };
  }

  let logId: string | null;
  try {
    logId = await claim(request);
  } catch {
    return { ok: false, status: "failed", message: "We couldn't record this message." };
  }
  if (!logId) {
    return { ok: true, status: "sent", message: "This message was already sent.", duplicate: true };
  }

  try {
    switch (request.channel) {
      case "in_app":
        return await deliverInApp(logId, request);
      case "push":
        return await deliverPush(logId, request);
      case "sms":
        return await deliverSms(logId, request);
      case "whatsapp":
        return await deliverWhatsApp(logId, request);
      case "email":
        return await deliverEmail(logId, request);
      default:
        await finish(logId, "failed", { error: "Unsupported channel" });
        return { ok: false, status: "failed", message: "That channel isn't supported." };
    }
  } catch (error) {
    console.error("Customer message failed", error instanceof Error ? error.message : error);
    await finish(logId, "failed", { error: "Unexpected error" });
    return { ok: false, status: "failed", message: "The message couldn't be sent. Nothing else was affected." };
  }
}

/** Existing inbox thread — created on demand so the owner can start a conversation. */
async function deliverInApp(logId: string, request: SendRequest): Promise<SendResult> {
  if (!request.customerUserId) {
    await finish(logId, "failed", { error: "No account" });
    return { ok: false, status: "failed", message: "This customer has no account inbox." };
  }
  const client = await db();
  const now = new Date().toISOString();

  const { data: existing } = await client
    .from("customer_conversations")
    .select("id")
    .eq("customer_user_id", request.customerUserId)
    .maybeSingle();

  let conversationId = existing?.id as string | undefined;
  if (!conversationId) {
    const { data: created, error } = await client
      .from("customer_conversations")
      .insert({ customer_user_id: request.customerUserId, last_message_at: now })
      .select("id")
      .maybeSingle();
    if (error || !created?.id) {
      await finish(logId, "failed", { error: "Conversation could not be opened" });
      return { ok: false, status: "failed", message: "We couldn't open a conversation with this customer." };
    }
    conversationId = created.id as string;
  }

  const { error: messageError } = await client.from("customer_conversation_messages").insert({
    conversation_id: conversationId,
    sender_user_id: request.actorUserId,
    sender_role: "staff",
    sender_name: "Flamio team",
    body: request.body,
    read_by_customer: false,
    read_by_staff: true,
  });
  if (messageError) {
    await finish(logId, "failed", { error: "Message not stored" });
    return { ok: false, status: "failed", message: "We couldn't send this message. Please try again." };
  }

  await client
    .from("customer_conversations")
    .update({ last_message_at: now })
    .eq("id", conversationId);

  // Existing notification system, unchanged. A push failure must not fail the message.
  try {
    const { notifyUsers } = await import("@/lib/push.server");
    await notifyUsers(
      [
        {
          userId: request.customerUserId,
          kind: "personal",
          status: "contact_message",
          title: "Message from Flamio",
          body: request.body.slice(0, 160),
        },
      ],
      { title: "Message from Flamio", body: request.body.slice(0, 160), url: "/account/inbox" },
    );
  } catch (error) {
    console.error("Inbox push notify failed", error instanceof Error ? error.message : error);
  }

  await finish(logId, "sent", { providerSlug: "in_app" });
  return { ok: true, status: "sent", message: "Sent to the customer's inbox." };
}

async function deliverPush(logId: string, request: SendRequest): Promise<SendResult> {
  if (!request.customerUserId) {
    await finish(logId, "failed", { error: "No account" });
    return { ok: false, status: "failed", message: "Push needs a signed-in device." };
  }
  const { notifyUsers, pushConfigured } = await import("@/lib/push.server");
  if (!pushConfigured()) {
    await finish(logId, "failed", { error: "Push keys missing" });
    return { ok: false, status: "failed", message: "Push isn't configured on the server." };
  }
  await notifyUsers(
    [
      {
        userId: request.customerUserId,
        kind: "personal",
        status: "owner_message",
        title: "Message from Flamio",
        body: request.body.slice(0, 160),
      },
    ],
    { title: "Message from Flamio", body: request.body.slice(0, 160), url: "/account/inbox" },
  );
  await finish(logId, "sent", { providerSlug: "web_push" });
  return { ok: true, status: "sent", message: "Pushed to the customer's devices." };
}

/** Reuses the existing SMS provider for a CRM purpose. No OTP logic involved. */
async function deliverSms(logId: string, request: SendRequest): Promise<SendResult> {
  const { sendSms } = await import("@/lib/sms.server");
  const result = await sendSms(request.phone, request.body);
  await finish(logId, result.ok ? "sent" : "failed", {
    providerSlug: "sms",
    error: result.ok ? null : result.message,
  });
  return { ok: result.ok, status: result.ok ? "sent" : "failed", message: result.message };
}

async function deliverWhatsApp(logId: string, request: SendRequest): Promise<SendResult> {
  const { getIntegration } = await import("@/lib/integrations.server");
  const integration = await getIntegration("whatsapp");
  if (!integration || integration.status !== "active") {
    await finish(logId, "failed", { providerSlug: "whatsapp", error: "Not active" });
    return { ok: false, status: "failed", message: "WhatsApp isn't connected and active." };
  }

  const to = normalizePhone(request.phone);
  const response = await fetch(
    `https://graph.facebook.com/v21.0/${encodeURIComponent(integration.config['phoneNumberId'] ?? "")}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env["WHATSAPP_ACCESS_TOKEN"]}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "text",
        text: { body: request.body },
      }),
    },
  );
  const payload = (await response.json().catch(() => null)) as
    | { messages?: { id?: string }[]; error?: { message?: string } }
    | null;

  if (!response.ok) {
    console.error("WhatsApp send rejected", response.status, payload?.error?.message);
    await finish(logId, "failed", {
      providerSlug: "whatsapp",
      error: payload?.error?.message?.slice(0, 200) ?? `HTTP ${response.status}`,
    });
    return { ok: false, status: "failed", message: "WhatsApp rejected this message." };
  }

  await finish(logId, "sent", {
    providerSlug: "whatsapp",
    providerMessageId: payload?.messages?.[0]?.id ?? null,
  });
  return { ok: true, status: "sent", message: "Handed to WhatsApp. Delivery is confirmed separately." };
}

async function deliverEmail(logId: string, request: SendRequest): Promise<SendResult> {
  const { getIntegration } = await import("@/lib/integrations.server");
  const integration = await getIntegration("email");
  if (!integration || integration.status !== "active") {
    await finish(logId, "failed", { providerSlug: "email", error: "Not active" });
    return { ok: false, status: "failed", message: "Email isn't connected and active." };
  }
  if (!request.customerEmail) {
    await finish(logId, "failed", { providerSlug: "email", error: "No email address" });
    return { ok: false, status: "failed", message: "This customer has no verified email address." };
  }

  const fromName = integration.config['fromName'] ?? "Flamio";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env["RESEND_API_KEY"]}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `${fromName} <${integration.config['fromEmail']}>`,
      to: [request.customerEmail],
      subject: request.subject?.trim() || "A message from Flamio",
      text: request.body,
    }),
  });
  const payload = (await response.json().catch(() => null)) as
    | { id?: string; message?: string }
    | null;

  if (!response.ok) {
    console.error("Email send rejected", response.status, payload?.message);
    await finish(logId, "failed", {
      providerSlug: "email",
      error: payload?.message?.slice(0, 200) ?? `HTTP ${response.status}`,
    });
    return { ok: false, status: "failed", message: "The email provider rejected this message." };
  }

  await finish(logId, "sent", { providerSlug: "email", providerMessageId: payload?.id ?? null });
  return { ok: true, status: "sent", message: "Handed to the email provider." };
}

/**
 * Server-side readiness gate. The browser never decides whether a channel can
 * be used — this re-checks the provider configuration for every single send.
 */
export async function assertChannelReady(
  rawPhone: string,
  channel: CommChannel,
): Promise<{ ok: boolean; message: string }> {
  const phone = normalizePhone(rawPhone);
  const validPhone = /^8801\d{9}$/.test(phone);

  if (channel === "in_app" || channel === "push") {
    if (channel === "push") {
      const { pushConfigured } = await import("@/lib/push.server");
      if (!pushConfigured()) return { ok: false, message: "Push isn't configured on the server." };
    }
    return { ok: true, message: "" };
  }

  if (channel === "sms") {
    if (!validPhone) {
      return { ok: false, message: "That phone number isn't a valid Bangladeshi mobile number." };
    }
    const { getSmsConfig } = await import("@/lib/sms.server");
    const config = await getSmsConfig().catch(() => null);
    if (!config?.isEnabled) return { ok: false, message: "The SMS provider is switched off." };
    if (!config.apiKeyStored) {
      return { ok: false, message: "No SMS credential is stored on the server." };
    }
    return { ok: true, message: "" };
  }

  const { getIntegration } = await import("@/lib/integrations.server");
  const integration = await getIntegration(channel === "whatsapp" ? "whatsapp" : "email");
  if (!integration || integration.status !== "active") {
    return {
      ok: false,
      message:
        channel === "whatsapp"
          ? "WhatsApp isn't connected and switched on in Settings → Integrations."
          : "Email isn't connected and switched on in Settings → Integrations.",
    };
  }
  if (channel === "whatsapp" && !validPhone) {
    return { ok: false, message: "That phone number isn't valid for WhatsApp." };
  }
  return { ok: true, message: "" };
}

/** Provider status names mapped onto our normalized set. Webhook use only. */
export function normalizeProviderStatus(raw: string): CommStatus | null {
  const value = raw.toLowerCase();
  if (["delivered", "email.delivered"].includes(value)) return "delivered";
  if (["sent", "email.sent", "accepted"].includes(value)) return "sent";
  if (["failed", "email.bounced", "undelivered", "email.failed"].includes(value)) return "failed";
  if (["queued", "email.queued", "accepted_queued"].includes(value)) return "queued";
  if (["cancelled", "canceled"].includes(value)) return "cancelled";
  if (value === "read") return "delivered";
  return null;
}

/**
 * Progress ranking. A webhook that arrives late must never walk a message
 * backwards: delivered stays delivered when a "sent" event turns up after it.
 */
const STATUS_RANK: Record<CommStatus, number> = {
  cancelled: 0,
  queued: 1,
  sending: 2,
  sent: 3,
  failed: 4,
  delivered: 5,
};

export async function applyProviderStatus(input: {
  providerSlug: string;
  providerMessageId: string;
  status: CommStatus;
}): Promise<void> {
  const client = await db();
  const now = new Date().toISOString();

  const { data: rows } = await client
    .from("communication_messages")
    .select("id, status, delivered_at")
    .eq("provider_slug", input.providerSlug)
    .eq("provider_message_id", input.providerMessageId);

  for (const row of (rows ?? []) as {
    id: string;
    status: CommStatus;
    delivered_at: string | null;
  }[]) {
    const current = STATUS_RANK[row.status] ?? 0;
    const incoming = STATUS_RANK[input.status] ?? 0;
    // A genuine provider failure is authoritative unless the message was
    // already confirmed delivered; every other weaker status is ignored.
    const isAuthoritativeFailure = input.status === "failed" && row.status !== "delivered";
    if (incoming <= current && !isAuthoritativeFailure) continue;

    const patch: Record<string, unknown> = { status: input.status, updated_at: now };
    if (input.status === "delivered" && !row.delivered_at) patch['delivered_at'] = now;
    // An existing delivered_at is never cleared.
    await client.from("communication_messages").update(patch).eq("id", row.id);
  }
}
