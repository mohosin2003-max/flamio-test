/**
 * Real phone push delivery (Web Push / RFC 8291) for Flamio.
 *
 * Server-only. Reuses the EXISTING tables:
 *  - public.push_tokens                 — one row per browser/PWA subscription
 *  - public.notifications               — the in-app history the bell reads
 *  - public.notification_push_deliveries — per-token delivery outcome (audit)
 *  - public.notification_jobs          — delayed/idempotent scheduled sends
 *
 * Nothing here decides permissions on its own; callers use the existing
 * assertOwner / assertPermission helpers, and every recipient list is resolved
 * from `user_roles` + `staff_permissions`.
 */

import { buildPushPayload } from "@block65/webcrypto-web-push";

import type { StaffPermission } from "@/lib/permissions";

export type NotificationKind =
  | "order_status"
  | "order_message"
  | "review_request"
  | "personal"
  | "broadcast"
  | "staff_new_order"
  | "owner_escalation";

export type PushPayload = {
  title: string;
  body: string;
  url: string;
  tag?: string;
  /** Silent = no sound, no vibration (used for the review reminder). */
  silent?: boolean;
  requireInteraction?: boolean;
  urgency?: "low" | "normal" | "high";
  /** Optional vibration pattern (ms); honoured only where the platform supports it. */
  vibrate?: number[];
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  token: string;
  p256dh: string | null;
  auth: string | null;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { looseDb } = await import("@/integrations/supabase/loose.server");
  // The generated types don't yet know the newest notification columns; the
  // client, auth and RLS are unchanged.
  return looseDb(supabaseAdmin);
}

function vapidKeys() {
  return {
    subject: process.env["VAPID_SUBJECT"] ?? "mailto:notifications@flamio.app",
    publicKey: process.env["VAPID_PUBLIC_KEY"],
    privateKey: process.env["VAPID_PRIVATE_KEY"],
  };
}

export type NotificationSettings = {
  reviewReminderDelayMinutes: number;
  staffAckTimeoutMinutes: number;
  staffOrderSoundEnabled: boolean;
  ownerEscalationEnabled: boolean;
};

export async function getNotificationSettings(): Promise<NotificationSettings> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("restaurant_settings")
    .select(
      "review_reminder_delay_minutes, staff_ack_timeout_minutes, staff_order_sound_enabled, owner_escalation_enabled",
    )
    .order("created_at")
    .limit(1)
    .maybeSingle();

  return {
    reviewReminderDelayMinutes: Number(data?.review_reminder_delay_minutes ?? 5) || 5,
    staffAckTimeoutMinutes: Number(data?.staff_ack_timeout_minutes ?? 2) || 2,
    staffOrderSoundEnabled: data?.staff_order_sound_enabled !== false,
    ownerEscalationEnabled: data?.owner_escalation_enabled !== false,
  };
}

/* ------------------------------------------------------------------ */
/* Recipients — reuses the existing roles + staff permissions          */
/* ------------------------------------------------------------------ */

export async function managerUserIds(): Promise<string[]> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("user_roles")
    .select("user_id, role")
    .in("role", ["owner", "admin"]);
  return [...new Set((data ?? []).map((r) => r.user_id as string))];
}

/** Owners/managers plus every staff member holding one of these permissions. */
export async function recipientsWithPermission(
  permissions: StaffPermission[],
): Promise<string[]> {
  const supabaseAdmin = await admin();
  const managers = await managerUserIds();

  const { data: staffRoles } = await supabaseAdmin
    .from("user_roles")
    .select("user_id")
    .eq("role", "staff");
  const staffIds = new Set((staffRoles ?? []).map((r) => r.user_id as string));

  const { data: perms } = await supabaseAdmin
    .from("staff_permissions")
    .select("user_id, permission")
    .in("permission", permissions);

  const granted = (perms ?? [])
    .map((r) => r.user_id as string)
    .filter((id) => staffIds.has(id));

  return [...new Set([...managers, ...granted])];
}

/* ------------------------------------------------------------------ */
/* In-app history (idempotent)                                         */
/* ------------------------------------------------------------------ */

export type NotificationDraft = {
  userId: string;
  kind: NotificationKind;
  title: string;
  body: string;
  orderId?: string | null;
  orderCode?: string | null;
  /** Legacy tag the customer bell already understands for routing. */
  status?: string | null;
  /** Same key twice = same notification. Retries can never duplicate. */
  dedupeKey?: string | null;
};

