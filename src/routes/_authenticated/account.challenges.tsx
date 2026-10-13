import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  Clock3,
  Gamepad2,
  Loader2,
  Lock,
  PartyPopper,
  Share2,
  ShoppingBag,
  Trophy,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ChallengeGame } from "@/components/challenges/ChallengeGame";
import type { ChanceOutcome } from "@/components/challenges/ChallengeGame";
import { WinnerTicker } from "@/components/challenges/WinnerTicker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import {
  claimChallengeWin,
  finishChallengePlay,
  listMyChallengeWins,
  listMyChallenges,
  startChallengePlay,
} from "@/lib/challenges.functions";
import { difficultyLabel, formatCountdown } from "@/lib/challenges";
import type { PublicChallenge } from "@/lib/challenges";
import { formatBDT } from "@/lib/format";

export const Route = createFileRoute("/_authenticated/account/challenges")({
  head: () => ({
    meta: [
      { title: "Flamio Challenges — Play & Win Rewards" },
      {
        name: "description",
        content: "Play Flamio challenges, beat the game and win free food rewards.",
      },
      { property: "og:title", content: "Flamio Challenges — Play & Win Rewards" },
      { property: "og:description", content: "Play. Challenge yourself. Win rewards." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ChallengesPage,
});

type PlayState = {
  challenge: PublicChallenge;
  sessionId: string;
  outcome: ChanceOutcome | null;
  phase: "playing" | "result";
  result?: {
    result: "won" | "lost";
    message: string;
    rewardName?: string;
    couponCode?: string | null;
    winnerId?: string;
    resultRewards?: { ruleName: string; points: number }[];
  };
};

function ChallengesPage() {
  const fetchChallenges = useServerFn(listMyChallenges);
  const fetchWins = useServerFn(listMyChallengeWins);
  const startPlay = useServerFn(startChallengePlay);
  const finishPlay = useServerFn(finishChallengePlay);
  const claimWin = useServerFn(claimChallengeWin);
  const queryClient = useQueryClient();

  const [play, setPlay] = useState<PlayState | null>(null);
  const [starting, setStarting] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);

  const challenges = useQuery({ queryKey: ["my-challenges"], queryFn: () => fetchChallenges() });
  const wins = useQuery({ queryKey: ["my-challenge-wins"], queryFn: () => fetchWins() });

  async function handlePlay(challenge: PublicChallenge) {
    setStarting(challenge.id);
    try {
      const session = await startPlay({ data: { challengeId: challenge.id } });
      setPlay({
        challenge,
        sessionId: session.sessionId,
        outcome: (session.outcome ?? null) as ChanceOutcome | null,
        phase: "playing",
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't start this challenge");
    } finally {
      setStarting(null);
    }
  }

  async function handleFinish(score: number) {
    if (!play) return;
    try {
      const result = await finishPlay({ data: { sessionId: play.sessionId, score } });
      setPlay({ ...play, phase: "result", result });
      for (const reward of result.resultRewards ?? []) {
        toast.success(`Challenge Reward +${reward.points} Points`, { description: reward.ruleName });
      }
      if ((result.resultRewards ?? []).length > 0) {
        await queryClient.invalidateQueries({ queryKey: ["my-rewards"] });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save your play");
      setPlay(null);
    } finally {
      await queryClient.invalidateQueries({ queryKey: ["my-challenges"] });
      await queryClient.invalidateQueries({ queryKey: ["my-challenge-wins"] });
      await queryClient.invalidateQueries({ queryKey: ["challenge-winner-ticker"] });
    }
  }

  if (challenges.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-8">
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!challenges.data?.enabled || challenges.data.challenges.length === 0) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-12 pb-28 text-center">
        <span className="mx-auto grid size-14 place-items-center rounded-full bg-secondary">
          <Gamepad2 className="size-6 text-muted-foreground" />
        </span>
        <h1 className="mt-4 font-display text-2xl font-black">Flamio Challenges</h1>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
          No challenges are running right now. Check back soon for your chance to win free food.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 pb-28 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-black">🎮 Flamio Challenges</h1>
      <p className="mt-1 text-sm text-muted-foreground">Play. Challenge yourself. Win rewards.</p>

      <div className="mt-4">
        <WinnerTicker />
      </div>

      <div className="mt-6 grid gap-4">
        {challenges.data.challenges.map((challenge) => (
          <div key={challenge.id} id={`challenge-${challenge.slug}`} className="scroll-mt-24">
            <ChallengeCard
              challenge={challenge}
              busy={starting === challenge.id}
              onPlay={() => void handlePlay(challenge)}
            />
          </div>
        ))}
      </div>

      {(wins.data ?? []).length > 0 ? (
        <section className="mt-10">
          <h2 className="font-display text-xl font-extrabold">Your wins</h2>
          <div className="mt-3 divide-y divide-border rounded-xl border border-border bg-card">
            {(wins.data ?? []).map((win) => (
              <div key={win.id} className="flex items-center gap-3 p-4">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                  <Trophy className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{win.rewardName}</p>
                  <p className="text-xs text-muted-foreground">
                    {win.challengeName} ·{" "}
                    {win.claimStatus === "claimed" ? "Claimed" : "Ready to claim"}
                    {win.couponCode ? ` · code ${win.couponCode}` : ""}
                  </p>
                </div>
                <time className="text-xs text-muted-foreground">
                  {new Date(win.wonAt).toLocaleDateString()}
                </time>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <Dialog
        open={Boolean(play)}
        onOpenChange={(open) => {
          if (!open && play?.phase === "result") setPlay(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">
              {play?.challenge.iconEmoji} {play?.challenge.name}
            </DialogTitle>
          </DialogHeader>

          {play?.phase === "playing" ? (
            <ChallengeGame
              detector={play.challenge.detectorType}
              config={play.challenge.difficultyConfig}
              requiredScore={play.challenge.requiredScore}
              timeLimitSeconds={play.challenge.timeLimitSeconds}
              outcome={play.outcome}
              onFinish={(score) => void handleFinish(score)}
            />
          ) : null}

          {play?.phase === "result" && play.result ? (
            <div className="py-4 text-center">
              {play.result.result === "won" && play.result.rewardName ? (
                <>
                  <div className="text-5xl">🎉</div>
                  <h2 className="mt-3 font-display text-2xl font-black">YOU WON!</h2>
                  <p className="mt-2 flex items-center justify-center gap-2 text-lg font-bold text-primary">
                    <PartyPopper className="size-5" /> {play.result.rewardName}
                  </p>
                  {play.result.couponCode ? (
                    <p className="mt-2 text-sm text-muted-foreground">
                      Voucher code <span className="font-mono font-semibold">{play.result.couponCode}</span>
                    </p>
                  ) : null}
                  <div className="mt-6 grid gap-2">
                    <Button
                      disabled={claiming}
                      onClick={async () => {
                        if (!play.result?.winnerId) return;
                        setClaiming(true);
                        try {
                          await claimWin({ data: { winnerId: play.result.winnerId } });
                          toast.success("Reward claimed — show this at the counter or mention it on your next order.");
                          await queryClient.invalidateQueries({ queryKey: ["my-challenge-wins"] });
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : "Couldn't claim reward");
                        } finally {
                          setClaiming(false);
                        }
                      }}
                    >
                      {claiming ? <Loader2 className="animate-spin" /> : null} CLAIM REWARD
                    </Button>
                    <Button
                      variant="outline"
                      onClick={async () => {
                        const text = `I just won ${play.result?.rewardName} from Flamio! 🍔🔥 (${play.challenge.name})`;
                        try {
                          if (typeof navigator !== "undefined" && navigator.share) {
                            await navigator.share({ title: "Flamio Challenges", text });
                          } else {
                            await navigator.clipboard.writeText(text);
                            toast.success("Victory message copied — paste it anywhere.");
                          }
                        } catch {
                          /* the customer cancelled sharing */
                        }
                      }}
                    >
                      <Share2 /> Share your victory
                    </Button>
                    <Button variant="ghost" onClick={() => setPlay(null)}>
                      Close
                    </Button>
                  </div>
                </>
              ) : (
                <>
                  <div className="text-5xl">{play.result.result === "won" ? "🙌" : "😔"}</div>
                  <h2 className="mt-3 font-display text-xl font-black">
                    {play.result.result === "won" ? "So close!" : "Not this time"}
                  </h2>
                  <p className="mt-2 text-sm text-muted-foreground">{play.result.message}</p>
                  {(play.result.resultRewards ?? []).map((reward) => (
                    <p key={reward.ruleName} className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-sm font-bold text-primary">
                      Challenge Reward +{reward.points} Points
                    </p>
                  ))}
                  <Button className="mt-6 w-full" onClick={() => setPlay(null)}>
                    Back to challenges
                  </Button>
                </>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChallengeCard({
  challenge,
  busy,
  onPlay,
}: {
  challenge: PublicChallenge;
  busy: boolean;
  onPlay: () => void;
}) {
  const access = challenge.access;
  const canPlay = challenge.playable && access.available > 0;
  const nextRefill = formatCountdown(access.nextRefillAt);
  const cooldown = formatCountdown(access.cooldownUntil);
  const dailyFull =
    challenge.dailyWinnerLimit > 0 && challenge.dailyWinners >= challenge.dailyWinnerLimit;

  return (
    <article className="overflow-hidden rounded-2xl border border-border bg-card">
      <div className="flex gap-4 p-4">
        <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-gradient-ember text-3xl">
          {challenge.iconEmoji}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-extrabold">{challenge.name}</h2>
            <Badge variant="secondary">{difficultyLabel(challenge.difficulty)}</Badge>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{challenge.description}</p>
          <p className="mt-2 flex items-center gap-1.5 text-sm font-semibold text-primary">
            <Trophy className="size-4" /> Win {challenge.rewardName}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {challenge.attemptsPerSession} attempt{challenge.attemptsPerSession === 1 ? "" : "s"} per play ·
            Available plays: {access.available}
          </p>
        </div>
      </div>

      <div className="border-t border-border p-4">
        {canPlay ? (
          <Button className="h-12 w-full text-base font-black" disabled={busy} onClick={onPlay}>
            {busy ? <Loader2 className="animate-spin" /> : null} PLAY NOW
          </Button>
        ) : (
          <div className="space-y-2">
            <p className="flex items-center gap-2 text-sm font-semibold">
              <Lock className="size-4 text-muted-foreground" />
              {challenge.unavailableReason
                ? challenge.unavailableReason
                : dailyFull
                  ? "Today's rewards have been claimed. Come back tomorrow! ❤️"
                  : "No plays available"}
            </p>
            {cooldown ? (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <Clock3 className="size-3.5" /> Cooling down · {cooldown} left
              </p>
            ) : null}
            {access.unlockMethods.map((method) => {
              if (method.kind === "refill") {
                return (
                  <p key="refill" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Clock3 className="size-3.5" />
                    {nextRefill
                      ? `Next free play in ${nextRefill}`
                      : `+${method.plays} play every ${Math.round(method.intervalMinutes / 60)}h`}
                  </p>
                );
              }
              if (method.kind === "order") {
                return (
                  <p key="order" className="flex items-center gap-2 text-xs text-muted-foreground">
                    <ShoppingBag className="size-3.5" /> Order {formatBDT(method.minAmount)} → get +
                    {method.plays} play
                  </p>
                );
              }
              return (
                <p key="referral" className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Users className="size-3.5" /> Refer {method.required} friends → get +{method.plays} play (
                  {method.verified} verified so far)
                </p>
              );
            })}
          </div>
        )}
      </div>
    </article>
  );
}
