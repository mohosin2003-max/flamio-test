import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  acknowledgeBurgerBoostRewardStart,
  prepareBurgerBoostRewardSession,
} from "@/lib/burger-boost.functions";
import type { LiveSession } from "@/lib/burger-boost-game";

type RewardState =
  | { kind: "idle"; text?: string }
  | { kind: "preparing" }
  | { kind: "ack"; sessionId: string; deadline: number }
  | { kind: "starting"; sessionId: string };

/**
 * Saved (real) game entry. Never falls back to a fake session. Reward mode is
 * two-phase: the server prepares a session, the player has 15 seconds to press
 * "Acknowledge & Start", and gameplay begins only after the server confirms.
 * The server deadline is authoritative; the countdown is display only.
 */
export function RealGamePanel({
  onLive,
  onUnlock,
}: {
  onLive: (live: LiveSession) => void;
  onUnlock?: () => void;
}) {
  const { isAuthenticated, loading } = useAuth();
  const prepare = useServerFn(prepareBurgerBoostRewardSession);
  const acknowledge = useServerFn(acknowledgeBurgerBoostRewardStart);
  const [reward, setReward] = useState<RewardState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  useEffect(() => {
    if (reward.kind !== "ack") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [reward.kind]);

  const remaining =
    reward.kind === "ack" ? Math.max(0, Math.ceil((reward.deadline - now) / 1000)) : 0;
  useEffect(() => {
    if (reward.kind === "ack" && remaining === 0) {
      setReward({
        kind: "idle",
        text: "The 15-second start window closed. This reward try wasn't started.",
      });
    }
  }, [reward.kind, remaining]);

  const prepareReward = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setReward({ kind: "preparing" });
    try {
      const r = await prepare({ data: {} });
      if (r.ok) {
        // Anchor the display countdown to the local clock (server deadline still enforced server-side).
        setNow(Date.now());
        setReward({
          kind: "ack",
          sessionId: r.sessionId,
          deadline:
            Date.now() +
            Math.min(r.ackWindowMs, Math.max(0, r.ackDeadlineAt - Date.now()) || r.ackWindowMs),
        });
      } else setReward({ kind: "idle", text: r.error });
    } catch {
      setReward({
        kind: "idle",
        text: "Reward games aren't available right now. Practice is open.",
      });
    } finally {
      inFlight.current = false;
    }
  };

  const acknowledgeStart = async () => {
    if (reward.kind !== "ack" || inFlight.current) return;
    try {
      onUnlock?.();
    } catch {
      /* silent */
    }
    inFlight.current = true;
    const sessionId = reward.sessionId;
    setReward({ kind: "starting", sessionId });
    try {
      const r = await acknowledge({ data: { sessionId } });
      if (r.ok) {
        setReward({ kind: "idle" });
        onLive({
          sessionId: r.session.sessionId,
          publicGates: r.publicGates,
          expiresAt: r.session.expiresAt,
          rulesVersion: r.session.rulesVersion,
        });
      } else setReward({ kind: "idle", text: r.error });
    } catch {
      setReward({
        kind: "idle",
        text: "We couldn't reach the server, so the reward game didn't start.",
      });
    } finally {
      inFlight.current = false;
    }
  };

  return (
    <div className="w-full space-y-2">
      {loading ? (
        <Button size="lg" className="w-full" disabled>
          Checking sign-in…
        </Button>
      ) : !isAuthenticated ? (
        <Button asChild size="lg" className="w-full">
          <Link to="/auth">PLAY — sign in to win</Link>
        </Button>
      ) : reward.kind === "ack" || reward.kind === "starting" ? (
        <div className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
          <p>This uses today's one PLAY. Press start within the time below.</p>
          <p aria-live="polite" className="text-2xl font-bold tabular-nums text-primary">
            {reward.kind === "ack" ? `${remaining}s` : "Starting…"}
          </p>
          <Button
            size="lg"
            className="w-full"
            disabled={reward.kind === "starting"}
            onClick={acknowledgeStart}
          >
            START NOW
          </Button>
        </div>
      ) : (
        <Button
          size="lg"
          className="w-full"
          disabled={reward.kind === "preparing"}
          onClick={prepareReward}
        >
          {reward.kind === "preparing" ? "Preparing…" : "PLAY"}
        </Button>
      )}
      {reward.kind === "idle" && reward.text && (
        <p role="status" className="text-sm text-muted-foreground">
          {reward.text}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        PLAY = one real chance per day to earn a store reward.
      </p>
    </div>
  );
}
