/**
 * FLAMIO Cat riding a classic motorcycle (procedural Canvas 2D, visual only, browser only).
 * Animation is driven by the caller's existing `now` timestamp and by
 * already-resolved game state (lane, layers, spoiledHits). It never decides
 * lanes, outcomes, score or timing.
 *
 * Everything is drawn in a fixed "unit space" (ctx.scale), so gradients are
 * created once per canvas context and reused every frame.
 */
import type { Ingredient, Lane } from "@/lib/burger-boost-rules";
import { victoryPose } from "@/lib/burger-boost-victory";

type Ctx = CanvasRenderingContext2D;

/* palette */
const FUR = "#f7902f", FUR_DARK = "#cf5f10", FUR_LIGHT = "#ffb766", CREAM = "#fff1d8", PINK = "#ffb3a7";
const SUIT = "#23201e", SUIT_DARK = "#121010", SUIT_LIGHT = "#4a423d";

/** Approved visual spec (Step 48): charcoal suit, branding on jersey AND cape. */
export const MASCOT_PALETTE = { suit: SUIT, suitDark: SUIT_DARK, suitLight: SUIT_LIGHT } as const;
export const MASCOT_BRANDING = { jersey: "FLAMIO", cape: "FLAMIO" } as const;
/**
 * Three-quarter carry: upper torso turned slightly so the burger is held out in
 * front of the chest on the player's right, clear of the lower-back seam.
 */
export const BURGER_GRIP = { bx: 30, by: -52, halfSpan: 17 } as const;
/** Periodic backward glance: every 4.5 s, lasting 700 ms. */
export const GLANCE_PERIOD_MS = 4500;
export const GLANCE_MS = 700;

/** Symmetric paw positions around the burger centre for a given stride (-1..1). */
export function gripPoints(stride: number): { left: { x: number; y: number }; right: { x: number; y: number } } {
  const { bx, by, halfSpan } = BURGER_GRIP;
  const dy = stride * 0.8;
  return { left: { x: bx - halfSpan, y: by - 6 - dy }, right: { x: bx + halfSpan, y: by - 6 + dy } };
}

/** 0..1 head-turn amount; smooth in/out, zero outside the glance window. */
export function glanceAmount(now: number): number {
  if (!Number.isFinite(now) || now < 0) return 0;
  const t = now % GLANCE_PERIOD_MS;
  const start = GLANCE_PERIOD_MS - GLANCE_MS;
  if (t < start) return 0;
  return Math.sin(((t - start) / GLANCE_MS) * Math.PI);
}
const ACCENT = "#ff7a1a", GOLD = "#f4c14a", MASK = "#10b981", MASK_DARK = "#047857";
const CAPE = "#ff6a13", CAPE_DARK = "#c2410c";

export const RUN_CYCLE_MS = 320;
export const SWITCH_MS = 180;
export const COLLECT_MS = 200;
export const FLINCH_MS = 350;
const MAX_BANK = (8 * Math.PI) / 180;

/** Presentation-only animation memory; mutated in place (no per-frame allocation). */
export type MascotAnim = {
  lane: Lane; fromX: number; toX: number; switchAt: number;
  prevLayers: number; prevSpoiled: number; collectAt: number; flinchAt: number;
};
export function createMascotAnim(): MascotAnim {
  return { lane: 0, fromX: NaN, toX: NaN, switchAt: -1e9, prevLayers: 0, prevSpoiled: 0, collectAt: -1e9, flinchAt: -1e9 };
}
export function resetMascotAnim(a: MascotAnim) { Object.assign(a, createMascotAnim()); }

const ease = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/**
 * Observe resolved state; returns the interpolated x for drawing.
 * Reactions trigger only from changes in verified local state.
 */
export function updateMascot(a: MascotAnim, lane: Lane, laneX: number, layers: number, spoiledHits: number, now: number): number {
  if (Number.isNaN(a.toX)) { a.toX = a.fromX = laneX; a.lane = lane; }
  if (lane !== a.lane) {
    const t = ease((now - a.switchAt) / SWITCH_MS);
    a.fromX = a.fromX + (a.toX - a.fromX) * t; a.toX = laneX; a.switchAt = now; a.lane = lane;
  } else a.toX = laneX;
  if (spoiledHits > a.prevSpoiled) a.flinchAt = now;
  else if (layers > a.prevLayers) a.collectAt = now;
  a.prevLayers = layers; a.prevSpoiled = spoiledHits;
  return a.fromX + (a.toX - a.fromX) * ease((now - a.switchAt) / SWITCH_MS);
}

/* --------------------------- cached gradients ------------------------------ */

type Grads = {
  suit: CanvasGradient; suitRim: CanvasGradient; head: CanvasGradient; leg: CanvasGradient;
  cape: CanvasGradient; letters: CanvasGradient; mask: CanvasGradient;
  bunTop: CanvasGradient; bunGloss: CanvasGradient; bunBottom: CanvasGradient; patty: CanvasGradient;
  cheese: CanvasGradient; tomato: CanvasGradient; plate: CanvasGradient;
  vSuit: CanvasGradient; vHead: CanvasGradient;
};
const gradCache = new WeakMap<Ctx, Grads>();

