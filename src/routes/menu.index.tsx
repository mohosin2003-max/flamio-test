import { useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { z } from "zod";

import { FeaturedSection, featuredIds } from "@/components/home/FeaturedSection";
import { RecommendedSection } from "@/components/home/RecommendedSection";
import { ProductCard } from "@/components/menu/ProductCard";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { menuQueryOptions } from "@/lib/menu-repository";
import { cn } from "@/lib/utils";

const searchSchema = z.object({
  category: z.string().optional(),
  q: z.string().optional(),
});

export const Route = createFileRoute("/menu/")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Menu — Flamio Burgers, Meat Boxes, Pizza & Shawarma" },
      {
        name: "description",
        content:
          "Explore the full Flamio menu: burgers from ৳60, meat boxes, stone-baked pizza, oven baked pasta, shawarma and sides.",
      },
      { property: "og:title", content: "Flamio Menu" },
      {
        property: "og:description",
        content: "Burgers, meat boxes, pizza, pasta, shawarma and sides — order online from Flamio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://flamio.bd/menu" },
      { property: "og:image", content: "https://flamio.bd/og-image.png" },
      { name: "twitter:image", content: "https://flamio.bd/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://flamio.bd/menu" }],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(menuQueryOptions());
  },
  component: MenuPage,
});

function MenuPage() {
  const { category, q } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data: menu } = useSuspenseQuery(menuQueryOptions());
  const query = (q ?? "").trim().toLowerCase();
  const matches = (p: { name: string; description: string | null }) =>
    !query ||
    p.name.toLowerCase().includes(query) ||
    (p.description ?? "").toLowerCase().includes(query);

  const activeCategory = menu.categories.find((c) => c.slug === category) ?? null;
  const visibleCategories = activeCategory ? [activeCategory] : menu.categories;

  // Owner-selected Popular / Offer items are shown once in the Featured area at
  // the top of the full menu, so they are not repeated in the category lists.
  // While searching or filtering a category, the plain full list is kept.
  const showFeatured = !activeCategory && !query;
  const featuredSet = showFeatured ? new Set(featuredIds(menu.products)) : new Set<string>();

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header>
        <h1 className="font-display text-3xl font-black sm:text-5xl">
          The <span className="text-gradient-ember">Flamio</span> Menu
        </h1>
        <p className="mt-3 max-w-xl text-muted-foreground">
          Everything is cooked when you order. Tap a dish for details.
        </p>
      </header>

      <div className="relative mt-6 max-w-md">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <input
          type="search"
          value={q ?? ""}
          onChange={(e) => {
            const value = e.target.value;
            void navigate({
              search: (prev) => ({ ...prev, q: value || undefined }),
              replace: true,
            });
          }}
          placeholder="Search the menu…"
          aria-label="Search menu items"
          className="w-full rounded-full border border-border bg-secondary py-2.5 pl-10 pr-4 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>

      <nav aria-label="Menu categories" className="sticky top-16 z-40 -mx-4 mt-6 bg-background/90 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6">
        <ul className="flex gap-2 overflow-x-auto pb-1">
          <li>
            <Link
              to="/menu"
              search={{}}
              className={cn(
                "inline-flex whitespace-nowrap rounded-full border border-border px-4 py-2 text-sm font-medium transition-smooth",
                !activeCategory
                  ? "bg-gradient-ember text-primary-foreground"
                  : "bg-secondary text-muted-foreground hover:text-foreground",
              )}
            >
              All
            </Link>
          </li>
          {menu.categories.map((c) => (
            <li key={c.id}>
              <Link
                to="/menu"
                search={{ category: c.slug }}
                className={cn(
                  "inline-flex whitespace-nowrap rounded-full border border-border px-4 py-2 text-sm font-medium transition-smooth",
                  activeCategory?.id === c.id
                    ? "bg-gradient-ember text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {c.name}
              </Link>
            </li>
          ))}
        </ul>
      </nav>

      {showFeatured ? (
        <div className="-mx-4 sm:-mx-6">
          <FeaturedSection products={menu.products} />
          <RecommendedSection products={menu.products} />
        </div>
      ) : null}


      {query && visibleCategories.every((c) => menu.products.filter((p) => p.categoryId === c.id && matches(p)).length === 0) ? (
        <div className="mt-8">
          <EmptyState
            title="No matching items"
            description={`Nothing on the menu matches “${q}”. Try another search.`}
          />
        </div>
      ) : null}

      {category && !activeCategory ? (
        <div className="mt-8">
          <EmptyState
            title="Category not found"
            description="That category is not on the menu right now."
            action={
              <Button asChild>
                <Link to="/menu" search={{}}>
                  View full menu
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-8 space-y-12">
          {visibleCategories.map((c) => {
            const items = menu.products.filter(
              (p) => p.categoryId === c.id && matches(p) && !featuredSet.has(p.id),
            );
            if (showFeatured && items.length === 0) return null;
            if (query && items.length === 0) return null;
            return (
              <section key={c.id} aria-labelledby={`cat-${c.slug}`} className="scroll-mt-32">
                <div className="flex items-baseline justify-between gap-4">
                  <h2 id={`cat-${c.slug}`} className="font-display text-2xl font-extrabold">
                    {c.name}
                  </h2>
                  <span className="text-sm text-muted-foreground">{items.length} items</span>
                </div>
                {c.description ? (
                  <p className="mt-1 text-sm text-muted-foreground">{c.description}</p>
                ) : null}
                {items.length === 0 ? (
                  <div className="mt-4">
                    <EmptyState
                      title="Nothing here yet"
                      description="Dishes for this category will appear as soon as they are added."
                    />
                  </div>
                ) : (
                  <div className="mt-5 grid grid-cols-2 gap-4 lg:grid-cols-4">
                    {items.map((product) => (
                      <ProductCard key={product.id} product={product} />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
