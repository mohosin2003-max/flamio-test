/**
 * Server-only engine for the owner's Data & Storage Management area.
 *
 * Rules enforced here (never in the browser):
 *  - only finished / technical data is ever eligible;
 *  - protected records are recognised and refused even if an id is posted
 *    directly to the endpoint;
 *  - files are only removed when the database proves nothing references them;
 *  - every action writes an audit row with real per-record outcomes.
 *
 * Existing tables are only read and (for eligible rows) deleted — no schema,
 * policy or bucket is changed anywhere in this file.
 */

import {
  CLEANUP_CATEGORIES,
  CLEANUP_CATEGORY_INFO,
  type CleanupCategory,
} from "@/lib/cleanup-categories";

/* eslint-disable @typescript-eslint/no-explicit-any */

const FINAL_ORDER_STATUSES = ["completed", "cancelled"] as const;
const FINISHED_JOB_STATUSES = ["done", "cancelled", "failed"] as const;
const BUSY_MESSAGE_STATUSES = ["queued", "sending"] as const;

export const KNOWN_BUCKETS = [
  "banner-images",
  "review-photos",
  "profile-photos",
  "product-images",
] as const;

export interface Candidate {
  id: string;
  label: string;
  detail: string | null;
  occurredAt: string | null;
  /** null → eligible. Any text → protected, with the reason shown to the owner. */
  protectedReason: string | null;
}

export interface CleanupSettingRow {
  category: CleanupCategory;
  autoEnabled: boolean;
  retentionDays: number;
  frequencyDays: number;
  requireApproval: boolean;
  unlocked: boolean;
  approvedAt: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
}

export interface CleanupGlobalState {
  autoPaused: boolean;
  pausedReason: string | null;
  largeDeletionThreshold: number;
}

export interface CleanupConfig {
  /** false → docs/sql/data_cleanup.sql has not been run yet. */
  installed: boolean;
  settings: CleanupSettingRow[];
  state: CleanupGlobalState;
}

async function db(): Promise<any> {
  const { untypedAdmin } = await import("@/lib/untyped-db.server");
  return untypedAdmin();
}

