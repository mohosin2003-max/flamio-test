/**
 * Server-only combo loading, configuration validation and authoritative
 * re-pricing. Combos never duplicate product records: a group stores which
 * categories / products are eligible and everything else is read live from the
 * existing menu tables.
 */

import type { ComboDto, ComboGroupDto, ComboPricingMode } from "@/lib/combos";
import { comboPricing, distributeComboPrices, type ComboSelection } from "@/lib/combos";

export interface ComboGroupConfig extends Omit<ComboGroupDto, "productIds"> {
  categoryIds: string[];
  productIds: string[];
}

export interface ComboConfig extends Omit<ComboDto, "groups"> {
  groups: ComboGroupConfig[];
}

type ComboRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url?: string | null;
  pricing_mode: string;
  fixed_price: number | string | null;
  is_active: boolean;
  sort_order: number;
};

const COMBO_BASE_COLUMNS =
  "id, slug, name, description, pricing_mode, fixed_price, is_active, sort_order";
const COMBO_COLUMNS = `${COMBO_BASE_COLUMNS}, image_url`;

/** True when the database doesn't have the optional combo image column yet. */
export function missingComboImageColumn(error: { message?: string } | null): boolean {
  return Boolean(error?.message && /image_url/i.test(error.message));
}


type GroupRow = {
  id: string;
  combo_id: string;
  name: string;
  is_required: boolean;
  min_select: number;
  max_select: number;
  extra_charge: number | string;
  category_ids: string[] | null;
  product_ids: string[] | null;
  sort_order: number;
};

function mapCombo(row: ComboRow, groups: GroupRow[]): ComboConfig {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    imageUrl: row.image_url ?? null,
    pricingMode: row.pricing_mode as ComboPricingMode,
    fixedPrice: row.fixed_price === null ? null : Number(row.fixed_price),
    isActive: row.is_active,
    sortOrder: row.sort_order,
    groups: groups
      .filter((g) => g.combo_id === row.id)
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((g) => ({
        id: g.id,
        name: g.name,
        isRequired: g.is_required,
        minSelect: g.min_select,
        maxSelect: g.max_select,
        extraCharge: Number(g.extra_charge),
        categoryIds: g.category_ids ?? [],
        productIds: g.product_ids ?? [],
        sortOrder: g.sort_order,
      })),
  };
}

/** Raw owner-facing configuration (active and draft). */
export async function loadComboConfigs(comboId?: string): Promise<ComboConfig[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const run = async (columns: string) => {
    let query = supabaseAdmin
      .from("combos")
      .select(columns)
      .order("sort_order", { ascending: true });
    if (comboId) query = query.eq("id", comboId);
    return query;
  };

  let { data: combos, error } = await run(COMBO_COLUMNS);
  if (error && missingComboImageColumn(error)) {
    // The optional combo image column isn't installed yet — combos still work.
    ({ data: combos, error } = await run(COMBO_BASE_COLUMNS));
  }
  if (error) {
    console.error("Combo load failed", error);
    throw new Error("We couldn't load the combos. Please try again.");
  }
  const rows = (combos ?? []) as unknown as ComboRow[];
  if (rows.length === 0) return [];

  const { data: groups } = await supabaseAdmin
    .from("combo_groups")
    .select(
      "id, combo_id, name, is_required, min_select, max_select, extra_charge, category_ids, product_ids, sort_order",
    )
    .in(
      "combo_id",
      rows.map((r) => r.id),
    );

  return rows.map((row) => mapCombo(row, (groups ?? []) as GroupRow[]));
}

type AvailableProduct = { id: string; category_id: string };

async function loadAvailableProducts(): Promise<AvailableProduct[]> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("products")
    .select("id, category_id")
    .eq("is_available", true);
  return (data ?? []) as AvailableProduct[];
}

