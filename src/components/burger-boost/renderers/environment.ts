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
  g.addColorStop(0, "#121110");
  g.addColorStop(0.55, "#2a1608");
  g.addColorStop(1, "#7c2d12");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, f.W, f.horizon + 1);
  // warm glow band just above the horizon
  ctx.save();
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = f.C.primary;
  ctx.fillRect(0, f.horizon - 4, f.W, 4);
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
      c.fillStyle = b.layer === 0 ? "#1f1a17" : "#141110";
      c.fillRect(b.x, top, b.w, Hh - top);
      if (b.layer === 1) {
        // a few roofs get a little restaurant awning
        if (b.lit % 5 === 0) { c.fillStyle = "#9a3412"; c.fillRect(b.x - 1, top, b.w + 2, 2); }
        c.fillStyle = "#fbbf24";
        for (let wy = top + 3; wy < Hh - 3; wy += 4) {
          for (let wx = b.x + 2; wx < b.x + b.w - 2; wx += 4) {
            if (((wx * 7 + wy * 13 + b.lit) % 5) === 0) c.fillRect(wx, wy, 1.5, 1.5);
          }
        }
      }
    }
    skyCache = { W, H: Hh, canvas: cv };
  }
  ctx.save();
  ctx.globalAlpha = 0.9;
  ctx.drawImage(skyCache.canvas!, 0, 0, W, Hh);
  ctx.restore();
}

/* ------------------------------ road ------------------------------------ */
export function drawRoadbed(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { W, H, proj, speed } = f;
  // ground / sidewalks
  ctx.fillStyle = "#1a1715";
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

  // dashed centre divider — dashes are fixed in world space (4 per gate unit)
  ctx.save();
  ctx.fillStyle = "#f5f5f4";
  const DASH = 0.5; // gate units between dashes
  const first = Math.floor(speed / DASH) * DASH;
  for (let p = first; p < speed + VIEW; p += DASH) {
    const d0 = depthAt(p + DASH * 0.45, speed), d1 = depthAt(p, speed);
    if (d1 < 0 || d0 > 1.15) continue;
    const a = proj(Math.max(0, d0)), b = proj(Math.min(1.15, d1));
    const w0 = 1 + 4 * a.scale, w1 = 1 + 4 * b.scale;
    ctx.beginPath();
    ctx.moveTo(W / 2 - w0 / 2, a.y); ctx.lineTo(W / 2 + w0 / 2, a.y);
    ctx.lineTo(W / 2 + w1 / 2, b.y); ctx.lineTo(W / 2 - w1 / 2, b.y);
    ctx.closePath(); ctx.fill();
  }
  ctx.restore();
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
    // small tree in planter on alternating lamps, outside the lamp
    if (n % 3 === 0) {
      const tx = baseX + side * 16 * s;
      ctx.fillStyle = "#44403c"; ctx.fillRect(tx - 6 * s, p.y - 8 * s, 12 * s, 8 * s);
      ctx.fillStyle = "#166534";
      ctx.beginPath(); ctx.arc(tx, p.y - 20 * s, 11 * s, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#15803d";
      ctx.beginPath(); ctx.arc(tx - 3 * s, p.y - 23 * s, 6 * s, 0, Math.PI * 2); ctx.fill();
    }
  }
  ctx.restore();
}

/* ---------------------------- billboards --------------------------------- */
type Board = { name: string; price: string; img: HTMLImageElement | null; ok: boolean };
let boards: Board[] | null = null;

/** Curated sequence (exact menu.ts names) covering all five categories. */
const BOARD_PRODUCTS = [
  "Flamio Special Burger",
  "Flamio Special Meat Box",
  "BBQ Chicken Supreme",
  "Chicken Shawarma",
  "Oven Baked Pasta",
  "BBQ Cheese Burst Burger",
  "Italiano Flamio Special",
  "Flamio Classic Burger",
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
const BOARD_W = 150, BOARD_H = 105, POST_H = 46;
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
    // fully outside the road + curb (curb is 6*s wide)
    const x = side < 0 ? p.left - 14 * s - bw : p.right + 14 * s;
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
    ctx.fillStyle = "#3f3a36";
    ctx.fillRect(x + bw * 0.22 - 2.5 * s, y + bh, 5 * s, ph);
    ctx.fillRect(x + bw * 0.78 - 2.5 * s, y + bh, 5 * s, ph);
    // dark-steel frame + orange accent
    const fr = 3 * s;
    ctx.fillStyle = "#24201d";
    ctx.fillRect(x - fr, y - fr, bw + fr * 2, bh + fr * 2);
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
      const pricePx = fitFont(ctx, b.price, bw * 0.3, 13 * s, "900");
      const pw = ctx.measureText(b.price).width + pad * 1.6;
      const pillH = pricePx * 1.45;
      const px = x + bw - pad - pw, py = y + photoH + (panelH - pillH) / 2;
      ctx.fillStyle = C.primary;
      ctx.fillRect(px, py, pw, pillH);
      ctx.fillStyle = "#141110"; ctx.textAlign = "center";
      ctx.fillText(b.price, px + pw / 2, py + pillH / 2 + 0.5 * s);
      // product name (left), full text, shrinks to fit
      ctx.textAlign = "left"; ctx.fillStyle = "#fafaf9";
      fitFont(ctx, b.name, bw - pw - pad * 3, 11 * s, "800");
      ctx.fillText(b.name, x + pad, y + photoH + panelH / 2);
    }
  }
  ctx.restore();
}

/** Full environment pass, drawn before gates and player. */
export function drawEnvironment(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  drawSky(ctx, f);
  drawSkyline(ctx, f);
  drawRoadbed(ctx, f);
  drawCurbs(ctx, f);
  drawStreetlamps(ctx, f);
  drawBillboards(ctx, f);
}