function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: ReadonlyArray<readonly [number, string]>) {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}
function rad(ctx: Ctx, x0: number, y0: number, r0: number, x1: number, y1: number, r1: number, stops: ReadonlyArray<readonly [number, string]>) {
  const g = ctx.createRadialGradient(x0, y0, r0, x1, y1, r1);
  for (const [o, c] of stops) g.addColorStop(o, c);
  return g;
}

function grads(ctx: Ctx): Grads {
  let g = gradCache.get(ctx);
  if (g) return g;
  g = {
    // running cat (unit space: feet at y=0, head ≈ y=-100)
    suit: lin(ctx, -26, 0, 26, 0, [[0, SUIT_DARK], [0.45, SUIT], [0.75, SUIT_LIGHT], [1, SUIT_DARK]]),
    suitRim: lin(ctx, 0, -80, 0, -30, [[0, "rgba(255,190,120,0.35)"], [0.3, "rgba(255,190,120,0)"]]),
    head: rad(ctx, 6, -104, 2, 0, -96, 24, [[0, FUR_LIGHT], [0.6, FUR], [1, FUR_DARK]]),
    leg: lin(ctx, -8, 0, 8, 0, [[0, SUIT_DARK], [0.5, SUIT], [1, SUIT_DARK]]),
    cape: lin(ctx, 0, -78, 0, -20, [[0, CAPE], [1, CAPE_DARK]]),
    letters: lin(ctx, 0, -70, 0, -55, [[0, "#fff6c2"], [0.45, GOLD], [1, ACCENT]]),
    mask: lin(ctx, 0, -100, 0, -92, [[0, "#34d399"], [1, MASK_DARK]]),
    // burger (unit space: width 100, bottom at y=0)
    bunTop: rad(ctx, -14, -30, 4, 0, -12, 56, [[0, "#ffd08a"], [0.45, "#e59a3c"], [0.85, "#b8661f"], [1, "#8a4513"]]),
    bunGloss: lin(ctx, 0, -40, 0, -16, [[0, "rgba(255,255,255,0.55)"], [1, "rgba(255,255,255,0)"]]),
    bunBottom: lin(ctx, 0, -12, 0, 0, [[0, "#f0b25e"], [0.6, "#c97b2c"], [1, "#8a4a16"]]),
    patty: lin(ctx, 0, -10, 0, 0, [[0, "#7a3b1a"], [0.5, "#5a2a12"], [1, "#3a1a0a"]]),
    cheese: lin(ctx, 0, -4, 0, 6, [[0, "#ffe27a"], [0.5, "#f7b928"], [1, "#e09412"]]),
    tomato: lin(ctx, 0, -5, 0, 0, [[0, "#ff6b55"], [1, "#b8231a"]]),
    plate: rad(ctx, -20, -4, 2, 0, 0, 70, [[0, "#fff6d0"], [0.5, GOLD], [1, "#a8781c"]]),
    // victory (front view)
    vSuit: rad(ctx, -8, -50, 4, 0, -36, 40, [[0, SUIT_LIGHT], [0.6, SUIT], [1, SUIT_DARK]]),
    vHead: rad(ctx, -8, -96, 4, 0, -88, 30, [[0, FUR_LIGHT], [0.6, FUR], [1, FUR_DARK]]),
  };
  gradCache.set(ctx, g);
  return g;
}

/* ------------------------------- burger ----------------------------------- */

const GREEN = ["#2f9e44", "#69db7c", "#b2f2bb"] as const;