function cutoffFor(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

export function defaultSetting(category: CleanupCategory): CleanupSettingRow {
  const info = CLEANUP_CATEGORY_INFO[category];
  return {
    category,
    autoEnabled: false,
    retentionDays: info.defaultRetentionDays,
    frequencyDays: info.defaultFrequencyDays,
    requireApproval: true,
    unlocked: false,
    approvedAt: null,
    lastRunAt: null,
    nextRunAt: null,
  };
}

/* ------------------------------------------------------------------ settings */

export async function readConfig(): Promise<CleanupConfig> {
  const client = await db();
  const defaults = CLEANUP_CATEGORIES.map(defaultSetting);

  const { data: rows, error } = await client.from("cleanup_settings").select("*");
  if (error) {
    return {
      installed: false,
      settings: defaults,
      state: { autoPaused: false, pausedReason: null, largeDeletionThreshold: 500 },
    };
  }

  const byId = new Map<string, any>((rows ?? []).map((row: any) => [row.category, row]));
  const settings = defaults.map((base) => {
    const row = byId.get(base.category);
    if (!row) return base;
    return {
      category: base.category,
      autoEnabled: Boolean(row.auto_enabled),
      retentionDays: Number(row.retention_days ?? base.retentionDays),
      frequencyDays: Number(row.frequency_days ?? base.frequencyDays),
      requireApproval: row.require_approval !== false,
      unlocked: Boolean(row.unlocked),
      approvedAt: row.approved_at ?? null,
      lastRunAt: row.last_run_at ?? null,
      nextRunAt: row.next_run_at ?? null,
    } satisfies CleanupSettingRow;
  });

  const { data: stateRow } = await client
    .from("cleanup_state")
    .select("*")
    .eq("id", "global")
    .maybeSingle();

  return {
    installed: true,
    settings,
    state: {
      autoPaused: Boolean(stateRow?.auto_paused),
      pausedReason: stateRow?.paused_reason ?? null,
      largeDeletionThreshold: Number(stateRow?.large_deletion_threshold ?? 500),
    },
  };
}

export async function getSetting(category: CleanupCategory): Promise<CleanupSettingRow> {
  const config = await readConfig();
  return config.settings.find((s) => s.category === category) ?? defaultSetting(category);
}

function nextRunFrom(frequencyDays: number, from = new Date()): string {
  return new Date(from.getTime() + frequencyDays * 24 * 60 * 60 * 1000).toISOString();
}

export async function saveSetting(
  userId: string,
  category: CleanupCategory,
  patch: {
    autoEnabled?: boolean | undefined;
    retentionDays?: number | undefined;
    frequencyDays?: number | undefined;
    requireApproval?: boolean | undefined;
    unlocked?: boolean | undefined;
  },
): Promise<CleanupSettingRow> {
  const info = CLEANUP_CATEGORY_INFO[category];
  const current = await getSetting(category);
  const client = await db();

  const autoEnabled = patch.autoEnabled ?? current.autoEnabled;
  if (autoEnabled && !info.autoSupported) {
    throw new Error(`${info.label} can only be cleaned manually.`);
  }
  if (autoEnabled && info.highRisk && !(patch.unlocked ?? current.unlocked)) {
    throw new Error(`Unlock ${info.label} before turning automatic cleanup on.`);
  }

  const frequencyDays = patch.frequencyDays ?? current.frequencyDays;
  const row = {
    category,
    auto_enabled: autoEnabled,
    retention_days: patch.retentionDays ?? current.retentionDays,
    frequency_days: frequencyDays,
    require_approval: patch.requireApproval ?? current.requireApproval,
    unlocked: patch.unlocked ?? current.unlocked,
    // Turning automation off clears the schedule instead of deleting anything.
    next_run_at: autoEnabled ? (current.nextRunAt ?? nextRunFrom(frequencyDays)) : null,
    updated_by: userId,
    updated_at: new Date().toISOString(),
  };

  const { error } = await client.from("cleanup_settings").upsert(row, { onConflict: "category" });
  if (error) throw new Error(settingsError(error));
  return getSetting(category);
}

function settingsError(error: any): string {
  const message = String(error?.message ?? "");
  if (/does not exist|schema cache/i.test(message)) {
    return "Cleanup settings aren't installed yet. Run docs/sql/data_cleanup.sql once in your database.";
  }
  return message || "Couldn't save the cleanup settings.";
}

export async function approveCategory(userId: string, category: CleanupCategory): Promise<void> {
  const current = await getSetting(category);
  const client = await db();
  const { error } = await client.from("cleanup_settings").upsert(
    {
      category,
      auto_enabled: current.autoEnabled,
      retention_days: current.retentionDays,
      frequency_days: current.frequencyDays,
      require_approval: current.requireApproval,
      unlocked: current.unlocked,
      approved_at: new Date().toISOString(),
      next_run_at: current.nextRunAt ?? nextRunFrom(current.frequencyDays),
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "category" },
  );
  if (error) throw new Error(settingsError(error));
}

export async function setGlobalState(
  userId: string | null,
  patch: {
    autoPaused?: boolean | undefined;
    pausedReason?: string | null | undefined;
    largeDeletionThreshold?: number | undefined;
  },
): Promise<void> {
  const client = await db();
  const current = (await readConfig()).state;
  const { error } = await client.from("cleanup_state").upsert(
    {
      id: "global",
      auto_paused: patch.autoPaused ?? current.autoPaused,
      paused_reason: patch.pausedReason === undefined ? current.pausedReason : patch.pausedReason,
      large_deletion_threshold: patch.largeDeletionThreshold ?? current.largeDeletionThreshold,
      updated_by: userId,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  );
  if (error) throw new Error(settingsError(error));
}

/** Stops the next scheduled run for every category without deleting anything. */
export async function stopAllAutomatic(userId: string, reason: string): Promise<void> {
  await setGlobalState(userId, { autoPaused: true, pausedReason: reason });
  await logRun({
    runType: "control",
    category: "all",
    status: "cancelled",
    initiatedBy: userId,
    initiatedLabel: "Owner",
    errorSummary: reason,
    items: [],
  });
}

export async function disableAllAutomatic(userId: string): Promise<void> {
  const client = await db();
  const config = await readConfig();
  for (const setting of config.settings) {
    if (!setting.autoEnabled) continue;
    const { error } = await client.from("cleanup_settings").upsert(
      {
        category: setting.category,
        auto_enabled: false,
        retention_days: setting.retentionDays,
        frequency_days: setting.frequencyDays,
        require_approval: setting.requireApproval,
        unlocked: setting.unlocked,
        next_run_at: null,
        updated_by: userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "category" },
    );
    if (error) throw new Error(settingsError(error));
  }
  await logRun({
    runType: "control",
    category: "all",
    status: "completed",
    initiatedBy: userId,
    initiatedLabel: "Owner",
    errorSummary: "Automatic cleanup disabled for every category.",
    items: [],
  });
}

/* ------------------------------------------------------------- candidate data */

async function activeOrderIds(): Promise<Set<string>> {
  const client = await db();
  const { data } = await client
    .from("orders")
    .select("id")
    .not("status", "in", `(${FINAL_ORDER_STATUSES.join(",")})`);
  return new Set((data ?? []).map((row: any) => row.id as string));
}

async function ordersWithStock(orderIds: string[]): Promise<Set<string>> {
  if (orderIds.length === 0) return new Set();
  const client = await db();
  const { data } = await client
    .from("inventory_movements")
    .select("order_id")
    .in("order_id", orderIds);
  return new Set((data ?? []).map((row: any) => row.order_id as string).filter(Boolean));
}

async function listOrderCandidates(
  status: "completed" | "cancelled",
  cutoff: string,
  limit: number,
): Promise<Candidate[]> {
  const client = await db();
  const { data, error } = await client
    .from("orders")
    .select("id, code, status, total, customer_name, created_at")
    .lt("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as any[];
  const stock = await ordersWithStock(rows.map((row) => row.id));

  return rows.map((row) => {
    let reason: string | null = null;
    if (row.status !== status) {
      reason =
        row.status === "completed" || row.status === "cancelled"
          ? "Belongs to another order category"
          : "Still an active order";
    } else if (stock.has(row.id)) {
      reason = "Linked to stock movement history";
    }
    return {
      id: row.id,
      label: row.code ? `Order ${row.code}` : "Order",
      detail: [row.customer_name, row.total != null ? `৳${row.total}` : null]
        .filter(Boolean)
        .join(" · ") || null,
      occurredAt: row.created_at ?? null,
      protectedReason: reason,
    } satisfies Candidate;
  });
}

async function listCandidates(
  category: CleanupCategory,
  cutoff: string,
  limit: number,
): Promise<Candidate[]> {
  const client = await db();

  switch (category) {
    case "notifications": {
      const { data, error } = await client
        .from("notifications")
        .select("id, title, body, order_id, is_read, created_at")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      const active = await activeOrderIds();
      return (data ?? []).map((row: any) => ({
        id: row.id,
        label: row.title || "Notification",
        detail: row.body ? String(row.body).slice(0, 120) : null,
        occurredAt: row.created_at ?? null,
        protectedReason:
          row.order_id && active.has(row.order_id) ? "Belongs to an active order" : null,
      }));
    }

    case "push_deliveries": {
      const { data, error } = await client
        .from("notification_push_deliveries")
        .select("id, status, provider_message_id, created_at")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        label: `Delivery record (${row.status ?? "unknown"})`,
        detail: row.provider_message_id ?? null,
        occurredAt: row.created_at ?? null,
        protectedReason: null,
      }));
    }

    case "notification_jobs": {
      const { data, error } = await client
        .from("notification_jobs")
        .select("id, kind, status, created_at")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        label: `${row.kind ?? "Job"} (${row.status ?? "unknown"})`,
        detail: null,
        occurredAt: row.created_at ?? null,
        protectedReason: (FINISHED_JOB_STATUSES as readonly string[]).includes(row.status)
          ? null
          : "Still scheduled to run",
      }));
    }

    case "expired_push_tokens": {
      const { data, error } = await client
        .from("push_tokens")
        .select("id, platform, is_active, failure_count, last_seen_at, created_at")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        label: `${row.platform ?? "Device"} subscription`,
        detail: row.last_seen_at ? `Last seen ${row.last_seen_at.slice(0, 10)}` : null,
        occurredAt: row.created_at ?? null,
        protectedReason: row.is_active === false ? null : "Device subscription is still active",
      }));
    }

    case "communication_log": {
      const { data, error } = await client
        .from("communication_messages")
        .select("id, channel, category, status, body_preview, created_at")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        label: `${row.channel ?? "message"} · ${row.category ?? ""}`.trim(),
        detail: row.body_preview ? String(row.body_preview).slice(0, 120) : null,
        occurredAt: row.created_at ?? null,
        protectedReason: (BUSY_MESSAGE_STATUSES as readonly string[]).includes(row.status)
          ? "Still being sent"
          : null,
      }));
    }

    case "completed_orders":
      return listOrderCandidates("completed", cutoff, limit);

    case "cancelled_orders":
      return listOrderCandidates("cancelled", cutoff, limit);

    case "old_reviews": {
      const { data, error } = await client
        .from("order_reviews")
        .select("id, rating, comment, status, photo_path, created_at")
        .lt("created_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(limit);
      if (error) throw new Error(error.message);
      return (data ?? []).map((row: any) => ({
        id: row.id,
        label: `${row.rating ?? "?"}★ review`,
        detail: row.comment ? String(row.comment).slice(0, 120) : null,
        occurredAt: row.created_at ?? null,
        protectedReason: row.status === "pending" ? "Waiting for your moderation" : null,
      }));
    }

    case "orphan_files": {
      const files = await scanStorage();
      return files
        .filter((file) => file.status !== "referenced")
        .slice(0, limit)
        .map((file) => ({
          id: `${file.bucket}/${file.path}`,
          label: file.path.split("/").pop() ?? file.path,
          detail: `${file.bucket} · ${formatBytes(file.bytes)}`,
          occurredAt: file.createdAt,
          protectedReason: file.status === "orphaned" ? null : "Reference could not be verified",
        }));
    }
  }
}

