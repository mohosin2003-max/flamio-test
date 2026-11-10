/**
 * FLAMIO Cat mascot (procedural Canvas 2D, visual only, browser only).
 * Animation is driven by the caller's existing `now` timestamp and by
 * already-resolved game state (lane, layers, spoiledHits). It never decides
 * lanes, outcomes, score or timing.
 */
import type { Ingredient, Lane } from "@/lib/burger-boost-rules";
import { LAYER_COLOR } from "./gates";

type Ctx = CanvasRenderingContext2D;

const FUR = "#f28a2e", FUR_DARK = "#c95f12", CREAM = "#fbefd6", SUIT = "#2a2624", SUIT_HI = "#3a3532";
const SEAM = "#f26b1d", CAPE = "#e8590c", CAPE_IN = "#b8430a", MASK = "#16a34a", GOLD = "#e8b23a";

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

/* ------------------------------ parts ------------------------------------ */

function burger(ctx: Ctx, x: number, y: number, w: number, layers: readonly Ingredient[]) {
  // golden platter
  ctx.fillStyle = GOLD; ctx.beginPath(); ctx.ellipse(x, y, w * 0.72, w * 0.14, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#fff1b8"; ctx.beginPath(); ctx.ellipse(x - w * 0.2, y - w * 0.03, w * 0.22, w * 0.04, 0, 0, Math.PI * 2); ctx.fill();
  let cy = y - w * 0.08;
  ctx.fillStyle = "#c9832f"; ctx.beginPath(); ctx.roundRect(x - w * 0.45, cy - w * 0.12, w * 0.9, w * 0.12, w * 0.06); ctx.fill();
  cy -= w * 0.12;
  const lh = Math.max(2, w * 0.075);
  for (let i = 0; i < layers.length; i++) {
    ctx.fillStyle = LAYER_COLOR[layers[i]!] ?? "#999";
    ctx.beginPath(); ctx.roundRect(x - w * 0.47, cy - lh, w * 0.94, lh, lh / 2); ctx.fill(); cy -= lh * 0.92;
  }
  ctx.fillStyle = "#e09a3e"; ctx.beginPath(); ctx.ellipse(x, cy, w * 0.47, w * 0.28, 0, Math.PI, 0); ctx.fill();
  ctx.fillStyle = "#fff3d6";
  for (const [dx, dy] of [[-0.2, -0.12], [0.05, -0.2], [0.22, -0.1], [-0.05, -0.08]] as const) {
    ctx.beginPath(); ctx.ellipse(x + dx * w, cy + dy * w, w * 0.03, w * 0.018, 0.4, 0, Math.PI * 2); ctx.fill();
  }
}

function capeShape(ctx: Ctx, sx: number, sy: number, len: number, flap: number, wide: number) {
  ctx.beginPath();
  ctx.moveTo(sx - wide * 0.5, sy);
  ctx.quadraticCurveTo(sx - wide * 0.85 - flap, sy + len * 0.55, sx - wide * 0.7 - flap * 1.4, sy + len);
  ctx.quadraticCurveTo(sx, sy + len * (0.9 + 0.06 * Math.sin(flap)), sx + wide * 0.7 + flap * 1.2, sy + len);
  ctx.quadraticCurveTo(sx + wide * 0.85 + flap, sy + len * 0.55, sx + wide * 0.5, sy);
  ctx.closePath();
}

/* ----------------------------- running cat -------------------------------- */

/** Rear three-quarter running cat at (x, footY). `size` ≈ body height in px. */
export function drawMascot(ctx: Ctx, a: MascotAnim, x: number, footY: number, size: number, layers: readonly Ingredient[], now: number) {
  ctx.save();
  try {
    const phase = (now % RUN_CYCLE_MS) / RUN_CYCLE_MS; // 0..1
    const frame = Math.floor(phase * 4); // 4-phase cycle
    const stride = Math.sin(phase * Math.PI * 2);
    let bob = Math.abs(Math.cos(phase * Math.PI * 2)) * size * 0.035;

    const sw = (now - a.switchAt) / SWITCH_MS;
    const dir = Math.sign(a.toX - a.fromX);
    const bank = sw < 1 ? dir * MAX_BANK * Math.sin(Math.PI * Math.min(1, Math.max(0, sw))) : 0;

    const ct = (now - a.collectAt) / COLLECT_MS;
    if (ct >= 0 && ct < 1) bob += Math.sin(ct * Math.PI) * size * 0.12;
    const ft = (now - a.flinchAt) / FLINCH_MS;
    const flinching = ft >= 0 && ft < 1;
    const recoil = flinching ? Math.sin(ft * Math.PI) * size * 0.08 : 0;
    const shake = flinching ? Math.sin(ft * 40) * size * 0.02 : 0;

    ctx.translate(x + shake, footY - bob + recoil);
    ctx.rotate(bank);
    const u = size / 100;

    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(0, bob - recoil + 2 * u, 30 * u, 7 * u, 0, 0, Math.PI * 2); ctx.fill();

    // legs (alternating)
    for (const side of [-1, 1] as const) {
      const lift = Math.max(0, stride * side) * 14 * u;
      const lx = side * 12 * u;
      ctx.fillStyle = SUIT; ctx.beginPath(); ctx.roundRect(lx - 7 * u, -30 * u, 14 * u, 26 * u - lift, 7 * u); ctx.fill();
      ctx.fillStyle = FUR; ctx.beginPath(); ctx.ellipse(lx, -4 * u - lift, 9 * u, 6 * u, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#ffc8a8"; ctx.beginPath(); ctx.ellipse(lx, -2 * u - lift, 5 * u, 3 * u, 0, 0, Math.PI * 2); ctx.fill(); // paw pad (rear view)
    }

    // tail
    ctx.strokeStyle = FUR; ctx.lineWidth = 7 * u; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(4 * u, -34 * u);
    ctx.bezierCurveTo(26 * u, -36 * u, 30 * u + stride * 6 * u, -58 * u, 22 * u + stride * 8 * u, -70 * u); ctx.stroke();
    ctx.strokeStyle = FUR_DARK; ctx.lineWidth = 3 * u;
    ctx.beginPath(); ctx.moveTo(24 * u, -50 * u); ctx.lineTo(28 * u, -54 * u); ctx.stroke();
    ctx.lineCap = "butt";

    // torso (suit)
    ctx.fillStyle = SUIT;
    ctx.beginPath(); ctx.moveTo(-20 * u, -30 * u);
    ctx.bezierCurveTo(-26 * u, -50 * u, -22 * u, -70 * u, -14 * u, -76 * u);
    ctx.lineTo(14 * u, -76 * u);
    ctx.bezierCurveTo(22 * u, -70 * u, 26 * u, -50 * u, 20 * u, -30 * u);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = SEAM; ctx.lineWidth = 2 * u;
    ctx.beginPath(); ctx.moveTo(0, -76 * u); ctx.lineTo(0, -32 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-20 * u, -36 * u); ctx.lineTo(20 * u, -36 * u); ctx.stroke(); // belt

    // cape (synced with run cycle, flutters on flinch)
    const flap = stride * 4 * u + (flinching ? Math.sin(ft * 30) * 8 * u : 0);
    capeShape(ctx, 0, -74 * u, 48 * u, flap, 40 * u);
    ctx.fillStyle = CAPE; ctx.fill();
    ctx.strokeStyle = CAPE_IN; ctx.lineWidth = 1.5 * u;
    ctx.beginPath(); ctx.moveTo(-10 * u, -70 * u); ctx.quadraticCurveTo(-14 * u - flap, -48 * u, -16 * u - flap, -30 * u); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10 * u, -70 * u); ctx.quadraticCurveTo(14 * u + flap, -48 * u, 16 * u + flap, -30 * u); ctx.stroke();
    // vertical FLAMIO lettering
    ctx.fillStyle = "#ffffff"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.font = `900 ${Math.max(5, 7.5 * u)}px system-ui, sans-serif`;
    const word = "FLAMIO";
    for (let i = 0; i < word.length; i++) ctx.fillText(word[i]!, flap * 0.3 * (i / 6), -66 * u + i * 7 * u);

    // left arm swinging, right arm raised holding burger platter
    ctx.fillStyle = SUIT;
    ctx.save(); ctx.translate(-18 * u, -70 * u); ctx.rotate(0.35 + stride * 0.35);
    ctx.beginPath(); ctx.roundRect(-5 * u, 0, 10 * u, 26 * u, 5 * u); ctx.fill();
    ctx.fillStyle = FUR; ctx.beginPath(); ctx.arc(0, 27 * u, 5.5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
    ctx.save(); ctx.translate(18 * u, -72 * u); ctx.rotate(-0.45);
    ctx.fillStyle = SUIT; ctx.beginPath(); ctx.roundRect(-5 * u, -30 * u, 10 * u, 32 * u, 5 * u); ctx.fill();
    ctx.fillStyle = SEAM; ctx.fillRect(-5 * u, -10 * u, 10 * u, 2 * u);
    ctx.fillStyle = FUR; ctx.beginPath(); ctx.arc(0, -31 * u, 5.5 * u, 0, Math.PI * 2); ctx.fill();
    ctx.restore();

    // head (back of head, 3/4: slight right turn shows cheek + mask edge)
    const hy = -92 * u + (frame % 2) * 1.2 * u;
    ctx.fillStyle = FUR;
    for (const side of [-1, 1] as const) { // ears
      ctx.beginPath(); ctx.moveTo(side * 6 * u, hy - 12 * u); ctx.lineTo(side * 19 * u, hy - 28 * u); ctx.lineTo(side * 20 * u, hy - 6 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = CREAM; ctx.beginPath(); ctx.moveTo(side * 10 * u, hy - 12 * u); ctx.lineTo(side * 17.5 * u, hy - 23 * u); ctx.lineTo(side * 18 * u, hy - 9 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = FUR;
    }
    ctx.beginPath(); ctx.ellipse(0, hy, 21 * u, 18 * u, 0, 0, Math.PI * 2); ctx.fill();
    // shading + stripes
    ctx.fillStyle = FUR_DARK; ctx.globalAlpha = 0.5;
    ctx.beginPath(); ctx.ellipse(-6 * u, hy + 6 * u, 16 * u, 10 * u, 0, 0, Math.PI); ctx.fill(); ctx.globalAlpha = 1;
    ctx.strokeStyle = FUR_DARK; ctx.lineWidth = 2.5 * u; ctx.lineCap = "round";
    for (const dx of [-7, 0, 7]) { ctx.beginPath(); ctx.moveTo(dx * u, hy - 16 * u); ctx.lineTo(dx * 0.8 * u, hy - 8 * u); ctx.stroke(); }
    ctx.lineCap = "butt";
    // mask tie + right cheek peek (3/4)
    ctx.fillStyle = MASK; ctx.fillRect(-21 * u, hy - 3 * u, 42 * u, 5 * u);
    ctx.beginPath(); ctx.moveTo(-18 * u, hy); ctx.lineTo(-28 * u, hy + 4 * u + flap * 0.3); ctx.lineTo(-26 * u, hy - 4 * u); ctx.fill();
    ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(19 * u, hy + 6 * u, 5 * u, 6 * u, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#3a2a20"; ctx.lineWidth = 1 * u;
    ctx.beginPath(); ctx.moveTo(22 * u, hy + 5 * u); ctx.lineTo(32 * u, hy + 2 * u); ctx.moveTo(22 * u, hy + 8 * u); ctx.lineTo(32 * u, hy + 9 * u); ctx.stroke();
    if (flinching && ft < 0.5) { // blink: closed eye tick at the visible edge
      ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = 1.5 * u;
      ctx.beginPath(); ctx.moveTo(15 * u, hy - 2 * u); ctx.lineTo(20 * u, hy - 1 * u); ctx.stroke();
    } else {
      ctx.fillStyle = "#fff"; ctx.beginPath(); ctx.ellipse(18 * u, hy - 1 * u, 2.4 * u, 2 * u, 0, 0, Math.PI * 2); ctx.fill();
    }

    // burger platter above the raised paw
    burger(ctx, 26 * u, -108 * u, 46 * u, layers.length > 10 ? layers.slice(-10) : layers);

    // collection star
    if (ct >= 0 && ct < 1) {
      ctx.globalAlpha = 1 - ct; ctx.fillStyle = "#ffd54a";
      const sx = 26 * u, sy = -150 * u - ct * 16 * u, r1 = 8 * u, r2 = 3.5 * u;
      ctx.beginPath();
      for (let i = 0; i < 10; i++) { const ang = (i * Math.PI) / 5 - Math.PI / 2, rr = i % 2 ? r2 : r1; ctx.lineTo(sx + Math.cos(ang) * rr, sy + Math.sin(ang) * rr); }
      ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1;
    }
    if (flinching) { ctx.fillStyle = "rgba(160,90,255,0.35)"; ctx.beginPath(); ctx.arc(0, -60 * u, 46 * u * (0.6 + ft * 0.6), 0, Math.PI * 2); ctx.fill(); }
  } catch { /* procedural fallback */ }
  ctx.restore();
}

/* ------------------------------- victory ---------------------------------- */

export const VICTORY_MS = 2600;

/**
 * Front-facing victory: turn → sit → bite. `t` = ms since the victory started.
 * Callers start it only after a confirmed completion.
 */
export function drawVictory(ctx: Ctx, W: number, H: number, t: number, layers: readonly Ingredient[]) {
  ctx.save();
  try {
    ctx.clearRect(0, 0, W, H);
    const u = Math.min(W, H) / 180;
    const sit = ease((t - 500) / 500); // 0.5–1.0s
    const bite = t > 1100 ? Math.max(0, Math.sin(((t - 1100) / 700) * Math.PI)) : 0;
    const bites = Math.min(3, Math.floor(Math.max(0, t - 1100) / 700));
    const turn = ease(t / 500);
    ctx.translate(W / 2, H * 0.92 - sit * 0 * u);
    ctx.scale(0.7 + 0.3 * turn, 1);

    ctx.fillStyle = "rgba(0,0,0,0.3)"; ctx.beginPath(); ctx.ellipse(0, 0, 50 * u, 9 * u, 0, 0, Math.PI * 2); ctx.fill();
    // cape behind
    capeShape(ctx, 0, -80 * u + sit * 14 * u, 70 * u - sit * 14 * u, Math.sin(t / 240) * 3 * u, 50 * u);
    ctx.fillStyle = CAPE_IN; ctx.fill();
    // sitting body
    const by = sit * 14 * u;
    ctx.fillStyle = SUIT; ctx.beginPath(); ctx.ellipse(0, -36 * u + by * 0.5, 30 * u, 36 * u - by * 0.5, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SUIT_HI; ctx.beginPath(); ctx.ellipse(0, -36 * u + by * 0.5, 16 * u, 26 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = SEAM; ctx.font = `900 ${10 * u}px system-ui, sans-serif`; ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("F", 0, -40 * u + by * 0.5);
    // feet
    ctx.fillStyle = FUR;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.ellipse(s * 16 * u, -4 * u, 12 * u, 7 * u, 0, 0, Math.PI * 2); ctx.fill(); }
    // head
    const hy = -88 * u + by;
    for (const side of [-1, 1] as const) {
      ctx.fillStyle = FUR; ctx.beginPath(); ctx.moveTo(side * 8 * u, hy - 14 * u); ctx.lineTo(side * 22 * u, hy - 34 * u); ctx.lineTo(side * 25 * u, hy - 6 * u); ctx.closePath(); ctx.fill();
      ctx.fillStyle = CREAM; ctx.beginPath(); ctx.moveTo(side * 12 * u, hy - 14 * u); ctx.lineTo(side * 21 * u, hy - 28 * u); ctx.lineTo(side * 22 * u, hy - 10 * u); ctx.closePath(); ctx.fill();
    }
    ctx.fillStyle = FUR; ctx.beginPath(); ctx.ellipse(0, hy, 27 * u, 23 * u, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = CREAM; ctx.beginPath(); ctx.ellipse(0, hy + 9 * u, 14 * u, 10 * u, 0, 0, Math.PI * 2); ctx.fill();
    // mask + happy eyes
    ctx.fillStyle = MASK; ctx.beginPath(); ctx.roundRect(-22 * u, hy - 9 * u, 44 * u, 11 * u, 5 * u); ctx.fill();
    ctx.strokeStyle = "#fff"; ctx.lineWidth = 2.4 * u; ctx.lineCap = "round";
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 10 * u, hy - 2 * u, 4 * u, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke(); }
    ctx.fillStyle = "#e86a7a"; ctx.beginPath(); ctx.moveTo(-3 * u, hy + 5 * u); ctx.lineTo(3 * u, hy + 5 * u); ctx.lineTo(0, hy + 8 * u); ctx.fill();
    ctx.strokeStyle = "#3a2a20"; ctx.lineWidth = 1.4 * u;
    ctx.beginPath(); ctx.arc(0, hy + 9 * u, 4 * u + bite * 2 * u, 0.1 * Math.PI, 0.9 * Math.PI); ctx.stroke();
    for (const s of [-1, 1]) for (const dy of [6, 10]) { ctx.beginPath(); ctx.moveTo(s * 14 * u, hy + dy * u); ctx.lineTo(s * 30 * u, hy + (dy - 2 + (dy - 8)) * u); ctx.stroke(); }
    ctx.lineCap = "butt";
    // burger held at mouth during bites
    const bx = 0, byy = hy + 40 * u - bite * 18 * u;
    burger(ctx, bx, byy, 52 * u, layers.length > 12 ? layers.slice(-12) : layers);
    // bite marks
    // real cut-out: erase pixels, then restore normal compositing
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.fillStyle = "#000";
    for (let i = 0; i < bites; i++) { ctx.beginPath(); ctx.arc(bx + 24 * u - i * 8 * u, byy - 18 * u - layers.length * 0.5 * u, 7 * u, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
    ctx.globalCompositeOperation = "source-over";
    // paws on burger
    ctx.fillStyle = FUR;
    for (const s of [-1, 1]) { ctx.beginPath(); ctx.arc(s * 26 * u, byy - 6 * u, 6 * u, 0, Math.PI * 2); ctx.fill(); }
  } catch { /* procedural fallback */ }
  ctx.restore();
}
