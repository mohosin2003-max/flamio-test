import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { getBurgerBoostOwnerOverview } from "@/lib/burger-boost-owner.functions";

export const Route = createFileRoute("/_authenticated/owner/burger-boost")({
  head: () => ({
    meta: [
      { title: "Burger Boost Management — Flamio" },
      { name: "description", content: "Review FLAMIO Burger Boost game status, gates and rules." },
      { property: "og:title", content: "Burger Boost Management — Flamio" },
      { property: "og:description", content: "Owner view of the Burger Boost game." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerBurgerBoost,
});

function OwnerBurgerBoost() {
  const fetchOverview = useServerFn(getBurgerBoostOwnerOverview);
  const q = useQuery({ queryKey: ["owner", "burger-boost"], queryFn: () => fetchOverview() });

  if (q.isPending) return <div className="space-y-3 p-4"><Skeleton className="h-8 w-56" /><Skeleton className="h-40 w-full" /></div>;
  if (q.error || !q.data) return <p className="p-4 text-sm text-destructive">You don't have access to Burger Boost management.</p>;
  const d = q.data;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <header>
        <h1 className="font-display text-2xl font-bold">FLAMIO Burger Boost</h1>
        <p className="text-sm text-muted-foreground">Read-only for now. Settings can't be saved until the game's database is installed.</p>
      </header>

      <Card><CardContent className="flex items-center justify-between gap-4 p-4">
        <div>
          <p className="font-semibold">Game status</p>
          <p className="text-sm text-muted-foreground">Locked off. Rewards {d.discountPercent}% · checkout {d.checkoutEnabled ? "on" : "off"}.</p>
        </div>
        <div className="flex items-center gap-2"><Lock className="size-4 text-muted-foreground" /><Switch checked={d.gameEnabled} disabled aria-label="Game enabled (locked)" /></div>
      </CardContent></Card>

      <Card><CardContent className="space-y-1 p-4">
        <p className="font-semibold">Gates per game</p>
        <p className="text-3xl font-black">{d.gateCount.current}</p>
        <p className="text-sm text-muted-foreground">Allowed range {d.gateCount.min}–{d.gateCount.max}. Customers can't change this. Not editable yet (no saved settings).</p>
      </CardContent></Card>

      <Card><CardContent className="space-y-3 p-4">
        <p className="font-semibold">Gate mix</p>
        <div className="flex flex-wrap gap-2">
          <Badge>Math {d.distribution.math}%</Badge>
          <Badge variant="secondary">Ingredient {d.distribution.ingredient}%</Badge>
          <Badge variant="destructive">Spoiled {d.distribution.negative}%</Badge>
        </div>
        <p className="text-sm">Math: {d.mathOperations.join("  ")}</p>
        <p className="text-sm capitalize">Ingredients / spoiled: {d.ingredients.join(", ")}</p>
      </CardContent></Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="p-4"><p className="font-semibold">Game analytics</p><p className="text-sm text-muted-foreground">Unavailable — {d.analytics.reason}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="font-semibold">Activity log</p><p className="text-sm text-muted-foreground">Unavailable — {d.audit.reason}</p></CardContent></Card>
      </div>
    </div>
  );
}
