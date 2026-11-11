/**
 * FLAMIO Cat mascot (procedural Canvas 2D, visual only, browser only).
 * Animation is driven by the caller's existing `now` timestamp and by
 * already-resolved game state (lane, layers, spoiledHits). It never decides
 * lanes, outcomes, score or timing.
 *
 * Everything is drawn in a fixed "unit space" (ctx.scale), so gradients are
 * created once per canvas context and reused every frame.
 */
import type { Ingredient, Lane } from "@/lib/burger-boost-rules";

type Ctx = CanvasRenderingContext2D;

/* palette */
const FUR = "#f7902f", FUR_DARK = "#cf5f10", FUR_LIGHT = "#ffb766", CREAM = "#fff1d8", PINK = "#ffb3a7";
const SUIT = "#23201e", SUIT_DARK = "#121010", SUIT_LIGHT = "#4a423d";

/** Approved visual spec (Step 48): charcoal suit, branding on jersey AND cape. */
export const MASCOT_PALETTE = { suit: SUIT, suitDark: SUIT_DARK, suitLight: SUIT_LIGHT } as const;
export const MASCOT_BRANDING = { jersey: "FLAMIO", cape: "FLAMIO" } as const;
/** Burger is held centred in front of the body (bx ≈ 4), never offset to one side. */
export const BURGER_GRIP = { bx: 4, by: -44, halfSpan: 15 } as const;
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

/* ----------------------------- running cat -------------------------------- */

function arcText(ctx: Ctx, word: string, cx: number, cy: number, radius: number, spread: number) {
  const n = word.length;
  for (let i = 0; i < n; i++) {
    const a = -Math.PI / 2 + (i - (n - 1) / 2) * spread;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius, cy + radius + Math.sin(a) * radius);
    ctx.rotate(a + Math.PI / 2);
    ctx.strokeText(word[i]!, 0, 0);
    ctx.fillText(word[i]!, 0, 0);
    ctx.restore();
  }
}

