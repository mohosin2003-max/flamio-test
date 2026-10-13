import { Link, createFileRoute } from "@tanstack/react-router";
import { useSuspenseQuery } from "@tanstack/react-query";
import { Heart, Loader2, ShoppingBag } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useCart } from "@/context/cart";
import { useFavorites } from "@/hooks/use-favorites";
import { formatBDT } from "@/lib/format";
import { displayPrice, hasVariants, menuQueryOptions, primaryImage } from "@/lib/menu-repository";

export const Route = createFileRoute("/_authenticated/account/favorites")({
  head: () => ({
    meta: [
      { title: "My Favorites — Flamio" },
      { name: "description", content: "The Flamio dishes you saved for a quick reorder." },
      { property: "og:title", content: "My Favorites — Flamio" },
      { property: "og:description", content: "The Flamio dishes you saved for a quick reorder." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(menuQueryOptions()),
  component: FavoritesPage,
});

function FavoritesPage() {
  const { data } = useSuspenseQuery(menuQueryOptions());
  const { favorites, isLoading, error, toggle, isPending } = useFavorites();
  const { addItem } = useCart();

  const items = favorites
    .map((f) => data.products.find((p) => p.id === f.productId || p.slug === f.productSlug))
    .filter((p): p is NonNullable<typeof p> => Boolean(p));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-28 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-black sm:text-4xl">My Favorites</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Saved dishes with today&apos;s menu prices.
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}

      {isLoading ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-24 w-full rounded-2xl" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="No favorites yet"
            description="Tap the heart on any dish to save it here for faster reordering."
            action={
              <Button asChild>
                <Link to="/menu" search={{}}>
                  Browse the menu
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <ul className="mt-6 space-y-3">
          {items.map((product) => {
            const image = primaryImage(product);
            const needsChoice = hasVariants(product);
            return (
              <li
                key={product.id}
                className="flex gap-3 rounded-2xl border border-border/70 bg-card p-3 shadow-card sm:p-4"
              >
                <Link
                  to="/menu/$productSlug"
                  params={{ productSlug: product.slug }}
                  className="shrink-0"
                >
                  {image ? (
                    <img
                      src={image}
                      alt={product.name}
                      width={96}
                      height={96}
                      loading="lazy"
                      className="size-20 rounded-xl object-cover sm:size-24"
                    />
                  ) : (
                    <span className="grid size-20 place-items-center rounded-xl bg-muted text-[11px] text-muted-foreground sm:size-24">
                      No image
                    </span>
                  )}
                </Link>

                <div className="flex min-w-0 flex-1 flex-col gap-2">
                  <div className="min-w-0">
                    <Link
                      to="/menu/$productSlug"
                      params={{ productSlug: product.slug }}
                      className="block truncate font-semibold transition-smooth hover:text-primary"
                    >
                      {product.name}
                    </Link>
                    <p className="text-sm text-muted-foreground">
                      {needsChoice ? "From " : ""}
                      <span className="font-display font-bold text-foreground">
                        {formatBDT(displayPrice(product))}
                      </span>
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {needsChoice ? (
                      <Button asChild size="sm">
                        <Link to="/menu/$productSlug" params={{ productSlug: product.slug }}>
                          Choose options
                        </Link>
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        disabled={!product.isAvailable}
                        onClick={() => {
                          addItem(product, null, 1);
                          toast.success(`${product.name} added to cart`);
                        }}
                      >
                        <ShoppingBag aria-hidden="true" />
                        Add to cart
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={isPending}
                      onClick={async () => {
                        try {
                          await toggle(product.id, product.slug);
                          toast.success(`Removed ${product.name} from favorites`);
                        } catch {
                          toast.error("We couldn't update your favorites. Please try again.");
                        }
                      }}
                    >
                      {isPending ? (
                        <Loader2 aria-hidden="true" className="animate-spin" />
                      ) : (
                        <Heart aria-hidden="true" className="fill-current" />
                      )}
                      Remove
                    </Button>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
