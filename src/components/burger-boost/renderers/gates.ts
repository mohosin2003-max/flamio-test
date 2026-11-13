/**
 * Burger Boost gate renderer + procedural vector food art (visual only, browser only).
 * Reads only PublicGate-shaped data (a, op, b, lanes, spoiled, spoiledLane).
 * Never computes answers or decides outcomes.
 */
import type { Ingredient, MathOp, Lane } from "@/lib/burger-boost-rules";
import type { Colors, Projected } from "./types";

type Ctx = CanvasRenderingContext2D;

function cheese(ctx: Ctx, r: number) {
  ctx.beginPath();
  ctx.moveTo(-r, r * 0.55); ctx.lineTo(r, r * 0.55); ctx.lineTo(r * 0.75, -r * 0.6);
  ctx.quadraticCurveTo(-r * 0.1, -r * 0.2, -r, r * 0.55); ctx.closePath();
  ctx.fillStyle = "#f7c23a"; ctx.fill();
  ctx.lineWidth = Math.max(1, r * 0.07); ctx.strokeStyle = "#c98c12"; ctx.stroke();
  ctx.fillStyle = "#d99a1a";
  for (const [x, y, s] of [[-0.35, 0.25, 0.14], [0.25, 0.3, 0.11], [0.45, -0.15, 0.09], [0, 0.05, 0.07]] as const) {
    ctx.beginPath(); ctx.ellipse(x * r, y * r, s * r, s * r * 0.8, 0, 0, Math.PI * 2); ctx.fill();
  }
}

function lettuce(ctx: Ctx, r: number) {
  const layer = (dy: number, col: string, w: number) => {
    ctx.beginPath(); ctx.moveTo(-w * r, dy * r);
    for (let i = 0; i <= 8; i++) {
      const x = -w + (2 * w * i) / 8;
      ctx.quadraticCurveTo((x - w / 8) * r, (dy - 0.35 - (i % 2) * 0.12) * r, x * r, (dy - 0.15) * r);
    }
    ctx.quadraticCurveTo(w * r, (dy + 0.35) * r, 0, (dy + 0.4) * r);
    ctx.quadraticCurveTo(-w * r, (dy + 0.35) * r, -w * r, dy * r);
    ctx.fillStyle = col; ctx.fill();
  };
  layer(0.25, "#2f8f3a", 1); layer(0, "#5fbf4a", 0.9); layer(-0.2, "#9be07a", 0.7);
  ctx.strokeStyle = "#e9ffd9"; ctx.lineWidth = Math.max(1, r * 0.05);
  ctx.beginPath(); ctx.moveTo(0, r * 0.35); ctx.lineTo(0, -r * 0.35); ctx.stroke();
}

function sausage(ctx: Ctx, r: number) {
  ctx.lineCap = "round";
  ctx.strokeStyle = "#7a2c18"; ctx.lineWidth = r * 0.72;
  ctx.beginPath(); ctx.arc(0, r * 0.9, r * 1.05, Math.PI * 1.22, Math.PI * 1.78); ctx.stroke();
  ctx.strokeStyle = "#b5502f"; ctx.lineWidth = r * 0.55; ctx.stroke();
  ctx.strokeStyle = "#e6875f"; ctx.lineWidth = r * 0.12;
  ctx.beginPath(); ctx.arc(0, r * 0.82, r * 1.05, Math.PI * 1.3, Math.PI * 1.6); ctx.stroke();
  ctx.strokeStyle = "#4a1a0e"; ctx.lineWidth = Math.max(1, r * 0.08);
  for (const a of [1.35, 1.5, 1.65]) {
    const x = Math.cos(Math.PI * a) * r * 1.05, y = r * 0.9 + Math.sin(Math.PI * a) * r * 1.05;
    ctx.beginPath(); ctx.moveTo(x - r * 0.12, y - r * 0.18); ctx.lineTo(x + r * 0.12, y + r * 0.18); ctx.stroke();
  }
  ctx.lineCap = "butt";
}