export function formatBytes(bytes: number | null): string {
  if (bytes == null) return "size unknown";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------- storage */

export interface StorageFile {
  bucket: string;
  path: string;
  bytes: number | null;
  createdAt: string | null;
  referencedBy: string | null;
  status: "referenced" | "orphaned" | "unknown";
}

async function listBucketFiles(bucket: string): Promise<{ path: string; bytes: number | null; createdAt: string | null }[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const out: { path: string; bytes: number | null; createdAt: string | null }[] = [];

  const walk = async (prefix: string, depth: number): Promise<void> => {
    if (depth > 3) return;
    const { data, error } = await supabaseAdmin.storage
      .from(bucket)
      .list(prefix, { limit: 1000, sortBy: { column: "name", order: "asc" } });
    if (error || !data) return;
    for (const entry of data as any[]) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.id === null && !entry.metadata) {
        await walk(path, depth + 1);
        continue;
      }
      out.push({
        path,
        bytes: entry.metadata?.size ?? null,
        createdAt: entry.created_at ?? null,
      });
    }
  };

  await walk("", 0);
  return out;
}

/**
 * Real reference resolution — never filename guessing. A file is only
 * "orphaned" when the owning table could be read and holds no reference.
 */
export async function scanStorage(): Promise<StorageFile[]> {
  const client = await db();
  const files: StorageFile[] = [];

  const refs: Record<string, { label: string; paths: Set<string> | null }> = {
    "banner-images": { label: "Promo banner", paths: null },
    "review-photos": { label: "Customer review", paths: null },
    "profile-photos": { label: "Customer profile photo", paths: null },
    "product-images": { label: "Menu photo", paths: null },
  };

  const collect = async (
    bucket: string,
    table: string,
    columns: string[],
  ): Promise<void> => {
    const { data, error } = await client.from(table).select(columns.join(", "));
    if (error) return; // leave as null → "unknown / protected"
    const set = new Set<string>();
    for (const row of (data ?? []) as any[]) {
      for (const column of columns) {
        const value = row[column];
        if (typeof value === "string" && value.trim()) {
          set.add(value.replace(/^\/+/, ""));
          const tail = value.split(`${bucket}/`).pop();
          if (tail) set.add(tail.replace(/^\/+/, ""));
        }
      }
    }
    refs[bucket]!.paths = set;
  };

  await collect("banner-images", "promo_banners", ["desktop_image_path", "mobile_image_path"]);
  await collect("review-photos", "order_reviews", ["photo_path"]);
  await collect("profile-photos", "profiles", ["avatar_path"]);
  await collect("product-images", "product_images", ["url"]);

  for (const bucket of KNOWN_BUCKETS) {
    const entry = refs[bucket]!;
    const bucketFiles = await listBucketFiles(bucket);
    for (const file of bucketFiles) {
      const referenced = entry.paths?.has(file.path) ?? false;
      files.push({
        bucket,
        path: file.path,
        bytes: file.bytes,
        createdAt: file.createdAt,
        referencedBy: referenced ? entry.label : null,
        status: entry.paths === null ? "unknown" : referenced ? "referenced" : "orphaned",
      });
    }
  }

  return files;
}

