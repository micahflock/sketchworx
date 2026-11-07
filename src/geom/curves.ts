import { bezierClosest, bezierDeriv, bezierPoint } from "./bezier";
import type { Vec2 } from "./vec";
import { angleInSweep, ccwSweep, cross, dist, dot, normAngle, sub } from "./vec";

/**
 * Curves for editing tools. Every curve has a parameter t:
 * line [0,1] from a to b; arc [0,1] over its CCW sweep; circle [0,1) from angle 0;
 * bezier [0,1].
 */
export type Curve =
  | { kind: "line"; a: Vec2; b: Vec2 }
  | { kind: "circle"; c: Vec2; r: number }
  | { kind: "arc"; c: Vec2; r: number; a0: number; a1: number }
  | { kind: "bezier"; cps: Vec2[] };

export function curvePoint(cv: Curve, t: number): Vec2 {
  switch (cv.kind) {
    case "line":
      return { x: cv.a.x + (cv.b.x - cv.a.x) * t, y: cv.a.y + (cv.b.y - cv.a.y) * t };
    case "circle": {
      const a = t * Math.PI * 2;
      return { x: cv.c.x + cv.r * Math.cos(a), y: cv.c.y + cv.r * Math.sin(a) };
    }
    case "arc": {
      const a = cv.a0 + ccwSweep(cv.a0, cv.a1) * t;
      return { x: cv.c.x + cv.r * Math.cos(a), y: cv.c.y + cv.r * Math.sin(a) };
    }
    case "bezier":
      return bezierPoint(cv.cps, t);
  }
}

/** Unit-free tangent (direction of increasing t). */
export function curveTangent(cv: Curve, t: number): Vec2 {
  switch (cv.kind) {
    case "line":
      return sub(cv.b, cv.a);
    case "circle":
    case "arc": {
      const p = curvePoint(cv, t);
      return { x: -(p.y - cv.c.y), y: p.x - cv.c.x };
    }
    case "bezier":
      return bezierDeriv(cv.cps, t);
  }
}

/** Parameter of the point on the curve closest to p. */
export function curveParam(cv: Curve, p: Vec2): number {
  switch (cv.kind) {
    case "line": {
      const ab = sub(cv.b, cv.a);
      const l2 = dot(ab, ab) || 1;
      return Math.max(0, Math.min(1, dot(sub(p, cv.a), ab) / l2));
    }
    case "circle":
      return normAngle(Math.atan2(p.y - cv.c.y, p.x - cv.c.x)) / (Math.PI * 2);
    case "arc": {
      const sw = ccwSweep(cv.a0, cv.a1);
      const d = normAngle(Math.atan2(p.y - cv.c.y, p.x - cv.c.x) - cv.a0);
      if (d <= sw) return d / sw;
      // Outside the sweep: nearest end.
      return d - sw < Math.PI * 2 - d ? 1 : 0;
    }
    case "bezier":
      return bezierClosest(cv.cps, p).t;
  }
}

export interface Hit2 {
  p: Vec2;
  t1: number;
  t2: number;
}

const EPS = 1e-9;

function lineLine(a: Curve & { kind: "line" }, b: Curve & { kind: "line" }, infA = false, infB = false): Hit2[] {
  const r = sub(a.b, a.a);
  const s = sub(b.b, b.a);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-12) return [];
  const qp = sub(b.a, a.a);
  const t = cross(qp, s) / den;
  const u = cross(qp, r) / den;
  if ((!infA && (t < -EPS || t > 1 + EPS)) || (!infB && (u < -EPS || u > 1 + EPS))) return [];
  return [{ p: { x: a.a.x + r.x * t, y: a.a.y + r.y * t }, t1: t, t2: u }];
}

/** Line (as a parametric segment or infinite line) against a full circle; returns line params. */
function lineCircleRaw(a: Vec2, b: Vec2, c: Vec2, r: number): number[] {
  const d = sub(b, a);
  const f = sub(a, c);
  const A = dot(d, d);
  const B = 2 * dot(f, d);
  const C = dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (A < 1e-24 || disc < -1e-12 * Math.max(1, A * r * r)) return [];
  if (disc <= 0) return [-B / (2 * A)];
  const sq = Math.sqrt(disc);
  return [(-B - sq) / (2 * A), (-B + sq) / (2 * A)];
}