function sauce(ctx: Ctx, r: number) {
  ctx.beginPath();
  ctx.moveTo(0, -r);
  ctx.bezierCurveTo(r * 0.3, -r * 0.4, r * 0.95, -r * 0.1, r * 0.8, r * 0.4);
  ctx.bezierCurveTo(r * 0.7, r * 0.85, -r * 0.7, r * 0.85, -r * 0.8, r * 0.4);
  ctx.bezierCurveTo(-r * 0.95, -r * 0.1, -r * 0.3, -r * 0.4, 0, -r);
  ctx.fillStyle = "#c62020"; ctx.fill();
  ctx.fillStyle = "#e5483a";
  ctx.beginPath(); ctx.ellipse(-r * 0.1, r * 0.25, r * 0.55, r * 0.35, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "rgba(255,255,255,0.65)";
  ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.05, r * 0.12, r * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#c62020";
  ctx.beginPath(); ctx.arc(r * 0.95, r * 0.7, r * 0.12, 0, Math.PI * 2); ctx.fill();
}

function mayo(ctx: Ctx, r: number) {
  const tier = (y: number, w: number, h: number) => {
    ctx.beginPath(); ctx.ellipse(0, y * r, w * r, h * r, 0, 0, Math.PI * 2);
    ctx.fillStyle = "#f6efd8"; ctx.fill(); ctx.strokeStyle = "#d7c9a0"; ctx.lineWidth = Math.max(1, r * 0.06); ctx.stroke();
  };
  tier(0.5, 0.95, 0.32); tier(0.12, 0.72, 0.28); tier(-0.22, 0.5, 0.24);
  ctx.beginPath(); ctx.moveTo(-r * 0.25, -r * 0.35); ctx.quadraticCurveTo(r * 0.05, -r * 1.1, r * 0.2, -r * 0.8);
  ctx.quadraticCurveTo(r * 0.15, -r * 0.45, r * 0.25, -r * 0.35); ctx.closePath();
  ctx.fillStyle = "#f6efd8"; ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(255,255,255,0.9)";
  ctx.beginPath(); ctx.ellipse(-r * 0.35, r * 0.05, r * 0.12, r * 0.06, 0, 0, Math.PI * 2); ctx.fill();
}

function cucumberSlice(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2, rr = s * (i % 2 ? 0.94 : 1);
    ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr * 0.9);
  }
  ctx.closePath(); ctx.fillStyle = "#1f6b37"; ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.82, s * 0.74, 0, 0, Math.PI * 2); ctx.fillStyle = "#c9ec9a"; ctx.fill();
  ctx.beginPath(); ctx.ellipse(x, y, s * 0.45, s * 0.4, 0, 0, Math.PI * 2); ctx.fillStyle = "#a6d77a"; ctx.fill();
  ctx.fillStyle = "#f4f6d8";
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * s * 0.3, y + Math.sin(a) * s * 0.27, s * 0.08, s * 0.05, a, 0, Math.PI * 2); ctx.fill();
  }
}
function cucumber(ctx: Ctx, r: number) {
  cucumberSlice(ctx, -r * 0.35, r * 0.2, r * 0.6);
  cucumberSlice(ctx, r * 0.35, -r * 0.15, r * 0.6);
}

function carrot(ctx: Ctx, r: number) {
  const stick = (x: number, y: number, rot: number) => {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
    const w = r * 0.32, h = r * 1.5;
    ctx.beginPath(); ctx.moveTo(-w / 2, -h / 2);
    for (let i = 0; i <= 6; i++) ctx.lineTo(-w / 2 + (i % 2 ? -w * 0.12 : 0), -h / 2 + (h * i) / 6);
    ctx.lineTo(w / 2, h / 2);
    for (let i = 6; i >= 0; i--) ctx.lineTo(w / 2 + (i % 2 ? w * 0.12 : 0), -h / 2 + (h * i) / 6);
    ctx.closePath(); ctx.fillStyle = "#ef7d22"; ctx.fill();
    ctx.fillStyle = "#ffb067"; ctx.fillRect(-w * 0.15, -h / 2 + 2, w * 0.18, h - 4);
    ctx.restore();
  };
  stick(-r * 0.45, r * 0.05, -0.35); stick(0, 0, 0.05); stick(r * 0.45, r * 0.05, 0.4);
}

