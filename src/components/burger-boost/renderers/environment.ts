/**
 * Burger Boost environment renderer (visual only, browser only).
 * Driven entirely by the existing game clock via `f.speed` (elapsed / interval),
 * using the same 4-gate view window as gates so roadside objects move in sync.
 * Reads no session, seed or answer data.
 */
import { products } from "@/data/menu";
import type { EnvFrame } from "./types";

/** Same lookahead as gates: objects become visible 4 gate-units ahead. */
const VIEW = 4;

/** depth for a roadside object at world position p (gate units). */
function depthAt(p: number, speed: number) {
  return 1 - (p - speed) / VIEW;
}

/* ------------------------------- sky ------------------------------------ */
export function drawSky(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const g = ctx.createLinearGradient(0, 0, 0, f.horizon + 6);
  // Dhaka daylight: clear blue fading to warm haze at the horizon
  g.addColorStop(0, "#3b9ad9");
  g.addColorStop(0.6, "#9fd3f0");
  g.addColorStop(1, "#fde9c4");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.W, f.horizon + 1);
  // warm glow band just above the horizon
  ctx.save();
  // soft sun disc + haze band
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = "#fff7d6";
  ctx.beginPath(); ctx.arc(f.W * 0.78, f.horizon * 0.35, Math.max(6, f.horizon * 0.16), 0, Math.PI * 2); ctx.fill();
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = "#fde68a";
  ctx.fillRect(0, f.horizon - 5, f.W, 5);
  ctx.restore();
}

/* ----------------------------- skyline ---------------------------------- */
type Building = { x: number; w: number; h: number; layer: 0 | 1; lit: number };
let skyCache: { W: number; H: number; canvas: HTMLCanvasElement | null } = { W: 0, H: 0, canvas: null };

function buildings(W: number): Building[] {
  // Deterministic LCG — identical silhouette every frame and every run.
  let s = 1337;
  const rnd = () => ((s = (s * 1103515245 + 12345) >>> 0) / 4294967296);
  const out: Building[] = [];
  for (const layer of [0, 1] as const) {
    let x = -10;
    while (x < W + 10) {
      const w = (layer === 0 ? 18 : 14) + rnd() * 22;
      const h = (layer === 0 ? 14 : 8) + rnd() * (layer === 0 ? 30 : 18);
      out.push({ x, w, h, layer, lit: Math.floor(rnd() * 1000) });
      x += w + 1 + rnd() * 3;
    }
  }
  return out;
}

export function drawSkyline(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const W = Math.round(f.W), Hh = Math.round(f.horizon);
  if (Hh < 12) return;
  if (!skyCache.canvas || skyCache.W !== W || skyCache.H !== Hh) {
    const cv = document.createElement("canvas");
    cv.width = W * 2; cv.height = Hh * 2;
    const c = cv.getContext("2d");
    if (!c) return;
    c.scale(2, 2);
    for (const b of buildings(W)) {
      const top = Hh - Math.min(b.h, Hh - 2);
      const tones = b.layer === 0 ? ["#9fb3c8", "#a8b8c4", "#b6c2cc"] : ["#d6c7b0", "#c9b79c", "#e2d5c0", "#b9c6cf"];
      c.fillStyle = tones[b.lit % tones.length]!;
      c.fillRect(b.x, top, b.w, Hh - top);
      if (b.layer === 1) {
        // sunlit edge + shaded side for depth
        c.fillStyle = "rgba(255,255,255,0.25)"; c.fillRect(b.x, top, 1.5, Hh - top);
        c.fillStyle = "rgba(60,50,40,0.18)"; c.fillRect(b.x + b.w - 3, top, 3, Hh - top);
        // windows (glass reflecting the sky)
        c.fillStyle = "#6c8fb0";
        for (let wy = top + 3; wy < Hh - 3; wy += 4) {
          for (let wx = b.x + 2; wx < b.x + b.w - 2; wx += 4) c.fillRect(wx, wy, 2, 2);
        }
        // selected rooftops carry a FLAMIO sign
        if (b.lit % 6 === 0 && b.w > 20 && top > 8) {
          c.fillStyle = "#3f3a36"; c.fillRect(b.x + b.w / 2 - 0.5, top - 3, 1, 3);
          c.fillStyle = "#f26b1d"; c.fillRect(b.x + 2, top - 8, b.w - 4, 5);
          c.fillStyle = "#fff7ed"; c.font = "900 4px system-ui, sans-serif"; c.textAlign = "center"; c.textBaseline = "middle";
          c.fillText("FLAMIO", b.x + b.w / 2, top - 5.4);
        }
      }
    }
    skyCache = { W, H: Hh, canvas: cv };
  }
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.drawImage(skyCache.canvas!, 0, 0, W, Hh);
  ctx.restore();
}

