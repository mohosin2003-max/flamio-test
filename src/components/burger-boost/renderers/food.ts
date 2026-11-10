/**
 * Procedural vector food art for Burger Boost (visual only, browser only).
 * One function per ingredient key; `r` is the icon radius in CSS px.
 */
import type { Ingredient } from "@/lib/burger-boost-rules";

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
