/**
 * Gameplay modules for the challenge engine.
 *
 * Each module maps to one `detector_type`. A module only produces a score; the
 * server decides whether that score wins. Chance games (dice/coin) receive a
 * server-generated outcome and merely animate it.
 *
 * Nothing here records video, uses the camera, or uploads any media.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

export type ChanceOutcome =
  | { kind: "dice"; dice: number[]; win: boolean }
  | { kind: "coin"; tosses: string[]; win: boolean };

export type GameProps = {
  detector: string;
  config: Record<string, number>;
  requiredScore: number;
  timeLimitSeconds: number | null;
  outcome: ChanceOutcome | null;
  onFinish: (score: number) => void;
};

function useHaptics() {
  return useCallback((pattern: number | number[]) => {
    if (typeof navigator !== "undefined" && "vibrate" in navigator) {
      try {
        navigator.vibrate(pattern);
      } catch {
        /* haptics are optional */
      }
    }
  }, []);
}

export function ChallengeGame(props: GameProps) {
  switch (props.detector) {
    case "reaction_game":
      return <ReactionGame {...props} />;
    case "timing_game":
      return <TimingGame {...props} />;
    case "memory_game":
      return <MemoryGame {...props} />;
    case "avoid_game":
      return <AvoidGame {...props} />;
    case "sequence_game":
      return <SequenceGame {...props} />;
    case "stack_game":
      return <StackGame {...props} />;
    case "dice_detector":
      return <DiceGame {...props} />;
    case "coin_detector":
      return <CoinGame {...props} />;
    default:
      return (
        <p className="p-6 text-center text-sm text-muted-foreground">
          This game type isn&apos;t available yet.
        </p>
      );
  }
}

function Shell({
  title,
  hint,
  progress,
  children,
}: {
  title: string;
  hint?: string;
  progress?: { value: number; max: number };
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[60vh] flex-col">
      <div className="mb-3 text-center">
        <p className="font-display text-lg font-extrabold">{title}</p>
        {hint ? <p className="mt-0.5 text-sm text-muted-foreground">{hint}</p> : null}
      </div>
      {progress ? (
        <Progress
          value={(progress.value / Math.max(1, progress.max)) * 100}
          className="mb-3 h-2"
        />
      ) : null}
      <div className="flex-1">{children}</div>
    </div>
  );
}

/* ------------------------------- reaction ------------------------------- */