/* ------------------------------ road ------------------------------------ */
export function drawRoadbed(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { W, H, proj, speed } = f;
  // ground / sidewalks
  ctx.fillStyle = "#a8a092"; // sunlit concrete footpath
  ctx.fillRect(0, f.horizon, W, H - f.horizon);
  const top = proj(0), bot = proj(1.15);
  const g = ctx.createLinearGradient(0, top.y, 0, H);
  g.addColorStop(0, "#26221f");
  g.addColorStop(1, "#33302c");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(top.left, top.y); ctx.lineTo(top.right, top.y);
  ctx.lineTo(bot.right + 40, H); ctx.lineTo(bot.left - 40, H);
  ctx.closePath(); ctx.fill();

  // subtle asphalt bands, scrolling with the track
  ctx.save();
  ctx.globalAlpha = 0.08;
  ctx.fillStyle = "#000";
  for (let k = 0; k < 12; k++) {
    const d = (k / 12 + (speed % 1) / 12 * 3) % 1;
    const a = proj(d), b = proj(Math.min(1.15, d + 0.02));
    ctx.fillRect(a.left, a.y, a.right - a.left, Math.max(1, b.y - a.y));
  }
  ctx.restore();

  // centre divider is the metallic FLAMIO B-rail (drawCenterRail); no painted dashes.
}

