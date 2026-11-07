import type { Vec2 } from "./vec";

/** Evaluate a Bézier of any degree at t (de Casteljau). */
export function bezierPoint(cps: Vec2[], t: number): Vec2 {
  const pts = cps.map((p) => ({ x: p.x, y: p.y }));
  for (let k = pts.length - 1; k > 0; k--)
    for (let i = 0; i < k; i++) {
      pts[i].x += (pts[i + 1].x - pts[i].x) * t;
      pts[i].y += (pts[i + 1].y - pts[i].y) * t;
    }
  return pts[0];
}

/** First derivative of a Bézier at t. */
export function bezierDeriv(cps: Vec2[], t: number): Vec2 {
  const n = cps.length - 1;
  if (n < 1) return { x: 0, y: 0 };
  const d: Vec2[] = [];
  for (let i = 0; i < n; i++) d.push({ x: n * (cps[i + 1].x - cps[i].x), y: n * (cps[i + 1].y - cps[i].y) });
  return bezierPoint(d, t);
}

export function bezierDeriv2(cps: Vec2[], t: number): Vec2 {
  const n = cps.length - 1;
  if (n < 2) return { x: 0, y: 0 };
  const d: Vec2[] = [];
  for (let i = 0; i < n; i++) d.push({ x: n * (cps[i + 1].x - cps[i].x), y: n * (cps[i + 1].y - cps[i].y) });
  return bezierDeriv(d, t);
}

/** Signed curvature at t. */
export function bezierCurvature(cps: Vec2[], t: number): number {
  const d1 = bezierDeriv(cps, t);
  const d2 = bezierDeriv2(cps, t);
  const s = Math.hypot(d1.x, d1.y);
  if (s < 1e-12) return 0;
  return (d1.x * d2.y - d1.y * d2.x) / (s * s * s);
}

/** Split a Bézier at t into two Béziers of the same degree. */
export function bezierSplit(cps: Vec2[], t: number): [Vec2[], Vec2[]] {
  const left: Vec2[] = [];
  const right: Vec2[] = [];
  let pts = cps.map((p) => ({ ...p }));
  while (pts.length) {
    left.push(pts[0]);
    right.unshift(pts[pts.length - 1]);
    const next: Vec2[] = [];
    for (let i = 0; i < pts.length - 1; i++)
      next.push({ x: pts[i].x + (pts[i + 1].x - pts[i].x) * t, y: pts[i].y + (pts[i + 1].y - pts[i].y) * t });
    pts = next;
  }
  return [left, right];
}

/** Polyline approximation. */
export function bezierPolyline(cps: Vec2[], segments = 48): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= segments; i++) out.push(bezierPoint(cps, i / segments));
  return out;
}

/** Elevate/approximate a Bézier of degree > 3 with cubic segments within tolerance. */
export function toCubics(cps: Vec2[], tol = 1e-3, depth = 0): Vec2[][] {
  const n = cps.length - 1;
  if (n === 1) {
    const [a, b] = cps;
    return [[a, { x: a.x + (b.x - a.x) / 3, y: a.y + (b.y - a.y) / 3 }, { x: a.x + (2 * (b.x - a.x)) / 3, y: a.y + (2 * (b.y - a.y)) / 3 }, b]];
  }
  if (n === 2) {
    const [a, c, b] = cps;
    return [[a, { x: a.x + (2 / 3) * (c.x - a.x), y: a.y + (2 / 3) * (c.y - a.y) }, { x: b.x + (2 / 3) * (c.x - b.x), y: b.y + (2 / 3) * (c.y - b.y) }, b]];
  }
  if (n === 3) return [cps];
  // Hermite fit: match endpoints and end tangents, then check error.
  const p0 = cps[0];
  const p3 = cps[n];
  const d0 = bezierDeriv(cps, 0);
  const d1 = bezierDeriv(cps, 1);
  const cubic = [p0, { x: p0.x + d0.x / 3, y: p0.y + d0.y / 3 }, { x: p3.x - d1.x / 3, y: p3.y - d1.y / 3 }, p3];
  let err = 0;
  for (let i = 1; i < 16; i++) {
    const t = i / 16;
    const a = bezierPoint(cps, t);
    const b = bezierPoint(cubic, t);
    err = Math.max(err, Math.hypot(a.x - b.x, a.y - b.y));
  }
  if (err <= tol || depth > 8) return [cubic];
  const [l, r] = bezierSplit(cps, 0.5);
  return [...toCubics(l, tol, depth + 1), ...toCubics(r, tol, depth + 1)];
}

/** Closest parameter on a Bézier to p (sampling + Newton refinement). */
export function bezierClosest(cps: Vec2[], p: Vec2): { t: number; d: number; pt: Vec2 } {
  let bestT = 0;
  let best = Infinity;
  const N = 32;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const q = bezierPoint(cps, t);
    const d = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (d < best) {
      best = d;
      bestT = t;
    }
  }
  let t = bestT;
  for (let k = 0; k < 6; k++) {
    const q = bezierPoint(cps, t);
    const d1 = bezierDeriv(cps, t);
    const d2 = bezierDeriv2(cps, t);
    const f = (q.x - p.x) * d1.x + (q.y - p.y) * d1.y;
    const fp = d1.x * d1.x + d1.y * d1.y + (q.x - p.x) * d2.x + (q.y - p.y) * d2.y;
    if (Math.abs(fp) < 1e-12) break;
    t = Math.min(1, Math.max(0, t - f / fp));
  }
  const q = bezierPoint(cps, t);
  return { t, d: Math.hypot(q.x - p.x, q.y - p.y), pt: q };
}
