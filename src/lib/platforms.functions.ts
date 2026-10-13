import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Online sales platforms (Foodi, Pathao Food, ...) and platform sales.
 *
 * This reuses the EXISTING structures end to end:
 * - the menu comes from `categories` / `products` / `product_images`
 * - a platform sale is stored as a normal row in `orders` + `order_items`
 * - stock is consumed with the existing idempotent `consume_inventory_for_order`
 * - reporting reads the same order rows as before
 *
 * Platform-specific prices live in `platform_product_prices`; normal menu
 * prices in `products.base_price` are never written here. Every sale stores the
 * applied unit prices (order_items.unit_price) plus the commission rate and
 * amount on the order, so historical records never change when settings do.
 */

export type PricingMode = "normal" | "custom";

export interface PlatformRow {
  id: string;
  name: string;
  commissionPercent: number;
  pricingMode: PricingMode;
  isActive: boolean;
  sortOrder: number;
  pricedItems: number;
}

export interface PlatformPricedProduct {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  imageUrl: string | null;
  isAvailable: boolean;
  normalPrice: number;
  /** `null` = no platform price configured for this item yet. */
  platformPrice: number | null;
  /** Price actually used on a sale: configured price, else normal in normal mode. */
  effectivePrice: number | null;
}

export interface PlatformCatalog {
  categories: { id: string; name: string; slug: string; sortOrder: number }[];
  products: PlatformPricedProduct[];
}

const idSchema = z.object({ platformId: z.string().uuid() });

const saveSchema = z.object({
  id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(2).max(60),
  commissionPercent: z.number().min(0).max(100),
  pricingMode: z.enum(["normal", "custom"]),
  prices: z
    .array(z.object({ productId: z.string().uuid(), price: z.number().min(0).max(100000) }))
    .max(500)
    .default([]),
  isActive: z.boolean().default(true),
});

async function loadCatalogWithPrices(platformId: string | null): Promise<PlatformCatalog> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const [{ data: categories }, { data: products }, { data: images }] = await Promise.all([
    supabaseAdmin.from("categories").select("id, name, slug, sort_order").order("sort_order"),
    supabaseAdmin
      .from("products")
      .select("id, category_id, name, slug, base_price, is_available, sort_order")
      .order("sort_order"),
    supabaseAdmin
      .from("product_images")
      .select("product_id, url, is_primary, sort_order")
      .order("sort_order"),
  ]);

  const imageByProduct = new Map<string, string | null>();
  for (const img of images ?? []) {
    if (!imageByProduct.has(img.product_id) || img.is_primary) {
      imageByProduct.set(img.product_id, img.url);
    }
  }

  let priceByProduct = new Map<string, number>();
  let mode: PricingMode = "normal";
  if (platformId) {
    const [{ data: platform }, { data: priceRows }] = await Promise.all([
      supabaseAdmin.from("sales_platforms").select("pricing_mode").eq("id", platformId).maybeSingle(),
      supabaseAdmin
        .from("platform_product_prices")
        .select("product_id, price")
        .eq("platform_id", platformId),
    ]);
    mode = (platform?.pricing_mode as PricingMode | undefined) ?? "normal";
    priceByProduct = new Map((priceRows ?? []).map((r) => [r.product_id, Number(r.price)]));
  }

  return {
    categories: (categories ?? []).map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      sortOrder: c.sort_order,
    })),
    products: (products ?? []).map((p) => {
      const normalPrice = Number(p.base_price);
      const platformPrice = priceByProduct.get(p.id) ?? null;
      return {
        id: p.id,
        categoryId: p.category_id,
        name: p.name,
        slug: p.slug,
        imageUrl: imageByProduct.get(p.id) ?? null,
        isAvailable: p.is_available,
        normalPrice,
        platformPrice,
        effectivePrice:
          platformPrice ?? (platformId === null || mode === "normal" ? normalPrice : null),
      };
    }),
  };
}

/** Platform list for the owner dashboard. */
export const ownerListPlatforms = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformRow[]> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["platform_sales", "menu", "pos"], "view");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [{ data: platforms, error }, { data: prices }] = await Promise.all([
      supabaseAdmin
        .from("sales_platforms")
        .select("id, name, commission_percent, pricing_mode, is_active, sort_order")
        .order("sort_order")
        .order("name"),
      supabaseAdmin.from("platform_product_prices").select("platform_id"),
    ]);

    if (error) {
      console.error("Platform list failed", error);
      throw new Error("We couldn't load your platforms. Please try again.");
    }

    const counts = new Map<string, number>();
    for (const row of prices ?? []) {
      counts.set(row.platform_id, (counts.get(row.platform_id) ?? 0) + 1);
    }

    return (platforms ?? []).map((p) => ({
      id: p.id,
      name: p.name,
      commissionPercent: Number(p.commission_percent),
      pricingMode: p.pricing_mode as PricingMode,
      isActive: p.is_active,
      sortOrder: p.sort_order,
      pricedItems: counts.get(p.id) ?? 0,
    }));
  });