/* ------------------------------ curbs ----------------------------------- */
export function drawCurbs(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { proj, speed, C } = f;
  const SEG = 0.25;
  const first = Math.floor(speed / SEG);
  ctx.save();
  for (let n = first; n * SEG < speed + VIEW; n++) {
    const p = n * SEG;
    const d0 = depthAt(p + SEG, speed), d1 = depthAt(p, speed);
    if (d1 < 0 || d0 > 1.15) continue;
    const a = proj(Math.max(0, d0)), b = proj(Math.min(1.15, d1));
    ctx.fillStyle = (n & 1) === 0 ? C.primary : "#2b2725";
    const ca = 6 * a.scale, cb = 6 * b.scale;
    // left curb
    ctx.beginPath();
    ctx.moveTo(a.left - ca, a.y); ctx.lineTo(a.left, a.y); ctx.lineTo(b.left, b.y); ctx.lineTo(b.left - cb, b.y);
    ctx.closePath(); ctx.fill();
    // right curb
    ctx.beginPath();
    ctx.moveTo(a.right, a.y); ctx.lineTo(a.right + ca, a.y); ctx.lineTo(b.right + cb, b.y); ctx.lineTo(b.right, b.y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
}

/* ---------------------------- streetlamps -------------------------------- */
const LAMP_EVERY = 1; // gate units

export function drawStreetlamps(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { proj, speed } = f;
  ctx.save();
  // far → near so nearer lamps overlap farther ones
  const last = Math.floor((speed + VIEW) / LAMP_EVERY);
  const firstN = Math.ceil(speed / LAMP_EVERY);
  for (let n = last; n >= firstN; n--) {
    const d = depthAt(n * LAMP_EVERY, speed);
    if (d < 0.02 || d > 1.1) continue;
    const p = proj(d), s = p.scale;
    const side = (n & 1) === 0 ? -1 : 1;
    const baseX = side < 0 ? p.left - 18 * s : p.right + 18 * s;
    const h = 90 * s;
    // ground light pool
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = "#fbbf24";
    ctx.beginPath(); ctx.ellipse(baseX - side * 14 * s, p.y, 26 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.globalAlpha = 1;
    // pole + arm + lamp head
    ctx.fillStyle = "#3f3a36";
    ctx.fillRect(baseX - 1.5 * s, p.y - h, 3 * s, h);
    ctx.fillRect(Math.min(baseX, baseX - side * 14 * s), p.y - h, 14 * s, 2.5 * s);
    ctx.fillStyle = "#fde68a";
    ctx.beginPath(); ctx.arc(baseX - side * 14 * s, p.y - h + 3 * s, 3.5 * s, 0, Math.PI * 2); ctx.fill();
    // Bangladesh roadside trees on alternating lamps: coconut palm / krishnachura
    if (n % 3 === 0) drawTree(ctx, baseX + side * 18 * s, p.y, s, treeKind(n));
  }
  ctx.restore();
}

/* ------------------------------ trees ----------------------------------- */
export type TreeKind = "coconut" | "krishnachura";
/** Deterministic per-slot tree choice (same every frame/run). */
export function treeKind(n: number): TreeKind { return Math.abs(n) % 2 === 0 ? "coconut" : "krishnachura"; }

function drawTree(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, kind: TreeKind) {
  if (kind === "coconut") {
    // curved slender trunk + fan of fronds + coconuts
    ctx.strokeStyle = "#8b5a2b"; ctx.lineWidth = 3 * s; ctx.lineCap = "round";
    ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + 6 * s, y - 30 * s, x + 2 * s, y - 56 * s); ctx.stroke();
    const tx = x + 2 * s, ty = y - 56 * s;
    ctx.strokeStyle = "#15803d"; ctx.lineWidth = 2.6 * s;
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI + (k / 5) * Math.PI;
      ctx.beginPath(); ctx.moveTo(tx, ty);
      ctx.quadraticCurveTo(tx + Math.cos(a) * 12 * s, ty + Math.sin(a) * 10 * s - 6 * s, tx + Math.cos(a) * 20 * s, ty + Math.sin(a) * 6 * s + 6 * s);
      ctx.stroke();
    }
    ctx.fillStyle = "#6b4423";
    ctx.beginPath(); ctx.arc(tx - 2 * s, ty + 2 * s, 2 * s, 0, Math.PI * 2); ctx.arc(tx + 2 * s, ty + 2.5 * s, 2 * s, 0, Math.PI * 2); ctx.fill();
    ctx.lineCap = "butt";
  } else {
    // krishnachura (flame tree): short trunk, wide umbrella canopy of red-orange blooms
    ctx.fillStyle = "#5b3a24"; ctx.fillRect(x - 2 * s, y - 24 * s, 4 * s, 24 * s);
    ctx.fillStyle = "#166534";
    ctx.beginPath(); ctx.ellipse(x, y - 30 * s, 20 * s, 9 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#dc2626";
    ctx.beginPath(); ctx.ellipse(x - 6 * s, y - 33 * s, 11 * s, 6 * s, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#f97316";
    ctx.beginPath(); ctx.ellipse(x + 7 * s, y - 32 * s, 10 * s, 5.5 * s, 0, 0, Math.PI * 2); ctx.fill();
  }
}

/* ------------------------- overhead signs & arches ------------------------ */
/** Gates (1-based) that get a FLAMIO milestone arch. */
export const MILESTONE_GATES = [15, 30] as const;
const SIGN_EVERY = 7; // plain green overhead highway sign every 7 gate units
const ARCH_OFFSET = 0.5; // arch sits just past its gate so it never hides the gate

/** World positions (gate units) of milestone arches. */
export function archPositions(): number[] { return MILESTONE_GATES.map((g) => g + ARCH_OFFSET); }

function gantry(ctx: CanvasRenderingContext2D, f: EnvFrame, d: number, label: string, milestone: boolean) {
  const p = f.proj(d), s = p.scale;
  const h = (milestone ? 120 : 105) * s;
  const pad = 10 * s;
  ctx.fillStyle = milestone ? "#f97316" : "#3f3a36";
  ctx.fillRect(p.left - pad - 3 * s, p.y - h, 4 * s, h);
  ctx.fillRect(p.right + pad - 1 * s, p.y - h, 4 * s, h);
  const bw = Math.min(p.right - p.left + pad * 2, (milestone ? 220 : 120) * s), bh = (milestone ? 22 : 16) * s;
  const bx = (p.left + p.right) / 2 - bw / 2, by = p.y - h - bh / 2;
  ctx.fillStyle = milestone ? "#1c1917" : "#166534";
  ctx.fillRect(p.left - pad, p.y - h - 2 * s, p.right - p.left + pad * 2, 4 * s);
  ctx.fillRect(bx, by, bw, bh);
  ctx.strokeStyle = milestone ? "#fbbf24" : "#e7e5e4"; ctx.lineWidth = Math.max(1, 1.2 * s);
  ctx.strokeRect(bx, by, bw, bh);
  if (s > 0.22) {
    ctx.fillStyle = milestone ? "#fbbf24" : "#f5f5f4";
    ctx.font = `900 ${Math.round((milestone ? 12 : 9) * s)}px system-ui, sans-serif`;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText(label, bx + bw / 2, by + bh / 2);
  }
}

export function drawOverheads(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { speed } = f;
  ctx.save();
  type Item = { pos: number; label: string; milestone: boolean };
  const items: Item[] = [];
  for (const g of MILESTONE_GATES) items.push({ pos: g + ARCH_OFFSET, label: `FLAMIO · GATE ${g}`, milestone: true });
  const firstN = Math.ceil(speed / SIGN_EVERY), lastN = Math.floor((speed + VIEW) / SIGN_EVERY);
  for (let n = firstN; n <= lastN; n++) if (n > 0) items.push({ pos: n * SIGN_EVERY + 0.5 + 0.25, label: "DHAKA ↑", milestone: false });
  items.sort((a, b) => b.pos - a.pos); // far → near
  for (const it of items) {
    const d = depthAt(it.pos, speed);
    if (d < 0.05 || d > 0.92) continue; // fade out before it reaches the player
    gantry(ctx, f, d, it.label, it.milestone);
  }
  ctx.restore();
}

/* ---------------------------- billboards --------------------------------- */
type Board = { name: string; price: string; img: HTMLImageElement | null; ok: boolean };
let boards: Board[] | null = null;

/** Curated sequence (exact menu.ts names) covering all five categories. */
const BOARD_PRODUCTS = [
  "Naga Fire Burger",
  "Cheesy Blast Burger",
  "BBQ Chicken Supreme",
  "Flamio Special Meat Box",
  "Chicken Shawarma",
  "Flamio Special Burger",
] as const;

function loadBoards(): Board[] {
  if (boards) return boards;
  const out: Board[] = [];
  for (const name of BOARD_PRODUCTS) {
    const p = products.find((x) => x.name === name);
    if (!p) continue; // never invent a product or price
    const b: Board = { name: p.name, price: `৳${p.basePrice}`, img: null, ok: false };
    const url = p.images[0]?.url;
    if (url && typeof Image !== "undefined") {
      const img = new Image();
      img.onload = () => { b.ok = true; };
      img.onerror = () => { b.ok = false; };
      img.src = url;
      b.img = img;
    }
    out.push(b);
  }
  boards = out;
  return boards;
}

const BOARD_EVERY = 3.5; // gate units, alternating sides
/** Giant elevated boards: set far back from the curb and high above street level. */
const BOARD_W = 210, BOARD_H = 145, POST_H = 150, BOARD_SETBACK = 30;
const PHOTO = 0.68;

/** Largest bold font (≤ max) whose text fits maxW — shrinks instead of truncating. */
function fitFont(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxPx: number, weight: string) {
  let px = maxPx;
  ctx.font = `${weight} ${px}px system-ui, sans-serif`;
  const w = ctx.measureText(text).width;
  if (w > maxW) {
    px = Math.max(3, px * (maxW / w));
    ctx.font = `${weight} ${px}px system-ui, sans-serif`;
  }
  return px;
}

export function drawBillboards(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { proj, speed, C, W } = f;
  const list = loadBoards();
  ctx.save();
  const last = Math.floor((speed + VIEW) / BOARD_EVERY);
  const firstN = Math.max(1, Math.ceil((speed - 0.3) / BOARD_EVERY));
  for (let n = last; n >= firstN; n--) {
    const d = depthAt(n * BOARD_EVERY, speed);
    if (d < 0.06 || d > 1.05) continue;
    const p = proj(d), s = p.scale;
    const side = (n & 1) === 0 ? 1 : -1;
    const bw = BOARD_W * s, bh = BOARD_H * s, ph = POST_H * s;
    // Keep the complete left board (including its 10*s halo) on the sidewalk.
    const rawX = side < 0 ? p.left - BOARD_SETBACK * s - bw : p.right + BOARD_SETBACK * s;
    let x = rawX;
    if (side < 0) {
      const pad = Math.max(3, 10 * s);
      const maxSafeX = Math.min(W - pad - bw, p.left - 6 * s - bw - 10 * s);
      // No position can fit the unchanged board here without clipping or road overlap.
      if (maxSafeX < pad) continue;
      x = Math.min(maxSafeX, Math.max(pad, rawX));
    }
    if (x > W || x + bw < 0) continue;
    const y = p.y - ph - bh;
    // fade in at the horizon, fade out as it sweeps past the screen edge
    const a = Math.min(1, (d - 0.06) / 0.1) * (d > 0.88 ? Math.max(0, 1 - (d - 0.88) / 0.17) : 1);
    if (a <= 0) continue;
    ctx.globalAlpha = a;

    // ground shadow
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    ctx.beginPath(); ctx.ellipse(x + bw / 2, p.y, bw * 0.45, 5 * s, 0, 0, Math.PI * 2); ctx.fill();
    // posts
    // steel lattice mast
    ctx.fillStyle = "#57534e";
    ctx.fillRect(x + bw * 0.5 - 5 * s, y + bh, 10 * s, ph);
    ctx.strokeStyle = "#78716c"; ctx.lineWidth = Math.max(0.6, 1.2 * s);
    ctx.beginPath();
    for (let k = 0; k < 5; k++) { const yy = y + bh + (ph * k) / 5; ctx.moveTo(x + bw * 0.5 - 5 * s, yy); ctx.lineTo(x + bw * 0.5 + 5 * s, yy + ph / 5); }
    ctx.stroke();
    ctx.fillRect(x + bw * 0.1, y + bh, bw * 0.8, 3 * s); // catwalk
    // LED glow halo
    ctx.fillStyle = "rgba(255,170,80,0.22)";
    ctx.fillRect(x - 10 * s, y - 10 * s, bw + 20 * s, bh + 20 * s);
    // dark-steel frame + orange accent
    const fr = 3 * s;
    ctx.fillStyle = "#24201d";
    ctx.fillRect(x - fr, y - fr, bw + fr * 2, bh + fr * 2);
    // FLAMIO header strip on top of the screen
    ctx.fillStyle = "#1c1917"; ctx.fillRect(x - fr, y - fr - 16 * s, bw + fr * 2, 16 * s);
    if (s > 0.2) { ctx.fillStyle = C.primary; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${Math.max(4, 12 * s)}px system-ui, sans-serif`; ctx.fillText("FLAMIO", x + bw / 2, y - fr - 8 * s); }
    ctx.fillStyle = C.primary;
    ctx.fillRect(x - fr, y - fr, bw + fr * 2, 2.5 * s);

    const b = list.length ? list[n % list.length]! : null;
    const photoH = bh * PHOTO, panelH = bh - photoH;
    if (b && b.ok && b.img && b.img.naturalWidth > 0) {
      // centred source crop matching the photo window aspect — no stretching
      const iw = b.img.naturalWidth, ih = b.img.naturalHeight;
      const target = bw / photoH;
      let sw = iw, sh = iw / target;
      if (sh > ih) { sh = ih; sw = ih * target; }
      ctx.drawImage(b.img, (iw - sw) / 2, (ih - sh) / 2, sw, sh, x, y, bw, photoH);
    } else {
      ctx.fillStyle = "#1c1917";
      ctx.fillRect(x, y, bw, photoH);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = C.primary;
      ctx.font = `900 ${Math.max(4, 20 * s)}px system-ui, sans-serif`;
      ctx.fillText("FLAMIO", x + bw / 2, y + photoH / 2);
    }
    // info panel
    ctx.fillStyle = "#141110";
    ctx.fillRect(x, y + photoH, bw, panelH);
    if (b) {
      const pad = 5 * s;
      ctx.textBaseline = "middle";
      // price pill (right)
      const pricePx = fitFont(ctx, b.price, bw * 0.3, 17 * s, "900");
      const pw = ctx.measureText(b.price).width + pad * 1.6;
      const pillH = pricePx * 1.45;
      const px = x + bw - pad - pw, py = y + photoH + (panelH - pillH) / 2;
      ctx.fillStyle = C.primary;
      ctx.fillRect(px, py, pw, pillH);
      ctx.fillStyle = "#141110"; ctx.textAlign = "center";
      ctx.fillText(b.price, px + pw / 2, py + pillH / 2 + 0.5 * s);
      // product name (left), full text, shrinks to fit
      ctx.textAlign = "left"; ctx.fillStyle = "#fafaf9";
      fitFont(ctx, b.name, bw - pw - pad * 3, 15 * s, "800");
      ctx.fillText(b.name, x + pad, y + photoH + panelH / 2);
    }
    // subtle LED sheen sweeping across the screen
    const sweep = ((speed * 0.6 + n * 0.37) % 1) * (bw + 40 * s) - 20 * s;
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(x + Math.max(0, sweep), y, Math.min(14 * s, Math.max(0, bw - sweep)), bh);
  }
  ctx.restore();
}

/** Full environment pass, drawn before gates and player. */
export function drawEnvironment(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  drawSky(ctx, f);
  drawSkyline(ctx, f);
  drawRoadbed(ctx, f);
  drawCenterRail(ctx, f);
  drawCurbs(ctx, f);
  drawShops(ctx, f);
  drawStreetlamps(ctx, f);
  drawCables(ctx, f);
  drawBillboards(ctx, f);
  drawOverheads(ctx, f);
}

/* ---------------------- STEP 3: FLAMIO centre B-rail ------------------- */
/** Low metallic lane divider drawn on the road surface (visual only, no collision). */
export function drawCenterRail(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { proj, speed, W } = f;
  const cx = W / 2, N = 24;
  ctx.save();
  for (let k = 0; k < N; k++) {
    const d0 = k / N, d1 = (k + 1) / N;
    const a = proj(d0), b = proj(Math.min(1.1, d1 * 1.1));
    const w0 = 2 + 9 * a.scale, w1 = 2 + 9 * b.scale;
    ctx.fillStyle = "#2a2624";
    ctx.beginPath(); ctx.moveTo(cx - w0 / 2, a.y); ctx.lineTo(cx + w0 / 2, a.y); ctx.lineTo(cx + w1 / 2, b.y); ctx.lineTo(cx - w1 / 2, b.y); ctx.closePath(); ctx.fill();
    // metallic edges + orange core
    ctx.fillStyle = "#9ca3af"; ctx.fillRect(cx - w1 / 2, a.y, Math.max(0.6, w1 * 0.12), b.y - a.y);
    ctx.fillRect(cx + w1 / 2 - Math.max(0.6, w1 * 0.12), a.y, Math.max(0.6, w1 * 0.12), b.y - a.y);
    ctx.fillStyle = "#f26b1d"; ctx.fillRect(cx - w1 * 0.12, a.y, w1 * 0.24, b.y - a.y);
  }
  // restrained FLAMIO marks fixed in world space (one per 2 gate units)
  const first = Math.ceil(speed / 2) * 2;
  for (let pos = first; pos < speed + VIEW; pos += 2) {
    const d = depthAt(pos, speed);
    if (d < 0.25 || d > 0.85) continue;
    const p = proj(d), s = p.scale, w = 16 * s, h = 34 * s;
    ctx.fillStyle = "#1c1917"; ctx.beginPath(); ctx.roundRect(cx - w / 2, p.y - h, w, h, 3 * s); ctx.fill();
    ctx.strokeStyle = "#f26b1d"; ctx.lineWidth = Math.max(0.8, 1.2 * s); ctx.stroke();
    if (s > 0.35) {
      ctx.save(); ctx.translate(cx, p.y - h / 2); ctx.rotate(-Math.PI / 2);
      ctx.fillStyle = "#fbbf24"; ctx.font = `900 ${Math.round(8 * s)}px system-ui, sans-serif`;
      ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("FLAMIO", 0, 0); ctx.restore();
    }
  }
  ctx.restore();
}

/* ------------------- STEP 3: Bangladesh roadside details -------------- */
const SHOPS = [
  { bn: "চা স্টল", en: "TEA STALL", bg: "#0f766e" },
  { bn: "মুদি দোকান", en: "GROCERY", bg: "#1d4ed8" },
  { bn: "ফ্লামিও", en: "FLAMIO", bg: "#c2410c" },
  { bn: "ফার্মেসি", en: "PHARMACY", bg: "#15803d" },
] as const;
const SHOP_EVERY = 2.5;

/** Small roadside shopfronts with Bengali + English signs, set back behind the curb. */
export function drawShops(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { proj, speed, W } = f;
  ctx.save();
  const last = Math.floor((speed + VIEW) / SHOP_EVERY), firstN = Math.max(1, Math.ceil(speed / SHOP_EVERY));
  for (let n = last; n >= firstN; n--) {
    const d = depthAt(n * SHOP_EVERY + 1.2, speed);
    if (d < 0.05 || d > 1.0) continue;
    const p = proj(d), s = p.scale, side = (n & 1) === 0 ? -1 : 1;
    const w = 70 * s, h = 46 * s;
    const x = side < 0 ? p.left - 70 * s - w : p.right + 70 * s;
    if (x > W || x + w < 0) continue;
    const shop = SHOPS[n % SHOPS.length]!;
    // upper commercial floors (Dhaka mixed-use block) with balconies
    const floors = 2 + (n % 3), fh = 22 * s, top = p.y - h - 16 * s - floors * fh;
    ctx.fillStyle = (n % 2) ? "#e7dcc8" : "#d4c3a8"; ctx.fillRect(x, top, w, floors * fh);
    ctx.fillStyle = "rgba(70,55,40,0.22)"; ctx.fillRect(side < 0 ? x + w - 6 * s : x, top, 6 * s, floors * fh); // shaded side
    for (let k = 0; k < floors; k++) {
      const fy = top + k * fh;
      ctx.fillStyle = "#7ea3c4"; ctx.fillRect(x + 8 * s, fy + 5 * s, w * 0.3, 11 * s); ctx.fillRect(x + w * 0.55, fy + 5 * s, w * 0.3, 11 * s);
      ctx.fillStyle = "#8a7a66"; ctx.fillRect(x + 4 * s, fy + fh - 4 * s, w - 8 * s, 2 * s);
    }
    if (shop.en === "FLAMIO" && s > 0.25) { // rooftop FLAMIO sign
      ctx.fillStyle = "#f26b1d"; ctx.fillRect(x + 4 * s, top - 14 * s, w - 8 * s, 12 * s);
      ctx.fillStyle = "#fff7ed"; ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.font = `900 ${Math.round(9 * s)}px system-ui, sans-serif`; ctx.fillText("FLAMIO", x + w / 2, top - 8 * s);
    }
    ctx.fillStyle = "#6b625a"; ctx.fillRect(x, p.y - h, w, h);
    ctx.fillStyle = "#3f3a36"; ctx.fillRect(x + w * 0.12, p.y - h * 0.55, w * 0.76, h * 0.55);
    // daylight shadow cast onto the footpath
    ctx.fillStyle = "rgba(0,0,0,0.18)"; ctx.fillRect(side < 0 ? x + w : x - 10 * s, p.y - 2 * s, 10 * s, 3 * s);
    ctx.fillStyle = shop.bg; ctx.fillRect(x - 2 * s, p.y - h - 16 * s, w + 4 * s, 16 * s);
    if (s > 0.3) {
      ctx.fillStyle = "#fafaf9"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.font = `700 ${Math.round(7 * s)}px 'Noto Sans Bengali', system-ui, sans-serif`;
      ctx.fillText(shop.bn, x + w / 2, p.y - h - 11 * s);
      ctx.font = `800 ${Math.round(5 * s)}px system-ui, sans-serif`;
      ctx.fillText(shop.en, x + w / 2, p.y - h - 4 * s);
    }
    // CNG auto-rickshaw parked in front of every 3rd shop
    if (n % 3 === 0 && s > 0.2) drawCng(ctx, side < 0 ? x + w - 6 * s : x + 6 * s, p.y, s, side);
  }
  ctx.restore();
}

function drawCng(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, side: number) {
  const w = 30 * s, h = 22 * s, bx = side < 0 ? x - w : x;
  ctx.fillStyle = "#15803d";
  ctx.beginPath(); ctx.moveTo(bx, y - 5 * s); ctx.lineTo(bx, y - h * 0.7); ctx.quadraticCurveTo(bx + w * 0.1, y - h, bx + w * 0.45, y - h); ctx.lineTo(bx + w, y - h * 0.85); ctx.lineTo(bx + w, y - 5 * s); ctx.closePath(); ctx.fill();
  ctx.fillStyle = "rgba(200,230,255,0.55)"; ctx.fillRect(bx + w * 0.55, y - h * 0.8, w * 0.35, h * 0.35);
  ctx.fillStyle = "#facc15"; ctx.fillRect(bx, y - 8 * s, w, 2 * s);
  ctx.fillStyle = "#111";
  for (const wx of [0.2, 0.82]) { ctx.beginPath(); ctx.arc(bx + w * wx, y - 3 * s, 3.2 * s, 0, Math.PI * 2); ctx.fill(); }
}

/** Subtle overhead electrical cables sagging between lamp posts (high in frame, thin, low alpha). */
export function drawCables(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { proj, speed } = f;
  ctx.save();
  ctx.strokeStyle = "rgba(20,17,16,0.55)"; ctx.lineWidth = 1;
  const firstN = Math.ceil(speed), last = Math.floor(speed + VIEW);
  for (let n = firstN; n < last; n++) {
    const d0 = depthAt(n + 1, speed), d1 = depthAt(n, speed);
    if (d0 < 0.02 || d1 > 1.05) continue;
    const a = proj(d0), b = proj(d1);
    for (const sideA of [0, 1]) {
      const xa = sideA ? a.right + 6 * a.scale : a.left - 6 * a.scale;
      const xb = sideA ? b.right + 6 * b.scale : b.left - 6 * b.scale;
      const ya = a.y - 120 * a.scale, yb = b.y - 120 * b.scale;
      ctx.beginPath(); ctx.moveTo(xa, ya); ctx.quadraticCurveTo((xa + xb) / 2, (ya + yb) / 2 + 10 * b.scale, xb, yb); ctx.stroke();
    }
  }
  ctx.restore();
}