/**
 * Every deletion must be auditable. If the cleanup tables are not installed
 * yet, refuse rather than delete without a history record.
 */
async function assertAuditable(): Promise<void> {
  const config = await readConfig();
  if (!config.installed) {
    throw new Error(
      "Setup step missing: run docs/sql/data_cleanup.sql once so every cleanup is recorded in history.",
    );
  }
}

export async function deleteStorageFiles(
  userId: string,
  keys: string[],
): Promise<CleanupResult> {
  await assertAuditable();
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const scan = await scanStorage();
  const byKey = new Map(scan.map((file) => [`${file.bucket}/${file.path}`, file]));

  const items: RunItem[] = [];
  let deleted = 0;
  let bytes = 0;

  for (const key of keys) {
    const file = byKey.get(key);
    if (!file) {
      items.push({ ref: key, label: key, outcome: "skipped", reason: "File no longer exists" });
      continue;
    }
    if (file.status !== "orphaned") {
      items.push({
        ref: key,
        label: file.path,
        outcome: "protected",
        reason: file.status === "referenced" ? `In use by ${file.referencedBy}` : "Reference could not be verified",
      });
      continue;
    }
    const { error } = await supabaseAdmin.storage.from(file.bucket).remove([file.path]);
    if (error) {
      items.push({ ref: key, label: file.path, outcome: "failed", reason: error.message });
      continue;
    }
    deleted += 1;
    bytes += file.bytes ?? 0;
    items.push({ ref: key, label: file.path, outcome: "deleted", bytes: file.bytes ?? null });
  }

  const run = await logRun({
    runType: "storage",
    category: "orphan_files",
    status: statusFor(items),
    initiatedBy: userId,
    initiatedLabel: "Owner",
    requestedCount: keys.length,
    filesDeleted: deleted,
    bytesReleased: bytes,
    items,
  });

  return { runId: run, ...summarise(items), filesDeleted: deleted, bytesReleased: bytes };
}