function ReactionGame({ config, onFinish }: GameProps) {
  const rounds = Math.max(1, config["rounds"] ?? 3);
  const maxReaction = Math.max(120, config["max_reaction_ms"] ?? 280);
  const buzz = useHaptics();
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [phase, setPhase] = useState<"wait" | "go" | "result">("wait");
  const [message, setMessage] = useState("Get ready…");
  const goAt = useRef(0);

  useEffect(() => {
    if (phase !== "wait") return;
    const delay = 900 + Math.random() * 1800;
    const timer = window.setTimeout(() => {
      goAt.current = performance.now();
      setPhase("go");
      buzz(20);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [phase, round, buzz]);

  function tap() {
    if (phase === "wait") {
      setMessage("Too early! Round lost.");
      next(false);
      return;
    }
    if (phase !== "go") return;
    const elapsed = performance.now() - goAt.current;
    const ok = elapsed <= maxReaction;
    setMessage(`${Math.round(elapsed)}ms — ${ok ? "nice!" : "too slow"}`);
    next(ok);
  }

  function next(ok: boolean) {
    const nextScore = score + (ok ? 1 : 0);
    setScore(nextScore);
    if (round >= rounds) {
      setPhase("result");
      window.setTimeout(() => onFinish(nextScore), 700);
      return;
    }
    setRound(round + 1);
    setPhase("wait");
  }

  return (
    <Shell
      title="Lightning Tap"
      hint={`Tap within ${maxReaction}ms · round ${round}/${rounds}`}
      progress={{ value: round - 1, max: rounds }}
    >
      <button
        type="button"
        onClick={tap}
        className={cn(
          "h-full min-h-[46vh] w-full rounded-3xl text-center text-xl font-black transition-colors",
          phase === "go"
            ? "bg-gradient-ember text-primary-foreground"
            : "bg-secondary text-muted-foreground",
        )}
      >
        {phase === "go" ? "TAP NOW!" : message}
      </button>
    </Shell>
  );
}

/* -------------------------------- timing -------------------------------- */

function TimingGame({ config, onFinish }: GameProps) {
  const rounds = Math.max(1, config["rounds"] ?? 2);
  const zone = Math.max(3, config["zone_width"] ?? 8);
  const speed = config["speed"] ?? 1.6;
  const buzz = useHaptics();
  const [round, setRound] = useState(1);
  const [score, setScore] = useState(0);
  const [position, setPosition] = useState(0);
  const [running, setRunning] = useState(true);
  const [message, setMessage] = useState("Stop inside the zone");
  const target = useMemo(
    () => 15 + Math.random() * 70,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [round],
  );
  const frame = useRef(0);
  const dir = useRef(1);
  const pos = useRef(0);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      pos.current += dir.current * speed * (dt / 16);
      if (pos.current >= 100) {
        pos.current = 100;
        dir.current = -1;
      }
      if (pos.current <= 0) {
        pos.current = 0;
        dir.current = 1;
      }
      setPosition(pos.current);
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame.current);
  }, [running, speed, round]);

  function stop() {
    if (!running) return;
    setRunning(false);
    const ok = Math.abs(pos.current - target) <= zone / 2;
    buzz(ok ? 30 : [10, 40, 10]);
    setMessage(ok ? "Perfect!" : "Missed the zone");
    const nextScore = score + (ok ? 1 : 0);
    setScore(nextScore);
    window.setTimeout(() => {
      if (round >= rounds) {
        onFinish(nextScore);
        return;
      }
      pos.current = 0;
      dir.current = 1;
      setRound(round + 1);
      setRunning(true);
      setMessage("Stop inside the zone");
    }, 750);
  }

  return (
    <Shell
      title="Perfect Stop"
      hint={`${message} · round ${round}/${rounds}`}
      progress={{ value: round - 1, max: rounds }}
    >
      <div className="relative mt-6 h-16 overflow-hidden rounded-full border border-border bg-secondary">
        <div
          className="absolute inset-y-0 rounded-full bg-primary/25"
          style={{ left: `${Math.max(0, target - zone / 2)}%`, width: `${zone}%` }}
        />
        <div
          className="absolute inset-y-2 w-2 rounded-full bg-primary shadow-ember"
          style={{ left: `calc(${position}% - 4px)` }}
        />
      </div>
      <Button className="mt-8 h-16 w-full text-lg font-black" onClick={stop} disabled={!running}>
        STOP
      </Button>
    </Shell>
  );
}

/* -------------------------------- memory -------------------------------- */

function MemoryGame({ config, onFinish }: GameProps) {
  const length = Math.max(3, config["sequence_length"] ?? 5);
  const buzz = useHaptics();
  const sequence = useMemo(
    () => Array.from({ length }, () => Math.floor(Math.random() * 6)),
    [length],
  );
  const [showIndex, setShowIndex] = useState(0);
  const [phase, setPhase] = useState<"show" | "input" | "done">("show");
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (phase !== "show") return;
    if (showIndex >= sequence.length) {
      const timer = window.setTimeout(() => setPhase("input"), 400);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setShowIndex(showIndex + 1), 650);
    return () => window.clearTimeout(timer);
  }, [phase, showIndex, sequence.length]);

  function tap(tile: number) {
    if (phase !== "input") return;
    buzz(15);
    if (sequence[step] === tile) {
      const next = step + 1;
      setStep(next);
      if (next >= sequence.length) {
        setPhase("done");
        onFinish(next);
      }
      return;
    }
    setPhase("done");
    onFinish(step);
  }

  const activeTile = phase === "show" ? sequence[showIndex - 1] : undefined;

  return (
    <Shell
      title="Memory Flash"
      hint={phase === "show" ? "Watch the pattern" : `Repeat it · ${step}/${sequence.length}`}
      progress={{ value: phase === "show" ? showIndex : step, max: sequence.length }}
    >
      <div className="mt-4 grid grid-cols-3 gap-3">
        {Array.from({ length: 6 }, (_, tile) => (
          <button
            key={tile}
            type="button"
            onClick={() => tap(tile)}
            className={cn(
              "aspect-square rounded-2xl border border-border transition-colors",
              activeTile === tile ? "bg-gradient-ember" : "bg-secondary",
            )}
            aria-label={`Tile ${tile + 1}`}
          />
        ))}
      </div>
    </Shell>
  );
}

/* --------------------------------- avoid -------------------------------- */

