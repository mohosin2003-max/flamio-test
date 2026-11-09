/** Shared, browser-only renderer types for the Burger Boost canvas. */
export type Colors = { bg: string; fg: string; primary: string; muted: string; destructive: string };

export type Projected = { y: number; left: number; right: number; scale: number };

/** Mutable frame context, reused every frame (no per-frame allocation). */
export type EnvFrame = {
  W: number;
  H: number;
  horizon: number;
  playerY: number;
  /** Track progress in gate units: elapsed / interval (same clock as gates). */
  speed: number;
  /** Existing projection — depth d: 0 = horizon, 1 = player. */
  proj: (d: number) => Projected;
  C: Colors;
};
