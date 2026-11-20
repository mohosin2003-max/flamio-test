import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Lock } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  getBurgerBoostOwnerOverview,
  getOwnerRewardSettings,
  setBurgerBoostGameEnabled,
  updateOwnerRewardSettings,
} from "@/lib/burger-boost-owner.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DRAFT_SETTINGS } from "@/lib/burger-boost-reward-flow";
import { REWARD_BOUNDS, type RewardSettings } from "@/lib/burger-boost-reward";

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

  if (q.isPending)
    return (
      <div className="space-y-3 p-4">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  if (q.error || !q.data)
    return (
      <p className="p-4 text-sm text-destructive">
        You don't have access to Burger Boost management.
      </p>
    );
  const d = q.data;

  return (
    <div className="mx-auto w-full max-w-4xl space-y-4 p-4">
      <header>
        <h1 className="font-display text-2xl font-bold">FLAMIO Burger Boost</h1>
        <p className="text-sm text-muted-foreground">
          TEST management · reward checkout and coupon issuance remain locked.
        </p>
      </header>

      <Card>
        <CardContent className="flex items-center justify-between gap-4 p-4">
          <div>
            <p className="font-semibold">Game status</p>
            <p className="text-sm text-muted-foreground">
              Rewards {d.discountPercent}% · checkout {d.checkoutEnabled ? "on" : "off"}
              .
            </p>
          </div>
          <GameToggle />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="font-semibold">Gates per game</p>
          <p className="text-3xl font-black">{d.gateCount.current}</p>
          <p className="text-sm text-muted-foreground">
            Allowed range {d.gateCount.min}–{d.gateCount.max}. Customers can't change this. Not
            editable yet (no saved settings).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="font-semibold">Gate mix</p>
          <div className="flex flex-wrap gap-2">
            <Badge>Math {d.distribution.math}%</Badge>
            <Badge variant="secondary">Ingredient {d.distribution.ingredient}%</Badge>
            <Badge variant="destructive">Spoiled {d.distribution.negative}%</Badge>
          </div>
          <p className="text-sm">Math: {d.mathOperations.join("  ")}</p>
          <p className="text-sm capitalize">Ingredients / spoiled: {d.ingredients.join(", ")}</p>
        </CardContent>
      </Card>

      <RewardSettingsForm />

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="font-semibold">Today's winners &amp; slots left</p>
            <p className="text-sm text-muted-foreground">Unavailable — {d.usage.reason}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="font-semibold">Reward history</p>
            <p className="text-sm text-muted-foreground">Unavailable — {d.rewardHistory.reason}</p>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardContent className="p-4">
            <p className="font-semibold">Game analytics</p>
            <p className="text-sm text-muted-foreground">Unavailable — {d.analytics.reason}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <p className="font-semibold">Activity log</p>
            <p className="text-sm text-muted-foreground">Unavailable — {d.audit.reason}</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function RewardSettingsForm() {
  const fetchSettings = useServerFn(getOwnerRewardSettings);
  const saveSettings = useServerFn(updateOwnerRewardSettings);
  const queryClient = useQueryClient();
  const q = useQuery({
    queryKey: ["owner", "burger-boost", "settings"],
    queryFn: () => fetchSettings(),
    retry: false,
  });
  const [form, setForm] = useState<RewardSettings>({ ...DRAFT_SETTINGS });
  useEffect(() => {
    if (q.data?.settings) setForm(q.data.settings);
  }, [q.data]);
  const mutation = useMutation({
    mutationFn: (settings: RewardSettings) => saveSettings({ data: settings }),
    onSuccess: (value) => {
      queryClient.setQueryData(["owner", "burger-boost", "settings"], value);
      void queryClient.invalidateQueries({ queryKey: ["burger-boost", "public-settings"] });
      toast.success("Reward settings saved");
    },
  });
  const available = q.data?.available === true;
  const usage = q.data?.usage;
  const fields: { key: keyof RewardSettings; label: string; min: number; max: number }[] = [
    { key: "ownerMax", label: "Top discount (%)", ...REWARD_BOUNDS.maxDiscount },
    { key: "partialMax", label: "Extra-winner discount (%)", min: 0, max: form.ownerMax },
    { key: "dailyFullLimit", label: "Full winners per day", ...REWARD_BOUNDS.winnersPerDay },
    { key: "dailyPartialLimit", label: "Extra winners per day", ...REWARD_BOUNDS.winnersPerDay },
    { key: "minOrderBdt", label: "Minimum eligible food order (৳)", ...REWARD_BOUNDS.minOrderBdt },
    { key: "gateCount", label: "Gates per game", ...REWARD_BOUNDS.gateCount },
  ];
  return (
    <section className="space-y-4 border-y border-border py-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold">Reward settings</h2>
        <Badge variant="outline">{available ? "Saved settings" : "Unavailable · not saved"}</Badge>
      </div>
      {q.isPending ? (
        <Skeleton className="h-32 w-full" />
      ) : (
        <>
          {!available && (
            <p role="status" className="text-sm text-muted-foreground">
              {q.error
                ? "Owner settings access could not be verified."
                : "The approved TEST database update is pending. Starting values below are not saved."}
            </p>
          )}
          <form
            className="space-y-4"
            onSubmit={(event) => {
              event.preventDefault();
              if (available && !mutation.isPending) mutation.mutate(form);
            }}
          >
            <fieldset
              disabled={!available || mutation.isPending}
              className="grid gap-4 sm:grid-cols-2"
            >
              {fields.map(({ key, label, min, max }) => (
                <div key={key} className="space-y-2">
                  <Label htmlFor={`bb-${key}`}>{label}</Label>
                  <Input
                    id={`bb-${key}`}
                    type="number"
                    required
                    step={1}
                    min={min}
                    max={max}
                    value={form[key]}
                    onChange={(event) =>
                      setForm((current) => ({ ...current, [key]: event.target.valueAsNumber }))
                    }
                  />
                </div>
              ))}
            </fieldset>
            <p className="text-sm text-muted-foreground">
              Reservation validity: 30 minutes · checkout locked · coupons locked
            </p>
            {mutation.error && (
              <p role="alert" className="text-sm text-destructive">
                {mutation.error.message}
              </p>
            )}
            <Button type="submit" disabled={!available || mutation.isPending}>
              {mutation.isPending ? "Saving…" : "Save settings"}
            </Button>
          </form>
          {usage && (
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-sm text-muted-foreground">Full winners · {usage.date}</dt>
                <dd>
                  {usage.fullUsed} used · {usage.fullReserved} reserved ·{" "}
                  {Math.max(0, form.dailyFullLimit - usage.fullUsed - usage.fullReserved)} slots
                  left
                </dd>
              </div>
              <div>
                <dt className="text-sm text-muted-foreground">Extra winners · {usage.date}</dt>
                <dd>
                  {usage.partialUsed} used · {usage.partialReserved} reserved ·{" "}
                  {Math.max(0, form.dailyPartialLimit - usage.partialUsed - usage.partialReserved)}{" "}
                  slots left
                </dd>
              </div>
            </dl>
          )}
        </>
      )}
    </section>
  );
}

function GameToggle() {
  const qc = useQueryClient();
  const fetchSettings = useServerFn(getOwnerRewardSettings);
  const setEnabled = useServerFn(setBurgerBoostGameEnabled);
  const settings = useQuery({
    queryKey: ["owner", "burger-boost", "settings"],
    queryFn: () => fetchSettings(),
  });
  const m = useMutation({
    mutationFn: (enabled: boolean) => setEnabled({ data: { enabled } }),
    onSuccess: (r) => {
      qc.setQueryData(["owner", "burger-boost", "settings"], r);
      toast.success(r.gameEnabled ? "Game turned on." : "Game turned off.");
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not change game status."),
  });
  const available = settings.data?.available === true;
  const on = settings.data?.gameEnabled === true;
  return (
    <div className="flex items-center gap-2">
      {!available && <Lock className="size-4 text-muted-foreground" />}
      <span className="text-sm text-muted-foreground">{on ? "On" : "Off"}</span>
      <Switch
        checked={on}
        disabled={!available || m.isPending}
        aria-label="Game enabled"
        onCheckedChange={(next) => {
          const msg = next ? "Turn the Burger Boost game ON for customers?" : "Turn the game OFF?";
          if (window.confirm(msg)) m.mutate(next);
        }}
      />
    </div>
  );
}
