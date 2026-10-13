/**
 * Customer CRM — communication status, history and sending.
 *
 * Everything here is built on tables and helpers that already exist:
 *
 *   IN_APP   → existing `customer_conversations` inbox (account holders)
 *   PUSH     → existing `push_tokens` + configured VAPID keys
 *   SMS      → existing `sms_providers` row used by the login-code provider
 *              (same vendor, separate purpose; no OTP logic is touched)
 *   WHATSAPP → `sms_providers` row 'whatsapp' + server credential
 *   EMAIL    → `sms_providers` row 'email' + server credential
 *
 * A stored phone number or email address is never treated as a usable channel —
 * the provider must be configured, enabled and confirmed by a real connection
 * test first. Sending is idempotent and logged in `communication_messages`.
 */

import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { normalizePhone } from "@/lib/phone";

export type CommunicationChannel = "in_app" | "push" | "sms" | "whatsapp" | "email";

export type ChannelState = "available" | "unavailable" | "not_configured";

export interface ChannelStatus {
  channel: CommunicationChannel;
  label: string;
  state: ChannelState;
  /** Plain-language reason, safe to show to any authorised staff member. */
  detail: string;
}

export interface CommunicationPreference {
  category: "transactional" | "service" | "marketing";
  label: string;
  enabled: boolean;
  detail: string;
}

export interface CommunicationHistoryItem {
  id: string;
  channel: CommunicationChannel;
  category: "transactional" | "service" | "marketing";
  title: string;
  preview: string;
  createdAt: string;
  status: "sent" | "delivered" | "queued" | "failed" | "cancelled" | "sending";
}

export interface CrmCommunicationView {
  customerType: "guest" | "account";
  accountLinked: boolean;
  hasPhone: boolean;
  hasEmail: boolean;
  channels: ChannelStatus[];
  preferences: CommunicationPreference[];
  history: CommunicationHistoryItem[];
  canSeeHistory: boolean;
  /** True only when at least one channel can genuinely deliver today. */
  canMessage: boolean;
  /** True when this staff member is allowed to send, not just to look. */
  canSend: boolean;
  /** Channels a message can actually be sent on right now. */
  sendableChannels: CommunicationChannel[];
  /** Existing owner inbox conversation for this customer, when one exists. */
  conversationId: string | null;
  marketingOptIns: { channel: CommunicationChannel; optedIn: boolean }[];
}

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  in_app: "In-app inbox",
  push: "Phone / browser push",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

