import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { ComboDto } from "@/lib/combos";

/** Public: active combos with today's available items only. */
export const listCombos = createServerFn({ method: "GET" }).handler(async (): Promise<ComboDto[]> => {
  const { loadCustomerCombos } = await import("@/lib/combos.server");
  try {
    return await loadCustomerCombos();
  } catch (error) {
    console.error("Combo listing failed", error);
    return [];
  }
});

const groupSchema = z.object({
  id: z.string().nullable(),
  name: z.string().trim().min(1).max(60),
  isRequired: z.boolean(),
  minSelect: z.number().int().min(0).max(10),
  maxSelect: z.number().int().min(1).max(10),
  extraCharge: z.number().min(0).max(100000),
  categoryIds: z.array(z.string().uuid()).max(50),
  productIds: z.array(z.string().uuid()).max(200),
  sortOrder: z.number().int().min(0).max(100),
});

const comboSchema = z.object({
  id: z.string().uuid().nullable(),
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(400).nullable(),
  /** Optional combo picture, same image-link approach as the menu items. */
  imageUrl: z.string().trim().max(600).nullable().default(null),
  pricingMode: z.enum(["calculated", "fixed"]),
  fixedPrice: z.number().min(0).max(1000000).nullable(),
  isActive: z.boolean(),
  sortOrder: z.number().int().min(0).max(1000),
  groups: z.array(groupSchema).max(8),
});

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 50) || "combo"
  );
}

/** Owner: full configuration, active and draft, for the dashboard. */
export const ownerListCombos = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "combos", "view");
    const { loadComboConfigs, comboConfigProblems } = await import("@/lib/combos.server");
    const configs = await loadComboConfigs();
    return Promise.all(
      configs.map(async (config) => ({
        ...config,
        problems: await comboConfigProblems(config),
      })),
    );
  });

export const ownerSaveCombo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => comboSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "combos");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { comboConfigProblems } = await import("@/lib/combos.server");

    const candidate = {
      id: data.id ?? "new",
      slug: slugify(data.name),
      name: data.name,
      description: data.description,
      imageUrl: data.imageUrl?.trim() ? data.imageUrl.trim() : null,
      pricingMode: data.pricingMode,
      fixedPrice: data.pricingMode === "fixed" ? data.fixedPrice : null,
      isActive: data.isActive,
      sortOrder: data.sortOrder,
      groups: data.groups.map((g, index) => ({
        id: g.id ?? `new-${index}`,
        name: g.name,
        isRequired: g.isRequired,
        minSelect: g.isRequired ? Math.max(g.minSelect, 1) : g.minSelect,
        maxSelect: g.maxSelect,
        extraCharge: g.extraCharge,
        categoryIds: g.categoryIds,
        productIds: g.productIds,
        sortOrder: index,
      })),
    };

    // A combo can always be saved as a draft; switching it on requires a
    // complete, buildable configuration.
    const problems = await comboConfigProblems(candidate);
    if (data.isActive && problems.length > 0) {
      throw new Error(`This combo can't go live yet: ${problems.join(" ")}`);
    }

    const payload = {
      name: candidate.name,
      description: candidate.description,
      pricing_mode: candidate.pricingMode,
      fixed_price: candidate.fixedPrice,
      is_active: candidate.isActive,
      sort_order: candidate.sortOrder,
    };
    // The combo picture is an optional extra column; where it isn't installed
    // yet the save still goes through without it.
    const withImage = { ...payload, image_url: candidate.imageUrl };
    const { missingComboImageColumn } = await import("@/lib/combos.server");
    const { looseDb } = await import("@/integrations/supabase/loose.server");
    const db = looseDb(supabaseAdmin);

    let comboId = data.id;
    if (comboId) {
      let { error } = await db.from("combos").update(withImage).eq("id", comboId);
      if (error && missingComboImageColumn(error)) {
        ({ error } = await supabaseAdmin.from("combos").update(payload).eq("id", comboId));
      }
      if (error) {
        console.error("Combo update failed", error);
        throw new Error("We couldn't save this combo. Please try again.");
      }
    } else {
      const slug = `${candidate.slug}-${Date.now().toString(36)}`;
      let { data: row, error } = await db
        .from("combos")
        .insert({ ...withImage, slug })
        .select("id")
        .single();
      if (error && missingComboImageColumn(error)) {
        ({ data: row, error } = await supabaseAdmin
          .from("combos")
          .insert({ ...payload, slug })
          .select("id")
          .single());
      }
      if (error || !row) {
        console.error("Combo insert failed", error);
        throw new Error("We couldn't create this combo. Please try again.");
      }
      comboId = row.id as string;
    }
    const savedComboId = comboId as string;

    // Steps are replaced wholesale — they only ever belong to this combo.
    await supabaseAdmin.from("combo_groups").delete().eq("combo_id", savedComboId);
    if (candidate.groups.length > 0) {
      const { error } = await supabaseAdmin.from("combo_groups").insert(
        candidate.groups.map((g) => ({
          combo_id: savedComboId,
          name: g.name,
          is_required: g.isRequired,
          min_select: g.minSelect,
          max_select: g.maxSelect,
          extra_charge: g.extraCharge,
          category_ids: g.categoryIds,
          product_ids: g.productIds,
          sort_order: g.sortOrder,
        })),
      );
      if (error) {
        console.error("Combo steps insert failed", error);
        throw new Error("We couldn't save the combo steps. Please try again.");
      }
    }

    return { id: comboId as string, problems };
  });

export const ownerSetComboActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ id: z.string().uuid(), isActive: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "combos");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadComboConfigs, comboConfigProblems } = await import("@/lib/combos.server");

    if (data.isActive) {
      const [config] = await loadComboConfigs(data.id);
      if (!config) throw new Error("That combo no longer exists.");
      const problems = await comboConfigProblems(config);
      if (problems.length > 0) {
        throw new Error(`This combo can't go live yet: ${problems.join(" ")}`);
      }
    }

    const { error } = await supabaseAdmin
      .from("combos")
      .update({ is_active: data.isActive })
      .eq("id", data.id);
    if (error) {
      console.error("Combo status update failed", error);
      throw new Error("We couldn't change this combo. Please try again.");
    }
    return { ok: true };
  });

export const ownerDeleteCombo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    const { assertPermission } = await import("@/lib/owner.server");
    await assertPermission(context.userId, "combos");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error } = await supabaseAdmin.from("combos").delete().eq("id", data.id);
    if (error) {
      console.error("Combo delete failed", error);
      throw new Error("We couldn't remove this combo. Please try again.");
    }
    return { ok: true };
  });
