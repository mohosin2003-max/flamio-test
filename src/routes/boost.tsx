import { ClientOnly, createFileRoute } from "@tanstack/react-router";

import { BurgerBoostGame } from "@/components/burger-boost/BurgerBoostGame";

export const Route = createFileRoute("/boost")({
  head: () => ({
    meta: [
      { title: "Burger Boost — Flamio Practice Game" },
      { name: "description", content: "Play FLAMIO Burger Boost: a 60-second burger runner. Solve math gates, stack ingredients and dodge spoiled food." },
      { property: "og:title", content: "FLAMIO Burger Boost" },
      { property: "og:description", content: "A quick burger-stacking runner game from Flamio. Practice mode." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: BoostPage,
});

function BoostPage() {
  return (
    <main className="px-0 py-0 md:py-6">
      <ClientOnly fallback={<div className="grid h-[70dvh] place-items-center text-muted-foreground">Loading game…</div>}>
        <BurgerBoostGame />
      </ClientOnly>
    </main>
  );
}