/** Resolves a group's eligible items to products that are available right now. */
function resolveGroupProducts(group: ComboGroupConfig, products: AvailableProduct[]): string[] {
  const ids = new Set<string>();
  for (const product of products) {
    if (group.productIds.includes(product.id)) ids.add(product.id);
    else if (group.categoryIds.includes(product.category_id)) ids.add(product.id);
  }
  return [...ids];
}

/** Customer-facing combos: active only, with sold-out items already removed. */
export async function loadCustomerCombos(): Promise<ComboDto[]> {
  const [configs, products] = await Promise.all([loadComboConfigs(), loadAvailableProducts()]);
  const visible: ComboDto[] = [];

  for (const config of configs.filter((c) => c.isActive)) {
    const groups: ComboGroupDto[] = config.groups.map((group) => ({
      id: group.id,
      name: group.name,
      isRequired: group.isRequired,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      extraCharge: group.extraCharge,
      sortOrder: group.sortOrder,
      productIds: resolveGroupProducts(group, products),
    }));

    // A required step with nothing available today can't be completed, so the
    // whole combo is hidden rather than shown as unbuildable.
    const broken = groups.some((g) => g.isRequired && g.productIds.length === 0);
    if (groups.length === 0 || broken) continue;

    visible.push({
      id: config.id,
      slug: config.slug,
      name: config.name,
      description: config.description,
      imageUrl: config.imageUrl,
      pricingMode: config.pricingMode,
      fixedPrice: config.fixedPrice,
      isActive: config.isActive,
      sortOrder: config.sortOrder,
      groups: groups.filter((g) => g.isRequired || g.productIds.length > 0),
    });
  }

  return visible;
}

/** Blocking problems that stop a combo from being switched on. */
export async function comboConfigProblems(config: ComboConfig): Promise<string[]> {
  const problems: string[] = [];
  if (!config.name.trim()) problems.push("Give the combo a name.");
  if (config.groups.length === 0) problems.push("Add at least one step (for example: Burger).");
  if (config.pricingMode === "fixed" && (config.fixedPrice === null || config.fixedPrice <= 0)) {
    problems.push("Set a fixed price above 0, or switch to item-price pricing.");
  }

  const products = await loadAvailableProducts();
  for (const group of config.groups) {
    const label = group.name.trim() || "Unnamed step";
    if (!group.name.trim()) problems.push("Every step needs a name.");
    if (group.minSelect < 0) problems.push(`${label}: minimum can't be negative.`);
    if (group.maxSelect < 1) problems.push(`${label}: maximum must be at least 1.`);
    if (group.minSelect > group.maxSelect) {
      problems.push(`${label}: minimum can't be more than the maximum.`);
    }
    if (group.extraCharge < 0) problems.push(`${label}: extra charge can't be negative.`);
    if (group.categoryIds.length === 0 && group.productIds.length === 0) {
      problems.push(`${label}: pick the categories or items customers can choose from.`);
    } else if (resolveGroupProducts(group, products).length === 0) {
      problems.push(`${label}: none of the chosen items are available right now.`);
    }
  }
  return problems;
}

export interface IncomingItem {
  productId: string;
  productSlug: string;
  productName: string;
  variantId: string | null;
  variantName: string | null;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  comboId?: string | null | undefined;
  comboName?: string | null | undefined;
  comboKey?: string | null | undefined;
  comboGroupId?: string | null | undefined;
}

/**
 * Re-validates and re-prices every combo line straight from the database before
 * an order is accepted. Client prices, totals and rule state are ignored: an
 * unavailable item, an item that isn't part of the combo, or a broken selection
 * rule rejects the order outright.
 */
