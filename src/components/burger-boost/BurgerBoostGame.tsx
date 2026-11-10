import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";

import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { drawEnvironment } from "@/components/burger-boost/renderers/environment";
import type { Colors, EnvFrame } from "@/components/burger-boost/renderers/types";
import { drawGate } from "@/components/burger-boost/renderers/gates";
import { createMascotAnim, resetMascotAnim, updateMascot, drawMascot, drawVictory, VICTORY_MS } from "@/components/burger-boost/renderers/mascot";
import { RealGamePanel } from "@/components/burger-boost/RealGamePanel";
import {
  createGame, passGate, switchLane, phaseAt, stackPercent, inTargetRange, practiceSeed,
  DEFAULT_GATE_COUNT, GAMEPLAY_DURATION_MS, HARD_CUTOFF_MS, STACK_TARGET_MIN, STACK_TARGET_MAX,
  createLiveGame, buildLiveSubmission, once, type GameState, type LiveSession,
} from "@/lib/burger-boost-game";
import { submitBurgerBoostGameplay, expireBurgerBoostSession } from "@/lib/burger-boost.functions";
import type { Ingredient, Lane } from "@/lib/burger-boost-rules";

/** Ingredient art colors (food colors, canvas only). */
const ING: Record<Ingredient, { color: string; label: string }> = {
  cheese: { color: "#f5b82e", label: "Cheese" }, lettuce: { color: "#5fbf4a", label: "Lettuce" },
  sausage: { color: "#a8452c", label: "Sausage" }, sauce: { color: "#d8322a", label: "Sauce" },
  mayo: { color: "#f3ead2", label: "Mayo" }, cucumber: { color: "#2f8f4e", label: "Cucumber" },
  carrot: { color: "#ef7d22", label: "Carrot" }, tomato: { color: "#e5483a", label: "Tomato" },
};

type Screen = "start" | "playing" | "over";