/* ------------------------------------------------------------------- preview */

export interface PreviewResult {
  category: CleanupCategory;
  retentionDays: number;
  cutoffAt: string;
  eligible: number;
  protected: number;
  filesAffected: number;
  bytesAffected: number | null;
  truncated: boolean;
  sample: Candidate[];
}

const SCAN_LIMIT = 500;

export async function previewCategory(
  category: CleanupCategory,
  options: { retentionDays?: number | undefined; before?: string | undefined } = {},
): Promise<PreviewResult> {
  const setting = await getSetting(category);
  const retentionDays = options.retentionDays ?? setting.retentionDays;
  const cutoff = options.before ?? cutoffFor(retentionDays);
  const rows = await listCandidates(category, cutoff, SCAN_LIMIT);

  const eligible = rows.filter((row) => !row.protectedReason);
  let filesAffected = 0;
  let bytes: number | null = null;

  if (category === "old_reviews") {
    filesAffected = await countReviewPhotos(eligible.map((row) => row.id));
  }
  if (category === "orphan_files") {
    const scan = await scanStorage();
    const keys = new Set(eligible.map((row) => row.id));
    const chosen = scan.filter((file) => keys.has(`${file.bucket}/${file.path}`));
    filesAffected = chosen.length;
    bytes = chosen.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
  }

  return {
    category,
    retentionDays,
    cutoffAt: cutoff,
    eligible: eligible.length,
    protected: rows.length - eligible.length,
    filesAffected,
    bytesAffected: bytes,
    truncated: rows.length >= SCAN_LIMIT,
    sample: rows.slice(0, 50),
  };
}

async function countReviewPhotos(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const client = await db();
  const { data } = await client
    .from("order_reviews")
    .select("photo_path")
    .in("id", ids)
    .not("photo_path", "is", null);
  return (data ?? []).length;
}

export async function listForOwner(
  category: CleanupCategory,
  options: { retentionDays?: number | undefined; before?: string | undefined; limit?: number | undefined } = {},
): Promise<Candidate[]> {
  const setting = await getSetting(category);
  const cutoff = options.before ?? cutoffFor(options.retentionDays ?? setting.retentionDays);
  return listCandidates(category, cutoff, Math.min(options.limit ?? 200, SCAN_LIMIT));
}

/* ------------------------------------------------------------------ deletion */

type RunItem = {
  ref: string;
  label: string;
  outcome: "deleted" | "protected" | "skipped" | "failed";
  reason?: string;
  bytes?: number | null;
};

export interface CleanupResult {
  runId: string | null;
  requested: number;
  deleted: number;
  protected: number;
  skipped: number;
  failed: number;
  filesDeleted: number;
  bytesReleased: number | null;
  status: string;
}

function summarise(items: RunItem[]) {
  return {
    requested: items.length,
    deleted: items.filter((i) => i.outcome === "deleted").length,
    protected: items.filter((i) => i.outcome === "protected").length,
    skipped: items.filter((i) => i.outcome === "skipped").length,
    failed: items.filter((i) => i.outcome === "failed").length,
    status: statusFor(items),
  };
}

function statusFor(items: RunItem[]): string {
  const failed = items.some((i) => i.outcome === "failed");
  const deleted = items.some((i) => i.outcome === "deleted");
  if (failed && deleted) return "partial";
  if (failed) return "failed";
  if (items.length > 0 && !deleted) return "partial";
  return "completed";
}

const TABLE_FOR: Partial<Record<CleanupCategory, string>> = {
  notifications: "notifications",
  push_deliveries: "notification_push_deliveries",
  notification_jobs: "notification_jobs",
  expired_push_tokens: "push_tokens",
  communication_log: "communication_messages",
  completed_orders: "orders",
  cancelled_orders: "orders",
  old_reviews: "order_reviews",
};