export async function validateComboItems(items: IncomingItem[]): Promise<IncomingItem[]> {
  const comboKeys = [...new Set(items.map((i) => i.comboKey).filter(Boolean))] as string[];
  if (comboKeys.length === 0) return items;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const comboIds = [...new Set(items.map((i) => i.comboId).filter(Boolean))] as string[];
  const configs = (
    await Promise.all(comboIds.map((id) => loadComboConfigs(id)))
  ).flat();
  const products = await loadAvailableProducts();

  const productIds = [...new Set(items.map((i) => i.productId))];
  const { data: productRows } = await supabaseAdmin
    .from("products")
    .select("id, name, slug, base_price, is_available")
    .in("id", productIds);
  const variantIds = items.map((i) => i.variantId).filter(Boolean) as string[];
  const { data: variantRows } = variantIds.length
    ? await supabaseAdmin
        .from("product_variants")
        .select("id, product_id, name, price, is_available")
        .in("id", variantIds)
    : { data: [] };

  const priced: IncomingItem[] = [...items];

  for (const key of comboKeys) {
    const indexes = priced.flatMap((item, index) => (item.comboKey === key ? [index] : []));
    const lines = indexes.map((i) => priced[i]!);
    const config = configs.find((c) => c.id === lines[0]?.comboId);
    if (!config || !config.isActive) {
      throw new Error("That combo is no longer available. Please rebuild it from the menu.");
    }

    const selections: ComboSelection[] = [];
    for (const line of lines) {
      const group = config.groups.find((g) => g.id === line.comboGroupId);
      if (!group) throw new Error(`${config.name}: one of the choices is no longer part of it.`);

      const product = (productRows ?? []).find((p) => p.id === line.productId);
      if (!product || !product.is_available) {
        throw new Error(`${line.productName} is sold out. Please rebuild your combo.`);
      }
      if (!resolveGroupProducts(group, products).includes(line.productId)) {
        throw new Error(`${product.name} can't be chosen for ${group.name}.`);
      }

      let unitPrice = Number(product.base_price);
      let variantName: string | null = null;
      if (line.variantId) {
        const variant = (variantRows ?? []).find(
          (v) => v.id === line.variantId && v.product_id === line.productId,
        );
        if (!variant || !variant.is_available) {
          throw new Error(`${product.name} option is sold out. Please rebuild your combo.`);
        }
        unitPrice = Number(variant.price);
        variantName = variant.name;
      }

      selections.push({
        groupId: group.id,
        productId: product.id,
        productSlug: product.slug,
        productName: product.name,
        variantId: line.variantId,
        variantName,
        unitPrice,
        imageUrl: line.imageUrl,
      });
    }

    // Selection rules, enforced here and not in the browser.
    for (const group of config.groups) {
      const chosen = selections.filter((s) => s.groupId === group.id);
      if (group.isRequired && chosen.length < Math.max(group.minSelect, 1)) {
        throw new Error(`${config.name}: ${group.name} is required.`);
      }
      if (chosen.length > group.maxSelect) {
        throw new Error(`${config.name}: too many items chosen for ${group.name}.`);
      }
    }

    const dto: ComboDto = {
      ...config,
      groups: config.groups.map((g) => ({
        id: g.id,
        name: g.name,
        isRequired: g.isRequired,
        minSelect: g.minSelect,
        maxSelect: g.maxSelect,
        extraCharge: g.extraCharge,
        sortOrder: g.sortOrder,
        productIds: resolveGroupProducts(g, products),
      })),
    };
    const pricing = comboPricing(dto, selections);
    const distributed = distributeComboPrices(pricing.total, selections);

    // One built combo carries a single shared quantity: every one of its lines
    // must have the same whole quantity, so the combo price simply multiplies.
    const quantity = Math.min(
      Math.max(1, Math.min(...lines.map((l) => Math.floor(Number(l.quantity)) || 1))),
      20,
    );

    indexes.forEach((originalIndex, i) => {
      const selection = selections[i]!;
      priced[originalIndex] = {
        ...priced[originalIndex]!,
        productSlug: selection.productSlug,
        productName: selection.productName,
        variantName: selection.variantName,
        unitPrice: distributed[i] ?? selection.unitPrice,
        quantity,
        comboName: config.name,
      };
    });
  }

  return priced;
}