/** Full menu with this platform's prices (pass `null` for a brand-new platform). */
export const ownerGetPlatformPricing = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ platformId: z.string().uuid().nullable() }).parse(input),
  )
  .handler(async ({ data, context }): Promise<PlatformCatalog> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["platform_sales", "menu", "pos"], "view");
    return loadCatalogWithPrices(data.platformId);
  });

/** Create or update a platform together with its platform-specific prices. */
export const ownerSavePlatform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saveSchema.parse(input))
  .handler(async ({ data, context }): Promise<{ id: string }> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["platform_sales", "menu"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const payload = {
      name: data.name,
      commission_percent: data.commissionPercent,
      pricing_mode: data.pricingMode,
      is_active: data.isActive,
    };

    let platformId = data.id ?? null;
    if (platformId) {
      const { error } = await supabaseAdmin
        .from("sales_platforms")
        .update(payload)
        .eq("id", platformId);
      if (error) {
        console.error("Platform update failed", error);
        throw new Error(
          error.code === "23505"
            ? "Another platform already uses that name."
            : "We couldn't save this platform. Please try again.",
        );
      }
    } else {
      const { data: row, error } = await supabaseAdmin
        .from("sales_platforms")
        .insert(payload)
        .select("id")
        .single();
      if (error || !row) {
        console.error("Platform insert failed", error);
        throw new Error(
          error?.code === "23505"
            ? "Another platform already uses that name."
            : "We couldn't save this platform. Please try again.",
        );
      }
      platformId = row.id;
    }

    // Only real products can be priced; normal menu prices are never written.
    const { data: products } = await supabaseAdmin.from("products").select("id");
    const valid = new Set((products ?? []).map((p) => p.id));
    const rows = data.prices
      .filter((p) => valid.has(p.productId))
      .map((p) => ({
        platform_id: platformId as string,
        product_id: p.productId,
        price: p.price,
      }));

    if (rows.length > 0) {
      const { error: priceError } = await supabaseAdmin
        .from("platform_product_prices")
        .upsert(rows, { onConflict: "platform_id,product_id" });
      if (priceError) {
        console.error("Platform price save failed", priceError);
        throw new Error("We couldn't save the platform prices. Please try again.");
      }
    }

    // Items the owner cleared are removed, so they stay "not configured".
    const keep = new Set(rows.map((r) => r.product_id));
    const { data: existing } = await supabaseAdmin
      .from("platform_product_prices")
      .select("id, product_id")
      .eq("platform_id", platformId as string);
    const stale = (existing ?? []).filter((r) => !keep.has(r.product_id)).map((r) => r.id);
    if (stale.length > 0) {
      await supabaseAdmin.from("platform_product_prices").delete().in("id", stale);
    }

    return { id: platformId as string };
  });

export const ownerDeletePlatform = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => idSchema.parse(input))
  .handler(async ({ data, context }) => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["platform_sales", "menu"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { error } = await supabaseAdmin
      .from("sales_platforms")
      .delete()
      .eq("id", data.platformId);
    if (error) {
      console.error("Platform delete failed", error);
      throw new Error("We couldn't remove this platform. Past sales keep their own snapshot.");
    }
    return { ok: true };
  });

const saleSchema = z.object({
  platformId: z.string().uuid(),
  reference: z.string().trim().max(60).nullable().default(null),
  items: z
    .array(
      z.object({
        productId: z.string().uuid(),
        quantity: z.number().int().positive().max(99),
      }),
    )
    .min(1)
    .max(50),
});

export interface PlatformSaleResult {
  id: string;
  code: string;
  gross: number;
  commissionRate: number;
  commissionAmount: number;
  netReceivable: number;
}