function tomato(ctx: Ctx, r: number) {
  ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fillStyle = "#c92a1f"; ctx.fill();
  ctx.beginPath(); ctx.arc(0, 0, r * 0.86, 0, Math.PI * 2); ctx.fillStyle = "#ef5a45"; ctx.fill();
  ctx.fillStyle = "#c92a1f";
  ctx.beginPath(); ctx.arc(0, 0, r * 0.18, 0, Math.PI * 2); ctx.fill();
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    ctx.save(); ctx.rotate(a);
    ctx.beginPath(); ctx.ellipse(r * 0.48, 0, r * 0.28, r * 0.2, 0, 0, Math.PI * 2); ctx.fillStyle = "#b51e18"; ctx.fill();
    ctx.fillStyle = "#ffd36a";
    for (const dx of [0.4, 0.56]) { ctx.beginPath(); ctx.ellipse(r * dx, 0, r * 0.05, r * 0.03, 0, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  ctx.fillStyle = "rgba(255,255,255,0.45)";
  ctx.beginPath(); ctx.ellipse(-r * 0.45, -r * 0.5, r * 0.18, r * 0.09, -0.7, 0, Math.PI * 2); ctx.fill();
}

const ART: Record<Ingredient, (ctx: Ctx, r: number) => void> = { cheese, lettuce, sausage, sauce, mayo, cucumber, carrot, tomato };

/** Draws the illustration for `kind` centred at (x, y). Never throws. */
export function drawFood(ctx: Ctx, kind: Ingredient, x: number, y: number, r: number, rotten = false) {
  const art = ART[kind];
  ctx.save();
  try {
    ctx.translate(x, y);
    if (art) art(ctx, r);
    else { ctx.beginPath(); ctx.arc(0, 0, r * 0.7, 0, Math.PI * 2); ctx.fillStyle = "#999"; ctx.fill(); }
    if (rotten) {
      ctx.globalCompositeOperation = "source-atop";
      ctx.fillStyle = "rgba(90,140,40,0.55)"; ctx.fillRect(-r * 1.4, -r * 1.4, r * 2.8, r * 2.8);
      ctx.globalCompositeOperation = "source-over";
      ctx.fillStyle = "rgba(60,40,30,0.7)";
      for (const [dx, dy, s] of [[-0.3, -0.2, 0.14], [0.35, 0.2, 0.11], [0.05, 0.4, 0.09]] as const) {
        ctx.beginPath(); ctx.arc(dx * r, dy * r, s * r, 0, Math.PI * 2); ctx.fill();
      }
    }
  } catch { /* procedural fallback: draw nothing */ }
  ctx.restore();
}

/** Ingredient layer colour for the carried burger. */
export const LAYER_COLOR: Record<Ingredient, string> = {
  cheese: "#f5b82e", lettuce: "#5fbf4a", sausage: "#a8452c", sauce: "#d8322a",
  mayo: "#f3ead2", cucumber: "#2f8f4e", carrot: "#ef7d22", tomato: "#e5483a",
};

/* ------------------------------ gates ------------------------------------ */

/** Visual-only gate shape (structurally a PublicGate; correctLane never read). */
export type DrawableGate =
  | { kind: "math"; a: number; op: MathOp; b: number; lanes: readonly [number, number] }
  | { kind: "ingredient"; lanes: readonly [Ingredient, Ingredient] }
  | { kind: "negative"; spoiled: Ingredient; spoiledLane: Lane }
  | { kind: "op"; lanes: readonly [{ op: MathOp; v: number }, { op: MathOp; v: number }] };

/** Lane label for an operation choice, e.g. "+12", "×2", "÷2". */
export function opLabel(c: { op: MathOp; v: number }): string {
  return `${c.op}${c.v}`;
}
/** Colour family: growth ops warm/gold, shrinking ops red. Same info as the label. */
export function opTone(c: { op: MathOp; v: number }): "grow" | "shrink" {
  return c.op === "+" || c.op === "×" ? "grow" : "shrink";
}

function rr(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath(); ctx.roundRect(x, y, w, h, Math.max(0, r));
}

/** Arch frame for one lane: two pillars + rounded top bar. */
function portal(ctx: Ctx, x: number, top: number, w: number, h: number, s: number, frame: string, glow: string, inner: string) {
  ctx.fillStyle = inner; ctx.globalAlpha = 0.55; rr(ctx, x, top, w, h, 10 * s); ctx.fill(); ctx.globalAlpha = 1;
  ctx.shadowColor = glow; ctx.shadowBlur = 10 * s;
  ctx.lineWidth = Math.max(1.5, 4 * s); ctx.strokeStyle = frame; rr(ctx, x, top, w, h, 10 * s); ctx.stroke();
  ctx.shadowBlur = 0;
}

export function drawGate(ctx: Ctx, gate: DrawableGate, p: Projected, C: Colors, now: number, index: number, gateCount: number) {
  ctx.save();
  try {
    const s = p.scale, mid = (p.left + p.right) / 2;
    const w = (p.right - p.left) / 2 - 8 * s, h = 82 * s, top = p.y - h;
    const lx = p.left + 4 * s, rx = mid + 4 * s;
    const cxL = lx + w / 2, cxR = rx + w / 2, cy = top + h / 2;
    ctx.textAlign = "center"; ctx.textBaseline = "middle";

    if (gate.kind === "op") {
      // compact top bar (thin, so upcoming gates stay visible behind it)
      const gy = top - 16 * s;
      ctx.fillStyle = "#23201e"; rr(ctx, p.left - 4 * s, gy, p.right - p.left + 8 * s, 12 * s, 4 * s); ctx.fill();
      ctx.lineWidth = Math.max(1, 1.5 * s); ctx.strokeStyle = C.primary; ctx.stroke();
      ctx.fillStyle = "#fff4e6"; ctx.font = `800 ${Math.max(6, 9 * s)}px system-ui, sans-serif`;
      if (s > 0.3) ctx.fillText("FLAMIO BOOST", mid, gy + 6 * s);
      for (const [x, cx, c] of [[lx, cxL, gate.lanes[0]], [rx, cxR, gate.lanes[1]]] as const) {
        // Unified FLAMIO portal for both lanes — colour never reveals the better choice.
        portal(ctx, x, top, w, h, s, "#f26b1d", "#ff8a3d", "#23201e");
        ctx.font = `900 ${Math.max(9, 30 * s)}px system-ui, sans-serif`;
        ctx.lineWidth = Math.max(1, 4 * s); ctx.strokeStyle = "#0b0705";
        const t = opLabel(c);
        ctx.strokeText(t, cx, cy); ctx.fillStyle = "#fff4e6"; ctx.fillText(t, cx, cy);
      }
    } else if (gate.kind === "math") {
      // gantry
      const gy = top - 34 * s;
      ctx.fillStyle = "#23201e"; ctx.fillRect(p.left - 4 * s, gy, 7 * s, h + 34 * s); ctx.fillRect(p.right - 3 * s, gy, 7 * s, h + 34 * s);
      ctx.fillStyle = "#2b2623"; rr(ctx, p.left - 6 * s, gy - 4 * s, p.right - p.left + 12 * s, 28 * s, 6 * s); ctx.fill();
      ctx.lineWidth = Math.max(1, 2.5 * s); ctx.strokeStyle = C.primary; ctx.stroke();
      for (let k = 0; k < 9; k++) {
        const bx = p.left + ((p.right - p.left) * (k + 0.5)) / 9;
        ctx.fillStyle = (Math.floor(now / 200) + k) % 3 === 0 ? "#ffd38a" : "#7c3a12";
        ctx.beginPath(); ctx.arc(bx, gy + 26 * s, 1.8 * s + 0.4, 0, Math.PI * 2); ctx.fill();
      }
      ctx.fillStyle = "#fff4e6"; ctx.font = `900 ${Math.max(8, 19 * s)}px system-ui, sans-serif`;
      ctx.fillText(`${gate.a} ${gate.op} ${gate.b} = ?`, mid, gy + 10 * s);
      portal(ctx, lx, top, w, h, s, "#ff8a3d", "#ff6a00", "#3a1d0c");
      portal(ctx, rx, top, w, h, s, "#ffc24a", "#ffae00", "#3a1d0c");
      ctx.font = `900 ${Math.max(9, 34 * s)}px system-ui, sans-serif`;
      ctx.lineWidth = Math.max(1, 4 * s); ctx.strokeStyle = "#1a0d05";
      for (const [cx, v] of [[cxL, gate.lanes[0]], [cxR, gate.lanes[1]]] as const) {
        ctx.strokeText(String(v), cx, cy); ctx.fillStyle = "#ffffff"; ctx.fillText(String(v), cx, cy);
      }
    } else if (gate.kind === "ingredient") {
      portal(ctx, lx, top, w, h, s, "#f5b82e", "#f26b1d", "#2a1a10");
      portal(ctx, rx, top, w, h, s, "#f5b82e", "#f26b1d", "#2a1a10");
      const r = Math.min(w, h) * 0.32;
      drawFood(ctx, gate.lanes[0], cxL, cy, r);
      drawFood(ctx, gate.lanes[1], cxR, cy, r);
    } else {
      const bad = gate.spoiledLane === 0 ? { x: lx, cx: cxL } : { x: rx, cx: cxR };
      const good = gate.spoiledLane === 0 ? { x: rx, cx: cxR } : { x: lx, cx: cxL };
      // spoiled lane
      portal(ctx, bad.x, top, w, h, s, "#f26b1d", "#ff8a3d", "#23201e");
      const r = Math.min(w, h) * 0.3;
      drawFood(ctx, gate.spoiled, bad.cx, cy + 4 * s, r, true);
      ctx.strokeStyle = "rgba(180,120,255,0.7)"; ctx.lineWidth = Math.max(1, 2 * s);
      for (let k = -1; k <= 1; k++) {
        const fx = bad.cx + k * r * 0.6, ph = now / 260 + k;
        ctx.beginPath(); ctx.moveTo(fx, cy - r * 0.6);
        for (let j = 1; j <= 4; j++) ctx.lineTo(fx + Math.sin(ph + j) * 4 * s, cy - r * 0.6 - j * 6 * s);
        ctx.stroke();
      }
      // hazard badge
      const bx = bad.x + w - 12 * s, by = top + 12 * s, br = 9 * s;
      ctx.beginPath(); ctx.moveTo(bx, by - br); ctx.lineTo(bx + br, by + br * 0.8); ctx.lineTo(bx - br, by + br * 0.8); ctx.closePath();
      ctx.fillStyle = "#facc15"; ctx.fill(); ctx.strokeStyle = "#1a1a1a"; ctx.lineWidth = Math.max(1, 1.5 * s); ctx.stroke();
      ctx.fillStyle = "#1a1a1a"; ctx.font = `900 ${Math.max(6, 11 * s)}px system-ui, sans-serif`; ctx.fillText("!", bx, by + br * 0.15);
      // safe lane
      portal(ctx, good.x, top, w, h, s, "#f26b1d", "#ff8a3d", "#23201e");
      ctx.fillStyle = "#ffe2b8";
      for (let k = 0; k < 5; k++) {
        const t = (now / 600 + k * 0.37) % 1;
        const sx = good.x + w * (0.15 + 0.7 * ((k * 0.53) % 1)), sy = top + h * (0.2 + 0.6 * t), ss = (1 - Math.abs(t - 0.5) * 2) * 4 * s + 0.5;
        ctx.beginPath(); ctx.moveTo(sx, sy - ss); ctx.lineTo(sx + ss * 0.3, sy); ctx.lineTo(sx, sy + ss); ctx.lineTo(sx - ss * 0.3, sy); ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = "#ffd38a"; ctx.lineWidth = Math.max(1.5, 4 * s);
      ctx.beginPath(); ctx.moveTo(good.cx - 10 * s, cy); ctx.lineTo(good.cx - 2 * s, cy + 9 * s); ctx.lineTo(good.cx + 13 * s, cy - 10 * s); ctx.stroke();
    }

    // milestones (visual only)
    if (index === gateCount - 1) drawFinishArch(ctx, p, now);
    else if (gateCount >= 15 && index === 14) drawHalfwayArch(ctx, p, gateCount);
  } catch { /* procedural fallback */ }
  ctx.restore();
}

function drawHalfwayArch(ctx: Ctx, p: Projected, gateCount: number) {
  const s = p.scale, top = p.y - 150 * s;
  ctx.fillStyle = "#23201e"; ctx.fillRect(p.left - 14 * s, top, 8 * s, 150 * s); ctx.fillRect(p.right + 6 * s, top, 8 * s, 150 * s);
  rr(ctx, p.left - 18 * s, top - 6 * s, p.right - p.left + 36 * s, 24 * s, 12 * s);
  ctx.fillStyle = "#f26b1d"; ctx.fill();
  ctx.fillStyle = "#fff7e0"; ctx.font = `900 ${Math.max(7, 15 * s)}px system-ui, sans-serif`;
  ctx.fillText(gateCount === 30 ? "HALFWAY! 15/30" : "HALFWAY!", (p.left + p.right) / 2, top + 6 * s);
  for (const fx of [p.left - 10 * s, p.right + 10 * s]) {
    ctx.fillStyle = "#ffb703";
    ctx.beginPath(); ctx.moveTo(fx, top - 6 * s); ctx.lineTo(fx, top - 30 * s); ctx.lineTo(fx + 16 * s, top - 22 * s); ctx.lineTo(fx, top - 16 * s); ctx.fill();
  }
}

function drawFinishArch(ctx: Ctx, p: Projected, now: number) {
  const s = p.scale, top = p.y - 170 * s, mid = (p.left + p.right) / 2, span = p.right - p.left + 40 * s;
  ctx.fillStyle = "#23201e"; ctx.fillRect(p.left - 20 * s, top, 12 * s, 170 * s); ctx.fillRect(p.right + 8 * s, top, 12 * s, 170 * s);
  // checkered band
  const cells = 16, cw = span / cells, by = top + 26 * s;
  for (let r = 0; r < 2; r++) for (let c = 0; c < cells; c++) {
    ctx.fillStyle = (r + c) % 2 ? "#111" : "#fafafa"; ctx.fillRect(p.left - 20 * s + c * cw, by + r * 6 * s, cw + 0.5, 6 * s);
  }
  rr(ctx, p.left - 22 * s, top - 4 * s, span + 4 * s, 30 * s, 8 * s); ctx.fillStyle = "#2b2623"; ctx.fill();
  ctx.lineWidth = Math.max(1, 3 * s); ctx.strokeStyle = "#f26b1d"; ctx.stroke();
  ctx.fillStyle = "#ffcc66"; ctx.font = `900 ${Math.max(8, 19 * s)}px system-ui, sans-serif`;
  ctx.fillText("FLAMIO FINISH", mid, top + 11 * s);
  // spotlights + sparks
  ctx.globalAlpha = 0.18; ctx.fillStyle = "#ffe8b0";
  for (const sx of [p.left - 14 * s, p.right + 14 * s]) {
    ctx.beginPath(); ctx.moveTo(sx, top); ctx.lineTo(mid - 30 * s, p.y); ctx.lineTo(mid + 30 * s, p.y); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1; ctx.fillStyle = "#ffd166";
  for (let k = 0; k < 6; k++) {
    const t = (now / 500 + k / 6) % 1, side = k % 2 ? p.right + 14 * s : p.left - 14 * s;
    ctx.beginPath(); ctx.arc(side + (k % 2 ? 1 : -1) * t * 18 * s, top - 4 * s - t * 20 * s + t * t * 30 * s, 2 * s * (1 - t) + 0.3, 0, Math.PI * 2); ctx.fill();
  }
}