/** Rear three-quarter running cat at (x, footY). `size` ≈ body height in px. */
export function drawMascot(ctx: Ctx, a: MascotAnim, x: number, footY: number, size: number, layers: readonly Ingredient[], now: number) {
  const G = grads(ctx);
  ctx.save();
  try {
    const phase = (now % RUN_CYCLE_MS) / RUN_CYCLE_MS; // 0..1
    const frame = Math.floor(phase * 4); // 4-phase cycle
    const stride = Math.sin(phase * Math.PI * 2);
    let bob = Math.abs(Math.cos(phase * Math.PI * 2)) * 3.5;

    const sw = (now - a.switchAt) / SWITCH_MS;
    const dir = Math.sign(a.toX - a.fromX);
    const bank = sw < 1 ? dir * MAX_BANK * Math.sin(Math.PI * Math.min(1, Math.max(0, sw))) : 0;

    const ct = (now - a.collectAt) / COLLECT_MS;
    if (ct >= 0 && ct < 1) bob += Math.sin(ct * Math.PI) * 12;
    const ft = (now - a.flinchAt) / FLINCH_MS;
    const flinching = ft >= 0 && ft < 1;
    const recoil = flinching ? Math.sin(ft * Math.PI) * 8 : 0;
    const shake = flinching ? Math.sin(ft * 40) * 2 : 0;

    const u = size / 100;
    ctx.translate(x, footY);
    ctx.scale(u, u);
    ctx.translate(shake, -bob + recoil);
    ctx.rotate(bank);

    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(0, bob - recoil + 2, 32, 7, 0, 0, Math.PI * 2); ctx.fill();

    // tail (behind legs, swishes with stride)
    ctx.lineCap = "round";
    ctx.strokeStyle = FUR_DARK; ctx.lineWidth = 9;
    ctx.beginPath(); ctx.moveTo(-4, -32);
    ctx.bezierCurveTo(-28, -30, -34 + stride * 6, -54, -22 + stride * 9, -70); ctx.stroke();
    ctx.strokeStyle = FUR; ctx.lineWidth = 6.5; ctx.stroke();
    ctx.strokeStyle = CREAM; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.moveTo(-23 + stride * 9, -66); ctx.lineTo(-22 + stride * 9, -70); ctx.stroke();

    // legs: teal tights + orange boots with paw pads
    for (const side of [-1, 1] as const) {
      const lift = Math.max(0, stride * side) * 13;
      const lx = side * 11;
      ctx.fillStyle = G.leg;
      ctx.beginPath(); ctx.moveTo(lx - 7, -34); ctx.quadraticCurveTo(lx - 9, -18 - lift, lx - 6, -8 - lift);
      ctx.lineTo(lx + 6, -8 - lift); ctx.quadraticCurveTo(lx + 9, -18 - lift, lx + 7, -34); ctx.closePath(); ctx.fill();
      ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.roundRect(lx - 7, -12 - lift, 14, 6, 3); ctx.fill();
      ctx.fillStyle = FUR; ctx.beginPath(); ctx.ellipse(lx, -4 - lift, 8.5, 5.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = PINK; ctx.beginPath(); ctx.ellipse(lx, -2.5 - lift, 4.5, 2.6, 0, 0, Math.PI * 2); ctx.fill();
      for (const tx of [-4.5, 0, 4.5]) { ctx.beginPath(); ctx.arc(lx + tx, -6 - lift, 1.5, 0, Math.PI * 2); ctx.fill(); }
    }

    // cape: split flaps hanging from shoulders on both sides — the back stays visible
    const flap = stride * 3 + (flinching ? Math.sin(ft * 30) * 7 : 0);
    ctx.fillStyle = G.cape;
    for (const side of [-1, 1] as const) {
      const f = flap * side;
      ctx.beginPath();
      ctx.moveTo(side * 14, -80);
      ctx.quadraticCurveTo(side * 34 + f, -60, side * 32 + f * 1.6, -26);
      ctx.lineTo(side * 22 + f, -30);
      ctx.quadraticCurveTo(side * 22, -56, side * 10, -76);
      ctx.closePath(); ctx.fill();
    }
    // FLAMIO on the cape: small vertical lettering down each flap (balanced, readable)
    ctx.save();
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "900 6px system-ui, -apple-system, sans-serif";
    ctx.fillStyle = "#fff6c2"; ctx.strokeStyle = "#7a2400"; ctx.lineWidth = 1.4; ctx.lineJoin = "round";
    for (const side of [-1, 1] as const) {
      const f = flap * side;
      const letters = MASCOT_BRANDING.cape;
      for (let i = 0; i < letters.length; i++) {
        const k = i / (letters.length - 1);
        const lx = side * (24 + k * 5) + f * (0.4 + k), ly = -66 + k * 32;
        ctx.strokeText(letters[i]!, lx, ly); ctx.fillText(letters[i]!, lx, ly);
      }
    }
    ctx.restore();

    // torso (athletic, tapered)
    ctx.fillStyle = G.suit;
    ctx.beginPath(); ctx.moveTo(-17, -32);
    ctx.bezierCurveTo(-25, -46, -27, -70, -18, -80);
    ctx.quadraticCurveTo(0, -85, 18, -80);
    ctx.bezierCurveTo(27, -70, 25, -46, 17, -32);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = G.suitRim; ctx.fill();
    // orange side panels + gold belt
    ctx.strokeStyle = ACCENT; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-22, -70); ctx.quadraticCurveTo(-23, -50, -17, -36); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(22, -70); ctx.quadraticCurveTo(23, -50, 17, -36); ctx.stroke();
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.roundRect(-18, -38, 36, 4.5, 2); ctx.fill();
    ctx.fillStyle = ACCENT; ctx.beginPath(); ctx.roundRect(-4, -38.5, 8, 5.5, 1.5); ctx.fill();

    // FLAMIO — horizontal jersey lettering across the upper back, glowing
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = "900 13px system-ui, -apple-system, 'Segoe UI', sans-serif";
    ctx.lineJoin = "round"; ctx.lineWidth = 2.6; ctx.strokeStyle = "#5a1a00";
    ctx.shadowColor = "rgba(255,140,30,0.95)"; ctx.shadowBlur = 7 * u;
    ctx.fillStyle = G.letters;
    arcText(ctx, MASCOT_BRANDING.jersey, 0, -64, 60, 0.115);
    ctx.shadowBlur = 0;
    ctx.fillStyle = "rgba(255,255,255,0.35)"; ctx.font = "800 6px system-ui, sans-serif";
    ctx.fillText("10", 0, -50);

    // arms: both reach forward-right to grip the burger at chest height
    const { bx, by } = BURGER_GRIP;
    const grip = gripPoints(stride);
    ctx.lineCap = "round";
    for (const side of [-1, 1] as const) {
      const sx = side * 19, sy = -74;
      const p = side < 0 ? grip.left : grip.right;
      const hx = p.x, hy = p.y;
      ctx.strokeStyle = SUIT_DARK; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.quadraticCurveTo(sx + side * 4, (sy + hy) / 2, hx, hy); ctx.stroke();
      ctx.strokeStyle = SUIT; ctx.lineWidth = 7.5; ctx.stroke();
      ctx.strokeStyle = ACCENT; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(hx - (hx - sx) * 0.14, hy - (hy - sy) * 0.14); ctx.lineTo(hx - (hx - sx) * 0.08, hy - (hy - sy) * 0.08); ctx.stroke();
    }
    ctx.lineCap = "butt";

    // head (rear 3/4: back of head + right cheek, eye and whiskers)
    const hy = -98 + (frame % 2) * 1.2;
    // periodic backward glance: head turns over the shoulder; body/grip unaffected
    const glance = glanceAmount(now);
    ctx.save();
    if (glance > 0) { ctx.translate(-glance * 3, 0); ctx.rotate(-glance * 0.22); }
    for (const side of [-1, 1] as const) {
      ctx.fillStyle = FUR;
      ctx.beginPath(); ctx.moveTo(side * 6, hy - 13); ctx.quadraticCurveTo(side * 16, hy - 32, side * 21, hy - 30); ctx.quadraticCurveTo(side * 23, hy - 16, side * 20, hy - 5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PINK;
      ctx.beginPath(); ctx.moveTo(side * 10, hy - 13); ctx.quadraticCurveTo(side * 16, hy - 26, side * 19, hy - 25); ctx.quadraticCurveTo(side * 20, hy - 15, side * 18, hy - 9); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = G.head; ctx.beginPath(); ctx.ellipse(0, hy, 22, 19, 0, 0, Math.PI * 2); ctx.fill();
    // tabby stripes
    ctx.strokeStyle = FUR_DARK; ctx.lineWidth = 2.6; ctx.lineCap = "round";
    for (const dx of [-8, 0, 8]) { ctx.beginPath(); ctx.moveTo(dx, hy - 18); ctx.quadraticCurveTo(dx * 0.9 + 1, hy - 12, dx * 0.75, hy - 8); ctx.stroke(); }
    ctx.lineCap = "butt";
    // emerald mask band + flowing ties
    ctx.fillStyle = G.mask;
    ctx.beginPath(); ctx.moveTo(-22, hy - 4); ctx.quadraticCurveTo(0, hy - 7, 23, hy - 5); ctx.lineTo(23, hy + 2); ctx.quadraticCurveTo(0, hy, -22, hy + 3); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-19, hy - 2); ctx.quadraticCurveTo(-30, hy + 2 - flap, -34, hy + 7 - flap * 0.6); ctx.lineTo(-29, hy + 1); ctx.lineTo(-33, hy - 3 - flap * 0.5); ctx.closePath(); ctx.fill();
    // cheek + muzzle peek
    ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(18, hy + 7, 6.5, 6.5, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#ff8fa3"; ctx.beginPath(); ctx.ellipse(23.5, hy + 4.5, 1.8, 1.3, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "rgba(60,40,30,0.8)"; ctx.lineWidth = 0.9;
    ctx.beginPath(); ctx.moveTo(22, hy + 6); ctx.lineTo(34, hy + 3); ctx.moveTo(22, hy + 9); ctx.lineTo(34, hy + 10); ctx.stroke();
    // eye inside the mask
    if (flinching && ft < 0.5) {
      ctx.strokeStyle = "#0b2a1f"; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(14, hy - 2); ctx.lineTo(20, hy - 1); ctx.stroke();
    } else {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(18, hy - 1.5, 3, 2.4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#123"; ctx.beginPath(); ctx.ellipse(19.2, hy - 1.4, 1.4, 1.8, 0, 0, Math.PI * 2); ctx.fill();
    }

    ctx.restore(); // end head glance transform

    // burger gripped in both paws, centred in front of the body (last 10 layers)
    burger(ctx, bx, by + 8, 32, layers.length > 10 ? layers.slice(-10) : layers, false);
    // paws over the bun edges
    ctx.fillStyle = FUR;
    for (const side of [-1, 1] as const) {
      const p = side < 0 ? grip.left : grip.right;
      ctx.beginPath(); ctx.ellipse(p.x + side, p.y, 4.8, 5.5, 0, 0, Math.PI * 2); ctx.fill();
    }

    // collection star
    if (ct >= 0 && ct < 1) {
      ctx.globalAlpha = 1 - ct; ctx.fillStyle = "#ffd54a";
      const sx = bx, sy = -86 - ct * 16;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const ang = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? 3.5 : 8; ctx.lineTo(sx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr); }
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (flinching) { ctx.fillStyle = "rgba(160,90,255,0.35)"; ctx.beginPath(); ctx.arc(0, -60, 46 * (0.6 + ft * 0.6), 0, Math.PI * 2); ctx.fill(); }
  } catch { /* procedural fallback */ }
  ctx.restore();
}

/* ------------------------------- victory ---------------------------------- */

export const VICTORY_MS = 2600;

/**
 * Front-facing victory: turn → sit → bite. `t` = ms since the victory started.
 * Callers render it only after a confirmed completion (static final frame).
 */
export function drawVictory(ctx: Ctx, W: number, H: number, t: number, layers: readonly Ingredient[]) {
  const G = grads(ctx);
  ctx.save();
  try {
    ctx.clearRect(0, 0, W, H);
    const u = Math.min(W, H) / 180;
    const sit = ease((t - 500) / 500);
    const bite = t > 1100 ? Math.max(0, Math.sin(((t - 1100) / 700) * Math.PI)) : 0;
    const bites = Math.min(3, Math.floor(Math.max(0, t - 1100) / 700));
    const turn = ease(t / 500);
    ctx.translate(W / 2, H * 0.92);
    ctx.scale(u * (0.7 + 0.3 * turn), u);

    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(0, 0, 50, 9, 0, 0, Math.PI * 2); ctx.fill();
    // cape behind
    ctx.fillStyle = CAPE_DARK;
    ctx.beginPath(); ctx.moveTo(-26, -70); ctx.quadraticCurveTo(-56, -30, -46, -2); ctx.lineTo(46, -2); ctx.quadraticCurveTo(56, -30, 26, -70); ctx.closePath(); ctx.fill();
    // tail
    ctx.lineCap = "round"; ctx.strokeStyle = FUR; ctx.lineWidth = 8;
    ctx.beginPath(); ctx.moveTo(24, -8); ctx.bezierCurveTo(54, -10, 58, -40, 44, -56); ctx.stroke(); ctx.lineCap = "butt";
    // sitting body (teal suit)
    const by = sit * 7;
    ctx.fillStyle = G.vSuit; ctx.beginPath(); ctx.ellipse(0, -36 + by, 30, 36 - by, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = GOLD; ctx.beginPath(); ctx.roundRect(-26, -22 + by, 52, 5, 2.5); ctx.fill();
    // chest emblem: flame
    ctx.fillStyle = ACCENT;
    ctx.beginPath(); ctx.moveTo(0, -60 + by); ctx.quadraticCurveTo(10, -48 + by, 4, -38 + by); ctx.quadraticCurveTo(0, -44 + by, -4, -38 + by); ctx.quadraticCurveTo(-10, -48 + by, 0, -60 + by); ctx.fill();
    // feet
    ctx.fillStyle = FUR;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 16, -4, 12, 7, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = PINK; ctx.beginPath(); ctx.ellipse(s * 16, -3, 5, 3, 0, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = FUR; }
    // head
    const hy = -88 + by;
    for (const side of [-1, 1] as const) {
      ctx.fillStyle = FUR; ctx.beginPath(); ctx.moveTo(side * 8, hy - 14); ctx.quadraticCurveTo(side * 18, hy - 38, side * 25, hy - 34); ctx.quadraticCurveTo(side * 28, hy - 18, side * 25, hy - 6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = PINK; ctx.beginPath(); ctx.moveTo(side * 12, hy - 14); ctx.quadraticCurveTo(side * 19, hy - 31, side * 23, hy - 29); ctx.quadraticCurveTo(side * 24, hy - 18, side * 22, hy - 10); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = G.vHead; ctx.beginPath(); ctx.ellipse(0, hy, 27, 23, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(0, hy + 9, 14, 10, 0, 0, Math.PI * 2); ctx.fill();
    // emerald mask + happy eyes
    ctx.fillStyle = MASK; ctx.beginPath(); ctx.roundRect(-23, hy - 9, 46, 11, 5.5); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.4; ctx.lineCap = "round";
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 10, hy - 2, 4, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    ctx.fillStyle = "#e86a7a"; ctx.beginPath(); ctx.moveTo(-3, hy + 5); ctx.lineTo(3, hy + 5); ctx.lineTo(0, hy + 8); ctx.fill();
    ctx.strokeStyle = "#3a2a20"; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.arc(0, hy + 9, 4 + bite * 2, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    for (const s of [-1, 1]) for (const dy of [6, 10]) { ctx.beginPath(); ctx.moveTo(s * 14, hy + dy); ctx.lineTo(s * 30, hy + (dy - 2 + (dy - 8))); ctx.stroke(); }
    ctx.lineCap = "butt";
    // burger held at the mouth
    const byy = hy + 52 - bite * 18;
    burger(ctx, 0, byy, 56, layers.length > 12 ? layers.slice(-12) : layers, false);
    // real bite cut-outs from the top-right of the bun
    const topY = byy - (22 + Math.min(12, layers.length) * 3.5 + 16) * 0.56;
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (let i = 0; i < bites; i++) { ctx.beginPath(); ctx.arc(22 - i * 8, topY, 6.5, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    // paws gripping both sides
    ctx.fillStyle = FUR;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 28, byy - 10, 6, 7, 0, 0, Math.PI * 2); ctx.fill(); }
  } catch { /* procedural fallback */ }
  ctx.restore();
}