function orderCode(date: Date): string {
  const stamp = [
    date.getUTCFullYear().toString().slice(-2),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("");
  const random = Math.floor(Math.random() * 46656)
    .toString(36)
    .toUpperCase()
    .padStart(3, "0");
  return `FLM-${stamp}-${random}`;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Records a platform sale as a normal order. Prices and the commission rate are
 * resolved on the server from the platform configuration and then frozen on the
 * order rows, so editing settings later never changes past sales.
 */
export const ownerPlacePlatformSale = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => saleSchema.parse(input))
  .handler(async ({ data, context }): Promise<PlatformSaleResult> => {
    const { assertAnyPermission } = await import("@/lib/owner.server");
    await assertAnyPermission(context.userId, ["platform_sales", "pos"]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: platform } = await supabaseAdmin
      .from("sales_platforms")
      .select("id, name, commission_percent, pricing_mode, is_active")
      .eq("id", data.platformId)
      .maybeSingle();

    if (!platform) throw new Error("That platform no longer exists.");
    if (!platform.is_active) throw new Error("That platform is switched off.");

    const productIds = [...new Set(data.items.map((i) => i.productId))];
    const [{ data: products }, { data: priceRows }, { data: images }] = await Promise.all([
      supabaseAdmin
        .from("products")
        .select("id, slug, name, base_price, is_available")
        .in("id", productIds),
      supabaseAdmin
        .from("platform_product_prices")
        .select("product_id, price")
        .eq("platform_id", platform.id)
        .in("product_id", productIds),
      supabaseAdmin
        .from("product_images")
        .select("product_id, url, is_primary, sort_order")
        .in("product_id", productIds)
        .order("sort_order"),
    ]);

    const productById = new Map((products ?? []).map((p) => [p.id, p]));
    const priceById = new Map((priceRows ?? []).map((r) => [r.product_id, Number(r.price)]));
    const imageById = new Map<string, string | null>();
    for (const img of images ?? []) {
      if (!imageById.has(img.product_id) || img.is_primary) {
        imageById.set(img.product_id, img.url);
      }
    }

    const mode = platform.pricing_mode as PricingMode;
    const lines = data.items.map((item) => {
      const product = productById.get(item.productId);
      if (!product) throw new Error("One of these items no longer exists.");
      if (!product.is_available) throw new Error(`${product.name} is not available right now.`);

      const configured = priceById.get(item.productId) ?? null;
      const unitPrice = configured ?? (mode === "normal" ? Number(product.base_price) : null);
      if (unitPrice === null || !Number.isFinite(unitPrice) || unitPrice <= 0) {
        throw new Error(
          `${product.name} has no ${platform.name} price yet. Set its platform price first.`,
        );
      }

      return {
        product_id: product.id,
        product_slug: product.slug,
        product_name: product.name,
        variant_id: null,
        variant_name: null,
        unit_price: unitPrice,
        quantity: item.quantity,
        image_url: imageById.get(product.id) ?? null,
      };
    });

    const gross = round2(lines.reduce((sum, l) => sum + l.unit_price * l.quantity, 0));
    const commissionRate = Number(platform.commission_percent);
    const commissionAmount = round2((gross * commissionRate) / 100);
    const netReceivable = round2(gross - commissionAmount);

    let inserted: { id: string; code: string } | null = null;
    let lastError: unknown = null;
    for (let attempt = 0; attempt < 3 && !inserted; attempt++) {
      const { data: row, error } = await supabaseAdmin
        .from("orders")
        .insert({
          code: orderCode(new Date()),
          user_id: null,
          channel: "platform",
          // Platform sales are recorded as completed sales, like counter sales.
          status: "completed",
          fulfillment: "pickup",
          payment_method: "platform",
          payment_label: `${platform.name} (platform)`,
          customer_name: platform.name,
          customer_phone: "000000",
          pickup_note: data.reference ? `${platform.name} ref ${data.reference}` : platform.name,
          subtotal: gross,
          discount: 0,
          delivery_charge: 0,
          total: gross,
          platform_id: platform.id,
          platform_name: platform.name,
          commission_rate: commissionRate,
          commission_amount: commissionAmount,
          net_receivable: netReceivable,
        })
        .select("id, code")
        .single();
      if (error) {
        lastError = error;
        if (error.code !== "23505") break;
        continue;
      }
      inserted = row;
    }

    if (!inserted) {
      console.error("Platform sale insert failed", lastError);
      throw new Error("We couldn't record this sale. Please try again.");
    }

    const { error: itemsError } = await supabaseAdmin
      .from("order_items")
      .insert(lines.map((l) => ({ ...l, order_id: inserted.id })));
    if (itemsError) {
      console.error("Platform sale items failed", itemsError);
      await supabaseAdmin.from("orders").delete().eq("id", inserted.id);
      throw new Error("We couldn't record this sale. Please try again.");
    }

    // Same inventory path as every other order; the DB function is idempotent
    // per order, so stock can never be deducted twice.
    const { data: settingsRow } = await supabaseAdmin
      .from("restaurant_settings")
      .select("inventory_mode")
      .order("created_at")
      .limit(1)
      .maybeSingle();
    if (settingsRow?.inventory_mode !== "simple") {
      const { error: stockError } = await supabaseAdmin.rpc("consume_inventory_for_order", {
        _order_id: inserted.id,
      });
      if (stockError) console.error("Inventory consumption failed", stockError);
    }

    return {
      id: inserted.id,
      code: inserted.code,
      gross,
      commissionRate,
      commissionAmount,
      netReceivable,
    };
  });
