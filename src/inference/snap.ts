import { bezierClosest, bezierPolyline } from "../geom/bezier";
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
  /** Larger tolerance for existing points (end points are the usual target for a finger). Defaults to tol. */
  pointTol?: number;
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
    if (e.type !== "point" || o.skip?.has(e.id) || s.ext?.[e.id]?.hidden) continue;
    if (e.owner) {
      const own = s.entities[e.owner];
      if (own?.type === "spline" && own.derived) continue;
    }
    const d = dist(raw, e);
    if (d <= (o.pointTol ?? tol) && (!best || d < best.d)) best = { id: e.id, d };
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
    if (e.type !== "line" || o.skip?.has(e.id) || s.ext?.[e.id]?.hidden) continue;
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
  // On a curve, an inferred direction (H/V, tangent, perpendicular) keeps only where it crosses that
  // curve near the cursor: the end lands on the crossing with both relations. Otherwise the curve wins.
  const onCurve = o.noCurves ? null : closestCurve(s, raw, tol, o.skip);
  if (o.from && res.hv && onCurve) {
    const hit = dirCurveHit(s, o.from, res.hv === "horizontal" ? { x: 1, y: 0 } : { x: 0, y: 1 }, raw, tol, o.skip);
    if (hit) {
      res.pos = hit.pt;
      res.curve = hit.id;
      res.glyphs.push("on");
      res.guides = [{ a: o.from, b: { ...hit.pt } }];
      return res;
    }
    res.hv = undefined;
    res.glyphs = [];
    pos = { ...raw };
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
          if (onCurve) {
            const hit = dirCurveHit(s, o.from, u, raw, tol, o.skip);
            if (!hit) continue;
            res.pos = hit.pt;
            res.curve = hit.id;
            res.dirRel = { type: ref.type, ref: ref.ref };
            res.glyphs.push(ref.type === "tangent" ? "tangent" : "perpendicular", "on");
            res.guides.push({ a: o.from, b: { ...hit.pt } });
            return res;
          }
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
    if (e.type !== "point" || o.skip?.has(e.id) || s.ext?.[e.id]?.hidden) continue;
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
    if (e.type === "point" || skip?.has(e.id) || s.ext?.[e.id]?.hidden) continue;
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

/**
 * Where the line through `origin` along `dir` crosses a curve, nearest `raw` and within `tol` of it.
 * Works in line coordinates: u runs along the line, v across it (v = 0 on the line).
 */
function dirCurveHit(s: Sketch, origin: Vec2, dir: Vec2, raw: Vec2, tol: number, skip?: Set<Id>): { id: Id; pt: Vec2 } | null {
  const l = Math.hypot(dir.x, dir.y) || 1;
  const ux = dir.x / l;
  const uy = dir.y / l;
  const u = (p: Vec2) => (p.x - origin.x) * ux + (p.y - origin.y) * uy;
  const v = (p: Vec2) => (p.y - origin.y) * ux - (p.x - origin.x) * uy;
  const at = (uu: number): Vec2 => ({ x: origin.x + ux * uu, y: origin.y + uy * uu });
  let best: { id: Id; pt: Vec2; d: number } | null = null;
  const consider = (id: Id, uu: number) => {
    const pt = at(uu);
    const d = dist(pt, raw);
    if (d <= tol && (!best || d < best.d)) best = { id, pt, d };
  };
  const segments = (id: Id, pts: Vec2[]) => {
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const dv = v(b) - v(a);
      if (Math.abs(dv) < 1e-12) continue; // parallel to the line
      const t = -v(a) / dv;
      if (t >= 0 && t <= 1) consider(id, u(a) + t * (u(b) - u(a)));
    }
  };
  const circle = (id: Id, c: Vec2, r: number, keep: (p: Vec2) => boolean) => {
    const dv = v(c);
    if (Math.abs(dv) > r) return;
    const h = Math.sqrt(r * r - dv * dv);
    for (const uu of [u(c) - h, u(c) + h]) if (keep(at(uu))) consider(id, uu);
  };
  for (const e of Object.values(s.entities)) {
    if (e.type === "point" || skip?.has(e.id) || s.ext?.[e.id]?.hidden) continue;
    if (e.type === "line") segments(e.id, [ptv(s, e.p1), ptv(s, e.p2)]);
    else if (e.type === "circle") circle(e.id, ptv(s, e.c), e.r, () => true);
    else if (e.type === "arc") {
      const g = arcGeom(s, e);
      circle(e.id, g.c, g.r, (p) => angleInSweep(Math.atan2(p.y - g.c.y, p.x - g.c.x), g.a0, g.a1));
    } else if (e.type === "spline") segments(e.id, bezierPolyline(splinePts(s, e), 96));
  }
  return best;
}
