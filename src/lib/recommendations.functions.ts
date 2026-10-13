import { createServerFn } from "@tanstack/react-start";

/**
 * Smart food recommendations.
 *
 * Returns product IDs only — the client resolves them against the existing
 * menu query, so availability, live prices and variants always come from
 * today's menu and nothing is duplicated here.
 *
 * Identity is read from the request's bearer token (optional), so the same
 * endpoint serves guests and signed-in customers. Order history is read for
 * the caller's own user id only; no other customer's data is ever touched.
 */

export interface Recommendations {
  enabled: boolean;
  count: number;
  /** Previously ordered, still available: most recent + most frequent first. */
  orderAgain: string[];
  /** Available items the customer hasn't ordered (or owner picks for guests). */
  tryNew: string[];
}

const FULFILLED_STATUSES = ["completed", "delivered"];

export const getRecommendations = createServerFn({ method: "GET" }).handler(
  async (): Promise<Recommendations> => {
    const empty: Recommendations = { enabled: false, count: 0, orderAgain: [], tryNew: [] };

    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { getOptionalUserId } = await import("@/lib/auth.server");

      const { data: settings } = await supabaseAdmin
        .from("restaurant_settings")
        .select("recommendations_enabled, recommendations_count")
        .order("created_at")
        .limit(1)
        .maybeSingle();

      if (settings && settings.recommendations_enabled === false) return empty;
      const count = Math.min(Math.max(Number(settings?.recommendations_count ?? 6) || 6, 1), 12);

      // Available products only, in the owner's menu order.
      const { data: products } = await supabaseAdmin
        .from("products")
        .select("id, category_id, is_available, is_featured, is_popular, sort_order")
        .eq("is_available", true)
        .order("sort_order");

      const available = products ?? [];
      if (available.length === 0) return { enabled: true, count, orderAgain: [], tryNew: [] };

      const availableIds = new Set(available.map((p) => p.id));
      const ownerPicks = available
        .filter((p) => p.is_featured || p.is_popular)
        .map((p) => p.id);

      const userId = await getOptionalUserId();
      if (!userId) {
        // Guests / new customers: owner-selected + popular items only.
        const fallback = (ownerPicks.length ? ownerPicks : available.map((p) => p.id)).slice(
          0,
          count,
        );
        return { enabled: true, count, orderAgain: [], tryNew: fallback };
      }

      const { data: orders } = await supabaseAdmin
        .from("orders")
        .select("id, created_at, order_items(product_id)")
        .eq("user_id", userId)
        .in("status", FULFILLED_STATUSES)
        .order("created_at", { ascending: false })
        .limit(30);

      // Rank by recency first (newest order wins), then by how often ordered.
      const scores = new Map<string, { recency: number; times: number }>();
      (orders ?? []).forEach((order, orderIndex) => {
        for (const item of order.order_items ?? []) {
          const id = item.product_id;
          if (!id || !availableIds.has(id)) continue;
          const current = scores.get(id);
          if (current) current.times += 1;
          else scores.set(id, { recency: orderIndex, times: 1 });
        }
      });

      const orderAgain = [...scores.entries()]
        .sort((a, b) => a[1].recency - b[1].recency || b[1].times - a[1].times)
        .map(([id]) => id)
        .slice(0, count);

      // Categories the customer already likes get priority in "try new".
      const likedCategories = new Set(
        available.filter((p) => scores.has(p.id)).map((p) => p.category_id),
      );

      const candidates = available.filter((p) => !scores.has(p.id));
      const rank = (p: (typeof available)[number]) =>
        (p.is_featured ? 0 : p.is_popular ? 1 : 2) + (likedCategories.has(p.category_id) ? 0 : 3);

      const tryNew = candidates
        .slice()
        .sort((a, b) => rank(a) - rank(b) || a.sort_order - b.sort_order)
        .map((p) => p.id)
        .slice(0, count);

      return { enabled: true, count, orderAgain, tryNew };
    } catch (error) {
      console.error("Recommendations load failed", error);
      return empty;
    }
  },
);
