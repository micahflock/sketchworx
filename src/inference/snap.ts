import { bezierClosest } from "../geom/bezier";
import type { Vec2 } from "../geom/vec";
import { angleInSweep, closestOnSegment, dist, mid, polar, sub } from "../geom/vec";
import { arcGeom, ptv, splinePts } from "../model/sketch";
import type { Id, Sketch } from "../model/types";

export type InferGlyph = "coincident" | "midpoint" | "on" | "H" | "V" | "tangent" | "perpendicular" | "grid";

export interface SnapResult {
  pos: Vec2;
  /** Coincide with this existing point. */
  point?: Id;
  /** Lies on this curve. */
  curve?: Id;
  /** Sits at the midpoint of this line. */
  midpointOf?: Id;
  /** Segment from `from` to pos is horizontal/vertical. */
  hv?: "horizontal" | "vertical";
  guides: { a: Vec2; b: Vec2 }[];
  glyphs: InferGlyph[];
}

export interface SnapOptions {
  /** Anchor of the segment being drawn (enables H/V inference). */
  from?: Vec2;
  skip?: Set<Id>;
  /** Ctrl held: no snapping or auto relations. */
  suppress?: boolean;
  /** Snap tolerance in sketch units. */
  tol: number;
  gridStep?: number;
  noCurves?: boolean;
}

/** Find the best snap for a cursor position, SolidWorks style. */
export function snap(s: Sketch, raw: Vec2, o: SnapOptions): SnapResult {
  const res: SnapResult = { pos: raw, guides: [], glyphs: [] };
  if (o.suppress) return res;
  const tol = o.tol;

  // 1. Existing points.
  let best: { id: Id; d: number } | null = null;
  for (const e of Object.values(s.entities)) {
    if (e.type !== "point" || o.skip?.has(e.id)) continue;
    const d = dist(raw, e);
    if (d <= tol && (!best || d < best.d)) best = { id: e.id, d };
  }
  if (best) {
    const p = ptv(s, best.id);
    return { pos: p, point: best.id, guides: [], glyphs: ["coincident"] };
  }

  // 2. Line midpoints.
  for (const e of Object.values(s.entities)) {
    if (e.type !== "line" || o.skip?.has(e.id)) continue;
    const m = mid(ptv(s, e.p1), ptv(s, e.p2));
    if (dist(raw, m) <= tol * 0.8) return { pos: m, midpointOf: e.id, guides: [], glyphs: ["midpoint"] };
  }

  // 3. H/V relative to the anchor, alignment with other points.
  let pos = { ...raw };
  const angTol = tol;
  if (o.from) {
    const d = sub(raw, o.from);
    if (Math.abs(d.y) < angTol && Math.abs(d.x) > tol) {
      pos.y = o.from.y;
      res.hv = "horizontal";
      res.glyphs.push("H");
    } else if (Math.abs(d.x) < angTol && Math.abs(d.y) > tol) {
      pos.x = o.from.x;
      res.hv = "vertical";
      res.glyphs.push("V");
    }
  }
  // Alignment guides to existing points (no relation, just placement help).
  let alignedX = res.hv === "vertical";
  let alignedY = res.hv === "horizontal";
  for (const e of Object.values(s.entities)) {
    if (e.type !== "point" || o.skip?.has(e.id)) continue;
    if (o.from && dist(e, o.from) < 1e-9) continue;
    if (!alignedX && Math.abs(e.x - raw.x) < tol * 0.7 && Math.abs(e.y - raw.y) > tol) {
      pos.x = e.x;
      alignedX = true;
      res.guides.push({ a: { x: e.x, y: e.y }, b: pos });
    }
    if (!alignedY && Math.abs(e.y - raw.y) < tol * 0.7 && Math.abs(e.x - raw.x) > tol) {
      pos.y = e.y;
      alignedY = true;
      res.guides.push({ a: { x: e.x, y: e.y }, b: pos });
    }
  }
  // Fix guide endpoints after both coordinates settle.
  res.guides = res.guides.map((g) => ({ a: g.a, b: { ...pos } }));
  if (res.hv && o.from) res.guides.push({ a: o.from, b: { ...pos } });

  // 4. On curve (only when not already aligned).
  if (!o.noCurves && !res.hv) {
    const onC = closestCurve(s, raw, tol, o.skip);
    if (onC) {
      res.pos = onC.pt;
      res.curve = onC.id;
      res.glyphs = ["on"];
      res.guides = [];
      return res;
    }
  }

  if (o.gridStep && !alignedX && !alignedY && !res.hv) {
    const g = o.gridStep;
    pos = { x: Math.round(pos.x / g) * g, y: Math.round(pos.y / g) * g };
    res.glyphs.push("grid");
  }
  res.pos = pos;
  return res;
}

export function closestCurve(s: Sketch, p: Vec2, tol: number, skip?: Set<Id>): { id: Id; pt: Vec2; d: number } | null {
  let best: { id: Id; pt: Vec2; d: number } | null = null;
  for (const e of Object.values(s.entities)) {
    if (e.type === "point" || skip?.has(e.id)) continue;
    let pt: Vec2 | null = null;
    if (e.type === "line") pt = closestOnSegment(p, ptv(s, e.p1), ptv(s, e.p2));
    else if (e.type === "circle") {
      const c = ptv(s, e.c);
      pt = polar(c, e.r, Math.atan2(p.y - c.y, p.x - c.x));
    } else if (e.type === "arc") {
      const g = arcGeom(s, e);
      const a = Math.atan2(p.y - g.c.y, p.x - g.c.x);
      if (angleInSweep(a, g.a0, g.a1)) pt = polar(g.c, g.r, a);
    } else if (e.type === "spline") pt = bezierClosest(splinePts(s, e), p).pt;
    if (!pt) continue;
    const d = dist(p, pt);
    if (d <= tol && (!best || d < best.d)) best = { id: e.id, pt, d };
  }
  return best;
}
