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
  /** Direction inference relative to an existing entity (tangent to an arc, perpendicular to a line). */
  dirRel?: { type: "tangent" | "perpendicular" | "parallel"; ref: Id };
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
  /** Candidate directions from `from` that imply a relation when the cursor follows them. */
  dirRefs?: { dir: Vec2; type: "tangent" | "perpendicular" | "parallel"; ref: Id }[];
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
    if (e.owner) {
      const own = s.entities[e.owner];
      if (own?.type === "spline" && own.derived) continue;
      if (own?.type === "line" && own.guide) continue;
    }
    const d = dist(raw, e);
    if (d <= tol && (!best || d < best.d)) best = { id: e.id, d };
  }
  if (best) {
    const p = ptv(s, best.id);
    const r: SnapResult = { pos: p, point: best.id, guides: [], glyphs: ["coincident"] };
    // Closing onto a point that is (nearly) level or plumb with the anchor also infers H/V.
    if (o.from) {
      const d = sub(p, o.from);
      if (Math.abs(d.y) < tol && Math.abs(d.x) > tol) {
        r.hv = "horizontal";
        r.glyphs.push("H");
      } else if (Math.abs(d.x) < tol && Math.abs(d.y) > tol) {
        r.hv = "vertical";
        r.glyphs.push("V");
      }
    }
    return r;
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
  // Tangent / perpendicular to the entity the segment starts from.
  if (o.from && !res.hv && o.dirRefs?.length) {
    const d = sub(raw, o.from);
    const l = Math.hypot(d.x, d.y);
    if (l > tol * 2) {
      for (const ref of o.dirRefs) {
        const u = ref.dir;
        const ul = Math.hypot(u.x, u.y) || 1;
        const t = (d.x * u.x + d.y * u.y) / ul;
        const off = Math.abs(d.x * u.y - d.y * u.x) / ul;
        if (t > 0 && off < tol) {
          pos = { x: o.from.x + (u.x / ul) * t, y: o.from.y + (u.y / ul) * t };
          res.dirRel = { type: ref.type, ref: ref.ref };
          res.glyphs.push(ref.type === "tangent" ? "tangent" : "perpendicular");
          res.guides.push({ a: o.from, b: pos });
          res.pos = pos;
          return res;
        }
      }
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
    if (e.type === "line") {
      const a = ptv(s, e.p1);
      const b = ptv(s, e.p2);
      pt = e.guide ? { x: p.x, y: a.y + ((b.y - a.y) * (p.x - a.x)) / (b.x - a.x || 1) } : closestOnSegment(p, a, b);
    }
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
