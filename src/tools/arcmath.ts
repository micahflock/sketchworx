import type { Vec2 } from "../geom/vec";
import { cross, dot, norm, perp, scale, sub, add, circleFrom3 } from "../geom/vec";

export interface ArcPreview {
  c: Vec2;
  r: number;
  /** Angle of the travel start and end. */
  a0: number;
  a1: number;
  /** Travel direction: true = CCW from start to end. */
  ccw: boolean;
  /** Tangent direction at the end, in travel direction. */
  endDir: Vec2;
}

/** Arc leaving `start` tangent to `dir` and ending at `end`. */
export function tangentArcFrom(start: Vec2, dir: Vec2, end: Vec2): ArcPreview | null {
  const n = perp(norm(dir));
  const w = sub(start, end);
  const nw = dot(n, w);
  if (Math.abs(nw) < 1e-9 * Math.max(1, dot(w, w))) return null;
  const t = -dot(w, w) / (2 * nw);
  const c = add(start, scale(n, t));
  const r = Math.abs(t);
  const ccw = t > 0;
  const a0 = Math.atan2(start.y - c.y, start.x - c.x);
  const a1 = Math.atan2(end.y - c.y, end.x - c.x);
  const radial = norm(sub(end, c));
  const endDir = ccw ? perp(radial) : scale(perp(radial), -1);
  return { c, r, a0, a1, ccw, endDir };
}

/** Arc through start, end, passing through `via`. */
export function arcFrom3(start: Vec2, end: Vec2, via: Vec2): ArcPreview | null {
  const circ = circleFrom3(start, via, end);
  if (!circ) return null;
  // CCW if via is to the left... use orientation of (start, via, end).
  const ccw = cross(sub(via, start), sub(end, via)) > 0;
  const a0 = Math.atan2(start.y - circ.c.y, start.x - circ.c.x);
  const a1 = Math.atan2(end.y - circ.c.y, end.x - circ.c.x);
  const radial = norm(sub(end, circ.c));
  return { c: circ.c, r: circ.r, a0, a1, ccw, endDir: ccw ? perp(radial) : scale(perp(radial), -1) };
}
