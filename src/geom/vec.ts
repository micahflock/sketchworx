export interface Vec2 {
  x: number;
  y: number;
}

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const mid = (a: Vec2, b: Vec2): Vec2 => lerp(a, b, 0.5);
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });
export const norm = (a: Vec2): Vec2 => {
  const l = len(a);
  return l < 1e-12 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
export const angleOf = (a: Vec2): number => Math.atan2(a.y, a.x);
export const polar = (c: Vec2, r: number, ang: number): Vec2 => ({ x: c.x + r * Math.cos(ang), y: c.y + r * Math.sin(ang) });

/** Normalize an angle into [0, 2π). */
export function normAngle(a: number): number {
  const t = Math.PI * 2;
  a = a % t;
  return a < 0 ? a + t : a;
}

/** CCW sweep from a0 to a1 in (0, 2π]. */
export function ccwSweep(a0: number, a1: number): number {
  const s = normAngle(a1 - a0);
  return s === 0 ? Math.PI * 2 : s;
}

/** True when angle a lies within the CCW sweep from a0 to a1. */
export function angleInSweep(a: number, a0: number, a1: number): boolean {
  return normAngle(a - a0) <= ccwSweep(a0, a1) + 1e-12;
}

export function distToSegment(p: Vec2, a: Vec2, b: Vec2): number {
  return dist(p, closestOnSegment(p, a, b));
}

export function closestOnSegment(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-24) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return lerp(a, b, t);
}

/** Parameter t of p projected onto infinite line a→b. */
export function projectParam(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  return l2 < 1e-24 ? 0 : dot(sub(p, a), ab) / l2;
}

export function distToLineInf(p: Vec2, a: Vec2, b: Vec2): number {
  const ab = sub(b, a);
  const l = len(ab);
  if (l < 1e-12) return dist(p, a);
  return Math.abs(cross(ab, sub(p, a))) / l;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const emptyBox = (): Box => ({ minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity });
export function boxAdd(b: Box, p: Vec2): Box {
  b.minX = Math.min(b.minX, p.x);
  b.minY = Math.min(b.minY, p.y);
  b.maxX = Math.max(b.maxX, p.x);
  b.maxY = Math.max(b.maxY, p.y);
  return b;
}
export const boxValid = (b: Box) => b.minX <= b.maxX && b.minY <= b.maxY;
export const inBox = (p: Vec2, b: Box) => p.x >= b.minX && p.x <= b.maxX && p.y >= b.minY && p.y <= b.maxY;

/** Segment vs axis-aligned box intersection (Liang–Barsky). */
export function segmentHitsBox(a: Vec2, b: Vec2, box: Box): boolean {
  if (inBox(a, box) || inBox(b, box)) return true;
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const p = [-dx, dx, -dy, dy];
  const q = [a.x - box.minX, box.maxX - a.x, a.y - box.minY, box.maxY - a.y];
  for (let i = 0; i < 4; i++) {
    if (Math.abs(p[i]) < 1e-15) {
      if (q[i] < 0) return false;
    } else {
      const t = q[i] / p[i];
      if (p[i] < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/** Circle through three points, or null when collinear. */
export function circleFrom3(a: Vec2, b: Vec2, c: Vec2): { c: Vec2; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y;
  const b2 = b.x * b.x + b.y * b.y;
  const c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  const center = { x: ux, y: uy };
  return { c: center, r: dist(center, a) };
}