/** Inserts notification rows, skipping any whose dedupe key already exists. */
export async function createNotifications(
  drafts: NotificationDraft[],
): Promise<Map<string, string>> {
  const byUser = new Map<string, string>();
  if (drafts.length === 0) return byUser;

  const supabaseAdmin = await admin();
  const keys = drafts.map((d) => d.dedupeKey).filter((k): k is string => Boolean(k));

  const existing = new Set<string>();
  if (keys.length > 0) {
    const { data } = await supabaseAdmin
      .from("notifications")
      .select("id, user_id, dedupe_key")
      .in("dedupe_key", keys);
    for (const row of data ?? []) {
      existing.add(row.dedupe_key as string);
      byUser.set(row.user_id as string, row.id as string);
    }
  }

  const fresh = drafts.filter((d) => !d.dedupeKey || !existing.has(d.dedupeKey));
  if (fresh.length === 0) return byUser;

  const { data, error } = await supabaseAdmin
    .from("notifications")
    .insert(
      fresh.map((d) => ({
        user_id: d.userId,
        kind: d.kind,
        title: d.title,
        body: d.body,
        order_id: d.orderId ?? null,
        order_code: d.orderCode ?? null,
        status: d.status ?? null,
        dedupe_key: d.dedupeKey ?? null,
      })),
    )
    .select("id, user_id");

  if (error) {
    console.error("Notification insert failed", error);
    return byUser;
  }
  for (const row of data ?? []) byUser.set(row.user_id as string, row.id as string);
  return byUser;
}

/* ------------------------------------------------------------------ */
/* Push delivery                                                       */
/* ------------------------------------------------------------------ */

export function pushConfigured(): boolean {
  const { publicKey, privateKey } = vapidKeys();
  return Boolean(publicKey && privateKey);
}

/**
 * Sends one payload to every active subscription of these users.
 * Dead subscriptions (404/410) are deactivated so they stop being retried.
 */
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
  notificationIdByUser?: Map<string, string>,
): Promise<{ sent: number; failed: number }> {
  const unique = [...new Set(userIds)].filter(Boolean);
  if (unique.length === 0) return { sent: 0, failed: 0 };
  if (!pushConfigured()) {
    console.warn("Push keys are not configured — in-app notification only");
    return { sent: 0, failed: 0 };
  }

  const supabaseAdmin = await admin();
  const { data, error } = await supabaseAdmin
    .from("push_tokens")
    .select("id, user_id, token, p256dh, auth")
    .in("user_id", unique)
    .eq("is_active", true);

  if (error) {
    console.error("Push token lookup failed", error);
    return { sent: 0, failed: 0 };
  }

  const subscriptions = (data ?? []) as SubscriptionRow[];
  let sent = 0;
  let failed = 0;

  await Promise.all(
    subscriptions.map(async (row) => {
      if (!row.p256dh || !row.auth) return;
      const notificationId = notificationIdByUser?.get(row.user_id) ?? null;
      try {
        const message = {
          data: {
            title: payload.title,
            body: payload.body,
            url: payload.url,
            tag: payload.tag ?? null,
            silent: payload.silent === true,
            requireInteraction: payload.requireInteraction === true,
            ...(payload.vibrate ? { vibrate: payload.vibrate } : {}),
          },
          options: { ttl: 3600, urgency: payload.urgency ?? "normal" } as const,
        };
        const built = await buildPushPayload(
          message,
          {
            endpoint: row.token,
            expirationTime: null,
            keys: { p256dh: row.p256dh, auth: row.auth },
          },
          vapidKeys(),
        );

        const response = await fetch(row.token, {
          method: built.method,
          headers: built.headers,
          body: built.body as unknown as BodyInit,
        });

        if (response.ok) {
          sent += 1;
          if (notificationId) {
            await supabaseAdmin.from("notification_push_deliveries").insert({
              notification_id: notificationId,
              push_token_id: row.id,
              status: "sent",
              attempt_count: 1,
            });
          }
          return;
        }

        failed += 1;
        const detail = `${response.status} ${await response.text().catch(() => "")}`.slice(0, 300);
        if (response.status === 404 || response.status === 410) {
          await supabaseAdmin
            .from("push_tokens")
            .update({ is_active: false })
            .eq("id", row.id);
        }
        if (notificationId) {
          await supabaseAdmin.from("notification_push_deliveries").insert({
            notification_id: notificationId,
            push_token_id: row.id,
            status: "failed",
            attempt_count: 1,
            last_error: detail,
          });
        }
      } catch (pushError) {
        failed += 1;
        console.error("Push send failed", pushError);
      }
    }),
  );

  return { sent, failed };
}

/** In-app history + real push in one call. */
export async function notifyUsers(
  drafts: NotificationDraft[],
  payload: PushPayload,
): Promise<{ sent: number; failed: number }> {
  const ids = await createNotifications(drafts);
  return sendPushToUsers(
    drafts.map((d) => d.userId),
    payload,
    ids,
  );
}

/* ------------------------------------------------------------------ */
/* Scheduled jobs                                                      */
/* ------------------------------------------------------------------ */

type JobRow = {
  id: string;
  kind: "review_reminder" | "staff_new_order" | "owner_escalation";
  order_id: string | null;
  user_id: string | null;
};

type OrderRow = {
  id: string;
  code: string;
  status: string;
  user_id: string | null;
  channel: string | null;
};

async function loadOrder(orderId: string): Promise<OrderRow | null> {
  const supabaseAdmin = await admin();
  const { data } = await supabaseAdmin
    .from("orders")
    .select("id, code, status, user_id, channel")
    .eq("id", orderId)
    .maybeSingle();
  return (data as OrderRow) ?? null;
}

