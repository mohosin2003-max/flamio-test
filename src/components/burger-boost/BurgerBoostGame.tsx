import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  Music,
} from "lucide-react";

import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";

import { Button } from "@/components/ui/button";
import { drawEnvironment } from "@/components/burger-boost/renderers/environment";
import type { Colors, EnvFrame } from "@/components/burger-boost/renderers/types";
import { drawGate } from "@/components/burger-boost/renderers/gates";
import {
  createMascotAnim,
  resetMascotAnim,
  updateMascot,
  drawMascot,
  drawVictory,
  VICTORY_MS,
} from "@/components/burger-boost/renderers/mascot";
import { RealGamePanel } from "@/components/burger-boost/RealGamePanel";
import {
  createGame,
  passGate,
  switchLane,
  phaseAt,
  stackPercent,
  practiceSeed,
  DEFAULT_GATE_COUNT,
  GAMEPLAY_DURATION_MS,
  HARD_CUTOFF_MS,
  createLiveGame,
  buildLiveSubmission,
  once,
  type GameState,
  type LiveSession,
} from "@/lib/burger-boost-game";
import {
  submitBurgerBoostGameplay,
  expireBurgerBoostSession,
  getBurgerBoostPublicSettings,
} from "@/lib/burger-boost.functions";
import {
  OPERATION_RULES_VERSION,
  TIERED_RULES_VERSION,
  isMeterRules,
  gateSchedule,
  trackPosition,
  METER,
  type Ingredient,
  type Lane,
} from "@/lib/burger-boost-rules";
import {
  createPauseClock,
  storeDiscountPreview,
  boostDelta,
  type PauseClock,
} from "@/lib/burger-boost-pause";
import {
  createAudioEngine,
  pickGateSound,
  isMilestoneGate,
  type AudioEngine,
  type SoundEvent,
} from "@/lib/burger-boost-audio";

/** Ingredient art colors (food colors, canvas only). */
const ING: Record<Ingredient, { color: string; label: string }> = {
  cheese: { color: "#f5b82e", label: "Cheese" },
  lettuce: { color: "#5fbf4a", label: "Lettuce" },
  sausage: { color: "#a8452c", label: "Sausage" },
  sauce: { color: "#d8322a", label: "Sauce" },
  mayo: { color: "#f3ead2", label: "Mayo" },
  cucumber: { color: "#2f8f4e", label: "Cucumber" },
  carrot: { color: "#ef7d22", label: "Carrot" },
  tomato: { color: "#e5483a", label: "Tomato" },
  onion: { color: "#b45c9b", label: "Onion" },
  capsicum: { color: "#2f9e44", label: "Capsicum" },
};

type Screen = "start" | "playing" | "over";