function AvoidGame({ config, timeLimitSeconds, onFinish }: GameProps) {
  const spawnMs = Math.max(350, config["spawn_ms"] ?? 800);
  const bombRatio = Math.min(0.7, Math.max(0.1, config["bomb_ratio"] ?? 0.35));
  const buzz = useHaptics();
  const [cell, setCell] = useState({ index: 0, bomb: false });
  const [score, setScore] = useState(0);
  const [left, setLeft] = useState(timeLimitSeconds ?? 25);
  const done = useRef(false);

  const finish = useCallback(
    (value: number) => {
      if (done.current) return;
      done.current = true;
      onFinish(value);
    },
    [onFinish],
  );

  useEffect(() => {
    const spawn = window.setInterval(() => {
      setCell({ index: Math.floor(Math.random() * 9), bomb: Math.random() < bombRatio });
    }, spawnMs);
    const tick = window.setInterval(() => setLeft((value) => value - 1), 1000);
    return () => {
      window.clearInterval(spawn);
      window.clearInterval(tick);
    };
  }, [spawnMs, bombRatio]);

  useEffect(() => {
    if (left <= 0) finish(score);
  }, [left, score, finish]);

  return (
    <Shell
      title="Don't Tap the Bomb"
      hint={`Score ${score} · ${Math.max(0, left)}s left`}
      progress={{ value: score, max: Math.max(1, config["target_score"] ?? 12) }}
    >
      <div className="mt-4 grid grid-cols-3 gap-3">
        {Array.from({ length: 9 }, (_, index) => {
          const active = cell.index === index;
          return (
            <button
              key={index}
              type="button"
              onClick={() => {
                if (!active) return;
                if (cell.bomb) {
                  buzz([20, 60, 20]);
                  finish(score);
                  return;
                }
                buzz(12);
                setScore((value) => value + 1);
                setCell({ index: -1, bomb: false });
              }}
              className={cn(
                "grid aspect-square place-items-center rounded-2xl border border-border text-3xl",
                active ? "bg-secondary" : "bg-card",
              )}
            >
              {active ? (cell.bomb ? "💥" : "🍔") : ""}
            </button>
          );
        })}
      </div>
    </Shell>
  );
}

/* -------------------------------- sequence ------------------------------- */

function SequenceGame({ config, timeLimitSeconds, onFinish }: GameProps) {
  const count = Math.max(4, config["count"] ?? 12);
  const buzz = useHaptics();
  const tiles = useMemo(() => {
    const values = Array.from({ length: count }, (_, index) => index + 1);
    for (let i = values.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [values[i], values[j]] = [values[j]!, values[i]!];
    }
    return values;
  }, [count]);
  const [next, setNext] = useState(1);
  const [left, setLeft] = useState(timeLimitSeconds ?? 20);
  const done = useRef(false);

  const finish = useCallback(
    (value: number) => {
      if (done.current) return;
      done.current = true;
      onFinish(value);
    },
    [onFinish],
  );

  useEffect(() => {
    const tick = window.setInterval(() => setLeft((value) => value - 1), 1000);
    return () => window.clearInterval(tick);
  }, []);

  useEffect(() => {
    if (left <= 0) finish(next - 1);
  }, [left, next, finish]);

  return (
    <Shell
      title="Number Rush"
      hint={`Tap ${next} · ${Math.max(0, left)}s left`}
      progress={{ value: next - 1, max: count }}
    >
      <div className="mt-4 grid grid-cols-4 gap-2">
        {tiles.map((value) => (
          <button
            key={value}
            type="button"
            disabled={value < next}
            onClick={() => {
              if (value !== next) {
                buzz([10, 40]);
                finish(next - 1);
                return;
              }
              buzz(10);
              if (value >= count) {
                finish(count);
                return;
              }
              setNext(value + 1);
            }}
            className={cn(
              "grid aspect-square place-items-center rounded-xl border border-border text-lg font-bold",
              value < next ? "bg-primary/15 text-muted-foreground" : "bg-secondary",
            )}
          >
            {value}
          </button>
        ))}
      </div>
    </Shell>
  );
}

/* --------------------------------- stack -------------------------------- */

const STACK_LAYERS = ["🥬", "🧅", "🍅", "🧀", "🥓", "🍔", "🥒", "🌶️"];