function roundParam(cv: Curve & { kind: "circle" | "arc" }, p: Vec2): number | null {
  const ang = Math.atan2(p.y - cv.c.y, p.x - cv.c.x);
  if (cv.kind === "circle") return normAngle(ang) / (Math.PI * 2);
  if (!angleInSweep(ang, cv.a0, cv.a1)) {
    // tolerate tiny overshoot at the ends
    const sw = ccwSweep(cv.a0, cv.a1);
    const d = normAngle(ang - cv.a0);
    if (d - sw < 1e-9) return 1;
    if (Math.PI * 2 - d < 1e-9) return 0;
    return null;
  }
  return normAngle(ang - cv.a0) / ccwSweep(cv.a0, cv.a1);
}

function circleCircle(c1: Vec2, r1: number, c2: Vec2, r2: number): Vec2[] {
  const d = dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 + 1e-9 || d < Math.abs(r1 - r2) - 1e-9) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = h2 > 0 ? Math.sqrt(h2) : 0;
  const ux = (c2.x - c1.x) / d;
  const uy = (c2.y - c1.y) / d;
  const px = c1.x + a * ux;
  const py = c1.y + a * uy;
  if (h < 1e-12) return [{ x: px, y: py }];
  return [
    { x: px - h * uy, y: py + h * ux },
    { x: px + h * uy, y: py - h * ux },
  ];
}

/** Polyline sampling for Bézier intersections, refined by bisection on the segment parameter. */
function sampled(cv: Curve, n = 96): { pts: Vec2[]; ts: number[] } {
  const ts: number[] = [];
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    ts.push(t);
    pts.push(curvePoint(cv, t));
  }
  return { pts, ts };
}

/**
 * Intersections of two curves. With `infiniteA`, a line `a` is treated as infinite
 * (used by Extend); its t1 may then be outside [0,1].
 */
export function intersect(a: Curve, b: Curve, infiniteA = false): Hit2[] {
  if (a.kind === "line" && b.kind === "line") return lineLine(a, b, infiniteA);
  if (a.kind === "line" && (b.kind === "circle" || b.kind === "arc")) {
    const out: Hit2[] = [];
    for (const t of lineCircleRaw(a.a, a.b, b.c, b.r)) {
      if (!infiniteA && (t < -EPS || t > 1 + EPS)) continue;
      const p = curvePoint({ kind: "line", a: a.a, b: a.b }, t);
      const t2 = roundParam(b, p);
      if (t2 !== null) out.push({ p, t1: t, t2 });
    }
    return out;
  }
  if ((a.kind === "circle" || a.kind === "arc") && b.kind === "line") return intersect(b, a).map((h) => ({ p: h.p, t1: h.t2, t2: h.t1 }));
  if ((a.kind === "circle" || a.kind === "arc") && (b.kind === "circle" || b.kind === "arc")) {
    const out: Hit2[] = [];
    for (const p of circleCircle(a.c, a.r, b.c, b.r)) {
      const t1 = roundParam(a, p);
      const t2 = roundParam(b, p);
      if (t1 !== null && t2 !== null) out.push({ p, t1, t2 });
    }
    return out;
  }
  // At least one Bézier: polyline intersection then local refinement.
  const A = sampled(a);
  const B = b.kind === "line" ? { pts: [b.a, b.b], ts: [0, 1] } : sampled(b);
  const out: Hit2[] = [];
  for (let i = 0; i < A.pts.length - 1; i++)
    for (let j = 0; j < B.pts.length - 1; j++) {
      const h = lineLine({ kind: "line", a: A.pts[i], b: A.pts[i + 1] }, { kind: "line", a: B.pts[j], b: B.pts[j + 1] });
      if (!h.length) continue;
      let t1 = A.ts[i] + (A.ts[i + 1] - A.ts[i]) * h[0].t1;
      let t2 = B.ts[j] + (B.ts[j + 1] - B.ts[j]) * h[0].t2;
      // Newton refinement on F(t1,t2) = A(t1) - B(t2).
      for (let k = 0; k < 8; k++) {
        const pa = curvePoint(a, t1);
        const pb = curvePoint(b, t2);
        const da = curveTangent(a, t1);
        const db = curveTangent(b, t2);
        const fx = pa.x - pb.x;
        const fy = pa.y - pb.y;
        const det = -da.x * db.y + da.y * db.x;
        if (Math.abs(det) < 1e-14) break;
        const dt1 = (-fx * db.y + fy * db.x) / det;
        const dt2 = (da.x * fy - da.y * fx) / det;
        t1 = Math.min(1, Math.max(0, t1 - dt1));
        t2 = Math.min(1, Math.max(0, t2 - dt2));
      }
      const p = curvePoint(a, t1);
      if (!out.some((o) => dist(o.p, p) < 1e-7)) out.push({ p, t1, t2 });
    }
  return out;
}
