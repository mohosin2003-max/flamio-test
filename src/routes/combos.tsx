import { useQuery, useSuspenseQuery } from "@tanstack/react-query";
import { Link, createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { ComboBuilder } from "@/components/combo/ComboBuilder";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { listCombos } from "@/lib/combos.functions";
import type { ComboDto } from "@/lib/combos";
import { menuQueryOptions } from "@/lib/menu-repository";

export const Route = createFileRoute("/combos")({
  head: () => ({
    meta: [
      { title: "Build Your Own Combo — Flamio Kishoreganj" },
      {
        name: "description",
        content:
          "Build your own Flamio combo: pick a flame-grilled burger, a side and a drink and see your live combo price before you order.",
      },
      { property: "og:title", content: "Build Your Own Combo — Flamio" },
      {
        property: "og:description",
        content: "Pick a burger, a side and a drink and build your own Flamio combo deal.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://flamio.bd/combos" },
      { property: "og:image", content: "https://flamio.bd/og-image.png" },
      { name: "twitter:image", content: "https://flamio.bd/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://flamio.bd/combos" }],
  }),
  loader: ({ context }) => {
    context.queryClient.ensureQueryData(menuQueryOptions());
  },
  component: CombosPage,
});

function CombosPage() {
  const { data: menu } = useSuspenseQuery(menuQueryOptions());
  const fetchCombos = useServerFn(listCombos);
  const combos = useQuery<ComboDto[]>({
    queryKey: ["combos"],
    queryFn: () => fetchCombos(),
    staleTime: 60 * 1000,
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <header>
        <h1 className="font-display text-3xl font-black sm:text-4xl">Build your own combo</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Pick your favourites step by step and watch your combo price update as you go.
        </p>
      </header>

      {combos.isLoading ? (
        <div className="mt-8 space-y-4">
          <Skeleton className="h-64 w-full" />
        </div>
      ) : (combos.data ?? []).length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="No combos right now"
            description="There aren't any combo deals running at the moment. The full menu is always available."
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
        <div className="mt-8 space-y-6">
          {(combos.data ?? []).map((combo) => (
            <ComboBuilder key={combo.id} combo={combo} products={menu.products} />
          ))}
        </div>
      )}
    </div>
  );
}