function StackGame({ config, onFinish }: GameProps) {
  const targetLayers = Math.max(3, config["target_layers"] ?? 6);
  const tolerance = Math.max(6, config["tolerance"] ?? 16);
  const speed = config["speed"] ?? 2.2;
  const buzz = useHaptics();
  const [position, setPosition] = useState(0);
  const [stack, setStack] = useState<number[]>([]);
  const [running, setRunning] = useState(true);
  const pos = useRef(0);
  const dir = useRef(1);
  const frame = useRef(0);

  useEffect(() => {
    if (!running) return;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = now - last;
      last = now;
      pos.current += dir.current * speed * (dt / 16);
      if (pos.current >= 100) {
        pos.current = 100;
        dir.current = -1;
      }
      if (pos.current <= 0) {
        pos.current = 0;
        dir.current = 1;
      }
      setPosition(pos.current);
      frame.current = requestAnimationFrame(loop);
    };
    frame.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame.current);
  }, [running, speed]);

  function drop() {
    if (!running) return;
    const last = stack.at(-1) ?? 50;
    const ok = Math.abs(pos.current - last) <= tolerance;
    buzz(ok ? 15 : [10, 40]);
    if (!ok) {
      setRunning(false);
      window.setTimeout(() => onFinish(stack.length), 600);
      return;
    }
    const next = [...stack, pos.current];
    setStack(next);
    if (next.length >= targetLayers) {
      setRunning(false);
      window.setTimeout(() => onFinish(next.length), 600);
    }
  }

  return (
    <Shell
      title="Burger Stack"
      hint={`Layers ${stack.length}/${targetLayers}`}
      progress={{ value: stack.length, max: targetLayers }}
    >
      <div className="relative mt-4 h-[42vh] overflow-hidden rounded-2xl border border-border bg-secondary/50">
        {stack.map((left, index) => (
          <div
            key={index}
            className="absolute text-2xl"
            style={{ left: `calc(${left}% - 16px)`, bottom: `${index * 34 + 8}px` }}
          >
            {STACK_LAYERS[index % STACK_LAYERS.length]}
          </div>
        ))}
        {running ? (
          <div
            className="absolute top-3 text-2xl"
            style={{ left: `calc(${position}% - 16px)` }}
          >
            {STACK_LAYERS[stack.length % STACK_LAYERS.length]}
          </div>
        ) : null}
      </div>
      <Button className="mt-6 h-16 w-full text-lg font-black" onClick={drop} disabled={!running}>
        DROP
      </Button>
    </Shell>
  );
}

/* ------------------------------ chance games ----------------------------- */

const DICE_FACES = ["", "⚀", "⚁", "⚂", "⚃", "⚄", "⚅"];

function DiceGame({ outcome, onFinish }: GameProps) {
  const [rolling, setRolling] = useState(true);
  const [faces, setFaces] = useState([1, 1]);
  const dice = outcome?.kind === "dice" ? outcome.dice : [1, 1];

  useEffect(() => {
    const spin = window.setInterval(() => {
      setFaces([1 + Math.floor(Math.random() * 6), 1 + Math.floor(Math.random() * 6)]);
    }, 90);
    const stop = window.setTimeout(() => {
      window.clearInterval(spin);
      setFaces(dice);
      setRolling(false);
      window.setTimeout(() => onFinish(1), 900);
    }, 1600);
    return () => {
      window.clearInterval(spin);
      window.clearTimeout(stop);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Shell title="Double Dice" hint={rolling ? "Rolling…" : "Result"}>
      <div className="mt-10 flex items-center justify-center gap-6 text-[5rem] leading-none">
        <span>{DICE_FACES[faces[0] ?? 1]}</span>
        <span>{DICE_FACES[faces[1] ?? 1]}</span>
      </div>
    </Shell>
  );
}

function CoinGame({ outcome, onFinish }: GameProps) {
  const tosses = outcome?.kind === "coin" ? outcome.tosses : [];
  const [shown, setShown] = useState(0);

  useEffect(() => {
    if (shown >= tosses.length) {
      const timer = window.setTimeout(() => onFinish(1), 900);
      return () => window.clearTimeout(timer);
    }
    const timer = window.setTimeout(() => setShown(shown + 1), 700);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown, tosses.length]);

  return (
    <Shell title="Lucky Coin" hint={`Toss ${Math.min(shown, tosses.length)}/${tosses.length}`}>
      <div className="mt-10 flex flex-wrap items-center justify-center gap-4 text-4xl">
        {tosses.slice(0, shown).map((toss, index) => (
          <span key={index}>{toss === "heads" ? "🪙" : "⚪"}</span>
        ))}
      </div>
    </Shell>
  );
}
