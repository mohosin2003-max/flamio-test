import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { CLEANUP_CATEGORIES } from "@/lib/cleanup-categories";

/**
 * Owner → Settings → Data & Storage Management.
 *
 * Every endpoint is owner-only (not manager, not staff) and re-applies the
 * server-side eligibility rules, so a posted id can never delete protected
 * data. Reuses the existing roles system — no parallel authentication.
 */

const categorySchema = z.enum(CLEANUP_CATEGORIES);

async function ownerOnly(userId: string) {
  const { getAccessProfile } = await import("@/lib/owner.server");
  const access = await getAccessProfile(userId);
  if (!access.isOwner) throw new Error("Forbidden");
  return access;
}

export const cleanupGetOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ownerOnly(context.userId);
    const { buildOverview, readConfig } = await import("@/lib/cleanup.server");
    const [overview, config] = await Promise.all([buildOverview(), readConfig()]);
    return { overview, config };
  });

export const cleanupListRecords = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        category: categorySchema,
        retentionDays: z.number().int().min(1).max(3650).optional(),
        before: z.string().datetime().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { listForOwner, previewCategory } = await import("@/lib/cleanup.server");
    const [records, preview] = await Promise.all([
      listForOwner(data.category, data),
      previewCategory(data.category, data),
    ]);
    return { records, preview };
  });

export const cleanupPreview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        category: categorySchema,
        retentionDays: z.number().int().min(1).max(3650).optional(),
        before: z.string().datetime().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { previewCategory } = await import("@/lib/cleanup.server");
    // Preview never deletes anything.
    return previewCategory(data.category, data);
  });

export const cleanupDelete = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        category: categorySchema,
        ids: z.array(z.string().min(1).max(300)).min(1).max(500),
        retentionDays: z.number().int().min(1).max(3650).optional(),
        before: z.string().datetime().optional(),
        confirm: z.literal("DELETE").optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { CLEANUP_CATEGORY_INFO } = await import("@/lib/cleanup-categories");
    if (CLEANUP_CATEGORY_INFO[data.category].highRisk && data.confirm !== "DELETE") {
      throw new Error("Type DELETE to confirm this cleanup.");
    }
    const { deleteRecords } = await import("@/lib/cleanup.server");
    return deleteRecords(
      data.category,
      data.ids,
      { userId: context.userId, label: "Owner", runType: "manual" },
      { retentionDays: data.retentionDays, before: data.before },
    );
  });

export const cleanupSaveSetting = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        category: categorySchema,
        autoEnabled: z.boolean().optional(),
        retentionDays: z.number().int().min(1).max(3650).optional(),
        frequencyDays: z.number().int().min(1).max(365).optional(),
        requireApproval: z.boolean().optional(),
        unlocked: z.boolean().optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { saveSetting } = await import("@/lib/cleanup.server");
    const { category, ...patch } = data;
    return saveSetting(context.userId, category, patch);
  });

export const cleanupApproveCategory = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ category: categorySchema }).parse(input))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { approveCategory } = await import("@/lib/cleanup.server");
    await approveCategory(context.userId, data.category);
    return { ok: true };
  });

export const cleanupSetGlobal = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z
      .object({
        action: z.enum(["pause", "resume", "disable_all", "threshold"]),
        threshold: z.number().int().min(10).max(100000).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { setGlobalState, stopAllAutomatic, disableAllAutomatic } = await import(
      "@/lib/cleanup.server"
    );
    if (data.action === "pause") {
      await stopAllAutomatic(context.userId, "Owner paused all automatic cleanup.");
    } else if (data.action === "resume") {
      await setGlobalState(context.userId, { autoPaused: false, pausedReason: null });
    } else if (data.action === "disable_all") {
      await disableAllAutomatic(context.userId);
    } else if (data.threshold) {
      await setGlobalState(context.userId, { largeDeletionThreshold: data.threshold });
    }
    return { ok: true };
  });

export const cleanupListStorage = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ownerOnly(context.userId);
    const { scanStorage } = await import("@/lib/cleanup.server");
    return scanStorage();
  });

export const cleanupDeleteFiles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ keys: z.array(z.string().min(1).max(400)).min(1).max(200) }).parse(input),
  )
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { deleteStorageFiles } = await import("@/lib/cleanup.server");
    return deleteStorageFiles(context.userId, data.keys);
  });

export const cleanupListHistory = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await ownerOnly(context.userId);
    const { listRuns } = await import("@/lib/cleanup.server");
    return listRuns(50);
  });

export const cleanupRunDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ runId: z.string().uuid() }).parse(input))
  .handler(async ({ data, context }) => {
    await ownerOnly(context.userId);
    const { listRunItems } = await import("@/lib/cleanup.server");
    return listRunItems(data.runId);
  });