/** One ingredient layer in burger unit space; returns its height. Top of layer at y. */
function layer(ctx: Ctx, G: Grads, kind: Ingredient, y: number, i: number): number {
  const wob = (i % 2 ? 1 : -1) * 1.5;
  switch (kind) {
    case "cheese": {
      ctx.fillStyle = G.cheese;
      ctx.save(); ctx.translate(0, y);
      ctx.beginPath(); ctx.moveTo(-47, 0); ctx.lineTo(47, 0); ctx.lineTo(47, 3);
      // melted drips
      ctx.quadraticCurveTo(40, 3, 38, 10); ctx.quadraticCurveTo(35, 14, 32, 4);
      ctx.lineTo(8, 4); ctx.quadraticCurveTo(4, 4, 3, 12); ctx.quadraticCurveTo(0, 16, -3, 5);
      ctx.lineTo(-26, 5); ctx.quadraticCurveTo(-30, 5, -31, 11); ctx.quadraticCurveTo(-34, 14, -37, 4);
      ctx.lineTo(-47, 3); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.55)"; ctx.fillRect(-30, 0.6, 22, 1.2);
      ctx.restore();
      return 4;
    }
    case "lettuce": {
      ctx.save(); ctx.translate(wob, y);
      for (let k = 0; k < 3; k++) {
        ctx.fillStyle = GREEN[k]!;
        const w = 52 - k * 4, dy = k * 1.2;
        ctx.beginPath(); ctx.moveTo(-w, dy + 3);
        for (let j = 0; j <= 10; j++) { const x = -w + (2 * w * j) / 10; ctx.quadraticCurveTo(x - w / 10, dy + (j % 2 ? 7 : -1), x, dy + 3); }
        ctx.lineTo(w - 4, dy + 6); ctx.lineTo(-w + 4, dy + 6); ctx.closePath(); ctx.fill();
      }
      ctx.restore();
      return 6;
    }
    case "tomato": {
      ctx.save(); ctx.translate(0, y);
      for (const cx of [-22, 22]) {
        ctx.fillStyle = G.tomato; ctx.beginPath(); ctx.ellipse(cx, 2.5, 25, 3.5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffd36a";
        for (const sx of [-12, -4, 4, 12]) { ctx.beginPath(); ctx.ellipse(cx + sx, 2, 1.6, 0.9, 0, 0, Math.PI * 2); ctx.fill(); }
        ctx.fillStyle = "rgba(255,255,255,0.45)"; ctx.beginPath(); ctx.ellipse(cx - 10, 0.8, 7, 0.8, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      return 5;
    }
    case "cucumber": {
      ctx.save(); ctx.translate(0, y);
      for (const cx of [-30, -10, 10, 30]) {
        ctx.fillStyle = "#1f6f3a"; ctx.beginPath(); ctx.ellipse(cx, 2, 11, 2.6, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#b9e4a0"; ctx.beginPath(); ctx.ellipse(cx, 1.6, 9, 1.8, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#e9f7dc"; ctx.beginPath(); ctx.ellipse(cx, 1.6, 3, 0.8, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      return 4;
    }
    case "sausage": {
      ctx.save(); ctx.translate(0, y);
      ctx.fillStyle = G.patty; ctx.beginPath(); ctx.roundRect(-46, 0, 92, 8, 4); ctx.fill();
      ctx.strokeStyle = "#2a1006"; ctx.lineWidth = 1.4;
      for (const gx of [-30, -14, 2, 18, 34]) { ctx.beginPath(); ctx.moveTo(gx - 4, 1.5); ctx.lineTo(gx + 4, 6.5); ctx.stroke(); }
      ctx.fillStyle = "rgba(255,190,140,0.35)"; ctx.fillRect(-38, 1, 60, 1);
      ctx.restore();
      return 8;
    }
    case "sauce": {
      ctx.save(); ctx.translate(0, y);
      ctx.fillStyle = "#c81e1e";
      ctx.beginPath(); ctx.moveTo(-46, 0); ctx.lineTo(46, 0); ctx.lineTo(46, 2);
      ctx.quadraticCurveTo(22, 2, 20, 7); ctx.quadraticCurveTo(18, 9, 16, 3);
      ctx.lineTo(-14, 3); ctx.quadraticCurveTo(-16, 8, -19, 3); ctx.lineTo(-46, 2); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.6)"; ctx.beginPath(); ctx.ellipse(-20, 1, 10, 0.7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return 3;
    }
    case "mayo": {
      ctx.save(); ctx.translate(0, y);
      ctx.strokeStyle = "#fffaf0"; ctx.lineWidth = 3; ctx.lineCap = "round";
      ctx.beginPath(); ctx.moveTo(-44, 2);
      for (let j = 1; j <= 8; j++) ctx.quadraticCurveTo(-44 + j * 11 - 5.5, j % 2 ? -1 : 5, -44 + j * 11, 2);
      ctx.stroke();
      ctx.strokeStyle = "rgba(220,205,170,0.8)"; ctx.lineWidth = 0.8; ctx.stroke();
      ctx.lineCap = "butt";
      ctx.restore();
      return 3;
    }
    case "carrot": {
      ctx.save(); ctx.translate(0, y);
      for (const cx of [-32, -11, 11, 32]) {
        ctx.fillStyle = "#e8590c"; ctx.beginPath(); ctx.ellipse(cx, 2, 10, 2.4, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#ffa94d"; ctx.beginPath(); ctx.ellipse(cx, 1.6, 6, 1.4, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.restore();
      return 4;
    }
    case "onion": {
      ctx.save(); ctx.translate(0, y);
      ctx.lineWidth = 2.2;
      for (const cx of [-30, -10, 10, 30]) {
        ctx.strokeStyle = "#8e3a7c"; ctx.beginPath(); ctx.ellipse(cx, 2, 10, 2.6, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.strokeStyle = "#f2dcec"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.ellipse(cx, 2, 6.5, 1.6, 0, 0, Math.PI * 2); ctx.stroke();
        ctx.lineWidth = 2.2;
      }
      ctx.restore();
      return 4;
    }
    case "capsicum": {
      ctx.save(); ctx.translate(wob, y);
      for (const cx of [-28, 0, 28]) {
        ctx.fillStyle = "#1f7a32"; ctx.beginPath(); ctx.ellipse(cx, 2, 13, 3, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#b9e4a0"; ctx.beginPath(); ctx.ellipse(cx, 1.8, 10, 2, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = "#1f7a32"; ctx.fillRect(cx - 0.6, 0.2, 1.2, 3.4);
      }
      ctx.restore();
      return 4;
    }
    default: return 0;
  }
}

/**
 * Juicy burger centred at (x, bottomY) with `w` px width. Always has a grilled
 * patty; collected `layers` stack above it in order (verified game state only).
 */
function burger(ctx: Ctx, x: number, bottomY: number, w: number, layers: readonly Ingredient[], plate: boolean) {
  const G = grads(ctx);
  ctx.save();
  ctx.translate(x, bottomY); ctx.scale(w / 100, w / 100);
  if (plate) {
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(0, 4, 64, 9, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = G.plate; ctx.beginPath(); ctx.ellipse(0, 0, 62, 8, 0, 0, Math.PI * 2); ctx.fill();
  }
  // bottom bun
  ctx.fillStyle = G.bunBottom; ctx.beginPath(); ctx.roundRect(-46, -12, 92, 12, [3, 3, 10, 10]); ctx.fill();
  ctx.fillStyle = "rgba(255,230,180,0.35)"; ctx.fillRect(-42, -11, 84, 1.5);
  let y = -12;
  // grilled beef patty (always present)
  y -= 10;
  ctx.fillStyle = G.patty; ctx.beginPath();
  ctx.moveTo(-48, y + 3); ctx.quadraticCurveTo(-50, y + 10, -44, y + 10.5); ctx.lineTo(44, y + 10.5);
  ctx.quadraticCurveTo(50, y + 10, 48, y + 3); ctx.quadraticCurveTo(46, y - 0.5, 38, y); ctx.lineTo(-38, y);
  ctx.quadraticCurveTo(-46, y - 0.5, -48, y + 3); ctx.fill();
  ctx.strokeStyle = "#241005"; ctx.lineWidth = 1.6;
  for (const gx of [-32, -16, 0, 16, 32]) { ctx.beginPath(); ctx.moveTo(gx - 5, y + 2); ctx.lineTo(gx + 5, y + 8); ctx.stroke(); }
  ctx.fillStyle = "rgba(170,90,50,0.6)";
  for (const [dx, dy] of [[-22, 4], [10, 6], [28, 3], [-4, 7]] as const) { ctx.beginPath(); ctx.arc(dx, y + dy, 1, 0, Math.PI * 2); ctx.fill(); }
  // collected layers (latest on top)
  for (let i = 0; i < layers.length; i++) {
    const h = layer(ctx, G, layers[i]!, y - 4, i);
    y -= Math.max(3, h * 0.8);
  }
  // top bun
  ctx.fillStyle = G.bunTop; ctx.beginPath();
  ctx.moveTo(-48, y); ctx.bezierCurveTo(-48, y - 34, 48, y - 34, 48, y);
  ctx.quadraticCurveTo(0, y + 4, -48, y); ctx.fill();
  ctx.save(); ctx.translate(0, y + 12);
  ctx.fillStyle = G.bunGloss; ctx.beginPath(); ctx.ellipse(-12, -32, 22, 6, -0.15, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  // sesame seeds with shadow
  for (const [dx, dy, r] of [[-26, 10, 0.5], [-12, 18, -0.4], [4, 21, 0.3], [20, 16, -0.6], [32, 8, 0.4], [-34, 4, -0.3], [-2, 11, 0.7], [14, 6, -0.2], [-18, 6, 0.2]] as const) {
    ctx.fillStyle = "rgba(110,55,15,0.45)"; ctx.beginPath(); ctx.ellipse(dx + 0.6, y - dy + 0.8, 2.6, 1.3, r, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff4d6"; ctx.beginPath(); ctx.ellipse(dx, y - dy, 2.6, 1.3, r, 0, Math.PI * 2); ctx.fill();
  }
  ctx.restore();
}

/* ---------------------- FLAMIO superhero cat runner ------------------------ */
/*
 * Rear view of the FLAMIO superhero cat sprinting down the road (facing away
 * from the camera, toward the gates). Both paws hold the burger centrally in
 * front of the chest; the burger is wider than the torso so it reads on both
 * sides. Unit space: ground contact at y = 0, ~130 units tall. Visual only.
 */
const CAPE_TEXT = "#fff7ed";

export function drawMascot(ctx: Ctx, a: MascotAnim, x: number, footY: number, size: number, layers: readonly Ingredient[], now: number, travel = now / 300) {
  ctx.save();
  try {
    const u = size / 100;
    const sw = (now - a.switchAt) / SWITCH_MS;
    const dir = Math.sign(a.toX - a.fromX);
    const bank = sw >= 0 && sw < 1.6 ? dir * Math.sin(Math.min(1, sw / 1.6) * Math.PI) * MAX_BANK * 1.4 : 0;
    // stride phase driven by track travel so running speed matches the road
    const ph = travel * Math.PI * 2 * 1.2;
    const stride = Math.sin(ph);
    const bounce = Math.abs(Math.cos(ph)) * 5; // body rises at mid-stride
    const ct = (now - a.collectAt) / COLLECT_MS, ft = (now - a.flinchAt) / FLINCH_MS;
    const collecting = ct >= 0 && ct < 1.5, flinching = ft >= 0 && ft < 1;
    const wob = flinching ? Math.sin(ft * Math.PI * 6) * 0.07 * (1 - ft) : 0;

    // ground shadow shrinks as the body lifts
    ctx.fillStyle = "rgba(0,0,0,0.3)";
    ctx.beginPath(); ctx.ellipse(x + 4 * u, footY - 2 * u, (26 - bounce) * u, 7 * u, 0, 0, Math.PI * 2); ctx.fill();

    ctx.translate(x, footY); ctx.rotate(bank + wob); ctx.scale(u, u);

    // legs: alternating stride (rear view — a lifted leg shortens and its foot sole shows)
    for (const sd of [-1, 1] as const) {
      const lift = Math.max(0, stride * sd); // 0..1 this leg is swinging forward/up
      const kneeY = -26 - lift * 6, footYL = -lift * 14;
      ctx.lineCap = "round";
      ctx.strokeStyle = SUIT_DARK; ctx.lineWidth = 11;
      ctx.beginPath(); ctx.moveTo(sd * 8, -44 - bounce); ctx.quadraticCurveTo(sd * 11, kneeY - bounce * 0.5, sd * 9, footYL - 4); ctx.stroke();
      ctx.strokeStyle = SUIT; ctx.lineWidth = 8; ctx.stroke();
      // boot / paw sole
      ctx.fillStyle = CAPE_DARK; ctx.beginPath(); ctx.ellipse(sd * 9, footYL - 3, 6.5, 4 + lift * 1.5, 0, 0, Math.PI * 2); ctx.fill();
      if (lift > 0.3) { ctx.fillStyle = PINK; ctx.beginPath(); ctx.ellipse(sd * 9, footYL - 3, 3, 2, 0, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.lineCap = "butt";

    ctx.translate(0, -bounce);

    // tail swishing out from under the cape
    const swish = Math.sin(now / 240) * 4 + stride * 2;
    ctx.lineCap = "round";
    ctx.strokeStyle = FUR_DARK; ctx.lineWidth = 5.5;
    ctx.beginPath(); ctx.moveTo(4, -46); ctx.quadraticCurveTo(22 + swish, -44, 26 + swish, -64); ctx.stroke();
    ctx.strokeStyle = FUR; ctx.lineWidth = 3.8; ctx.stroke();
    ctx.lineCap = "butt";

    // burger held centrally in front of the chest (drawn first: body occludes the middle)
    const stack = layers.length > 8 ? layers.slice(-8) : layers;
    const lift = collecting ? Math.sin(Math.min(1, ct) * Math.PI) * 4 : 0;
    burger(ctx, 0, -78 - lift + stride * 0.8, 58, stack, false);
    if (collecting) { ctx.fillStyle = `rgba(255,190,90,${0.45 * (1 - Math.min(1, ct / 1.5))})`; ctx.beginPath(); ctx.ellipse(0, -78, 28, 9, 0, 0, Math.PI * 2); ctx.fill(); }

    // torso (charcoal hero suit)
    ctx.fillStyle = SUIT; ctx.beginPath(); ctx.moveTo(-13, -44); ctx.quadraticCurveTo(-16, -84, -11, -94); ctx.lineTo(11, -94); ctx.quadraticCurveTo(16, -84, 13, -44); ctx.closePath(); ctx.fill();
    ctx.fillStyle = GOLD; ctx.fillRect(-13, -50, 26, 3); // belt

    // arms: from shoulders, wrapping forward around the burger; paws on its sides
    for (const sd of [-1, 1] as const) {
      const pump = stride * sd * 1.2;
      ctx.lineCap = "round";
      ctx.strokeStyle = SUIT_DARK; ctx.lineWidth = 7;
      ctx.beginPath(); ctx.moveTo(sd * 11, -88); ctx.quadraticCurveTo(sd * 23, -82 + pump, sd * 27, -80 + pump * 0.5); ctx.stroke();
      ctx.strokeStyle = SUIT_LIGHT; ctx.lineWidth = 4.5; ctx.stroke();
      ctx.fillStyle = FUR; ctx.beginPath(); ctx.ellipse(sd * 27, -80 + pump * 0.5, 4.5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(sd * 26, -79 + pump * 0.5, 2.6, 2, 0, 0, Math.PI * 2); ctx.fill();
    }
    ctx.lineCap = "butt";

    // cape: flutters behind (toward camera), wave amplitude grows with stride + lane change
    const flap = Math.sin(now / 110) * 3 + stride * 2 + bank * 30;
    ctx.fillStyle = CAPE_DARK;
    ctx.beginPath(); ctx.moveTo(-12, -93);
    ctx.quadraticCurveTo(-24 - flap * 0.3, -66, -21 + flap * 0.5, -34);
    ctx.quadraticCurveTo(-10, -30 + flap * 0.6, 0, -33);
    ctx.quadraticCurveTo(10, -30 - flap * 0.6, 21 + flap * 0.5, -34);
    ctx.quadraticCurveTo(24 - flap * 0.3, -66, 12, -93); ctx.closePath(); ctx.fill();
    ctx.fillStyle = CAPE;
    ctx.beginPath(); ctx.moveTo(-11, -93);
    ctx.quadraticCurveTo(-21 - flap * 0.3, -66, -18 + flap * 0.5, -37);
    ctx.quadraticCurveTo(-9, -33 + flap * 0.6, 0, -36);
    ctx.quadraticCurveTo(9, -33 - flap * 0.6, 18 + flap * 0.5, -37);
    ctx.quadraticCurveTo(21 - flap * 0.3, -66, 11, -93); ctx.closePath(); ctx.fill();
    // FLAMIO branding on the cape
    ctx.save(); ctx.translate(flap * 0.15, -62); ctx.rotate(flap * 0.006);
    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.font = "900 9px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(MASCOT_BRANDING.cape, 0.6, 0.8);
    ctx.fillStyle = CAPE_TEXT; ctx.fillText(MASCOT_BRANDING.cape, 0, 0);
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.moveTo(0, -14); ctx.lineTo(4, -8); ctx.lineTo(0, -10); ctx.lineTo(-4, -8); ctx.closePath(); ctx.fill(); // flame mark
    ctx.restore();
    // cape clasp
    ctx.fillStyle = GOLD; for (const sd of [-1, 1]) { ctx.beginPath(); ctx.arc(sd * 9, -92, 2.2, 0, Math.PI * 2); ctx.fill(); }

    // head from behind, counter-tilting to stay level; occasional glance back
    const look = glanceAmount(now);
    ctx.save(); ctx.translate(0, -104); ctx.rotate(-bank * 0.5);
    for (const sd of [-1, 1]) {
      ctx.fillStyle = FUR_DARK; ctx.beginPath(); ctx.moveTo(sd * 3, -8); ctx.lineTo(sd * 10, -18); ctx.lineTo(sd * 11, -4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PINK; ctx.beginPath(); ctx.moveTo(sd * 5, -8); ctx.lineTo(sd * 9.5, -15); ctx.lineTo(sd * 9.5, -6); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = FUR; ctx.beginPath(); ctx.ellipse(0, 0, 11.5, 10.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = FUR_DARK; for (const k of [-5, 0, 5]) { ctx.beginPath(); ctx.ellipse(k, -5, 1.4, 4, 0, 0, Math.PI * 2); ctx.fill(); }
    // hero mask ties fluttering behind the head
    ctx.strokeStyle = MASK_DARK; ctx.lineWidth = 2; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(-10, 1); ctx.lineTo(10, 1); ctx.stroke();
    ctx.strokeStyle = MASK; ctx.lineWidth = 1.6;
    ctx.beginPath(); ctx.moveTo(0, 1); ctx.quadraticCurveTo(4 + flap * 0.4, 6, 8 + flap * 0.6, 10); ctx.moveTo(0, 1); ctx.quadraticCurveTo(-3 + flap * 0.4, 7, -5 + flap * 0.6, 11); ctx.stroke();
    ctx.lineCap = "butt";
    if (look > 0.05) { // cheek + eye peeking around during the glance
      ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(9 * look, 3, 4 * look, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#1c1917"; ctx.beginPath(); ctx.arc(9 * look, -1, 1.3 * look, 0, Math.PI * 2); ctx.fill();
    }
    ctx.restore();

    if (flinching) { ctx.fillStyle = `rgba(120,140,90,${0.4 * (1 - ft)})`; for (let k = 0; k < 3; k++) { ctx.beginPath(); ctx.arc(-14 + k * 14, -60 - ft * 30 - k * 6, 8 + ft * 10, 0, Math.PI * 2); ctx.fill(); } }
  } catch { /* procedural fallback */ }
  ctx.restore();
}


/* ------------------------------- victory ---------------------------------- */

export { VICTORY_MS } from "@/lib/burger-boost-victory";

/**
 * Front-facing result scene: the FLAMIO superhero cat leaps,
 * raises the burger, bites, chews and celebrates (or looks disappointed on a
 * loss). Pose is a pure function of `t`, so it is frame-rate safe.
 */
export function drawVictory(ctx: Ctx, W: number, H: number, t: number, layers: readonly Ingredient[], loss = false) {
  const p = victoryPose(t, loss);
  ctx.save();
  try {
    ctx.clearRect(0, 0, W, H);
    const u = Math.min(W, H) / 170;
    ctx.globalAlpha = 0.25 + 0.75 * p.appear;
    ctx.translate(W / 2, H * 0.95);
    const sc = 0.9 + 0.1 * p.appear;
    ctx.scale(u * sc, u * sc);
    const drop = p.headDrop * 7;
    const bob = p.chew * 1.6 - p.cheer * 4;

    ctx.fillStyle = "rgba(0,0,0,0.25)"; ctx.beginPath(); ctx.ellipse(0, 0, 70, 8, 0, 0, Math.PI * 2); ctx.fill();
    // celebration leap (cheer phase) — visible hop, pure function of t
    const leap = p.sad ? 0 : Math.abs(Math.sin(t / 170)) * 18 * p.cheer;
    ctx.translate(0, -leap);
    // FLAMIO cape behind the body
    ctx.fillStyle = CAPE; ctx.beginPath(); ctx.moveTo(-20, -84); ctx.quadraticCurveTo(-40, -40, -34 + Math.sin(t / 120) * 4, -6); ctx.lineTo(34 + Math.sin(t / 120) * 4, -6); ctx.quadraticCurveTo(40, -40, 20, -84); ctx.closePath(); ctx.fill();
    // legs + boots
    ctx.fillStyle = "#1e293b"; for (const s of [-1, 1]) ctx.fillRect(s * 11 - 6, -40, 12, 36);
    ctx.fillStyle = "#0c0a09"; for (const s of [-1, 1]) { ctx.beginPath(); ctx.roundRect(s * 11 - 8, -7, 16, 7, 3); ctx.fill(); }
    // jacket torso
    const ty = -40 + drop * 0.4 + bob * 0.4;
    ctx.fillStyle = SUIT; ctx.beginPath(); ctx.moveTo(-24, ty); ctx.quadraticCurveTo(-28, ty - 36, -18, ty - 44); ctx.lineTo(18, ty - 44); ctx.quadraticCurveTo(28, ty - 36, 24, ty); ctx.closePath(); ctx.fill();
    ctx.fillStyle = GOLD; ctx.fillRect(-25, ty - 14, 50, 3);
    ctx.fillStyle = "#fff7ed"; ctx.font = "900 8px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("FLAMIO", 0, ty - 6);

    // head: original FLAMIO cartoon cat (orange tabby, big glossy eyes)
    const hy = ty - 60 + drop;
    const FUR = "#f59e3b", FUR_D = "#c2671c", CREAM = "#fff4e0", INK = "#1c1917";
    // ears (droop on loss)
    const earT = p.sad ? 0.5 : -0.05 * p.cheer;
    for (const s of [-1, 1]) {
      ctx.save(); ctx.translate(s * 14, hy - 14); ctx.rotate(s * (0.25 + earT));
      ctx.fillStyle = FUR; ctx.beginPath(); ctx.moveTo(-8, 4); ctx.quadraticCurveTo(-2, -20, 2, -18); ctx.quadraticCurveTo(8, -8, 8, 4); ctx.closePath(); ctx.fill();
      ctx.fillStyle = "#fda4af"; ctx.beginPath(); ctx.moveTo(-4, 2); ctx.quadraticCurveTo(-1, -12, 1.5, -11); ctx.quadraticCurveTo(5, -5, 4.5, 2); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    // head shape with cheek fluff
    ctx.fillStyle = FUR; ctx.beginPath();
    ctx.moveTo(-22, hy); ctx.quadraticCurveTo(-24, hy - 22, 0, hy - 23); ctx.quadraticCurveTo(24, hy - 22, 22, hy);
    ctx.lineTo(25, hy + 6); ctx.lineTo(20, hy + 9); ctx.quadraticCurveTo(12, hy + 20, 0, hy + 20); ctx.quadraticCurveTo(-12, hy + 20, -20, hy + 9); ctx.lineTo(-25, hy + 6); ctx.closePath(); ctx.fill();
    // tabby stripes on forehead
    ctx.fillStyle = FUR_D; for (const k of [-6, 0, 6]) { ctx.beginPath(); ctx.ellipse(k, hy - 18, 1.6, 4.5, k * 0.04, 0, Math.PI * 2); ctx.fill(); }
    // muzzle
    ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(-5.5, hy + 10, 8, 6.5, 0, 0, Math.PI * 2); ctx.ellipse(5.5, hy + 10, 8, 6.5, 0, 0, Math.PI * 2); ctx.fill();
    // FLAMIO cap
    ctx.fillStyle = CAPE; ctx.beginPath(); ctx.arc(0, hy - 16, 15, Math.PI, 0); ctx.closePath(); ctx.fill();
    ctx.fillStyle = CAPE_DARK; ctx.beginPath(); ctx.ellipse(6, hy - 16, 16, 3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#fff7ed"; ctx.font = "900 5px system-ui, sans-serif"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("FLAMIO", 0, hy - 22);
    // eyes
    const happy = !p.sad && (p.chew !== 0 || p.cheer > 0.4);
    for (const s of [-1, 1]) {
      const ex = s * 9, ey = hy - 3;
      if (happy) { ctx.strokeStyle = INK; ctx.lineWidth = 2.2; ctx.lineCap = "round"; ctx.beginPath(); ctx.arc(ex, ey + 2, 4.5, Math.PI * 1.15, Math.PI * 1.85); ctx.stroke(); continue; }
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.ellipse(ex, ey, 6, p.sad ? 5 : 7, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#65a30d"; ctx.beginPath(); ctx.ellipse(ex + s * 0.5, ey + (p.sad ? 1.5 : 0.5), 4, p.sad ? 4 : 5.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = INK; ctx.beginPath(); ctx.ellipse(ex + s * 0.5, ey + (p.sad ? 1.5 : 0.5), 1.8, p.sad ? 3 : 4.2, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffffff"; ctx.beginPath(); ctx.arc(ex - 1.6, ey - 2, 1.5, 0, Math.PI * 2); ctx.fill();
      if (p.sad) { ctx.fillStyle = FUR; ctx.beginPath(); ctx.ellipse(ex, ey - 4.5, 7, 3.4, s * -0.25, 0, Math.PI * 2); ctx.fill(); } // heavy eyelids
    }
    // brows
    ctx.strokeStyle = FUR_D; ctx.lineWidth = 1.6; ctx.lineCap = "round";
    for (const s of [-1, 1]) { ctx.beginPath(); if (p.sad) { ctx.moveTo(s * 4, hy - 10); ctx.lineTo(s * 13, hy - 8); } else { ctx.moveTo(s * 5, hy - 12 - p.cheer); ctx.quadraticCurveTo(s * 9, hy - 14 - p.cheer * 2, s * 13, hy - 12); } ctx.stroke(); }
    // nose
    ctx.fillStyle = "#f472b6"; ctx.beginPath(); ctx.moveTo(-2.8, hy + 5); ctx.lineTo(2.8, hy + 5); ctx.lineTo(0, hy + 8); ctx.closePath(); ctx.fill();
    // mouth
    ctx.strokeStyle = INK; ctx.lineWidth = 1.3;
    if (p.sad) { ctx.beginPath(); ctx.arc(0, hy + 16, 4, 1.15 * Math.PI, 1.85 * Math.PI); ctx.stroke(); }
    else if (p.mouthOpen > 0.05) { ctx.fillStyle = "#7f1d1d"; ctx.beginPath(); ctx.ellipse(0, hy + 12, 4.5, 1 + p.mouthOpen * 5, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fb7185"; ctx.beginPath(); ctx.ellipse(0, hy + 13 + p.mouthOpen * 2.5, 2.8, 1.4 * p.mouthOpen + 0.3, 0, 0, Math.PI * 2); ctx.fill(); }
    else { const c = p.chew * 0.8; ctx.beginPath(); ctx.moveTo(0, hy + 8); ctx.quadraticCurveTo(-3, hy + 12 + c, -6, hy + 10 + c); ctx.moveTo(0, hy + 8); ctx.quadraticCurveTo(3, hy + 12 - c, 6, hy + 10 - c); ctx.stroke(); }
    // whiskers
    ctx.strokeStyle = "rgba(28,25,23,0.55)"; ctx.lineWidth = 0.8;
    for (const s of [-1, 1]) for (const k of [-1, 0, 1]) { ctx.beginPath(); ctx.moveTo(s * 11, hy + 9 + k * 2); ctx.lineTo(s * 26, hy + 7 + k * 4 + (p.sad ? 2 : 0)); ctx.stroke(); }
    // blush (chewing / celebrating)
    if (!p.sad && (p.chew !== 0 || p.cheer > 0)) { ctx.fillStyle = "rgba(251,113,133,0.45)"; for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 15, hy + 7 + Math.abs(p.chew), 3.5, 2.2, 0, 0, Math.PI * 2); ctx.fill(); } }
    ctx.lineCap = "butt";

    // burger: both hands hold it; rises to mouth for the bite, held high on celebrate
    const restY = p.sad ? -14 : -34;
    const byy = restY - p.lift * 40 - p.cheer * 34 + bob * 0.6;
    const stack = layers.length > 10 ? layers.slice(-10) : layers;
    ctx.lineCap = "round";
    for (const s of [-1, 1]) {
      ctx.strokeStyle = SUIT_DARK; ctx.lineWidth = 9; ctx.beginPath(); ctx.moveTo(s * 21, ty - 38); ctx.quadraticCurveTo(s * 34, byy - 4, s * 25, byy - 10); ctx.stroke();
      ctx.strokeStyle = SUIT_LIGHT; ctx.lineWidth = 7; ctx.stroke();
    }
    ctx.lineCap = "butt";
    ctx.save();
    if (p.bites) { // bite cut-out clipped from the burger only (never erases the rider)
      ctx.beginPath(); ctx.rect(-120, -260, 240, 280);
      ctx.moveTo(2, byy - 40); ctx.arc(-6, byy - 40, 8, 0, Math.PI * 2);
      ctx.moveTo(11, byy - 42); ctx.arc(4, byy - 42, 7, 0, Math.PI * 2);
      ctx.clip("evenodd");
    }
    burger(ctx, 0, byy, 46, stack, false);
    ctx.restore();
    for (const s of [-1, 1]) { ctx.fillStyle = "#f59e3b"; ctx.beginPath(); ctx.arc(s * 24, byy - 10, 5, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#fda4af"; ctx.beginPath(); ctx.arc(s * 24, byy - 9, 2, 0, Math.PI * 2); ctx.fill(); }
    if (p.cheer > 0) {
      ctx.fillStyle = `rgba(251,191,36,${p.cheer})`;
      for (const [x, y] of [[-56, -120], [58, -116], [-64, -76], [66, -70], [0, -150]] as const) { ctx.beginPath(); ctx.moveTo(x, y - 6); ctx.lineTo(x + 2.4, y); ctx.lineTo(x, y + 6); ctx.lineTo(x - 2.4, y); ctx.closePath(); ctx.fill(); }
    }
  } catch { /* procedural fallback */ }
  ctx.restore();
}
