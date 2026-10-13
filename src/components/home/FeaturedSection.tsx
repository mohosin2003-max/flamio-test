import { Link } from "@tanstack/react-router";

import { ProductCard } from "@/components/menu/ProductCard";
import type { Product } from "@/types/menu";

/**
 * One combined "Popular & Offers" section.
 *
 * Presentation only: items come from the owner's existing menu controls
 * (`is_popular` and `is_featured` on products). An item flagged as both appears
 * exactly once, with both badges. Hidden entirely when nothing is selected.
 */
export function FeaturedSection({ products }: { products: Product[] }) {
  const featured = products.filter((p) => p.isAvailable && (p.isPopular || p.isFeatured));
  if (featured.length === 0) return null;

  // Offers first, then popular picks, keeping the owner's menu order within each.
  const ordered = [
    ...featured.filter((p) => p.isFeatured),
    ...featured.filter((p) => !p.isFeatured),
  ].slice(0, 8);

  return (
    <section
      aria-labelledby="featured-heading"
      className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6"
    >
      <div className="flex items-end justify-between gap-4">
        <h2 id="featured-heading" className="font-display text-xl font-extrabold sm:text-2xl">
          Popular &amp; Offers
        </h2>
        <Link
          to="/menu"
          search={{}}
          className="text-sm font-medium text-primary transition-smooth hover:opacity-80"
        >
          Full menu
        </Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {ordered.map((product) => (
          <ProductCard key={product.id} product={product} showOfferBadge />
        ))}
      </div>
    </section>
  );
}

/** IDs rendered by the Featured section, for de-duplicating other sections. */
export function featuredIds(products: Product[]): string[] {
  return products
    .filter((p) => p.isAvailable && (p.isPopular || p.isFeatured))
    .sort((a, b) => Number(b.isFeatured) - Number(a.isFeatured))
    .slice(0, 8)
    .map((p) => p.id);
}