/**
 * Deletes only the ids that are still eligible right now. Ids that are
 * protected, missing or refused by the database are reported, never hidden.
 */
export async function deleteRecords(
  category: CleanupCategory,
  ids: string[],
  actor: { userId: string | null; label: string; runType: "manual" | "auto" },
  options: { retentionDays?: number | undefined; before?: string | undefined } = {},
): Promise<CleanupResult> {
  if (category === "orphan_files") {
    if (!actor.userId) throw new Error("Forbidden");
    return deleteStorageFiles(actor.userId, ids);
  }

  await assertAuditable();

  const info = CLEANUP_CATEGORY_INFO[category];
  const setting = await getSetting(category);
  if (info.highRisk && !setting.unlocked) {
    throw new Error(`${info.label} is locked. Unlock it in the settings section first.`);
  }

  const retentionDays = options.retentionDays ?? setting.retentionDays;
  const cutoff = options.before ?? cutoffFor(retentionDays);
  const candidates = await listCandidates(category, cutoff, SCAN_LIMIT);
  const byId = new Map(candidates.map((row) => [row.id, row]));

  const client = await db();
  const table = TABLE_FOR[category]!;
  const items: RunItem[] = [];
  let filesDeleted = 0;

  for (const id of ids) {
    const candidate = byId.get(id);
    if (!candidate) {
      items.push({ ref: id, label: id, outcome: "skipped", reason: "No longer eligible or already gone" });
      continue;
    }
    if (candidate.protectedReason) {
      items.push({
        ref: id,
        label: candidate.label,
        outcome: "protected",
        reason: candidate.protectedReason,
      });
      continue;
    }

    let photoPath: string | null = null;
    if (category === "old_reviews") {
      const { data } = await client.from("order_reviews").select("photo_path").eq("id", id).maybeSingle();
      photoPath = data?.photo_path ?? null;
    }

    const { error } = await client.from(table).delete().eq("id", id);
    if (error) {
      items.push({ ref: id, label: candidate.label, outcome: "failed", reason: error.message });
      continue;
    }
    items.push({ ref: id, label: candidate.label, outcome: "deleted" });

    if (photoPath && (await photoIsOrphaned(photoPath))) {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error: removeError } = await supabaseAdmin.storage.from("review-photos").remove([photoPath]);
      if (!removeError) filesDeleted += 1;
    }
  }

  const summary = summarise(items);
  const runId = await logRun({
    runType: actor.runType,
    category,
    status: summary.status,
    retentionDays,
    cutoffAt: cutoff,
    initiatedBy: actor.userId,
    initiatedLabel: actor.label,
    requestedCount: ids.length,
    filesDeleted,
    items,
  });

  await touchLastRun(category);

  return { runId, ...summary, filesDeleted, bytesReleased: null };
}

async function photoIsOrphaned(path: string): Promise<boolean> {
  const client = await db();
  const { data, error } = await client.from("order_reviews").select("id").eq("photo_path", path).limit(1);
  if (error) return false;
  return (data ?? []).length === 0;
}

async function touchLastRun(category: CleanupCategory): Promise<void> {
  const client = await db();
  const setting = await getSetting(category);
  await client.from("cleanup_settings").upsert(
    {
      category,
      auto_enabled: setting.autoEnabled,
      retention_days: setting.retentionDays,
      frequency_days: setting.frequencyDays,
      require_approval: setting.requireApproval,
      unlocked: setting.unlocked,
      last_run_at: new Date().toISOString(),
      next_run_at: setting.autoEnabled ? nextRunFrom(setting.frequencyDays) : null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "category" },
  );
}

/* --------------------------------------------------------------- audit trail */

export interface RunRow {
  id: string;
  runType: string;
  category: string;
  status: string;
  retentionDays: number | null;
  requested: number;
  deleted: number;
  skipped: number;
  protected: number;
  failed: number;
  filesDeleted: number;
  bytesReleased: number | null;
  initiatedLabel: string | null;
  errorSummary: string | null;
  startedAt: string;
  completedAt: string | null;
}

