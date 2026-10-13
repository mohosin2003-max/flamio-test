import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/hooks/use-auth";
import { formatBDT } from "@/lib/format";
import { displayPrice, primaryImage } from "@/lib/menu-repository";
import { getRecommendations } from "@/lib/recommendations.functions";
import type { Product } from "@/types/menu";

/**
 * "Recommended for You" — presentation only. The server returns product IDs;
 * every price, option and availability flag comes from the live menu list
 * already loaded on the page.
 *
 * Kept deliberately compact (a single horizontal strip of small cards) so it
 * stays visually secondary to the primary menu.
 */
export function RecommendedSection({
  products,
}: {
  products: Product[];
}) {
  const { user, loading } = useAuth();
  const fetchRecommendations = useServerFn(getRecommendations);

  const { data } = useQuery({
    queryKey: ["recommendations", user?.id ?? "guest"],
    queryFn: () => fetchRecommendations(),
    enabled: !loading,
    staleTime: 60 * 1000,
  });

  if (!data?.enabled) return null;

  const byId = new Map(products.filter((p) => p.isAvailable).map((p) => [p.id, p] as const));
  const seen = new Set<string>();
  const items: Product[] = [];
  for (const id of [...data.orderAgain, ...data.tryNew]) {
    if (seen.has(id)) continue;
    const product = byId.get(id);
    if (!product) continue;
    seen.add(id);
    items.push(product);
    if (items.length >= 8) break;
  }

  if (items.length === 0) return null;

  const hasHistory = data.orderAgain.length > 0;

  return (
    <section
      aria-labelledby="recommended-heading"
      className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6"
    >
      <div className="flex items-end justify-between gap-4">
        <h2 id="recommended-heading" className="font-display text-base font-extrabold sm:text-lg">
          Recommended for You
        </h2>
        <span className="text-xs text-muted-foreground">
          {hasHistory ? "Based on your orders" : "Popular picks"}
        </span>
      </div>

      <ul className="mt-3 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {items.map((product) => (
          <li key={product.id} className="w-32 shrink-0 sm:w-40">
            <Link
              to="/menu/$productSlug"
              params={{ productSlug: product.slug }}
              className="group block overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card transition-smooth hover:border-primary/50"
            >
              <span className="block aspect-[4/3] overflow-hidden">
                {primaryImage(product) ? (
                  <img
                    src={primaryImage(product) as string}
                    alt={product.name}
                    loading="lazy"
                    className="size-full object-cover transition-smooth group-hover:scale-105"
                  />
                ) : (
                  <span className="block size-full bg-muted" />
                )}
              </span>
              <span className="block p-2">
                <span className="block truncate text-sm font-semibold">{product.name}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {formatBDT(displayPrice(product))}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
