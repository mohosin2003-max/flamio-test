import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";

import { WinnerTicker } from "@/components/challenges/WinnerTicker";
import { FeaturedSection } from "@/components/home/FeaturedSection";
import { HomeCarousel } from "@/components/home/HomeCarousel";
import { InstallAppBanner } from "@/components/home/InstallAppBanner";
import { LocationSection } from "@/components/home/LocationSection";
import { RecommendedSection } from "@/components/home/RecommendedSection";
import { RemainingMenuSection } from "@/components/home/RemainingMenuSection";
import { CustomerReviewsSection } from "@/components/reviews/CustomerReviewsSection";
import { menuQueryOptions, restaurantQueryOptions } from "@/lib/menu-repository";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Flamio — Flame-Grilled Burgers, Pizza & Meat Boxes in Kishoreganj" },
      {
        name: "description",
        content:
          "Order flame-grilled burgers, meat boxes, stone-baked pizza, pasta and shawarma from Flamio in Kishoreganj Sadar, Gurudayal College.",
      },
      { property: "og:title", content: "Flamio — Flame-Grilled Food in Kishoreganj" },
      {
        property: "og:description",
        content: "Burgers, meat boxes, pizza, pasta and shawarma cooked to order at Flamio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://flamio.bd/" },
      { property: "og:image", content: "https://flamio.bd/og-image.png" },
      { name: "twitter:image", content: "https://flamio.bd/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://flamio.bd/" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify({
          "@context": "https://schema.org",
          "@type": "Restaurant",
          name: "Flamio",
          url: "https://flamio.bd/",
          telephone: "+8801647502172",
          image: "https://flamio.bd/icon-512.png",
          address: {
            "@type": "PostalAddress",
            addressLocality: "Kishoreganj Sadar",
            addressRegion: "Kishoreganj",
            addressCountry: "BD",
          },
          openingHoursSpecification: [
            {
              "@type": "OpeningHoursSpecification",
              dayOfWeek: [
                "Monday",
                "Tuesday",
                "Wednesday",
                "Thursday",
                "Friday",
                "Saturday",
                "Sunday",
              ],
              opens: "11:00",
              closes: "22:00",
            },
          ],
        }),
      },
    ],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(menuQueryOptions());
    context.queryClient.ensureQueryData(restaurantQueryOptions());
  },
  component: HomePage,
});

function HomePage() {
  const { data: menu } = useSuspenseQuery(menuQueryOptions());
  const { data: info } = useSuspenseQuery(restaurantQueryOptions());

  const featured = menu.products.filter((p) => p.isFeatured);
  const popular = menu.products.filter((p) => p.isPopular);
  const carouselProducts = (featured.length ? featured : popular.length ? popular : menu.products).slice(0, 5);
  return (
    <>
      <InstallAppBanner />
      <HomeCarousel banners={info.banners} products={carouselProducts} />

      <div className="mx-auto w-full max-w-6xl px-4 pt-4 sm:px-6">
        <WinnerTicker />
      </div>

      <RecommendedSection products={menu.products} />

      <section
        aria-labelledby="categories-heading"
        className="mx-auto w-full max-w-6xl px-4 pt-8 sm:px-6"
      >
        <div className="flex items-end justify-between gap-4">
          <h2 id="categories-heading" className="font-display text-xl font-extrabold sm:text-2xl">
            Categories
          </h2>
          <Link
            to="/menu"
            search={{}}
            className="text-sm font-medium text-primary transition-smooth hover:opacity-80"
          >
            See all
          </Link>
        </div>
        <ul className="mt-4 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {menu.categories.map((category) => (
            <li key={category.id} className="w-32 shrink-0 sm:w-40">
              <Link
                to="/menu"
                search={{ category: category.slug }}
                className="group block overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card"
              >
                <span className="block aspect-[4/3] overflow-hidden">
                  {category.imageUrl ? (
                    <img
                      src={category.imageUrl}
                      alt={category.name}
                      loading="lazy"
                      className="size-full object-cover opacity-80 transition-smooth group-hover:scale-105"
                    />
                  ) : (
                    <span className="block size-full bg-muted" />
                  )}
                </span>
                <span className="block truncate p-2 text-center text-sm font-semibold">
                  {category.name}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <FeaturedSection products={menu.products} />

      <RemainingMenuSection
        products={menu.products}
        categories={menu.categories}
      />

      <CustomerReviewsSection />

      <div className="pt-10">
        <LocationSection restaurant={info.restaurant} />
      </div>
    </>
  );
}
