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
type Board = { name: string; price: number; img: HTMLImageElement | null; ok: boolean };
let boards: Board[] | null = null;

function loadBoards(): Board[] {
  if (boards) return boards;
  // Real menu data only: featured items first, then popular. Prices come from menu.ts.
  const picked = products.filter((p) => p.isFeatured).concat(products.filter((p) => p.isPopular && !p.isFeatured)).slice(0, 6);
  boards = picked.map((p) => {
    const b: Board = { name: p.name, price: p.basePrice, img: null, ok: false };
    const url = p.images[0]?.url;
    if (url && typeof Image !== "undefined") {
      const img = new Image();
      img.onload = () => { b.ok = true; };
      img.onerror = () => { b.ok = false; };
      img.src = url;
      b.img = img;
    }
    return b;
  });
  return boards;
}

const BOARD_EVERY = 5.5; // gate units

function fitText(ctx: CanvasRenderingContext2D, text: string, maxW: number) {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 3 && ctx.measureText(t + "…").width > maxW) t = t.slice(0, -1);
  return t + "…";
}

export function drawBillboards(ctx: CanvasRenderingContext2D, f: EnvFrame) {
  const { proj, speed, C } = f;
  const list = loadBoards();
  ctx.save();
  const last = Math.floor((speed + VIEW) / BOARD_EVERY);
  const firstN = Math.max(1, Math.ceil(speed / BOARD_EVERY));
  for (let n = last; n >= firstN; n--) {
    const d = depthAt(n * BOARD_EVERY + 0.5, speed);
    if (d < 0.05 || d > 1.05) continue;
    const p = proj(d), s = p.scale;
    const side = (n & 1) === 0 ? 1 : -1;
    const bw = 92 * s, bh = 60 * s;
    // keep boards fully off the road
    const x = side < 0 ? p.left - 34 * s - bw : p.right + 34 * s;
    const y = p.y - 70 * s - bh;
    // posts
    ctx.fillStyle = "#3f3a36";
    ctx.fillRect(x + bw * 0.2, y + bh, 3 * s, 70 * s);
    ctx.fillRect(x + bw * 0.8 - 3 * s, y + bh, 3 * s, 70 * s);
    // frame
    ctx.fillStyle = "#1c1917";
    ctx.fillRect(x - 2 * s, y - 2 * s, bw + 4 * s, bh + 4 * s);
    ctx.fillStyle = C.primary;
    ctx.fillRect(x - 2 * s, y - 2 * s, bw + 4 * s, 3 * s);

    const b = list.length ? list[n % list.length]! : null;
    const fontPx = Math.max(5, 9 * s);
    if (b && b.ok && b.img) {
      const imgH = bh * 0.62;
      ctx.drawImage(b.img, x, y, bw, imgH);
      ctx.fillStyle = "#111";
      ctx.fillRect(x, y + imgH, bw, bh - imgH);
      ctx.textBaseline = "middle"; ctx.textAlign = "left";
      ctx.font = `bold ${fontPx}px system-ui, sans-serif`;
      ctx.fillStyle = C.primary;
      const price = `৳${b.price}`;
      const pw = ctx.measureText(price).width;
      ctx.fillText(price, x + bw - pw - 3 * s, y + imgH + (bh - imgH) / 2);
      ctx.fillStyle = "#fafaf9";
      ctx.fillText(fitText(ctx, b.name, bw - pw - 9 * s), x + 3 * s, y + imgH + (bh - imgH) / 2);
    } else {
      // Branded fallback — no invented prices.
      ctx.fillStyle = "#111";
      ctx.fillRect(x, y, bw, bh);
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = C.primary;
      ctx.font = `900 ${Math.max(6, 15 * s)}px system-ui, sans-serif`;
      ctx.fillText("FLAMIO", x + bw / 2, y + bh * 0.42);
      ctx.fillStyle = "#fafaf9";
      ctx.font = `bold ${Math.max(4, 7 * s)}px system-ui, sans-serif`;
      ctx.fillText("BURGER BOOST", x + bw / 2, y + bh * 0.72);
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
