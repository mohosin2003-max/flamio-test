import type { CartLine, Product, ProductVariant } from "@/types/menu";

export interface ReorderPlan {
  add: Array<{ product: Product; variant: ProductVariant | null; quantity: number }>;
  unavailable: string[];
}

/**
 * Maps a previous order's items onto the CURRENT menu. Prices always come from
 * today's menu, and anything removed or sold out is reported back so the
 * customer can be told instead of silently losing an item.
 */
export function buildReorderPlan(items: CartLine[], products: Product[]): ReorderPlan {
  const plan: ReorderPlan = { add: [], unavailable: [] };

  for (const item of items) {
    const product =
      products.find((p) => p.id === item.productId) ??
      products.find((p) => p.slug === item.productSlug);

    if (!product || !product.isAvailable) {
      plan.unavailable.push(item.productName);
      continue;
    }

    let variant: ProductVariant | null = null;
    if (item.variantId) {
      variant = product.variants.find((v) => v.id === item.variantId) ?? null;
      if (!variant) variant = product.variants.find((v) => v.name === item.variantName) ?? null;
      if (!variant || !variant.isAvailable) {
        plan.unavailable.push(
          item.variantName ? `${item.productName} (${item.variantName})` : item.productName,
        );
        continue;
      }
    } else if (product.variants.some((v) => v.isAvailable)) {
      // Product gained variants since the order was placed – pick the cheapest.
      variant = product.variants
        .filter((v) => v.isAvailable)
        .reduce((cheapest, v) => (v.price < cheapest.price ? v : cheapest));
    }

    plan.add.push({ product, variant, quantity: item.quantity });
  }

  return plan;
}