async function runReviewReminder(job: JobRow): Promise<void> {
  if (!job.order_id) return;
  const order = await loadOrder(job.order_id);
  if (!order?.user_id) return;

  const supabaseAdmin = await admin();

  // Already reviewed? Then never remind.
  const { data: review } = await supabaseAdmin
    .from("order_reviews")
    .select("id")
    .eq("order_id", order.id)
    .eq("user_id", order.user_id)
    .maybeSingle();
  if (review) return;

  // The existing DB trigger already wrote the in-app review row; reuse it so
  // the same order is never listed twice.
  const { data: existing } = await supabaseAdmin
    .from("notifications")
    .select("id")
    .eq("order_id", order.id)
    .eq("status", "review_request")
    .limit(1)
    .maybeSingle();

  let notificationId = existing?.id as string | undefined;
  if (!notificationId) {
    const ids = await createNotifications([
      {
        userId: order.user_id,
        kind: "review_request",
        status: "review_request",
        title: "How was your Flamio experience?",
        body: "Tap to leave a quick review.",
        orderId: order.id,
        orderCode: order.code,
        dedupeKey: `review_request:${order.id}`,
      },
    ]);
    notificationId = ids.get(order.user_id);
  }

  const map = new Map<string, string>();
  if (notificationId) map.set(order.user_id, notificationId);

  await sendPushToUsers(
    [order.user_id],
    {
      title: "How was your Flamio experience?",
      body: "Tap to leave a quick review.",
      url: `/account/review/${order.id}`,
      tag: `review-${order.id}`,
      silent: true,
      urgency: "low",
    },
    map,
  );
}

async function runStaffNewOrder(job: JobRow): Promise<void> {
  if (!job.order_id) return;
  const order = await loadOrder(job.order_id);
  if (!order) return;
  // Already acknowledged (moved past "placed") or closed — stay quiet.
  if (order.status !== "placed") return;

  const settings = await getNotificationSettings();
  const recipients = await recipientsWithPermission(["order_management", "online_orders"]);
  if (recipients.length === 0) return;

  await notifyUsers(
    recipients.map((userId) => ({
      userId,
      kind: "staff_new_order" as const,
      status: "staff_new_order",
      title: `New Order ${order.code}`,
      body: "A new order needs your attention.",
      orderId: order.id,
      orderCode: order.code,
      dedupeKey: `staff_new_order:${order.id}:${userId}`,
    })),
    {
      title: `NEW ORDER #${order.code}`,
      body: "New order waiting — tap to open and accept it.",
      url: `/owner/orders/${order.id}`,
      tag: `order-${order.id}`,
      silent: !settings.staffOrderSoundEnabled,
      requireInteraction: true,
      urgency: "high",
      vibrate: [500, 200, 500, 200, 500, 200, 800],
    },
  );
}

async function runOwnerEscalation(job: JobRow): Promise<void> {
  if (!job.order_id) return;
  const settings = await getNotificationSettings();
  if (!settings.ownerEscalationEnabled) return;

  const order = await loadOrder(job.order_id);
  if (!order) return;
  // Acknowledged in the meantime — no escalation.
  if (order.status !== "placed") return;

  const owners = await managerUserIds();
  if (owners.length === 0) return;

  await notifyUsers(
    owners.map((userId) => ({
      userId,
      kind: "owner_escalation" as const,
      status: "owner_escalation",
      title: `Order ${order.code} needs attention`,
      body: "Assigned staff has not acknowledged the order.",
      orderId: order.id,
      orderCode: order.code,
      dedupeKey: `owner_escalation:${order.id}:${userId}`,
    })),
    {
      title: `Order ${order.code} needs attention`,
      body: "Assigned staff has not acknowledged the order.",
      url: `/owner/orders?order=${order.id}`,
      tag: `escalation-${order.id}`,
      urgency: "high",
    },
  );
}

/**
 * Claims and runs every due job. Claiming is atomic in the database
 * (`claim_notification_jobs` uses FOR UPDATE SKIP LOCKED), so two overlapping
 * runs can never send the same notification twice.
 */
export async function dispatchDueNotificationJobs(
  limit = 25,
): Promise<{ processed: number; failed: number }> {
  const supabaseAdmin = await admin();
  const { data, error } = await supabaseAdmin.rpc("claim_notification_jobs", {
    _limit: limit,
  });

  if (error) {
    console.error("Job claim failed", error);
    return { processed: 0, failed: 0 };
  }

  const jobs = (data ?? []) as JobRow[];
  let processed = 0;
  let failed = 0;

  for (const job of jobs) {
    try {
      if (job.kind === "review_reminder") await runReviewReminder(job);
      else if (job.kind === "staff_new_order") await runStaffNewOrder(job);
      else await runOwnerEscalation(job);

      await supabaseAdmin
        .from("notification_jobs")
        .update({ status: "done", last_error: null })
        .eq("id", job.id);
      processed += 1;
    } catch (jobError) {
      failed += 1;
      console.error("Notification job failed", job.kind, jobError);
      await supabaseAdmin
        .from("notification_jobs")
        .update({
          status: "failed",
          last_error: jobError instanceof Error ? jobError.message.slice(0, 300) : "unknown",
        })
        .eq("id", job.id);
    }
  }

  return { processed, failed };
}
