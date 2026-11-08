import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  createGame, passGate, switchLane, phaseAt, stackPercent, inTargetRange, practiceSeed,
  DEFAULT_GATE_COUNT, GAMEPLAY_DURATION_MS, HARD_CUTOFF_MS, STACK_TARGET_MIN, STACK_TARGET_MAX,
  type GameState,
} from "@/lib/burger-boost-game";
import type { Gate, Ingredient, Lane } from "@/lib/burger-boost-rules";

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
  const stateRef = useRef<GameState | null>(null);
  const startRef = useRef(0);
  const flashRef = useRef<{ text: string; good: boolean; at: number } | null>(null);
  const [screen, setScreen] = useState<Screen>("start");
  const [paused, setPaused] = useState(false);
  const [hud, setHud] = useState({ score: 0, elapsed: 0, stack: 0, gate: 0, layers: [] as Ingredient[] });
  const [result, setResult] = useState<GameState | null>(null);

  const start = useCallback(() => {
    stateRef.current = createGame(practiceSeed(), gateCount);
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
    const css = getComputedStyle(document.documentElement);
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
      if (s.phase === "finished" || s.phase === "expired") { setResult(s); setScreen("over"); return; }
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
    <div className="relative mx-auto flex h-[calc(100dvh-4rem)] w-full max-w-md flex-col overflow-hidden bg-background text-foreground md:h-[calc(100dvh-6rem)] md:rounded-2xl md:border md:border-border">
      {screen === "playing" && (
        <>
          <Hud score={hud.score} remaining={remaining} grace={grace} graceLeft={graceLeft} stack={hud.stack} gate={hud.gate} total={stateRef.current?.gateCount ?? gateCount} onPause={() => setPaused(true)} />
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
          <Button size="lg" className="w-full" onClick={start}><Play className="size-5" /> Start</Button>
        </Overlay>
      )}

      {screen === "over" && result && (
        <Overlay>
          <h2 className="font-display text-3xl font-black">{result.phase === "expired" ? "Time’s up!" : "Finished!"}</h2>
          <p className="font-display text-6xl font-black text-primary">{result.score}</p>
          <p className="text-sm text-muted-foreground">practice score</p>
          <BurgerStack layers={result.layers} />
          <dl className="grid w-full grid-cols-3 gap-2 text-sm">
            <Stat label="Correct" value={result.mathCorrect} />
            <Stat label="Layers" value={result.layers.length} />
            <Stat label="Spoiled" value={result.spoiledHits} />
          </dl>
          <p className={inTargetRange(stackPercent(result)) ? "text-sm font-semibold text-primary" : "text-sm text-muted-foreground"}>
            Stack {stackPercent(result)}% — {inTargetRange(stackPercent(result)) ? "in the target zone!" : `target is ${STACK_TARGET_MIN}–${STACK_TARGET_MAX}%`}
          </p>
          <p className="text-xs text-muted-foreground">Practice result — not saved. Discount: 0%.</p>
          <Button size="lg" className="w-full" onClick={start}><RotateCcw className="size-5" /> Play again</Button>
        </Overlay>
      )}
    </div>
  );
}