export function BurgerBoostGame({ gateCount = DEFAULT_GATE_COUNT }: { gateCount?: number }) {
  const fetchSettings = useServerFn(getBurgerBoostPublicSettings);
  const settingsQuery = useQuery({
    queryKey: ["burger-boost", "public-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 30_000,
  });
  const ownerMax = settingsQuery.data?.ownerMax ?? 0;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const stateRef = useRef<GameState | null>(null);
  const startRef = useRef(0);
  const clockRef = useRef<PauseClock>(createPauseClock(0));
  const flashRef = useRef<{ text: string; good: boolean; at: number } | null>(null);
  const [screen, setScreen] = useState<Screen>("start");
  const [paused, setPaused] = useState(false);
  const pausedRef = useRef(false);
  useEffect(() => {
    pausedRef.current = paused;
    const now = performance.now();
    if (paused) clockRef.current.pause(now);
    else clockRef.current.resume(now);
  }, [paused]);
  const [hud, setHud] = useState({
    score: 0,
    meter: 0,
    v2: true,
    elapsed: 0,
    stack: 0,
    gate: 0,
    layers: [] as Ingredient[],
  });
  const [result, setResult] = useState<GameState | null>(null);
  // Live saved session (server gates). null = practice.
  const liveRef = useRef<LiveSession | null>(null);
  const finalizeRef = useRef<(() => Promise<void>) | null>(null);
  const [isLive, setIsLive] = useState(false);
  const [verdict, setVerdict] = useState<{
    kind: "pending" | "ok" | "fail";
    score?: number;
    awarded?: number;
    text?: string;
  } | null>(null);
  const submitFn = useServerFn(submitBurgerBoostGameplay);
  const expireFn = useServerFn(expireBurgerBoostSession);
  // Audio: one engine per mounted game, created lazily, disposed on unmount.
  const audioRef = useRef<AudioEngine | null>(null);
  const [muted, setMuted] = useState(false); // sound effects
  const [musicMuted, setMusicMuted] = useState(false);
  const audio = useCallback(() => (audioRef.current ??= createAudioEngine()), []);
  const unlockAudio = useCallback(() => {
    audio().unlock();
  }, [audio]);
  useEffect(() => {
    const onVis = () => {
      if (document.hidden) {
        audioRef.current?.hold();
        return;
      }
      // Tab return: resume the single existing engine only if a game is actively running and not paused.
      const st = stateRef.current?.phase;
      if (!pausedRef.current && (st === "running" || st === "grace")) audioRef.current?.unlock();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      audioRef.current?.dispose();
      audioRef.current = null;
    };
  }, []);
  useEffect(() => {
    if (paused) audioRef.current?.hold();
  }, [paused]);
  // Saved-game victory waits for the server-confirmed verdict, once.
  const victoryPlayedRef = useRef(false);
  useEffect(() => {
    if (
      isLive &&
      verdict?.kind === "ok" &&
      result?.phase === "finished" &&
      !victoryPlayedRef.current
    ) {
      victoryPlayedRef.current = true;
      audioRef.current?.play("victory");
    }
  }, [isLive, verdict, result]);

  const startLive = useCallback(
    (live: LiveSession) => {
      const g = createLiveGame(live);
      if (!g) {
        setVerdict({ kind: "fail", text: "This saved game couldn't be loaded." });
        return;
      }
      liveRef.current = live;
      stateRef.current = g;
      resetMascotAnim(mascot);
      finalizeRef.current = once(async () => {
        const s = stateRef.current;
        if (!s) return;
        const payload = buildLiveSubmission(live.sessionId, s);
        try {
          if (!payload) {
            await expireFn({ data: { sessionId: live.sessionId } });
            setVerdict({
              kind: "fail",
              text: "Time ran out before all gates — this saved game wasn't counted.",
            });
            return;
          }
          const r = await submitFn({ data: payload });
          setVerdict(
            r.ok && "verifiedScore" in r
              ? {
                  kind: "ok",
                  score: r.verifiedScore,
                  awarded:
                    Number(
                      (r as { awardedDiscountPercent?: number }).awardedDiscountPercent ?? 0,
                    ) || 0,
                }
              : { kind: "fail", text: r.error ?? "This game couldn't be verified." },
          );
        } catch {
          setVerdict({ kind: "fail", text: "We couldn't reach the server to verify this game." });
        }
      });
      startRef.current = performance.now();
      clockRef.current = createPauseClock(startRef.current);
      victoryPlayedRef.current = false;
      audioRef.current?.play("start");
      audioRef.current?.startMusic();
      setIsLive(true);
      setVerdict({ kind: "pending" });
      setPaused(false);
      setResult(null);
      setScreen("playing");
    },
    [submitFn, expireFn],
  );

  const start = useCallback(() => {
    unlockAudio();
    victoryPlayedRef.current = false;
    liveRef.current = null;
    finalizeRef.current = null;
    setIsLive(false);
    setVerdict(null);
    stateRef.current = createGame(practiceSeed(), gateCount, TIERED_RULES_VERSION);
    resetMascotAnim(mascot);
    startRef.current = performance.now();
    clockRef.current = createPauseClock(startRef.current);
    audioRef.current?.play("start");
    audioRef.current?.startMusic();
    setPaused(false);
    setResult(null);
    setScreen("playing");
  }, [gateCount, unlockAudio]);

  const setLane = useCallback((lane: Lane) => {
    const prev = stateRef.current;
    if (!prev || pausedRef.current) return;
    const next = switchLane(prev, lane);
    stateRef.current = next;
    if (next.lane !== prev.lane) audioRef.current?.play("lane");
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

  // Game loop. Pause freezes the arcade clock (gates, timer, meter, mascot); server expiry is unaffected.
  useEffect(() => {
    if (screen !== "playing") return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const css = getComputedStyle(rootRef.current ?? document.documentElement);
    const col = (v: string, f: string) => css.getPropertyValue(v).trim() || f;
    const C = {
      bg: col("--background", "#1c1714"),
      fg: col("--foreground", "#fff"),
      primary: col("--primary", "#f26b1d"),
      muted: col("--muted", "#333"),
      destructive: col("--destructive", "#e33"),
    };
    const sched = gateSchedule(
      stateRef.current?.gateCount ?? gateCount,
      stateRef.current?.rulesVersion ?? OPERATION_RULES_VERSION,
    );
    let raf = 0;
    let lastHud = 0;

    let cssW = 0,
      cssH = 0;
    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const r = canvas.getBoundingClientRect();
      cssW = r.width;
      cssH = r.height;
      canvas.width = Math.round(r.width * dpr);
      canvas.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const OUT_SOUND: Record<string, SoundEvent> = {
      correct: "correct",
      wrong: "wrong",
      collect: "collect",
      spoiled: "hazard",
      safe: "gate",
      boost: "correct",
      drop: "wrong",
    };
    const frame = (realNow: number) => {
      if (pausedRef.current) {
        raf = requestAnimationFrame(frame);
        return;
      }
      let s = stateRef.current;
      if (!s) return;
      const sounds: SoundEvent[] = [];
      const played = clockRef.current.elapsed(realNow);
      const now = startRef.current + played; // virtual time: frozen while paused
      const elapsed = Math.min(HARD_CUTOFF_MS, played);
      // resolve gates that reached the player
      while (
        s.nextGate < s.gateCount &&
        (sched[s.nextGate] ?? Infinity) <= elapsed &&
        (s.phase === "running" || s.phase === "grace")
      ) {
        const before = s.meter;
        const r = passGate(s, elapsed);
        s = r.state;
        const outcomeSound = r.outcome ? OUT_SOUND[r.outcome] : undefined;
        if (outcomeSound) sounds.push(outcomeSound);
        if (isMilestoneGate(s.nextGate) && r.outcome) sounds.push("milestone");
        const d = s.meter - before,
          ds = boostDelta(d);
        if (r.outcome)
          flashRef.current = {
            text: {
              correct: "+10 Correct!",
              wrong: "Wrong",
              collect: isMeterRules(s.rulesVersion) ? `Layer ${ds}` : "+5 Layer",
              spoiled: isMeterRules(s.rulesVersion) ? `Spoiled! ${ds}` : "Spoiled! −5",
              safe: "Dodged",
              boost: ds,
              drop: ds,
            }[r.outcome],
            good: r.outcome !== "wrong" && r.outcome !== "spoiled" && r.outcome !== "drop",
            at: now,
          };
      }
      if (s.phase === "running" || s.phase === "grace")
        s = {
          ...s,
          phase:
            phaseAt(elapsed) === "expired"
              ? "expired"
              : s.phase === "grace" || phaseAt(elapsed) === "grace"
                ? "grace"
                : "running",
        };
      stateRef.current = s;
      const snd = pickGateSound(sounds);
      if (snd) audioRef.current?.play(snd);
      draw(ctx, cssW, cssH, s, elapsed, sched, C, flashRef.current, now);
      if (now - lastHud > 100) {
        lastHud = now;
        setHud({
          score: s.score,
          meter: s.meter,
          v2: isMeterRules(s.rulesVersion),
          elapsed,
          stack: stackPercent(s),
          gate: s.nextGate,
          layers: s.layers,
        });
      }
      if (s.phase === "finished" || s.phase === "expired") {
        const a = audioRef.current;
        a?.stopAll();
        a?.stopMusic();
        if (s.phase === "finished" && !liveRef.current) {
          victoryPlayedRef.current = true;
          a?.play("victory");
        } else a?.play("gameOver");
        setResult(s);
        setScreen("over");
        void finalizeRef.current?.();
        return;
      }
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, [screen, gateCount]);

  // Swipe
  const touchX = useRef<number | null>(null);

  const remaining = Math.max(0, GAMEPLAY_DURATION_MS - hud.elapsed);
  const grace = hud.elapsed >= GAMEPLAY_DURATION_MS;
  const graceLeft = Math.max(0, HARD_CUTOFF_MS - hud.elapsed);

  return (
    <div
      ref={rootRef}
      className="bb-theme fixed inset-0 z-50 mx-auto flex h-dvh w-full max-w-md flex-col overflow-hidden bg-background pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] text-foreground"
    >
      {screen === "playing" && (
        <>
          <Hud
            live={isLive}
            v2={hud.v2}
            discount={isLive ? 0 : storeDiscountPreview(ownerMax, hud.meter)}
            meter={hud.meter}
            score={hud.score}
            remaining={remaining}
            grace={grace}
            graceLeft={graceLeft}
            stack={hud.stack}
            gate={hud.gate}
            total={stateRef.current?.gateCount ?? gateCount}
            onPause={() => setPaused(true)}
            muted={muted}
            onMute={() => {
              const m = !muted;
              if (!m) unlockAudio();
              audio().setSfxMuted(m);
              setMuted(m);
            }}
            musicMuted={musicMuted}
            onMusicMute={() => {
              const m = !musicMuted;
              if (!m) unlockAudio();
              audio().setMusicMuted(m);
              setMusicMuted(m);
            }}
          />
          <div
            className="relative min-h-0 flex-1 touch-none select-none"
            onTouchStart={(e) => {
              touchX.current = e.touches[0]?.clientX ?? null;
            }}
            onTouchEnd={(e) => {
              const x0 = touchX.current;
              const x1 = e.changedTouches[0]?.clientX;
              if (x0 != null && x1 != null && Math.abs(x1 - x0) > 30) setLane(x1 < x0 ? 0 : 1);
              touchX.current = null;
            }}
          >
            <canvas
              ref={canvasRef}
              className="h-full w-full"
              aria-label="Burger Boost track"
              role="img"
            />
            <div className="absolute inset-x-0 bottom-0 grid grid-cols-2 gap-2 p-3">
              <Button
                size="lg"
                variant="secondary"
                className="h-16 text-base"
                onPointerDown={() => setLane(0)}
                aria-label="Move to left lane"
              >
                <ChevronLeft className="size-6" /> Left
              </Button>
              <Button
                size="lg"
                variant="secondary"
                className="h-16 text-base"
                onPointerDown={() => setLane(1)}
                aria-label="Move to right lane"
              >
                Right <ChevronRight className="size-6" />
              </Button>
            </div>
            {paused && (
              <Overlay>
                <h2 className="font-display text-2xl font-bold">Paused</h2>
                <p className="text-sm text-muted-foreground">
                  Game frozen — tap Resume to continue exactly where you left off.
                </p>
                <Button
                  size="lg"
                  onClick={() => {
                    unlockAudio();
                    setPaused(false);
                  }}
                >
                  <Play className="size-5" /> Resume
                </Button>
              </Overlay>
            )}
          </div>
        </>
      )}

      {screen === "start" && (
        <Overlay>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
            Practice mode
          </p>
          <h1 className="font-display text-4xl font-black leading-none">
            FLAMIO
            <br />
            <span className="text-primary">BURGER BOOST</span>
          </h1>
          <ul className="space-y-2 text-left text-sm text-muted-foreground">
            <li>
              🔥 Your burger runs forward on its own — tap{" "}
              <b className="text-foreground">Left / Right</b> or swipe to change lanes.
            </li>
            <li>
              ➕ <b className="text-foreground">Boost gates:</b> both lanes change your Discount
              meter (+, −, ×, ÷). Pick the smarter one — ×2 is great when you’re ahead, ÷2 hurts
              less than −20 only when you’re low.
            </li>
            <li>
              🥬 <b className="text-foreground">Ingredient gates:</b> add a layer to your burger (+
              {METER.ingredient}%).
            </li>
            <li>
              ☠️ <b className="text-foreground">Spoiled gates:</b> dodge them or lose a layer (
              {METER.hazard}%).
            </li>
            <li>
              🎯 The meter starts at 0% and can go negative — recover with later gates. 60 s + 15 s
              grace.
            </li>
          </ul>
          <p className="rounded-lg border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            Practice mode: unlimited plays, never saved, never gives a coupon and never uses your
            daily reward try.
          </p>
          <Button size="lg" className="w-full" onClick={start}>
            <Play className="size-5" /> Start practice
          </Button>
          <RealGamePanel onLive={startLive} onUnlock={unlockAudio} />
          <Link to="/" className="text-sm text-muted-foreground underline">
            Back to Flamio
          </Link>
        </Overlay>
      )}

      {screen === "over" && result && (
        <Overlay>
          {(() => {
            const awarded =
              isLive && verdict?.kind === "ok" ? Math.max(0, Math.floor(verdict.awarded ?? 0)) : 0;
            const preview = isLive ? 0 : storeDiscountPreview(ownerMax, result.meter);
            const pending = isLive && verdict?.kind === "pending";
            const won = awarded > 0;
            if (pending)
              return (
                <p role="status" className="text-sm text-muted-foreground">
                  Checking your game with Flamio…
                </p>
              );
            if (isLive && verdict?.kind === "fail")
              return (
                <>
                  <h2 className="font-display text-4xl font-black">YOU LOST</h2>
                  <p role="status" className="text-sm text-destructive">
                    {verdict.text}
                  </p>
                  <p className="font-display text-xl font-bold text-primary">TRY AGAIN</p>
                </>
              );
            if (won)
              return (
                <div className="animate-in zoom-in-90 fade-in duration-500 space-y-1">
                  <h2 className="font-display text-5xl font-black text-primary">YOU WON!</h2>
                  <p className="font-display text-3xl font-black">{awarded}% DISCOUNT</p>
                  <p className="text-sm font-semibold uppercase tracking-[0.25em] text-muted-foreground">
                    A gift from FLAMIO
                  </p>
                </div>
              );
            if (!isLive && preview > 0)
              return (
                <div className="animate-in fade-in duration-500 space-y-1">
                  <h2 className="font-display text-4xl font-black text-primary">GREAT RIDE!</h2>
                  <p className="font-display text-2xl font-black">{preview}% practice score</p>
                  <p className="text-xs text-muted-foreground">
                    Practice games never give a real discount. Play a reward game to win one.
                  </p>
                </div>
              );
            return (
              <div className="animate-in fade-in duration-500 space-y-1">
                <h2 className="font-display text-5xl font-black">YOU LOST</h2>
                <p className="font-display text-2xl font-bold text-primary">TRY AGAIN</p>
              </div>
            );
          })()}
          {result.phase === "finished" && (!isLive || verdict?.kind === "ok") ? (
            <VictoryCat
              layers={result.layers}
              loss={
                isLive
                  ? !((verdict?.awarded ?? 0) > 0)
                  : storeDiscountPreview(ownerMax, result.meter) <= 0
              }
            />
          ) : (
            <BurgerStack layers={result.layers} />
          )}
          <dl className="grid w-full grid-cols-2 gap-2 text-sm">
            <Stat label="Layers" value={result.layers.length} />
            <Stat label="Spoiled" value={result.spoiledHits} />
          </dl>
          {isLive && verdict?.kind === "ok" && (verdict.awarded ?? 0) > 0 ? (
            <Button asChild size="lg" className="w-full">
              <Link to="/account/vouchers">CLAIM &amp; USE DISCOUNT</Link>
            </Button>
          ) : (
            <Button size="lg" className="w-full" onClick={start}>
              <RotateCcw className="size-5" /> {isLive ? "Play practice" : "Try again"}
            </Button>
          )}
          <Link to="/" className="text-sm text-muted-foreground underline">
            Back to Flamio
          </Link>
        </Overlay>
      )}
    </div>
  );
}

function Hud(p: {
  live: boolean;
  v2: boolean;
  discount: number;
  meter: number;
  score: number;
  remaining: number;
  grace: boolean;
  graceLeft: number;
  stack: number;
  gate: number;
  total: number;
  onPause: () => void;
  muted: boolean;
  onMute: () => void;
  musicMuted: boolean;
  onMusicMute: () => void;
}) {
  const shown = Math.max(0, Math.min(100, p.meter));
  return (
    <div className="space-y-2 border-b border-border bg-card/80 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <div
          aria-live="polite"
          className={
            p.grace
              ? "font-display text-xl font-bold text-destructive"
              : "font-display text-xl font-bold"
          }
        >
          {p.grace
            ? `Grace ${Math.ceil(p.graceLeft / 1000)}s`
            : `${Math.ceil(p.remaining / 1000)}s`}
        </div>
        <span className="text-xs text-muted-foreground">
          Gate {p.gate}/{p.total}
        </span>
        <div className="flex items-center">
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            onClick={p.onMusicMute}
            aria-label={p.musicMuted ? "Turn music on" : "Turn music off"}
            aria-pressed={p.musicMuted}
          >
            {p.musicMuted ? <MusicOff /> : <Music className="size-5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            onClick={p.onMute}
            aria-label={p.muted ? "Turn sound effects on" : "Turn sound effects off"}
            aria-pressed={p.muted}
          >
            {p.muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="size-11"
            onClick={p.onPause}
            aria-label="Pause"
          >
            <Pause className="size-5" />
          </Button>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div
          className="flex min-w-[7.5rem] flex-col items-center rounded-xl border-2 border-primary bg-background px-4 py-1 shadow-lg"
          aria-live="polite"
        >
          <span className="text-[10px] font-black uppercase tracking-[0.3em] text-primary">
            Discount
          </span>
          <span
            key={p.discount}
            className="font-display text-3xl font-black leading-none animate-in zoom-in-75 fade-in duration-300"
          >
            {p.discount}%
          </span>
        </div>
        {p.v2 ? (
          <div
            className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-valuemin={-100}
            aria-valuemax={100}
            aria-valuenow={p.meter}
            aria-label="Boost"
          >
            <div
              className="absolute inset-y-0 left-0 bg-primary transition-all"
              style={{ width: `${shown}%` }}
            />
          </div>
        ) : (
          <p className="flex-1 text-[11px] text-muted-foreground">
            Saved game — checked by Flamio after the run.
          </p>
        )}
      </div>
      {p.live && (
        <p className="text-center text-[10px] text-muted-foreground">
          Discount shows only what Flamio has verified.
        </p>
      )}
    </div>
  );
}
function MusicOff() {
  return (
    <span className="relative inline-flex">
      <Music className="size-5 opacity-50" />
      <span className="absolute left-1/2 top-1/2 h-0.5 w-6 -translate-x-1/2 -translate-y-1/2 rotate-45 bg-current" />
    </span>
  );
}

function Overlay({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-background/95 p-6 text-center">
      {children}
    </div>
  );
}
function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-muted/50 p-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-display text-lg font-bold">{value}</dd>
    </div>
  );
}
/** Victory/loss scene. Mounted only after completion is confirmed. One bounded RAF loop: stops at VICTORY_MS and is cancelled on unmount. */
function VictoryCat({ layers, loss }: { layers: Ingredient[]; loss: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const cv = ref.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const W = 220,
      H = 220;
    cv.width = W * dpr;
    cv.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let raf = 0;
    let elapsed = 0;
    let last = performance.now();
    const frame = (now: number) => {
      // Advance only while the tab is visible, so a hidden scene doesn't skip ahead.
      if (document.visibilityState === "visible") elapsed += Math.min(100, now - last);
      last = now;
      drawVictory(ctx, W, H, elapsed, layers, loss);
      if (elapsed < VICTORY_MS) raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [layers, loss]);
  return (
    <canvas
      ref={ref}
      className="size-[220px]"
      role="img"
      aria-label={
        loss
          ? "FLAMIO rider looks disappointed holding the burger"
          : "FLAMIO rider bites the burger and celebrates"
      }
    />
  );
}
function BurgerStack({ layers }: { layers: Ingredient[] }) {
  return (
    <div
      className="flex w-32 flex-col-reverse items-center"
      aria-label={`${layers.length} burger layers`}
    >
      <div className="h-4 w-full rounded-b-xl bg-primary/80" />
      {layers.slice(-12).map((l, i) => (
        <div key={i} className="h-2 w-[94%] rounded-sm" style={{ background: ING[l].color }} />
      ))}
      <div className="h-6 w-full rounded-t-full bg-primary" />
    </div>
  );
}

/* ------------------------------ canvas draw ------------------------------ */

const mascot = createMascotAnim();
const envFrame: EnvFrame = {
  W: 0,
  H: 0,
  horizon: 0,
  playerY: 0,
  speed: 0,
  proj: () => ({ y: 0, left: 0, right: 0, scale: 0 }),
  C: { bg: "", fg: "", primary: "", muted: "", destructive: "" },
};

function draw(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  s: GameState,
  elapsed: number,
  sched: readonly number[],
  C: Colors,
  flash: { text: string; good: boolean; at: number } | null,
  now: number,
) {
  const horizon = H * 0.12,
    playerY = H - 130;
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // perspective: depth d in [0,1] (0 = horizon, 1 = player)
  const proj = (d: number) => {
    const y = horizon + (playerY - horizon) * d * d;
    const half = W * (0.08 + 0.38 * d * d);
    return { y, left: W / 2 - half, right: W / 2 + half, scale: 0.15 + 0.85 * d * d };
  };
  // environment (sky, skyline, road, curbs, lamps, billboards) — same clock as gates
  envFrame.W = W;
  envFrame.H = H;
  envFrame.horizon = horizon;
  envFrame.playerY = playerY;
  const pos = trackPosition(elapsed, sched);
  envFrame.speed = pos;
  envFrame.proj = proj;
  envFrame.C = C;
  drawEnvironment(ctx, envFrame);

  // gates: gate i hits the player at sched[i]; visible ~4 gate-units ahead (same space as scenery)
  for (let i = Math.min(s.gateCount - 1, s.nextGate + 4); i >= s.nextGate; i--) {
    const d = 1 - (i + 1 - pos) / 4;
    if (d < 0 || d > 1.05) continue;
    const gate = s.track[i];
    if (gate) drawGate(ctx, gate, proj(d), C, now, i, s.gateCount);
  }

  // FLAMIO delivery rider (presentation only; reads already-resolved state)
  const p = proj(1);
  const targetX = s.lane === 0 ? (p.left + W / 2) / 2 : (p.right + W / 2) / 2;
  const laneX = updateMascot(mascot, s.lane, targetX, s.layers.length, s.spoiledHits, now);
  drawMascot(ctx, mascot, laneX, playerY + 30, 92, s.layers, now, pos);
  const y = playerY - 110;
  if (flash && now - flash.at < 700) {
    ctx.globalAlpha = 1 - (now - flash.at) / 700;
    ctx.fillStyle = flash.good ? C.primary : C.destructive;
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(flash.text, laneX, y - 30 - (now - flash.at) / 20);
    ctx.globalAlpha = 1;
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, r));
}