async function logRun(input: {
  runType: string;
  category: string;
  status: string;
  retentionDays?: number;
  cutoffAt?: string;
  initiatedBy?: string | null;
  initiatedLabel?: string;
  requestedCount?: number;
  filesDeleted?: number;
  bytesReleased?: number | null;
  errorSummary?: string;
  items: RunItem[];
}): Promise<string | null> {
  const client = await db();
  const summary = summarise(input.items);
  const now = new Date().toISOString();

  const { data, error } = await client
    .from("cleanup_runs")
    .insert({
      run_type: input.runType,
      category: input.category,
      status: input.status,
      retention_days: input.retentionDays ?? null,
      cutoff_at: input.cutoffAt ?? null,
      requested_count: input.requestedCount ?? summary.requested,
      deleted_count: summary.deleted,
      skipped_count: summary.skipped,
      protected_count: summary.protected,
      failed_count: summary.failed,
      files_deleted: input.filesDeleted ?? 0,
      bytes_released: input.bytesReleased ?? null,
      initiated_by: input.initiatedBy ?? null,
      initiated_label: input.initiatedLabel ?? null,
      error_summary:
        input.errorSummary ??
        (input.items
          .filter((i) => i.outcome === "failed")
          .map((i) => `${i.label}: ${i.reason ?? "failed"}`)
          .slice(0, 10)
          .join("; ") || null),
      started_at: now,
      completed_at: now,
    })
    .select("id")
    .maybeSingle();

  if (error || !data?.id) {
    console.error("Cleanup audit row failed", error);
    return null;
  }

  if (input.items.length > 0) {
    const rows = input.items.slice(0, 500).map((item) => ({
      run_id: data.id,
      record_ref: item.ref,
      record_label: item.label?.slice(0, 200) ?? null,
      outcome: item.outcome,
      reason: item.reason?.slice(0, 300) ?? null,
      bytes: item.bytes ?? null,
    }));
    const { error: itemError } = await client.from("cleanup_run_items").insert(rows);
    if (itemError) console.error("Cleanup audit details failed", itemError);
  }

  return data.id as string;
}

export async function listRuns(limit = 50): Promise<RunRow[]> {
  const client = await db();
  const { data, error } = await client
    .from("cleanup_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row: any) => ({
    id: row.id,
    runType: row.run_type,
    category: row.category,
    status: row.status,
    retentionDays: row.retention_days ?? null,
    requested: row.requested_count ?? 0,
    deleted: row.deleted_count ?? 0,
    skipped: row.skipped_count ?? 0,
    protected: row.protected_count ?? 0,
    failed: row.failed_count ?? 0,
    filesDeleted: row.files_deleted ?? 0,
    bytesReleased: row.bytes_released ?? null,
    initiatedLabel: row.initiated_label ?? null,
    errorSummary: row.error_summary ?? null,
    startedAt: row.started_at,
    completedAt: row.completed_at ?? null,
  }));
}

export async function listRunItems(runId: string, limit = 200) {
  const client = await db();
  const { data, error } = await client
    .from("cleanup_run_items")
    .select("*")
    .eq("run_id", runId)
    .order("created_at", { ascending: true })
    .limit(limit);
  if (error) return [];
  return (data ?? []).map((row: any) => ({
    id: row.id,
    label: row.record_label ?? row.record_ref,
    outcome: row.outcome as string,
    reason: row.reason ?? null,
  }));
}

/* ------------------------------------------------------------------ overview */

export interface OverviewCard {
  databaseRecords: { table: string; label: string; count: number | null }[];
  storageFiles: number | null;
  storageBytes: number | null;
  storageQuota: null;
  candidates: { category: CleanupCategory; eligible: number }[];
  orphanFiles: number | null;
  oldestCandidateAt: string | null;
  nextRunAt: string | null;
  autoEnabledCount: number;
  autoPaused: boolean;
  installed: boolean;
  lastRun: RunRow | null;
}

const COUNTED_TABLES: { table: string; label: string }[] = [
  { table: "orders", label: "Orders" },
  { table: "order_items", label: "Order items" },
  { table: "notifications", label: "Notifications" },
  { table: "notification_push_deliveries", label: "Phone delivery records" },
  { table: "notification_jobs", label: "Background jobs" },
  { table: "communication_messages", label: "Message log" },
  { table: "order_reviews", label: "Reviews" },
  { table: "push_tokens", label: "Device subscriptions" },
];

