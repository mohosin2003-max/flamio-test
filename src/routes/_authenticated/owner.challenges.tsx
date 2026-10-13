import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { AlertTriangle, Copy, Eye, EyeOff, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  CHALLENGE_DIFFICULTIES,
  CHALLENGE_STATUSES,
  DETECTORS,
  DETECTOR_TYPES,
  REWARD_TYPES,
  difficultyLabel,
} from "@/lib/challenges";
import type { ChallengeDifficulty, ChallengeStatus, DetectorType } from "@/lib/challenges";
import {
  ownerCleanupWinners,
  ownerDeleteChallenge,
  ownerDuplicateChallenge,
  ownerListChallenges,
  ownerSaveChallenge,
  ownerSaveChallengeSettings,
  ownerSetChallengeStatus,
  ownerUpdateWinner,
} from "@/lib/challenges.functions";
import type { ChallengeInput } from "@/lib/challenges.functions";
import { formatBDT } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/owner/challenges")({
  head: () => ({
    meta: [
      { title: "Challenges Management — Flamio" },
      { name: "description", content: "Manage Flamio challenges, play access, rewards and winners." },
      { property: "og:title", content: "Challenges Management — Flamio" },
      { property: "og:description", content: "Manage Flamio challenges and winners." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerChallenges,
});


function value<T>(row: Record<string, unknown>, key: string, fallback: T): T {
  const raw = row[key];
  return (raw === null || raw === undefined ? fallback : raw) as T;
}

function toInput(row: Record<string, unknown> | null): ChallengeInput {
  if (!row) {
    return {
      id: null,
      slug: "",
      name: "",
      description: "",
      instructions: "",
      gameType: "mini_game",
      detectorType: "reaction_game",
      iconEmoji: "🎮",
      difficulty: "normal",
      status: "draft",
      startsOn: null,
      endsOn: null,
      dailyStartTime: null,
      dailyEndTime: null,
      attemptsPerSession: 1,
      requiredScore: 3,
      requiredAccuracy: null,
      timeLimitSeconds: 30,
      winningCondition: {},
      difficultyConfig: { rounds: 3, max_reaction_ms: 280 },
      rewardType: "free_item",
      rewardName: "Free Flamio Classic Burger",
      rewardQuantity: 1,
      rewardCouponId: null,
      rewardPoints: 0,
      basePlays: 1,
      maxStoredPlays: 1,
      maxPlaysPerCustomer: 0,
      cooldownMinutes: 0,
      refillEnabled: true,
      refillIntervalMinutes: 1440,
      refillAmount: 1,
      orderUnlockEnabled: false,
      orderMinAmount: 200,
      orderUnlockPlays: 1,
      orderUnlockMax: 0,
      orderUnlockStack: true,
      orderRequiredStatus: "completed",
      referralUnlockEnabled: false,
      referralRequiredCount: 10,
      referralUnlockPlays: 1,
      referralUnlockMax: 0,
      referralCooldownHours: 0,
      referralVerification: "approved_claim",
      dailyWinnerLimit: 5,
      totalWinnerLimit: 0,
      maxWinsPerCustomer: 1,
      sortOrder: 100,
    };
  }
  return {
    id: value<string>(row, "id", ""),
    slug: value<string>(row, "slug", ""),
    name: value<string>(row, "name", ""),
    description: value<string | null>(row, "description", ""),
    instructions: value<string | null>(row, "instructions", ""),
    gameType: value<string>(row, "game_type", "mini_game"),
    detectorType: value<DetectorType>(row, "detector_type", "reaction_game"),
    iconEmoji: value<string>(row, "icon_emoji", "🎮"),
    difficulty: value<ChallengeDifficulty>(row, "difficulty", "normal"),
    status: value<ChallengeStatus>(row, "status", "draft"),
    startsOn: (row["starts_on"] as string | null) ?? null,
    endsOn: (row["ends_on"] as string | null) ?? null,
    dailyStartTime: (row["daily_start_time"] as string | null) ?? null,
    dailyEndTime: (row["daily_end_time"] as string | null) ?? null,
    attemptsPerSession: Number(value(row, "attempts_per_session", 1)),
    requiredScore: Number(value(row, "required_score", 0)),
    requiredAccuracy: row["required_accuracy"] === null ? null : Number(row["required_accuracy"]),
    timeLimitSeconds: row["time_limit_seconds"] === null ? null : Number(row["time_limit_seconds"]),
    winningCondition: value<Record<string, number | string>>(row, "winning_condition", {}),
    difficultyConfig: value<Record<string, number>>(row, "difficulty_config", {}),
    rewardType: value(row, "reward_type", "free_item") as ChallengeInput["rewardType"],
    rewardName: value<string>(row, "reward_name", "Flamio reward"),
    rewardQuantity: Number(value(row, "reward_quantity", 1)),
    rewardCouponId: (row["reward_coupon_id"] as string | null) ?? null,
    rewardPoints: Number(value(row, "reward_points", 0)),
    basePlays: Number(value(row, "base_plays", 1)),
    maxStoredPlays: Number(value(row, "max_stored_plays", 1)),
    maxPlaysPerCustomer: Number(value(row, "max_plays_per_customer", 0)),
    cooldownMinutes: Number(value(row, "cooldown_minutes", 0)),
    refillEnabled: Boolean(value(row, "refill_enabled", false)),
    refillIntervalMinutes: Number(value(row, "refill_interval_minutes", 1440)),
    refillAmount: Number(value(row, "refill_amount", 1)),
    orderUnlockEnabled: Boolean(value(row, "order_unlock_enabled", false)),
    orderMinAmount: Number(value(row, "order_min_amount", 0)),
    orderUnlockPlays: Number(value(row, "order_unlock_plays", 1)),
    orderUnlockMax: Number(value(row, "order_unlock_max", 0)),
    orderUnlockStack: Boolean(value(row, "order_unlock_stack", true)),
    orderRequiredStatus: value(
      row,
      "order_required_status",
      "completed",
    ) as ChallengeInput["orderRequiredStatus"],
    referralUnlockEnabled: Boolean(value(row, "referral_unlock_enabled", false)),
    referralRequiredCount: Number(value(row, "referral_required_count", 10)),
    referralUnlockPlays: Number(value(row, "referral_unlock_plays", 1)),
    referralUnlockMax: Number(value(row, "referral_unlock_max", 0)),
    referralCooldownHours: Number(value(row, "referral_cooldown_hours", 0)),
    referralVerification: value(
      row,
      "referral_verification",
      "approved_claim",
    ) as ChallengeInput["referralVerification"],
    dailyWinnerLimit: Number(value(row, "daily_winner_limit", 0)),
    totalWinnerLimit: Number(value(row, "total_winner_limit", 0)),
    maxWinsPerCustomer: Number(value(row, "max_wins_per_customer", 1)),
    sortOrder: Number(value(row, "sort_order", 0)),
  };
}

function OwnerChallenges() {
  const fetchAll = useServerFn(ownerListChallenges);
  const save = useServerFn(ownerSaveChallenge);
  const setStatus = useServerFn(ownerSetChallengeStatus);
  const duplicate = useServerFn(ownerDuplicateChallenge);
  const remove = useServerFn(ownerDeleteChallenge);
  const updateWinner = useServerFn(ownerUpdateWinner);
  const cleanup = useServerFn(ownerCleanupWinners);
  const saveSettings = useServerFn(ownerSaveChallengeSettings);
  const queryClient = useQueryClient();

  const [editing, setEditing] = useState<ChallengeInput | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const data = useQuery({ queryKey: ["owner-challenges"], queryFn: () => fetchAll() });
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["owner-challenges"] });

  if (data.isLoading) return <Skeleton className="h-96 w-full" />;
  if (!data.data) return <p className="text-sm text-muted-foreground">Challenge management is unavailable.</p>;

  const rows = data.data.challenges as unknown as Record<string, unknown>[];
  const settings = data.data.settings;
  const byStatus = (status: string) => rows.filter((row) => row["status"] === status);
  const winners = data.data.winners;

  async function run(key: string, action: () => Promise<unknown>, success: string) {
    setBusy(key);
    try {
      await action();
      await refresh();
      toast.success(success);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      {/* A. Overview */}
      <section>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-display text-xl font-bold">Challenges</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              {rows.length} games · {byStatus("active").length} active · {winners.length} winner records
            </p>
          </div>
          <Button onClick={() => setEditing(toInput(null))}>
            <Plus /> New challenge
          </Button>
        </div>
        {!settings.isEnabled ? (
          <p className="mt-3 flex items-center gap-2 rounded-xl border border-dashed border-border p-3 text-sm text-muted-foreground">
            <AlertTriangle className="size-4" /> The challenge system is switched off — customers see nothing.
          </p>
        ) : null}
      </section>

      {/* B–D. Challenge lists by status */}
      {[
        { label: "Active challenges", status: "active" },
        { label: "Scheduled challenges", status: "scheduled" },
        { label: "Paused challenges", status: "paused" },
        { label: "Draft challenges", status: "draft" },
        { label: "Archived challenges", status: "archived" },
      ].map((group) =>
        byStatus(group.status).length === 0 ? null : (
          <section key={group.status}>
            <h3 className="font-display text-lg font-bold">{group.label}</h3>
            <div className="mt-3 grid gap-3">
              {byStatus(group.status).map((row) => (
                <Card key={String(row["id"])}>
                  <CardContent className="space-y-3 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="font-display text-base font-bold">
                          {String(row["icon_emoji"])} {String(row["name"])}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {DETECTORS[row["detector_type"] as DetectorType]?.label ??
                            String(row["detector_type"])}{" "}
                          · {difficultyLabel(String(row["difficulty"]))}
                        </p>
                      </div>
                      <Badge variant={row["status"] === "active" ? "default" : "secondary"}>
                        {String(row["status"])}
                      </Badge>
                    </div>

                    {row["detectorImplemented"] === false ? (
                      <p className="flex items-start gap-2 rounded-lg bg-secondary/60 p-2 text-xs text-muted-foreground">
                        <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                        {String(row["detectorNote"] ?? "This game cannot be judged automatically yet.")}
                      </p>
                    ) : null}

                    <dl className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
                      <Stat label="Plays" text={`${row["base_plays"]} base · max ${row["max_stored_plays"]}`} />
                      <Stat
                        label="Refill"
                        text={
                          row["refill_enabled"]
                            ? `+${row["refill_amount"]} / ${Math.round(Number(row["refill_interval_minutes"]) / 60)}h`
                            : "Off"
                        }
                      />
                      <Stat
                        label="Order unlock"
                        text={
                          row["order_unlock_enabled"]
                            ? `${formatBDT(Number(row["order_min_amount"]))} → +${row["order_unlock_plays"]}`
                            : "Off"
                        }
                      />
                      <Stat
                        label="Referral unlock"
                        text={
                          row["referral_unlock_enabled"]
                            ? `${row["referral_required_count"]} → +${row["referral_unlock_plays"]}`
                            : "Off"
                        }
                      />
                      <Stat label="Reward" text={String(row["reward_name"])} />
                      <Stat
                        label="Daily winners"
                        text={`${row["dailyWinners"]} / ${Number(row["daily_winner_limit"]) || "∞"}`}
                      />
                      <Stat label="Wins per customer" text={String(row["max_wins_per_customer"] || "∞")} />
                      <Stat label="Plays used" text={`${row["totalPlays"]} by ${row["totalPlayers"]}`} />
                    </dl>

                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" onClick={() => setEditing(toInput(row))}>
                        Edit
                      </Button>
                      {row["status"] === "active" ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === String(row["id"])}
                          onClick={() =>
                            void run(
                              String(row["id"]),
                              () => setStatus({ data: { id: String(row["id"]), status: "paused" } }),
                              "Challenge paused",
                            )
                          }
                        >
                          Pause
                        </Button>
                      ) : (
                        <Button
                          size="sm"
                          disabled={busy === String(row["id"]) || row["detectorImplemented"] === false}
                          onClick={() =>
                            void run(
                              String(row["id"]),
                              () => setStatus({ data: { id: String(row["id"]), status: "active" } }),
                              "Challenge activated",
                            )
                          }
                        >
                          Activate
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void run(
                            String(row["id"]),
                            () => setStatus({ data: { id: String(row["id"]), status: "archived" } }),
                            "Challenge archived",
                          )
                        }
                      >
                        Archive
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          void run(
                            String(row["id"]),
                            () => duplicate({ data: { id: String(row["id"]) } }),
                            "Challenge duplicated",
                          )
                        }
                      >
                        <Copy /> Duplicate
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => {
                          if (!window.confirm("Delete this challenge and its play/winner records?")) return;
                          void run(
                            String(row["id"]),
                            () => remove({ data: { id: String(row["id"]) } }),
                            "Challenge deleted",
                          );
                        }}
                      >
                        <Trash2 /> Delete
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        ),
      )}

      {/* E. Winners */}
      <section>
        <h3 className="font-display text-lg font-bold">Winners</h3>
        <div className="mt-3 space-y-2">
          {winners.length === 0 ? (
            <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
              No winners yet.
            </p>
          ) : (
            winners.map((winner) => (
              <div
                key={winner.id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-3"
              >
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">
                    {winner.customerName} — {winner.rewardName}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {winner.challengeName} · {new Date(winner.wonAt).toLocaleString()} ·{" "}
                    {winner.claimStatus}
                    {winner.isHidden ? " · hidden from ticker" : ""}
                  </p>
                </div>
                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void run(
                        winner.id,
                        () =>
                          updateWinner({
                            data: { id: winner.id, action: winner.isHidden ? "show" : "hide" },
                          }),
                        winner.isHidden ? "Winner shown" : "Winner hidden",
                      )
                    }
                  >
                    {winner.isHidden ? <Eye /> : <EyeOff />}
                  </Button>
                  {winner.claimStatus === "pending" ? (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() =>
                        void run(
                          winner.id,
                          () => updateWinner({ data: { id: winner.id, action: "mark_claimed" } }),
                          "Marked as claimed",
                        )
                      }
                    >
                      Mark claimed
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      if (!window.confirm("Delete this winner record? The customer account and orders stay untouched."))
                        return;
                      void run(
                        winner.id,
                        () => updateWinner({ data: { id: winner.id, action: "delete" } }),
                        "Winner record deleted",
                      );
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      {/* G. Cleanup + H. Settings */}
      <SettingsSection
        settings={settings}
        busy={busy === "settings"}
        onSave={(next) => void run("settings", () => saveSettings({ data: next }), "Settings saved")}
        onCleanup={(days) =>
          void run(
            "cleanup",
            async () => {
              const result = await cleanup({ data: { days } });
              toast.info(`${result.removed} winner record(s) removed`);
            },
            "Cleanup finished",
          )
        }
      />

      {editing ? (
        <ChallengeEditor
          input={editing}
          onClose={() => setEditing(null)}
          onSave={async (next) => {
            await save({ data: next });
            await refresh();
            setEditing(null);
            toast.success("Challenge saved");
          }}
        />
      ) : null}
    </div>
  );
}

function Stat({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className="font-semibold">{text}</dd>
    </div>
  );
}

type SettingsShape = {
  id: string;
  isEnabled: boolean;
  tickerEnabled: boolean;
  tickerMaxWinners: number;
  tickerDurationSeconds: number;
  winnerRetentionDays: number;
  autoCleanupEnabled: boolean;
};

function SettingsSection({
  settings,
  busy,
  onSave,
  onCleanup,
}: {
  settings: SettingsShape;
  busy: boolean;
  onSave: (next: {
    id: string;
    isEnabled: boolean;
    tickerEnabled: boolean;
    tickerMaxWinners: number;
    tickerDurationSeconds: number;
    winnerRetentionDays: 7 | 30 | 60 | 90;
    autoCleanupEnabled: boolean;
  }) => void;
  onCleanup: (days: 7 | 30 | 60 | 90) => void;
}) {
  const [form, setForm] = useState(settings);
  const retention = ([7, 30, 60, 90] as const).includes(form.winnerRetentionDays as 7)
    ? (form.winnerRetentionDays as 7 | 30 | 60 | 90)
    : 30;

  return (
    <section className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardContent className="space-y-4 p-4">
          <h3 className="font-display text-lg font-bold">Settings</h3>
          <Row label="Challenge system on">
            <Switch
              checked={form.isEnabled}
              onCheckedChange={(checked) => setForm({ ...form, isEnabled: checked })}
            />
          </Row>
          <Row label="Winner ticker on">
            <Switch
              checked={form.tickerEnabled}
              onCheckedChange={(checked) => setForm({ ...form, tickerEnabled: checked })}
            />
          </Row>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Ticker winners"
              type="number"
              value={form.tickerMaxWinners}
              onChange={(v) => setForm({ ...form, tickerMaxWinners: Number(v) || 1 })}
            />
            <Field
              label="Seconds each"
              type="number"
              value={form.tickerDurationSeconds}
              onChange={(v) => setForm({ ...form, tickerDurationSeconds: Number(v) || 4 })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Winner retention</Label>
            <select
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={retention}
              onChange={(event) =>
                setForm({ ...form, winnerRetentionDays: Number(event.target.value) })
              }
            >
              {[7, 30, 60, 90].map((days) => (
                <option key={days} value={days}>
                  {days} days
                </option>
              ))}
            </select>
          </div>
          <Row label="Auto cleanup">
            <Switch
              checked={form.autoCleanupEnabled}
              onCheckedChange={(checked) => setForm({ ...form, autoCleanupEnabled: checked })}
            />
          </Row>
          <Button
            disabled={busy}
            onClick={() =>
              onSave({
                id: form.id,
                isEnabled: form.isEnabled,
                tickerEnabled: form.tickerEnabled,
                tickerMaxWinners: form.tickerMaxWinners,
                tickerDurationSeconds: form.tickerDurationSeconds,
                winnerRetentionDays: retention,
                autoCleanupEnabled: form.autoCleanupEnabled,
              })
            }
          >
            {busy ? <Loader2 className="animate-spin" /> : null} Save settings
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <h3 className="font-display text-lg font-bold">Cleanup</h3>
          <p className="text-sm text-muted-foreground">
            Delete winner records older than the selected period. Customer accounts, profiles and orders are
            never affected.
          </p>
          <div className="flex flex-wrap gap-2">
            {([7, 30, 60, 90] as const).map((days) => (
              <Button key={days} size="sm" variant="outline" onClick={() => onCleanup(days)}>
                Older than {days} days
              </Button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            No gameplay video or camera footage is ever stored, so cleanup only removes small text records.
          </p>
        </CardContent>
      </Card>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Label>{label}</Label>
      {children}
    </div>
  );
}

function Field({
  label,
  value: fieldValue,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string;
  value: string | number;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <Input
        type={type}
        value={fieldValue}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function ChallengeEditor({
  input,
  onClose,
  onSave,
}: {
  input: ChallengeInput;
  onClose: () => void;
  onSave: (next: ChallengeInput) => Promise<void>;
}) {
  const [form, setForm] = useState(input);
  const [saving, setSaving] = useState(false);
  const [configText, setConfigText] = useState(JSON.stringify(form.difficultyConfig, null, 2));
  const [conditionText, setConditionText] = useState(JSON.stringify(form.winningCondition, null, 2));
  const set = <K extends keyof ChallengeInput>(key: K, next: ChallengeInput[K]) =>
    setForm((current) => ({ ...current, [key]: next }));

  async function submit() {
    let difficultyConfig: Record<string, number>;
    let winningCondition: Record<string, number | string>;
    try {
      difficultyConfig = JSON.parse(configText || "{}");
      winningCondition = JSON.parse(conditionText || "{}");
    } catch {
      toast.error("Game settings must be valid JSON.");
      return;
    }
    setSaving(true);
    try {
      await onSave({
        ...form,
        slug: form.slug || form.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
        difficultyConfig,
        winningCondition,
        description: form.description || null,
        instructions: form.instructions || null,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save challenge");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display">
            {form.id ? "Edit challenge" : "New challenge"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-6">
          <Group title="Basic">
            <Field label="Name" value={form.name} onChange={(v) => set("name", v)} />
            <Field label="Slug" value={form.slug} onChange={(v) => set("slug", v)} placeholder="bottle-flip" />
            <Field label="Icon" value={form.iconEmoji} onChange={(v) => set("iconEmoji", v)} />
            <Field label="Game type" value={form.gameType} onChange={(v) => set("gameType", v)} />
            <Select
              label="Detector"
              value={form.detectorType}
              options={DETECTOR_TYPES.map((type) => ({
                value: type,
                label: `${DETECTORS[type].label}${DETECTORS[type].implemented ? "" : " (not playable)"}`,
              }))}
              onChange={(v) => set("detectorType", v as DetectorType)}
            />
            <Select
              label="Difficulty"
              value={form.difficulty}
              options={CHALLENGE_DIFFICULTIES.map((d) => ({ value: d, label: difficultyLabel(d) }))}
              onChange={(v) => set("difficulty", v as ChallengeDifficulty)}
            />
            <Select
              label="Status"
              value={form.status}
              options={CHALLENGE_STATUSES.map((s) => ({ value: s, label: difficultyLabel(s) }))}
              onChange={(v) => set("status", v as ChallengeStatus)}
            />
            <Field
              label="Sort order"
              type="number"
              value={form.sortOrder}
              onChange={(v) => set("sortOrder", Number(v) || 0)}
            />
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Description</Label>
              <Textarea
                rows={2}
                value={form.description ?? ""}
                onChange={(event) => set("description", event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Instructions</Label>
              <Textarea
                rows={2}
                value={form.instructions ?? ""}
                onChange={(event) => set("instructions", event.target.value)}
              />
            </div>
          </Group>

          <Group title="Schedule">
            <Field
              label="Start date"
              type="date"
              value={form.startsOn ?? ""}
              onChange={(v) => set("startsOn", v || null)}
            />
            <Field
              label="End date"
              type="date"
              value={form.endsOn ?? ""}
              onChange={(v) => set("endsOn", v || null)}
            />
            <Field
              label="Daily start time"
              type="time"
              value={form.dailyStartTime ?? ""}
              onChange={(v) => set("dailyStartTime", v || null)}
            />
            <Field
              label="Daily end time"
              type="time"
              value={form.dailyEndTime ?? ""}
              onChange={(v) => set("dailyEndTime", v || null)}
            />
          </Group>

          <Group title="Game">
            <Field
              label="Attempts per session"
              type="number"
              value={form.attemptsPerSession}
              onChange={(v) => set("attemptsPerSession", Number(v) || 1)}
            />
            <Field
              label="Required score"
              type="number"
              value={form.requiredScore}
              onChange={(v) => set("requiredScore", Number(v) || 0)}
            />
            <Field
              label="Required accuracy %"
              type="number"
              value={form.requiredAccuracy ?? ""}
              onChange={(v) => set("requiredAccuracy", v === "" ? null : Number(v))}
            />
            <Field
              label="Time limit (seconds)"
              type="number"
              value={form.timeLimitSeconds ?? ""}
              onChange={(v) => set("timeLimitSeconds", v === "" ? null : Number(v))}
            />
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Game settings (speed, target size, rounds…)</Label>
              <Textarea
                rows={4}
                className="font-mono text-xs"
                value={configText}
                onChange={(event) => setConfigText(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Winning condition</Label>
              <Textarea
                rows={3}
                className="font-mono text-xs"
                value={conditionText}
                onChange={(event) => setConditionText(event.target.value)}
              />
            </div>
          </Group>

          <Group title="Reward">
            <Select
              label="Reward type"
              value={form.rewardType}
              options={REWARD_TYPES.map((type) => ({ value: type, label: difficultyLabel(type.replace("_", " ")) }))}
              onChange={(v) => set("rewardType", v as ChallengeInput["rewardType"])}
            />
            <Field label="Reward name" value={form.rewardName} onChange={(v) => set("rewardName", v)} />
            <Field
              label="Reward quantity"
              type="number"
              value={form.rewardQuantity}
              onChange={(v) => set("rewardQuantity", Number(v) || 1)}
            />
            <Field
              label="Reward points (points type)"
              type="number"
              value={form.rewardPoints}
              onChange={(v) => set("rewardPoints", Number(v) || 0)}
            />
            <Field
              label="Coupon id (coupon type)"
              value={form.rewardCouponId ?? ""}
              onChange={(v) => set("rewardCouponId", v || null)}
            />
          </Group>

          <Group title="Play access">
            <Field
              label="Base plays"
              type="number"
              value={form.basePlays}
              onChange={(v) => set("basePlays", Number(v) || 0)}
            />
            <Field
              label="Maximum stored plays"
              type="number"
              value={form.maxStoredPlays}
              onChange={(v) => set("maxStoredPlays", Number(v) || 1)}
            />
            <Field
              label="Max plays per customer (0 = unlimited)"
              type="number"
              value={form.maxPlaysPerCustomer}
              onChange={(v) => set("maxPlaysPerCustomer", Number(v) || 0)}
            />
            <Field
              label="Cooldown (minutes)"
              type="number"
              value={form.cooldownMinutes}
              onChange={(v) => set("cooldownMinutes", Number(v) || 0)}
            />

            <Row label="Time refill on">
              <Switch checked={form.refillEnabled} onCheckedChange={(c) => set("refillEnabled", c)} />
            </Row>
            <Field
              label="Refill every (minutes)"
              type="number"
              value={form.refillIntervalMinutes}
              onChange={(v) => set("refillIntervalMinutes", Number(v) || 1440)}
            />
            <Field
              label="Refill amount"
              type="number"
              value={form.refillAmount}
              onChange={(v) => set("refillAmount", Number(v) || 1)}
            />

            <Row label="Order unlock on">
              <Switch
                checked={form.orderUnlockEnabled}
                onCheckedChange={(c) => set("orderUnlockEnabled", c)}
              />
            </Row>
            <Field
              label="Minimum order amount"
              type="number"
              value={form.orderMinAmount}
              onChange={(v) => set("orderMinAmount", Number(v) || 0)}
            />
            <Field
              label="Plays per qualifying order"
              type="number"
              value={form.orderUnlockPlays}
              onChange={(v) => set("orderUnlockPlays", Number(v) || 1)}
            />
            <Field
              label="Max order plays (0 = unlimited)"
              type="number"
              value={form.orderUnlockMax}
              onChange={(v) => set("orderUnlockMax", Number(v) || 0)}
            />
            <Row label="Multiple orders stack">
              <Switch checked={form.orderUnlockStack} onCheckedChange={(c) => set("orderUnlockStack", c)} />
            </Row>
            <Select
              label="Order status required"
              value={form.orderRequiredStatus}
              options={["completed", "ready", "out_for_delivery", "confirmed"].map((s) => ({
                value: s,
                label: s.replace(/_/g, " "),
              }))}
              onChange={(v) => set("orderRequiredStatus", v as ChallengeInput["orderRequiredStatus"])}
            />

            <Row label="Referral unlock on">
              <Switch
                checked={form.referralUnlockEnabled}
                onCheckedChange={(c) => set("referralUnlockEnabled", c)}
              />
            </Row>
            <Field
              label="Verified referrals required"
              type="number"
              value={form.referralRequiredCount}
              onChange={(v) => set("referralRequiredCount", Number(v) || 1)}
            />
            <Field
              label="Plays per unlock"
              type="number"
              value={form.referralUnlockPlays}
              onChange={(v) => set("referralUnlockPlays", Number(v) || 1)}
            />
            <Field
              label="Max referral unlocks (0 = unlimited)"
              type="number"
              value={form.referralUnlockMax}
              onChange={(v) => set("referralUnlockMax", Number(v) || 0)}
            />
            <Field
              label="Referral cooldown (hours)"
              type="number"
              value={form.referralCooldownHours}
              onChange={(v) => set("referralCooldownHours", Number(v) || 0)}
            />
            <Select
              label="Referral verification"
              value={form.referralVerification}
              options={[
                { value: "approved_claim", label: "Owner-approved reward claim (verifiable)" },
                { value: "manual_review", label: "Manual review only" },
              ]}
              onChange={(v) => set("referralVerification", v as ChallengeInput["referralVerification"])}
            />
            <p className="text-xs text-muted-foreground sm:col-span-2">
              Social shares on outside platforms cannot be verified automatically, so referral and social
              unlocks count only reward claims you have approved.
            </p>
          </Group>

          <Group title="Winner limits">
            <Field
              label="Daily winner limit (0 = unlimited)"
              type="number"
              value={form.dailyWinnerLimit}
              onChange={(v) => set("dailyWinnerLimit", Number(v) || 0)}
            />
            <Field
              label="Overall winner limit (0 = unlimited)"
              type="number"
              value={form.totalWinnerLimit}
              onChange={(v) => set("totalWinnerLimit", Number(v) || 0)}
            />
            <Field
              label="Max wins per customer (0 = unlimited)"
              type="number"
              value={form.maxWinsPerCustomer}
              onChange={(v) => set("maxWinsPerCustomer", Number(v) || 0)}
            />
          </Group>

          <div className="flex gap-2 pb-2">
            <Button disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="animate-spin" /> : null} Save challenge
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="font-display text-base font-bold">{title}</h3>
      <div className="mt-3 grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Select({
  label,
  value: current,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      <Label>{label}</Label>
      <select
        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
        value={current}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}