function Hud(p: { score: number; remaining: number; grace: boolean; graceLeft: number; stack: number; gate: number; total: number; onPause: () => void }) {
  const ok = inTargetRange(p.stack);
  return (
    <div className="space-y-2 border-b border-border bg-card/80 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div aria-live="polite" className={p.grace ? "font-display text-xl font-bold text-destructive" : "font-display text-xl font-bold"}>
          {p.grace ? `Grace ${Math.ceil(p.graceLeft / 1000)}s` : `${Math.ceil(p.remaining / 1000)}s`}
        </div>
        <div className="text-center"><div className="text-[10px] uppercase tracking-widest text-muted-foreground">Score</div><div className="font-display text-xl font-bold text-primary">{p.score}</div></div>
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

type Colors = { bg: string; fg: string; primary: string; muted: string; destructive: string };

function draw(ctx: CanvasRenderingContext2D, cv: HTMLCanvasElement, s: GameState, elapsed: number, interval: number, C: Colors, flash: { text: string; good: boolean; at: number } | null, now: number) {
  const dpr = cv.width / cv.getBoundingClientRect().width || 1;
  const W = cv.width / dpr, H = cv.height / dpr;
  const horizon = H * 0.12, playerY = H - 130;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  // glow sky
  const g = ctx.createLinearGradient(0, 0, 0, horizon * 3);
  g.addColorStop(0, C.primary); g.addColorStop(1, "transparent");
  ctx.globalAlpha = 0.25; ctx.fillStyle = g; ctx.fillRect(0, 0, W, horizon * 3); ctx.globalAlpha = 1;

  // perspective: depth d in [0,1] (0 = horizon, 1 = player)
  const proj = (d: number) => {
    const y = horizon + (playerY - horizon) * d * d;
    const half = W * (0.08 + 0.38 * d * d);
    return { y, left: W / 2 - half, right: W / 2 + half, scale: 0.15 + 0.85 * d * d };
  };
  // road
  const top = proj(0), bot = proj(1.15);
  ctx.fillStyle = C.muted; ctx.beginPath();
  ctx.moveTo(top.left, top.y); ctx.lineTo(top.right, top.y); ctx.lineTo(bot.right + 40, H); ctx.lineTo(bot.left - 40, H); ctx.closePath(); ctx.fill();
  // moving stripes
  const speed = elapsed / interval;
  ctx.strokeStyle = C.primary; ctx.lineWidth = 2;
  for (let k = 0; k < 8; k++) {
    const d = ((k / 8 + (speed % 1) / 8 * 8 / 8 + speed * 0.25) % 1);
    const a = proj(d), b = proj(Math.min(1.1, d + 0.04));
    ctx.globalAlpha = 0.6; ctx.beginPath(); ctx.moveTo(W / 2, a.y); ctx.lineTo(W / 2, b.y); ctx.lineWidth = 1 + 4 * a.scale; ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // gates: gate i hits player at (i+1)*interval; visible ~4 gates ahead
  const view = interval * 4;
  for (let i = Math.min(s.gateCount - 1, s.nextGate + 4); i >= s.nextGate; i--) {
    const hit = (i + 1) * interval;
    const d = 1 - (hit - elapsed) / view;
    if (d < 0 || d > 1.05) continue;
    drawGate(ctx, s.track[i]!, proj(d), C);
  }

  // player burger
  const p = proj(1);
  const laneX = s.lane === 0 ? (p.left + W / 2) / 2 : (p.right + W / 2) / 2;
  const bw = 70, layers = s.layers.slice(-10);
  let y = playerY + 20;
  ctx.fillStyle = C.primary; roundRect(ctx, laneX - bw / 2, y - 12, bw, 12, 6); ctx.fill(); y -= 12;
  for (const l of layers) { ctx.fillStyle = ING[l].color; roundRect(ctx, laneX - bw / 2 + 3, y - 6, bw - 6, 6, 3); ctx.fill(); y -= 6; }
  ctx.fillStyle = C.primary; ctx.beginPath(); ctx.ellipse(laneX, y, bw / 2, 18, 0, Math.PI, 0); ctx.fill();
  // flames
  ctx.fillStyle = C.destructive; ctx.globalAlpha = 0.7;
  for (let k = -1; k <= 1; k++) { ctx.beginPath(); const fx = laneX + k * 18, fh = 10 + 6 * Math.sin(now / 80 + k); ctx.moveTo(fx - 6, playerY + 22); ctx.lineTo(fx, playerY + 22 + fh); ctx.lineTo(fx + 6, playerY + 22); ctx.fill(); }
  ctx.globalAlpha = 1;

  if (flash && now - flash.at < 700) {
    ctx.globalAlpha = 1 - (now - flash.at) / 700;
    ctx.fillStyle = flash.good ? C.primary : C.destructive;
    ctx.font = "bold 22px system-ui, sans-serif"; ctx.textAlign = "center";
    ctx.fillText(flash.text, laneX, y - 30 - (now - flash.at) / 20);
    ctx.globalAlpha = 1;
  }
}

function drawGate(ctx: CanvasRenderingContext2D, gate: Gate, p: { y: number; left: number; right: number; scale: number }, C: Colors) {
  const mid = (p.left + p.right) / 2, h = 70 * p.scale, w = (p.right - p.left) / 2 - 6 * p.scale;
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  const panel = (x: number, fill: string, stroke: string, text: string, sub?: string) => {
    ctx.globalAlpha = 0.85; ctx.fillStyle = fill; roundRect(ctx, x, p.y - h, w, h, 8 * p.scale); ctx.fill(); ctx.globalAlpha = 1;
    ctx.lineWidth = 3 * p.scale; ctx.strokeStyle = stroke; ctx.stroke();
    ctx.fillStyle = C.fg; ctx.font = `bold ${Math.max(8, 26 * p.scale)}px system-ui, sans-serif`;
    ctx.fillText(text, x + w / 2, p.y - h / 2 - (sub ? 8 * p.scale : 0));
    if (sub) { ctx.font = `${Math.max(6, 13 * p.scale)}px system-ui, sans-serif`; ctx.fillText(sub, x + w / 2, p.y - h / 2 + 14 * p.scale); }
  };
  const lx = p.left + 3 * p.scale, rx = mid + 3 * p.scale;
  if (gate.kind === "math") {
    ctx.fillStyle = C.fg; ctx.font = `bold ${Math.max(8, 20 * p.scale)}px system-ui, sans-serif`;
    ctx.fillText(`${gate.a} ${gate.op} ${gate.b} = ?`, mid, p.y - h - 14 * p.scale);
    panel(lx, "#1f4fa8", "#7aa7ff", String(gate.lanes[0]));
    panel(rx, "#1f4fa8", "#7aa7ff", String(gate.lanes[1]));
  } else if (gate.kind === "ingredient") {
    const [a, b] = gate.lanes;
    panel(lx, ING[a].color, C.fg, "🍔", ING[a].label);
    panel(rx, ING[b].color, C.fg, "🍔", ING[b].label);
  } else {
    const spoiled = { fill: "#3d2a3a", stroke: C.destructive, text: "☠", sub: `Spoiled ${ING[gate.spoiled].label}` };
    const safe = { fill: "#1d3b2a", stroke: "#4cd17a", text: "✓", sub: "Safe" };
    const [L, R] = gate.spoiledLane === 0 ? [spoiled, safe] : [safe, spoiled];
    panel(lx, L.fill, L.stroke, L.text, L.sub);
    panel(rx, R.fill, R.stroke, R.text, R.sub);
  }
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(0, r));
}
