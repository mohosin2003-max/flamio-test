import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { PromoBannerArea } from "@/components/home/PromoBannerArea";
import { ProductCard } from "@/components/menu/ProductCard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { menuQueryOptions, restaurantQueryOptions } from "@/lib/menu-repository";

export const Route = createFileRoute("/offers")({
  head: () => ({
    meta: [
      { title: "Offers & Specials — Flamio" },
      {
        name: "description",
        content:
          "See the current Flamio offers and chef specials — featured burgers, meat boxes, pizza and more.",
      },
      { property: "og:title", content: "Flamio Offers & Specials" },
      {
        property: "og:description",
        content: "Current Flamio promotions and featured dishes, ready to order.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://flamio.bd/offers" },
      { property: "og:image", content: "https://flamio.bd/og-image.png" },
      { name: "twitter:image", content: "https://flamio.bd/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://flamio.bd/offers" }],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(menuQueryOptions());
    context.queryClient.ensureQueryData(restaurantQueryOptions());
  },
  component: OffersPage,
});

function OffersPage() {
  const { data: menu } = useSuspenseQuery(menuQueryOptions());
  const { data: info } = useSuspenseQuery(restaurantQueryOptions());
  const banners = info.banners;
  const specials = menu.products.filter((p) => p.isFeatured);

  return (
    <div className="mx-auto w-full max-w-6xl space-y-8 px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-3xl font-black sm:text-4xl">
          <span className="text-gradient-ember">Offers</span> & Specials
        </h1>
        <p className="mt-2 max-w-xl text-muted-foreground">
          Running promotions and the dishes our kitchen is proudest of.
        </p>
      </header>

      <PromoBannerArea banners={banners} />

      <section aria-labelledby="specials">
        <h2 id="specials" className="font-display text-2xl font-extrabold">
          Chef's specials
        </h2>
        {specials.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              title="No offers running right now"
              description="Check the full menu — everything is cooked fresh when you order."
              action={
                <Button asChild>
                  <Link to="/menu" search={{}}>
                    View menu
                  </Link>
                </Button>
              }
            />
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
            {specials.map((product) => (
              <ProductCard key={product.id} product={product} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
