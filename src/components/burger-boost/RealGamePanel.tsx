import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import {
  acknowledgeBurgerBoostRewardStart, createBurgerBoostSession, prepareBurgerBoostRewardSession,
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
export function RealGamePanel({ onLive, onUnlock }: { onLive: (live: LiveSession) => void; onUnlock?: () => void }) {
  const { isAuthenticated, loading } = useAuth();
  const create = useServerFn(createBurgerBoostSession);
  const prepare = useServerFn(prepareBurgerBoostRewardSession);
  const acknowledge = useServerFn(acknowledgeBurgerBoostRewardStart);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "msg"; text?: string }>({ kind: "idle" });
  const [reward, setReward] = useState<RewardState>({ kind: "idle" });
  const [now, setNow] = useState(() => Date.now());
  const inFlight = useRef(false);

  useEffect(() => {
    if (reward.kind !== "ack") return;
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, [reward.kind]);

  const remaining = reward.kind === "ack" ? Math.max(0, Math.ceil((reward.deadline - now) / 1000)) : 0;
  useEffect(() => {
    if (reward.kind === "ack" && remaining === 0) {
      setReward({ kind: "idle", text: "The 15-second start window closed. This reward try wasn't started." });
    }
  }, [reward.kind, remaining]);

  const tryStart = async () => {
    try { onUnlock?.(); } catch { /* silent */ }
    setState({ kind: "busy" });
    try {
      const r = await create({ data: {} });
      if (r.ok) {
        setState({ kind: "idle" });
        onLive({ sessionId: r.session.sessionId, publicGates: r.publicGates, expiresAt: r.session.expiresAt, rulesVersion: r.session.rulesVersion });
      } else setState({ kind: "msg", text: r.error });
    } catch {
      setState({ kind: "msg", text: "Saved games aren't available yet. Practice is open." });
    }
  };

  const prepareReward = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setReward({ kind: "preparing" });
    try {
      const r = await prepare({ data: {} });
      if (r.ok) {
        // Anchor the display countdown to the local clock (server deadline still enforced server-side).
        setNow(Date.now());
        setReward({ kind: "ack", sessionId: r.sessionId, deadline: Date.now() + Math.min(r.ackWindowMs, Math.max(0, r.ackDeadlineAt - Date.now()) || r.ackWindowMs) });
      } else setReward({ kind: "idle", text: r.error });
    } catch {
      setReward({ kind: "idle", text: "Reward games aren't available right now. Practice is open." });
    } finally { inFlight.current = false; }
  };

  const acknowledgeStart = async () => {
    if (reward.kind !== "ack" || inFlight.current) return;
    try { onUnlock?.(); } catch { /* silent */ }
    inFlight.current = true;
    const sessionId = reward.sessionId;
    setReward({ kind: "starting", sessionId });
    try {
      const r = await acknowledge({ data: { sessionId } });
      if (r.ok) {
        setReward({ kind: "idle" });
        onLive({ sessionId: r.session.sessionId, publicGates: r.publicGates, expiresAt: r.session.expiresAt, rulesVersion: r.session.rulesVersion });
      } else setReward({ kind: "idle", text: r.error });
    } catch {
      setReward({ kind: "idle", text: "We couldn't reach the server, so the reward game didn't start." });
    } finally { inFlight.current = false; }
  };

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3 text-left text-sm">
      <p className="font-semibold">Saved game</p>
      {loading ? <p className="text-muted-foreground">Checking sign-in…</p>
        : !isAuthenticated ? (
          <p className="text-muted-foreground">Sign in to play saved games. <Link to="/auth" className="text-primary underline">Sign in</Link></p>
        ) : (
          <>
            <Button variant="outline" className="w-full" disabled={state.kind === "busy"} onClick={tryStart}>
              {state.kind === "busy" ? "Checking…" : "Start saved game"}
            </Button>
            {state.text && <p role="status" className="text-muted-foreground">{state.text}</p>}

            <div className="space-y-2 border-t border-border pt-2">
              <p className="font-semibold">Reward game</p>
              {reward.kind === "ack" || reward.kind === "starting" ? (
                <div className="space-y-2 rounded-md bg-muted/40 p-2">
                  <p>This uses today's one reward try. Press start within the time below.</p>
                  <p aria-live="polite" className="text-2xl font-bold tabular-nums text-primary">
                    {reward.kind === "ack" ? `${remaining}s` : "Starting…"}
                  </p>
                  <Button className="w-full" disabled={reward.kind === "starting"} onClick={acknowledgeStart}>
                    Acknowledge &amp; Start
                  </Button>
                </div>
              ) : (
                <Button variant="outline" className="w-full" disabled={reward.kind === "preparing"} onClick={prepareReward}>
                  {reward.kind === "preparing" ? "Preparing…" : "Play reward game"}
                </Button>
              )}
              {reward.kind === "idle" && reward.text && <p role="status" className="text-muted-foreground">{reward.text}</p>}
              <p className="text-xs text-muted-foreground">Store discounts are not switched on yet, so reward games give 0% for now.</p>
            </div>
            <p className="text-xs text-muted-foreground">Game history: not available yet.</p>
          </>
        )}
    </div>
  );
}
