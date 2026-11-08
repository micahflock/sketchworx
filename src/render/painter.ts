import type { Vec2 } from "../geom/vec";
import { theme } from "./theme";
import type { View } from "./view";

export interface StrokeStyle {
  color: string;
  width?: number;
  dash?: number[];
  /** Draw as a zigzag along the path (HELL MODE over defined). */
  jagged?: boolean;
}

/** Thin wrapper over Canvas 2D that takes sketch coordinates. */
export class Painter {
  constructor(public ctx: CanvasRenderingContext2D, public view: View) {}

  s(p: Vec2): Vec2 {
    return this.view.toScreen(p);
  }

  private stroke(st: StrokeStyle) {
    const c = this.ctx;
    c.strokeStyle = st.color;
    c.lineWidth = st.width ?? 1.5;
    c.setLineDash(st.dash ?? []);
    c.stroke();
  }

  line(a: Vec2, b: Vec2, st: StrokeStyle) {
    const A = this.s(a);
    const B = this.s(b);
    const c = this.ctx;
    c.beginPath();
    c.moveTo(A.x, A.y);
    c.lineTo(B.x, B.y);
    this.stroke(st);
  }

  polyline(pts: Vec2[], st: StrokeStyle, close = false) {
    if (pts.length < 2) return;
    const c = this.ctx;
    c.beginPath();
    const p0 = this.s(pts[0]);
    c.moveTo(p0.x, p0.y);
    for (let i = 1; i < pts.length; i++) {
      const p = this.s(pts[i]);
      c.lineTo(p.x, p.y);
    }
    if (close) c.closePath();
    this.stroke(st);
  }

  circle(center: Vec2, r: number, st: StrokeStyle) {
    const C = this.s(center);
    const c = this.ctx;
    c.beginPath();
    c.arc(C.x, C.y, Math.max(0, r * this.view.scale), 0, Math.PI * 2);
    this.stroke(st);
  }

  /** CCW (in world space) arc from angle a0 to a1. */
  arc(center: Vec2, r: number, a0: number, a1: number, st: StrokeStyle) {
    const C = this.s(center);
    const c = this.ctx;
    c.beginPath();
    // Screen is y-flipped, so a world-CCW arc is screen-CW with negated angles.
    c.arc(C.x, C.y, Math.max(0, r * this.view.scale), -a0, -a1, true);
    this.stroke(st);
  }

  bezier(cps: Vec2[], st: StrokeStyle) {
    const c = this.ctx;
    const P = cps.map((p) => this.s(p));
    c.beginPath();
    c.moveTo(P[0].x, P[0].y);
    if (P.length === 2) c.lineTo(P[1].x, P[1].y);
    else if (P.length === 3) c.quadraticCurveTo(P[1].x, P[1].y, P[2].x, P[2].y);
    else if (P.length === 4) c.bezierCurveTo(P[1].x, P[1].y, P[2].x, P[2].y, P[3].x, P[3].y);
    else {
      const N = 64;
      for (let i = 1; i <= N; i++) {
        const q = deCasteljau(P, i / N);
        c.lineTo(q.x, q.y);
      }
    }
    this.stroke(st);
  }

  /** A polyline (sketch coordinates) drawn as a small even zigzag in screen space. */
  zigzag(pts: Vec2[], st: StrokeStyle, step = 4, amp = 2) {
    if (pts.length < 2) return;
    const P = pts.map((q) => this.s(q));
    const c = this.ctx;
    c.beginPath();
    c.moveTo(P[0].x, P[0].y);
    let side = 1;
    let carry = 0; // distance walked since the last zig
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1];
      const b = P[i];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      if (len < 1e-9) continue;
      const ux = (b.x - a.x) / len;
      const uy = (b.y - a.y) / len;
      let t = step - carry;
      for (; t < len; t += step) {
        c.lineTo(a.x + ux * t - uy * amp * side, a.y + uy * t + ux * amp * side);
        side = -side;
      }
      carry = len - (t - step);
    }
    c.lineTo(P[P.length - 1].x, P[P.length - 1].y);
    this.stroke({ ...st, dash: undefined });
  }

  /** ✕ mark at a screen position. */
  crossScreen(x: number, y: number, size: number, color: string, width = 2) {
    const c = this.ctx;
    const h = size / 2;
    c.beginPath();
    c.moveTo(x - h, y - h);
    c.lineTo(x + h, y + h);
    c.moveTo(x + h, y - h);
    c.lineTo(x - h, y + h);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash([]);
    c.stroke();
  }

  dot(p: Vec2, radiusPx: number, color: string) {
    const P = this.s(p);
    const c = this.ctx;
    c.beginPath();
    c.arc(P.x, P.y, radiusPx, 0, Math.PI * 2);
    c.fillStyle = color;
    c.fill();
  }

  ring(p: Vec2, radiusPx: number, color: string, width = 1.5) {
    const P = this.s(p);
    const c = this.ctx;
    c.beginPath();
    c.arc(P.x, P.y, radiusPx, 0, Math.PI * 2);
    c.strokeStyle = color;
    c.lineWidth = width;
    c.setLineDash([]);
    c.stroke();
  }

  /** Text at a screen position. */
  textScreen(text: string, x: number, y: number, color: string, font = "12px system-ui, sans-serif", align: CanvasTextAlign = "center") {
    const c = this.ctx;
    c.font = font;
    c.fillStyle = color;
    c.textAlign = align;
    c.textBaseline = "middle";
    c.fillText(text, x, y);
  }

  /** Square glyph tag at a screen position (theme font and corner radius); returns its rect. */
  badge(text: string, x: number, y: number, bg: string, fg: string, border?: string) {
    const c = this.ctx;
    c.font = theme.glyphFont;
    const w = Math.max(14, c.measureText(text).width + 6);
    const h = 14;
    c.beginPath();
    c.roundRect(x - w / 2, y - h / 2, w, h, theme.glyphRadius);
    c.fillStyle = bg;
    c.fill();
    if (border) {
      c.strokeStyle = border;
      c.lineWidth = 1;
      c.setLineDash([]);
      c.stroke();
    }
    c.fillStyle = fg;
    c.textAlign = "center";
    c.textBaseline = "middle";
    c.fillText(text, x, y + 0.5);
    return { x: x - w / 2, y: y - h / 2, w, h };
  }
}

function deCasteljau(P: Vec2[], t: number): Vec2 {
  const q = P.map((p) => ({ ...p }));
  for (let k = q.length - 1; k > 0; k--)
    for (let i = 0; i < k; i++) {
      q[i].x += (q[i + 1].x - q[i].x) * t;
      q[i].y += (q[i + 1].y - q[i].y) * t;
    }
  return q[0];
}