export const crmGetCommunication = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { phone: string }) => input)
  .handler(async ({ data, context }): Promise<CrmCommunicationView> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["customer_profiles", "customers"], "view");

    let canSeeHistory = true;
    try {
      await assertAnyPermission(
        context.userId,
        ["communication_logs", "customer_profiles", "customers"],
        "view",
      );
    } catch {
      canSeeHistory = false;
    }

    let canSend = true;
    try {
      await assertAnyPermission(context.userId, ["customer_messaging"], "manage");
    } catch {
      canSend = false;
    }

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");
    const { canonicalEmail } = await import("@/lib/crm-identity.server");
    const db = looseDb(supabaseAdmin);
    const phone = normalizePhone(data.phone);

    // Who is this, as an authentication identity? Same deterministic rule as
    // Phase 2, resolved through the CRM identity index and indexed order
    // queries instead of reading thousands of historical orders.
    const { resolveAuthUserIdByPhone } = await import("@/lib/crm-identity.server");
    const authUserId: string | null = await resolveAuthUserIdByPhone(data.phone);

    let email: string | null = null;
    if (authUserId) {
      const { data: profile } = await supabaseAdmin
        .from("profiles")
        .select("email")
        .eq("id", authUserId)
        .maybeSingle();
      email = canonicalEmail(profile?.email ?? null);
    }

    // PUSH — a real, active subscription plus configured server keys.
    const { pushConfigured } = await import("@/lib/push.server");
    let activeDevices = 0;
    if (authUserId) {
      const { data: tokens } = await db
        .from("push_tokens")
        .select("id")
        .eq("user_id", authUserId)
        .eq("is_active", true);
      activeDevices = (tokens ?? []).length;
    }

    // IN_APP — the existing customer inbox thread.
    let conversationId: string | null = null;
    if (authUserId) {
      const { data: conversation } = await db
        .from("customer_conversations")
        .select("id")
        .eq("customer_user_id", authUserId)
        .maybeSingle();
      conversationId = (conversation?.id as string | undefined) ?? null;
    }

    // Provider readiness, from the owner's own configuration.
    const { getSmsConfig } = await import("@/lib/sms.server");
    const { listIntegrations } = await import("@/lib/integrations.server");
    const [smsConfig, integrations] = await Promise.all([
      getSmsConfig().catch(() => null),
      listIntegrations().catch(() => []),
    ]);
    const whatsapp = integrations.find((row) => row.slug === "whatsapp") ?? null;
    const emailProvider = integrations.find((row) => row.slug === "email") ?? null;

    const validPhone = /^8801\d{9}$/.test(phone);
    const smsReady = Boolean(smsConfig?.isEnabled && smsConfig?.apiKeyStored) && validPhone;
    const whatsappReady = whatsapp?.status === "active" && validPhone;
    const emailReady = emailProvider?.status === "active" && Boolean(email);
    const pushReady = Boolean(authUserId) && activeDevices > 0 && pushConfigured();

    const providerDetail = (
      row: { status: string; missingFields: string[]; missingSecretNames: string[] } | null,
      channelName: string,
    ): string => {
      if (!row) return `${channelName} isn't set up yet.`;
      switch (row.status) {
        case "active":
          return `Connected and switched on.`;
        case "disabled":
          return `Configured but switched off in Settings → Integrations.`;
        case "configuration_required":
          return row.missingSecretNames.length > 0
            ? "The access credential isn't stored on the server yet."
            : row.missingFields.length > 0
              ? `Still needed: ${row.missingFields.join(", ")}.`
              : "Run a connection test in Settings → Integrations first.";
        case "error":
          return "The last connection test failed. Check Settings → Integrations.";
        default:
          return `${channelName} isn't configured yet.`;
      }
    };

    const channels: ChannelStatus[] = [
      {
        channel: "in_app",
        label: CHANNEL_LABELS.in_app,
        state: authUserId ? "available" : "unavailable",
        detail: authUserId
          ? conversationId
            ? "Account holder with an existing conversation."
            : "Account holder — a conversation is opened on the first message."
          : "Guest customer — there is no account inbox to deliver to.",
      },
      {
        channel: "push",
        label: CHANNEL_LABELS.push,
        state: pushReady ? "available" : "unavailable",
        detail: !authUserId
          ? "Guest customer — push needs a signed-in device."
          : activeDevices === 0
            ? "No device has notifications switched on."
            : pushConfigured()
              ? `${activeDevices} device${activeDevices === 1 ? "" : "s"} switched on.`
              : "Push keys are not configured on the server.",
      },
      {
        channel: "sms",
        label: CHANNEL_LABELS.sms,
        state: smsReady ? "available" : smsConfig?.isEnabled ? "unavailable" : "not_configured",
        detail: !validPhone
          ? "This phone number isn't a valid Bangladeshi mobile number."
          : !smsConfig
            ? "No SMS provider row exists."
            : !smsConfig.isEnabled
              ? "The SMS provider is switched off in Settings."
              : smsConfig.apiKeyStored
                ? "Connected through the configured SMS provider."
                : "No SMS credential is stored on the server.",
      },
      {
        channel: "whatsapp",
        label: CHANNEL_LABELS.whatsapp,
        state: whatsappReady
          ? "available"
          : whatsapp && whatsapp.status !== "not_configured"
            ? "unavailable"
            : "not_configured",
        detail: !validPhone
          ? "This phone number isn't a valid mobile number for WhatsApp."
          : providerDetail(whatsapp, "WhatsApp"),
      },
      {
        channel: "email",
        label: CHANNEL_LABELS.email,
        state: emailReady
          ? "available"
          : emailProvider && emailProvider.status !== "not_configured"
            ? "unavailable"
            : "not_configured",
        detail: !email
          ? "No email address is on this customer's account."
          : providerDetail(emailProvider, "Email"),
      },
    ];

    // Stored consent (Phase 4). Marketing needs an explicit opt-in per channel.
    const { readPreferences } = await import("@/lib/communication.server");
    const stored = await readPreferences(phone).catch(() => []);
    const marketingOptIns = (["push", "sms", "whatsapp", "email", "in_app"] as const).map(
      (channel) => ({
        channel: channel as CommunicationChannel,
        optedIn: stored.some(
          (row) => row.channel === channel && row.category === "marketing" && row.optedIn,
        ),
      }),
    );
    const anyMarketing = marketingOptIns.some((row) => row.optedIn);

    const preferences: CommunicationPreference[] = [
      {
        category: "transactional",
        label: "Order updates",
        enabled: true,
        detail: "Order notifications continue exactly as today, in-app and push.",
      },
      {
        category: "service",
        label: "Customer service replies",
        enabled: Boolean(authUserId) || smsReady || whatsappReady || emailReady,
        detail: authUserId
          ? "Replies reach this customer through their inbox and any connected channel."
          : smsReady || whatsappReady
            ? "No account inbox, but a connected channel can reach this phone number."
            : "Guest customer with no connected channel — nothing can be delivered.",
      },
      {
        category: "marketing",
        label: "Offers & promotions",
        enabled: anyMarketing,
        detail: anyMarketing
          ? `Opted in on: ${marketingOptIns
              .filter((row) => row.optedIn)
              .map((row) => CHANNEL_LABELS[row.channel])
              .join(", ")}.`
          : "Not opted in, so promotional messages are blocked for this customer.",
      },
    ];

    const history: CommunicationHistoryItem[] = [];
    if (canSeeHistory) {
      const { data: sentRows } = await db
        .from("communication_messages")
        .select("id, channel, category, status, body_preview, created_at")
        .eq("customer_phone", phone)
        .order("created_at", { ascending: false })
        .limit(40);

      for (const row of (sentRows ?? []) as Record<string, unknown>[]) {
        const channel = row['channel'] as CommunicationChannel;
        const status = row['status'] as CommunicationHistoryItem["status"];
        // Inbox and push messages are stored by the existing inbox /
        // notification systems and are listed from those records below. Their
        // send record is shown only when nothing was actually delivered, so one
        // action reads as one event instead of two. Both records are kept.
        const deliveredElsewhere =
          (channel === "in_app" || channel === "push") &&
          status !== "failed" &&
          status !== "cancelled";
        if (deliveredElsewhere) continue;
        history.push({
          id: `c-${row['id'] as string}`,
          channel: row['channel'] as CommunicationChannel,
          category: row['category'] as CommunicationHistoryItem["category"],
          title: `Sent via ${CHANNEL_LABELS[row['channel'] as CommunicationChannel] ?? "channel"}`,
          preview: String(row['body_preview'] ?? "").slice(0, 140),
          createdAt: row['created_at'] as string,
          status: row['status'] as CommunicationHistoryItem["status"],
        });
      }
    }

    if (canSeeHistory && authUserId) {
      const [{ data: notifications }, { data: messages }] = await Promise.all([
        db
          .from("notifications")
          .select("id, kind, status, title, body, created_at")
          .eq("user_id", authUserId)
          .order("created_at", { ascending: false })
          .limit(30),
        conversationId
          ? db
              .from("customer_conversation_messages")
              .select("id, sender_role, sender_name, body, created_at")
              .eq("conversation_id", conversationId)
              .order("created_at", { ascending: false })
              .limit(30)
          : Promise.resolve({ data: [] as unknown[] }),
      ]);

      for (const row of (notifications ?? []) as {
        id: string;
        kind: string | null;
        status: string | null;
        title: string;
        body: string | null;
        created_at: string;
      }[]) {
        // An inbox message also raises a notification for the same action; the
        // conversation message below is the single event for it. The
        // notification row itself is left untouched for the existing bell.
        if (row.status === "contact_message" && conversationId) continue;
        history.push({
          id: `n-${row.id}`,
          channel: row.status === "owner_message" ? "push" : "in_app",
          category: row.kind === "broadcast" ? "marketing" : "transactional",
          title: row.title,
          preview: (row.body ?? "").slice(0, 140),
          createdAt: row.created_at,
          status: "sent",
        });
      }

      for (const row of (messages ?? []) as {
        id: string;
        sender_role: string;
        sender_name: string | null;
        body: string;
        created_at: string;
      }[]) {
        history.push({
          id: `m-${row.id}`,
          channel: "in_app",
          category: "service",
          title: row.sender_role === "staff" ? "Reply from the team" : "Message from customer",
          preview: row.body.slice(0, 140),
          createdAt: row.created_at,
          status: "sent",
        });
      }
    }

    history.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    const sendableChannels = channels
      .filter((row) => row.state === "available")
      .map((row) => row.channel);

    return {
      customerType: authUserId ? "account" : "guest",
      accountLinked: Boolean(authUserId),
      hasPhone: phone.length > 5,
      hasEmail: Boolean(email),
      channels,
      preferences,
      history: history.slice(0, 40),
      canSeeHistory,
      canMessage: sendableChannels.length > 0,
      canSend,
      sendableChannels,
      conversationId,
      marketingOptIns,
    };
  });

