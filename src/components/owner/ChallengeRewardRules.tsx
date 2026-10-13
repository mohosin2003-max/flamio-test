import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  ownerDeleteChallengeRewardRule,
  ownerGetChallengeRewards,
  ownerSaveChallengeRewardRule,
} from "@/lib/rewards.functions";
import type { ChallengeRewardRule } from "@/lib/rewards.functions";

type Draft = Omit<ChallengeRewardRule, "id"> & { id: string | null };

const emptyDraft: Draft = {
  id: null,
  name: "Lost challenge reward",
  challengeId: null,
  resultCondition: "lost",
  closeThresholdPercent: 90,
  points: 20,
  isEnabled: true,
  firstTimeOnly: false,
  maxPerCustomer: 0,
  maxPerDay: 1,
  maxPerChallenge: 0,
  allowRepeatAfterLimit: false,
  startsOn: null,
  endsOn: null,
};

export function ChallengeRewardRules() {
  const getData = useServerFn(ownerGetChallengeRewards);
  const saveRule = useServerFn(ownerSaveChallengeRewardRule);
  const deleteRule = useServerFn(ownerDeleteChallengeRewardRule);
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useQuery({ queryKey: ["owner-challenge-rewards"], queryFn: () => getData() });
  if (query.isLoading) return <Skeleton className="h-40 w-full" />;
  if (!query.data) return null;

  if (!query.data.installed) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Challenge result rewards are not set up in the database yet. Run
          <span className="font-mono"> docs/sql/challenge_result_rewards.sql </span>
          once, then reload this page.
        </CardContent>
      </Card>
    );
  }

  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-challenge-rewards"] });
  const challengeName = (id: string | null) =>
    id ? (query.data.challenges.find((c) => c.id === id)?.name ?? "Challenge") : "All challenges";

  async function save(value: Draft) {
    setBusy(true);
    try {
      await saveRule({ data: value });
      await refresh();
      setDraft(null);
      toast.success("Challenge reward rule saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save this rule");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="font-display text-xl font-bold">Challenge result rewards</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Optional points for customers who lose or almost win a challenge.
          </p>
        </div>
        <Button size="sm" onClick={() => setDraft({ ...emptyDraft })}>
          <Plus /> New rule
        </Button>
      </div>

      {draft ? (
        <RuleForm
          draft={draft}
          challenges={query.data.challenges}
          busy={busy}
          onChange={setDraft}
          onCancel={() => setDraft(null)}
          onSave={() => void save(draft)}
        />
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {query.data.rules.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground sm:col-span-2">
            No challenge result reward rules yet.
          </p>
        ) : (
          query.data.rules.map((rule) => (
            <Card key={rule.id}>
              <CardContent className="space-y-2 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-bold">{rule.name}</p>
                      <Badge variant={rule.isEnabled ? "default" : "secondary"}>
                        {rule.isEnabled ? "Enabled" : "Disabled"}
                      </Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {rule.resultCondition === "lost"
                        ? "Lost challenge"
                        : `Almost won (${rule.closeThresholdPercent}%+)`}{" "}
                      · {rule.points} points · {challengeName(rule.challengeId)}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {rule.firstTimeOnly ? "First time only · " : ""}
                      {rule.maxPerDay > 0 ? `${rule.maxPerDay}/day · ` : ""}
                      {rule.maxPerCustomer > 0 ? `${rule.maxPerCustomer} per customer · ` : ""}
                      {rule.maxPerChallenge > 0 ? `${rule.maxPerChallenge} per challenge · ` : ""}
                      {rule.allowRepeatAfterLimit ? "Repeats after limit" : "Stops at limit"}
                      {rule.startsOn || rule.endsOn
                        ? ` · ${rule.startsOn ?? "—"} to ${rule.endsOn ?? "—"}`
                        : ""}
                    </p>
                  </div>
                  <Switch
                    checked={rule.isEnabled}
                    aria-label={`Enable ${rule.name}`}
                    onCheckedChange={(checked) => void save({ ...rule, isEnabled: checked })}
                  />
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setDraft({ ...rule })}>
                    Edit
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={async () => {
                      if (!window.confirm(`Delete "${rule.name}"? Existing reward points stay untouched.`)) return;
                      try {
                        await deleteRule({ data: { id: rule.id } });
                        await refresh();
                        toast.success("Rule deleted");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Couldn't delete this rule");
                      }
                    }}
                  >
                    <Trash2 /> Delete
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      <div>
        <h3 className="font-display text-lg font-bold">Challenge reward history</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Every qualifying result, including rewards blocked by a limit.
        </p>
      </div>
      <div className="space-y-2">
        {query.data.events.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
            No challenge rewards yet.
          </p>
        ) : (
          query.data.events.map((event) => (
            <Card key={event.id}>
              <CardContent className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {event.customerName} · {event.challengeName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {event.ruleName} · {event.resultCondition === "close" ? "Almost won" : "Lost"} ·{" "}
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                </div>
                {event.status === "awarded" ? (
                  <Badge>+{event.points} points</Badge>
                ) : (
                  <Badge variant="secondary">Blocked · {event.blockedReason ?? "Limit reached"}</Badge>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function RuleForm({
  draft,
  challenges,
  busy,
  onChange,
  onCancel,
  onSave,
}: {
  draft: Draft;
  challenges: { id: string; name: string }[];
  busy: boolean;
  onChange: (value: Draft) => void;
  onCancel: () => void;
  onSave: () => void;
}) {
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => onChange({ ...draft, [key]: value });
  return (
    <Card>
      <CardContent className="space-y-4 p-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="crr-name">Rule name</Label>
            <Input id="crr-name" value={draft.name} onChange={(e) => set("name", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crr-points">Reward points</Label>
            <Input
              id="crr-points"
              type="number"
              min="0"
              value={String(draft.points)}
              onChange={(e) => set("points", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crr-condition">Result condition</Label>
            <select
              id="crr-condition"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.resultCondition}
              onChange={(e) => set("resultCondition", e.target.value as Draft["resultCondition"])}
            >
              <option value="lost">Lost challenge</option>
              <option value="close">Almost won / close result</option>
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crr-challenge">Challenge</Label>
            <select
              id="crr-challenge"
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={draft.challengeId ?? ""}
              onChange={(e) => set("challengeId", e.target.value || null)}
            >
              <option value="">All challenges</option>
              {challenges.map((challenge) => (
                <option key={challenge.id} value={challenge.id}>
                  {challenge.name}
                </option>
              ))}
            </select>
          </div>
          {draft.resultCondition === "close" ? (
            <div className="space-y-1.5">
              <Label htmlFor="crr-threshold">Close result from (% of target score)</Label>
              <Input
                id="crr-threshold"
                type="number"
                min="1"
                max="100"
                value={String(draft.closeThresholdPercent)}
                onChange={(e) => set("closeThresholdPercent", Number(e.target.value) || 90)}
              />
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="crr-day">Maximum per day (0 = no limit)</Label>
            <Input
              id="crr-day"
              type="number"
              min="0"
              value={String(draft.maxPerDay)}
              onChange={(e) => set("maxPerDay", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crr-customer">Maximum per customer (0 = no limit)</Label>
            <Input
              id="crr-customer"
              type="number"
              min="0"
              value={String(draft.maxPerCustomer)}
              onChange={(e) => set("maxPerCustomer", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crr-challenge-max">Maximum per challenge (0 = no limit)</Label>
            <Input
              id="crr-challenge-max"
              type="number"
              min="0"
              value={String(draft.maxPerChallenge)}
              onChange={(e) => set("maxPerChallenge", Number(e.target.value) || 0)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crr-start">Start date (optional)</Label>
            <Input
              id="crr-start"
              type="date"
              value={draft.startsOn ?? ""}
              onChange={(e) => set("startsOn", e.target.value || null)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="crr-end">End date (optional)</Label>
            <Input
              id="crr-end"
              type="date"
              value={draft.endsOn ?? ""}
              onChange={(e) => set("endsOn", e.target.value || null)}
            />
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
            Enabled
            <Switch checked={draft.isEnabled} onCheckedChange={(v) => set("isEnabled", v)} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
            First time only
            <Switch checked={draft.firstTimeOnly} onCheckedChange={(v) => set("firstTimeOnly", v)} />
          </label>
          <label className="flex items-center justify-between gap-3 rounded-lg border border-border p-3 text-sm">
            Can earn again after limit
            <Switch
              checked={draft.allowRepeatAfterLimit}
              onCheckedChange={(v) => set("allowRepeatAfterLimit", v)}
            />
          </label>
        </div>

        <div className="flex gap-2">
          <Button disabled={busy} onClick={onSave}>
            {busy ? <Loader2 className="animate-spin" /> : null} Save rule
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