export async function buildOverview(): Promise<OverviewCard> {
  const client = await db();
  const config = await readConfig();

  const databaseRecords = [] as OverviewCard["databaseRecords"];
  for (const entry of COUNTED_TABLES) {
    const { count, error } = await client.from(entry.table).select("id", { count: "exact", head: true });
    databaseRecords.push({ ...entry, count: error ? null : (count ?? 0) });
  }

  let storageFiles: number | null = null;
  let storageBytes: number | null = null;
  let orphanFiles: number | null = null;
  try {
    const scan = await scanStorage();
    storageFiles = scan.length;
    storageBytes = scan.reduce((sum, file) => sum + (file.bytes ?? 0), 0);
    orphanFiles = scan.filter((file) => file.status === "orphaned").length;
  } catch (error) {
    console.error("Storage scan failed", error);
  }

  const candidates: OverviewCard["candidates"] = [];
  let oldest: string | null = null;
  for (const category of CLEANUP_CATEGORIES) {
    if (category === "orphan_files") continue;
    try {
      const preview = await previewCategory(category);
      candidates.push({ category, eligible: preview.eligible });
      const first = preview.sample.find((row) => !row.protectedReason)?.occurredAt ?? null;
      if (first && (!oldest || first < oldest)) oldest = first;
    } catch {
      candidates.push({ category, eligible: 0 });
    }
  }

  const runs = await listRuns(1);
  const nextRuns = config.settings
    .filter((s) => s.autoEnabled && s.nextRunAt)
    .map((s) => s.nextRunAt!)
    .sort();

  return {
    databaseRecords,
    storageFiles,
    storageBytes,
    storageQuota: null,
    candidates,
    orphanFiles,
    oldestCandidateAt: oldest,
    nextRunAt: config.state.autoPaused ? null : (nextRuns[0] ?? null),
    autoEnabledCount: config.settings.filter((s) => s.autoEnabled).length,
    autoPaused: config.state.autoPaused,
    installed: config.installed,
    lastRun: runs[0] ?? null,
  };
}

/* ----------------------------------------------------------- scheduled runner */

export interface ScheduledOutcome {
  ran: { category: CleanupCategory; deleted: number; status: string }[];
  skipped: { category: CleanupCategory; reason: string }[];
}

/**
 * Called by the cron endpoint. Honours the global pause, the first-run
 * approval requirement and the large-deletion guard before anything is removed.
 */
export async function runScheduledCleanup(): Promise<ScheduledOutcome> {
  const config = await readConfig();
  const out: ScheduledOutcome = { ran: [], skipped: [] };

  if (!config.installed) return { ran: [], skipped: [{ category: "notifications", reason: "not installed" }] };
  if (config.state.autoPaused) {
    return { ran: [], skipped: config.settings.filter((s) => s.autoEnabled).map((s) => ({ category: s.category, reason: "automatic cleanup paused" })) };
  }

  const now = Date.now();

  for (const setting of config.settings) {
    const info = CLEANUP_CATEGORY_INFO[setting.category];
    if (!setting.autoEnabled || !info.autoSupported) continue;
    if (setting.nextRunAt && new Date(setting.nextRunAt).getTime() > now) {
      out.skipped.push({ category: setting.category, reason: "not due yet" });
      continue;
    }

    let preview: PreviewResult;
    try {
      preview = await previewCategory(setting.category);
    } catch (error) {
      out.skipped.push({ category: setting.category, reason: String(error) });
      continue;
    }

    if (setting.requireApproval && !setting.approvedAt) {
      await logRun({
        runType: "auto",
        category: setting.category,
        status: "awaiting_approval",
        retentionDays: preview.retentionDays,
        cutoffAt: preview.cutoffAt,
        initiatedLabel: "Schedule",
        requestedCount: preview.eligible,
        errorSummary: "First automatic run needs owner approval.",
        items: [],
      });
      out.skipped.push({ category: setting.category, reason: "waiting for owner approval" });
      continue;
    }

    if (preview.eligible > config.state.largeDeletionThreshold) {
      // Unusually large deletion: pause everything and wait for the owner.
      await setGlobalState(null, {
        autoPaused: true,
        pausedReason: `Paused automatically: ${CLEANUP_CATEGORY_INFO[setting.category].label} matched ${preview.eligible} records, above the ${config.state.largeDeletionThreshold} record safety limit.`,
      });
      await logRun({
        runType: "auto",
        category: setting.category,
        status: "skipped",
        retentionDays: preview.retentionDays,
        cutoffAt: preview.cutoffAt,
        initiatedLabel: "Schedule",
        requestedCount: preview.eligible,
        errorSummary: `Paused: ${preview.eligible} records is above the ${config.state.largeDeletionThreshold} record safety limit.`,
        items: [],
      });
      out.skipped.push({ category: setting.category, reason: "unusually large deletion — paused for approval" });
      continue;
    }

    const eligibleIds = (await listForOwner(setting.category, { retentionDays: setting.retentionDays }))
      .filter((row) => !row.protectedReason)
      .map((row) => row.id);

    const result = await deleteRecords(
      setting.category,
      eligibleIds,
      { userId: null, label: "Schedule", runType: "auto" },
      { retentionDays: setting.retentionDays },
    );
    out.ran.push({ category: setting.category, deleted: result.deleted, status: result.status });
  }

  return out;
}