/**
 * Sends one message to one customer on one channel. Permission, consent,
 * provider readiness and idempotency are all enforced on the server.
 */
export const crmSendCustomerMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        phone: z.string().min(6).max(30),
        channel: z.enum(["in_app", "push", "sms", "whatsapp", "email"]),
        category: z.enum(["transactional", "service", "marketing"]),
        subject: z.string().trim().max(150).nullable().optional(),
        body: z.string().trim().min(1).max(1200),
        requestId: z.string().min(8).max(80),
      })
      .parse(input),
  )
  .handler(
    async ({ data, context }): Promise<{ ok: boolean; message: string; duplicate?: boolean }> => {
      const { assertPermission } = await import("@/lib/owner.server");
      await assertPermission(context.userId, "customer_messaging");

      // Provider readiness is re-checked here on the server, never trusted from
      // the browser. (Server-only helpers, not the read server function.)
      const { assertChannelReady } = await import("@/lib/communication.server");
      const ready = await assertChannelReady(data.phone, data.channel);
      if (!ready.ok) return { ok: false, message: ready.message };


      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { normalizePhone: canonical } = await import("@/lib/phone");
      const phone = canonical(data.phone);

      const { resolveAuthUserIdByPhone } = await import("@/lib/crm-identity.server");
      const customerUserId = await resolveAuthUserIdByPhone(data.phone);

      let customerEmail: string | null = null;
      if (customerUserId) {
        const { data: profile } = await supabaseAdmin
          .from("profiles")
          .select("email")
          .eq("id", customerUserId)
          .maybeSingle();
        customerEmail = profile?.email ?? null;
      }

      const { sendCustomerMessage } = await import("@/lib/communication.server");
      const result = await sendCustomerMessage({
        phone: data.phone,
        channel: data.channel,
        category: data.category,
        body: data.body,
        subject: data.subject ?? null,
        actorUserId: context.userId,
        customerUserId,
        customerEmail,
        requestId: data.requestId,
      });

      return { ok: result.ok, message: result.message, duplicate: Boolean(result.duplicate) };
    },
  );

/** Owner-recorded marketing consent per channel. Transactional is never gated. */
export const crmSetMarketingConsent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        phone: z.string().min(6).max(30),
        channel: z.enum(["in_app", "push", "sms", "whatsapp", "email"]),
        optedIn: z.boolean(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "customer_messaging");
    const { setPreference } = await import("@/lib/communication.server");
    await setPreference({
      phone: data.phone,
      channel: data.channel,
      category: "marketing",
      optedIn: data.optedIn,
      actorUserId: context.userId,
    });
    return { ok: true };
  });