export function BurgerBoostGame({ gateCount = DEFAULT_GATE_COUNT }: { gateCount?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const startRef = useRef(0);
  const flashRef = useRef<{ text: string; good: boolean; at: number } | null>(null);
  const [screen, setScreen] = useState<Screen>("start");
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState({ score: 0, elapsed: 0, stack: 0, gate: 0, layers: [] as Ingredient[] });
  const [result, setResult] = useState<GameState | null>(null);
  // Live saved session (server gates). null = practice.
  const liveRef = useRef<LiveSession | null>(null);
  const finalizeRef = useRef<(() => Promise<void>) | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [verdict, setVerdict] = useState<{ kind: "pending" | "ok" | "fail"; score?: number; text?: string } | null>(null);
  const submitFn = useServerFn(submitBurgerBoostGameplay);
  const expireFn = useServerFn(expireBurgerBoostSession);

  const startLive = useCallback((live: LiveSession) => {
    const g = createLiveGame(live);
    if (!g) { setVerdict({ kind: "fail", text: "This saved game couldn't be loaded." }); return; }
    liveRef.current = live; stateRef.current = g; resetMascotAnim(mascot);
    finalizeRef.current = once(async () => {
      const s = stateRef.current!;
      const payload = buildLiveSubmission(live.sessionId, s);
      try {
        if (!payload) {
          await expireFn({ data: { sessionId: live.sessionId } });
          setVerdict({ kind: "fail", text: "Time ran out before all gates — this saved game wasn't counted." });
          return;
        }
        const r = await submitFn({ data: payload });
        setVerdict(r.ok && "verifiedScore" in r
          ? { kind: "ok", score: r.verifiedScore }
          : { kind: "fail", text: r.error ?? "This game couldn't be verified." });
      } catch {
        setVerdict({ kind: "fail", text: "We couldn't reach the server to verify this game." });
      }
    });
    startRef.current = performance.now();
    setIsLive(true); setVerdict({ kind: "pending" });
    setPaused(false); setResult(null); setScreen("playing");
  }, [submitFn, expireFn]);

  const start = useCallback(() => {
    liveRef.current = null; finalizeRef.current = null; setIsLive(false); setVerdict(null);
    stateRef.current = createGame(practiceSeed(), gateCount); resetMascotAnim(mascot);
    startRef.current = performance.now();
    setPaused(false); setResult(null); setScreen("playing");
  }, [gateCount]);

  const setLane = useCallback((lane: Lane) => {
    if (stateRef.current) stateRef.current = switchLane(stateRef.current, lane);
  }, []);

  // Keyboard fallback
  useEffect(() => {
    if (screen !== "playing") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft" || e.key === "a") setLane(0);
      if (e.key === "ArrowRight" || e.key === "d") setLane(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [screen, setLane]);

  // Game loop. Pause hides the track but the clock keeps running (hard 75 s cutoff).
  useEffect(() => {
    if (screen !== "playing") return;
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext("2d")!;
    const css = getComputedStyle(rootRef.current ?? document.documentElement);
    const col = (v: string, f: string) => css.getPropertyValue(v).trim() || f;
    const C = { bg: col("--background", "#1c1714"), fg: col("--foreground", "#fff"), primary: col("--primary", "#f26b1d"), muted: col("--muted", "#333"), destructive: col("--destructive", "#e33") };
    const interval = (GAMEPLAY_DURATION_MS * 0.92) / (stateRef.current?.gateCount ?? gateCount);
    let raf = 0; let lastHud = 0;

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * dpr); canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const frame = (now: number) => {
      let s = stateRef.current!;
      const elapsed = Math.min(HARD_CUTOFF_MS, now - startRef.current);
      // resolve gates that reached the player
      while (s.nextGate < s.gateCount && (s.nextGate + 1) * interval <= elapsed && (s.phase === "running" || s.phase === "grace")) {
        const r = passGate(s, elapsed);
        s = r.state;
        if (r.outcome) flashRef.current = { text: { correct: "+10 Correct!", wrong: "Wrong", collect: "+5 Layer", spoiled: "Spoiled! −5", safe: "Dodged" }[r.outcome], good: r.outcome !== "wrong" && r.outcome !== "spoiled", at: now };
      }
      if (s.phase === "running" || s.phase === "grace") s = { ...s, phase: phaseAt(elapsed) === "expired" ? "expired" : s.phase === "grace" || phaseAt(elapsed) === "grace" ? "grace" : "running" };
      stateRef.current = s;
      draw(ctx, canvas, s, elapsed, interval, C, flashRef.current, now);
      if (now - lastHud > 100) {
        lastHud = now;
        setHud({ score: s.score, elapsed, stack: stackPercent(s), gate: s.nextGate, layers: s.layers });
      }
      if (s.phase === "finished" || s.phase === "expired") { setResult(s); setScreen("over"); void finalizeRef.current?.(); return; }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", resize); };
  }, [screen, gateCount]);

  // Swipe
  const touchX = useRef<number | null>(null);

  const remaining = Math.max(0, GAMEPLAY_DURATION_MS - hud.elapsed);
  const grace = hud.elapsed >= GAMEPLAY_DURATION_MS;
  const graceLeft = Math.max(0, HARD_CUTOFF_MS - hud.elapsed);

  return (
    <div ref={rootRef} className="bb-theme fixed inset-0 z-50 mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground">
      {screen === "playing" && (
        <>
          <Hud live={isLive} score={hud.score} remaining={remaining} grace={grace} graceLeft={graceLeft} stack={hud.stack} gate={hud.gate} total={stateRef.current?.gateCount ?? gateCount} onPause={() => setPaused(true)} />
          <div
            className="relative min-h-0 flex-1 touch-none select-none"
            onTouchStart={(e) => { touchX.current = e.touches[0]?.clientX ?? null; }}
            onTouchEnd={(e) => {
              const x0 = touchX.current; const x1 = e.changedTouches[0]?.clientX;
              if (x0 != null && x1 != null && Math.abs(x1 - x0) > 30) setLane(x1 < x0 ? 0 : 1);
              touchX.current = null;
            }}
          >
            <canvas ref={canvasRef} className="h-full w-full" aria-label="Burger Boost track" role="img" />
            <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-2 p-3">
              <Button size="lg" variant="secondary" className="h-16 text-base" onPointerDown={() => setLane(0)} aria-label="Move to left lane"><ChevronLeft className="size-6" /> Left</Button>
              <Button size="lg" variant="secondary" className="h-16 text-base" onPointerDown={() => setLane(1)} aria-label="Move to right lane">Right <ChevronRight className="size-6" /></Button>
            </div>
            {paused && (
              <Overlay>
                <h2 className="font-display text-2xl font-bold">Paused</h2>
                <p className="text-sm text-muted-foreground">The clock keeps running — the 75-second limit can’t be paused.</p>
                <Button size="lg" onClick={() => setPaused(false)}><Play className="size-5" /> Resume</Button>
              </Overlay>
            )}
          </div>
        </>
      )}

      {screen === "start" && (
        <Overlay>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Practice mode</p>
          <h1 className="font-display text-4xl font-black leading-none">FLAMIO<br /><span className="text-primary">BURGER BOOST</span></h1>
          <ul className="space-y-2 text-left text-sm text-muted-foreground">
            <li>🔥 Your burger runs forward on its own — tap <b className="text-foreground">Left / Right</b> or swipe to change lanes.</li>
            <li>➕ <b className="text-foreground">Math gates:</b> pick the lane with the correct answer (+10).</li>
            <li>🥬 <b className="text-foreground">Ingredient gates:</b> add a layer to your burger (+5).</li>
            <li>☠️ <b className="text-foreground">Spoiled gates:</b> dodge them or lose a layer (−5).</li>
            <li>🎯 Keep your stack between <b className="text-foreground">{STACK_TARGET_MIN}%–{STACK_TARGET_MAX}%</b>. 60 s + 15 s grace.</li>
          </ul>
          <p className="rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground">Practice only: scores are not saved and no rewards or discounts are given yet.</p>
          <Button size="lg" className="w-full" onClick={start}><Play className="size-5" /> Start practice</Button>
          <RealGamePanel onLive={startLive} />
          <Link to="/" className="text-sm text-muted-foreground underline">Back to Flamio</Link>
        </Overlay>
      )}

      {screen === "over" && result && (
        <Overlay>
          <h2 className="font-display text-3xl font-black">{result.phase === "expired" ? "Time’s up!" : "Finished!"}</h2>
          {isLive ? (
            verdict?.kind === "ok" ? (<>
              <p className="font-display text-6xl font-black text-primary">{verdict.score}</p>
              <p className="text-sm text-muted-foreground">verified score</p>
            </>) : verdict?.kind === "fail" ? <p role="status" className="text-sm text-destructive">{verdict.text}</p>
              : <p role="status" className="text-sm text-muted-foreground">Verifying your game…</p>
          ) : (<>
            <p className="font-display text-6xl font-black text-primary">{result.score}</p>
            <p className="text-sm text-muted-foreground">practice score</p>
          </>)}
          {result.phase === "finished" && (!isLive || verdict?.kind === "ok")
            ? <VictoryCat layers={result.layers} />
            : <BurgerStack layers={result.layers} />}
          <dl className="grid w-full grid-cols-3 gap-2 text-sm">
            <Stat label="Correct" value={result.mathCorrect} />
            <Stat label="Layers" value={result.layers.length} />
            <Stat label="Spoiled" value={result.spoiledHits} />
          </dl>
          <p className={inTargetRange(stackPercent(result)) ? "text-sm font-semibold text-primary" : "text-sm text-muted-foreground"}>
            Stack {stackPercent(result)}% — {inTargetRange(stackPercent(result)) ? "in the target zone!" : `target is ${STACK_TARGET_MIN}–${STACK_TARGET_MAX}%`}
          </p>
          <p className="text-xs text-muted-foreground">{isLive ? "Saved game — score checked by Flamio. Discount: 0%." : "Practice result — not saved. Discount: 0%."}</p>
          <Button size="lg" className="w-full" onClick={start}><RotateCcw className="size-5" /> {isLive ? "Play practice" : "Play again"}</Button>
          <Link to="/" className="text-sm text-muted-foreground underline">Back to Flamio</Link>
        </Overlay>
      )}
    </div>
  );
}

function Hud(p: { live: boolean; score: number; remaining: number; grace: boolean; graceLeft: number; stack: number; gate: number; total: number; onPause: () => void }) {
  const ok = inTargetRange(p.stack);
  return (
    <div className="space-y-2 border-b border-border bg-card/80 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div aria-live="polite" className={p.grace ? "font-display text-xl font-bold text-destructive" : "font-display text-xl font-bold"}>
          {p.grace ? `Grace ${Math.ceil(p.graceLeft / 1000)}s` : `${Math.ceil(p.remaining / 1000)}s`}
        </div>
        <div className="text-center"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Score</div><div className="font-display text-xl font-bold text-primary">{p.live ? "—" : p.score}</div></div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">{p.gate}/{p.total}</span>
          <Button size="icon" variant="ghost" onClick={p.onPause} aria-label="Pause"><Pause className="size-5" /></Button>
        </div>
      </div>
      <div>
        <div className="mb-1 flex justify-between text-[10px] uppercase tracking-widest text-muted-foreground"><span>Burger stack</span><span className={ok ? "text-primary" : undefined}>{p.stack}%</span></div>
        <div className="relative h-3 overflow-hidden rounded-full bg-muted" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={p.stack} aria-label="Burger stack">
          <div className="absolute inset-y-0 border-x-2 border-primary/70 bg-primary/20" style={{ left: `${STACK_TARGET_MIN}%`, width: `${STACK_TARGET_MAX - STACK_TARGET_MIN}%` }} />
          <div className={ok ? "absolute inset-y-0 left-0 bg-primary transition-all" : "absolute inset-y-0 left-0 bg-muted-foreground transition-all"} style={{ width: `${p.stack}%` }} />
        </div>
      </div>
    </div>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-background/95 p-6 text-center">{children}</div>;
}
function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-lg bg-muted/50 p-2"><dt className="text-xs text-muted-foreground">{label}</dt><dd className="font-display text-lg font-bold">{value}</dd></div>;
}
/** Victory scene. Mounted only after completion is confirmed (server verdict for saved games). Runs a bounded animation after the game loop has stopped. */
function VictoryCat({ layers }: { layers: Ingredient[] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current; const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 200, H = 200; cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Single still frame of the finished victory pose — no timer or extra animation loop.
    drawVictory(ctx, W, H, VICTORY_MS, layers);
  }, [layers]);
  return <canvas ref={ref} className="size-[200px]" role="img" aria-label="FLAMIO Cat eats the burger" />;
}
function BurgerStack({ layers }: { layers: Ingredient[] }) {
  return (
    <div className="flex w-32 flex-col-reverse items-center" aria-label={`${layers.length} burger layers`}>
      <div className="h-4 w-full rounded-b-xl bg-primary/80" />
      {layers.slice(-12).map((l, i) => <div key={i} className="h-2 w-[94%] rounded-sm" style={{ background: ING[l].color }} />)}
      <div className="h-6 w-full rounded-t-full bg-primary" />
    </div>
  );
}

/* ------------------------------ canvas draw ------------------------------ */

const mascot = createMascotAnim();
const envFrame: EnvFrame = { W: 0, H: 0, horizon: 0, playerY: 0, speed: 0, proj: () => ({ y: 0, left: 0, right: 0, scale: 0 }), C: { bg: "", fg: "", primary: "", muted: "", destructive: "" } };

function draw(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, s: GameState, elapsed: number, interval: number, C: Colors, flash: { text: string; good: boolean; at: number } | null, now: number) {
  const dpr = cv.width / cv.getBoundingClientRect().width || 1;
  const W = cv.width / dpr, H = cv.height / dpr;
  const horizon = H * 0.12, playerY = H - 130;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);

  // perspective: depth d in [0,1] (0 = horizon, 1 = player)
  const proj = (d: number) => {
    const y = horizon + (playerY - horizon) * d * d;
    const half = W * (0.08 + 0.38 * d * d);
    return { y, left: W / 2 - half, right: W / 2 + half, scale: 0.15 + 0.85 * d * d };
  };
  // environment (sky, skyline, road, curbs, lamps, billboards) — same clock as gates
  envFrame.W = W; envFrame.H = H; envFrame.horizon = horizon; envFrame.playerY = playerY;
  envFrame.speed = elapsed / interval; envFrame.proj = proj; envFrame.C = C;
  drawEnvironment(ctx, envFrame);

  // gates: gate i hits player at (i+1)*interval; visible ~4 gates ahead
  const view = interval * 4;
  for (let i = Math.min(s.gateCount - 1, s.nextGate + 4); i >= s.nextGate; i--) {
    const hit = (i + 1) * interval;
    const d = 1 - (hit - elapsed) / view;
    if (d < 0 || d > 1.05) continue;
    drawGate(ctx, s.track[i]!, proj(d), C, now, i, s.gateCount);
  }

  // FLAMIO Cat mascot (presentation only; reads already-resolved state)
  const p = proj(1);
  const targetX = s.lane === 0 ? (p.left + W / 2) / 2 : (p.right + W / 2) / 2;
  const laneX = updateMascot(mascot, s.lane, targetX, s.layers.length, s.spoiledHits, now);
  drawMascot(ctx, mascot, laneX, playerY + 30, 92, s.layers, now);
  const y = playerY - 110;
  if (flash && now - flash.at < 700) {
    ctx.globalAlpha = 1 - (now - flash.at) / 700;
    ctx.fillStyle = flash.good ? C.primary : C.destructive;
    ctx.font = "bold 22px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(flash.text, laneX, y - 30 - (now - flash.at) / 20);
    ctx.globalAlpha = 1;
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(0, r));
}
