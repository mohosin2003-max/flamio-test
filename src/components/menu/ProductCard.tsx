import { Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { toast } from "sonner";

import { FavoriteButton } from "@/components/menu/FavoriteButton";
import { Button } from "@/components/ui/button";
import { useCart } from "@/context/cart";
import { formatBDT } from "@/lib/format";
import { displayPrice, hasVariants, primaryImage } from "@/lib/menu-repository";
import type { Product } from "@/types/menu";

const badgeLabels: Record<string, string> = {
  offer: "Offer",
  popular: "Popular",
  new: "New",
  spicy: "Spicy",
};

export function ProductCard({
  product,
  showOfferBadge = false,
}: {
  product: Product;
  /** Adds an "Offer" badge for owner-selected offer items (Featured section). */
  showOfferBadge?: boolean;
}) {
  const { addItem } = useCart();
  const image = primaryImage(product);
  const price = displayPrice(product);
  const needsChoice = hasVariants(product);

  const badges = [
    ...(showOfferBadge && product.isFeatured ? ["offer"] : []),
    ...(product.isPopular ? ["popular"] : []),
    ...product.badges,
  ];

  return (
    <article className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card transition-smooth hover:border-primary/50">
      <Link
        to="/menu/$productSlug"
        params={{ productSlug: product.slug }}
        className="relative block aspect-[4/3] overflow-hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`View details for ${product.name}`}
      >
        {image ? (
          <img
            src={image}
            alt={product.name}
            loading="lazy"
            width={800}
            height={600}
            className="size-full object-cover transition-smooth group-hover:scale-105"
          />
        ) : (
          <div className="grid size-full place-items-center bg-muted text-sm text-muted-foreground">
            Image coming soon
          </div>
        )}
        {badges.length > 0 && (
          <ul className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {[...new Set(badges)].slice(0, 2).map((badge) => (
              <li
                key={badge}
                className="rounded-full bg-gradient-ember px-2.5 py-1 text-[11px] font-bold uppercase tracking-wide text-primary-foreground"
              >
                {badgeLabels[badge] ?? badge}
              </li>
            ))}
          </ul>
        )}
      </Link>

      <FavoriteButton
        productId={product.id}
        productSlug={product.slug}
        productName={product.name}
        className="absolute right-3 top-3 z-10 shadow-card"
      />

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="flex-1">
          <h3 className="text-base font-semibold leading-snug">
            <Link
              to="/menu/$productSlug"
              params={{ productSlug: product.slug }}
              className="transition-smooth hover:text-primary"
            >
              {product.name}
            </Link>
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">
            {needsChoice ? "From " : ""}
            <span className="font-display text-lg font-bold text-foreground">
              {formatBDT(price)}
            </span>
          </p>
        </div>

        {needsChoice ? (
          <Button asChild size="sm" className="w-full">
            <Link to="/menu/$productSlug" params={{ productSlug: product.slug }}>
              Choose options
            </Link>
          </Button>
        ) : (
          <Button
            size="sm"
            className="w-full"
            disabled={!product.isAvailable}
            onClick={() => {
              addItem(product, null, 1);
              toast.success(`${product.name} added to cart`);
            }}
            aria-label={`Add ${product.name} to cart`}
          >
            <Plus aria-hidden="true" />
            {product.isAvailable ? "Add to cart" : "Unavailable"}
          </Button>
        )}
      </div>
    </article>
  );
}
