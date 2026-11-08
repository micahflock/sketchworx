import type { Vec2 } from "../geom/vec";
import { cross, dist, dot, len, mid, norm, projectParam, sub } from "../geom/vec";
import { evalExpr, evaluateVariables, ExprError, isExpression, parseExpr } from "./expr";
import { arcGeom, ptv } from "./sketch";
import type { Dimension, DimensionType, Doc, Entity, Id, Sketch } from "./types";

/** Key point of an entity used by distance dimensions (circle/arc → center). */
function keyPoint(e: Entity): Id | null {
  if (e.type === "point") return e.id;
  if (e.type === "circle" || e.type === "arc") return e.c;
  return null;
}

/** Oriented direction pairs for an angle dimension (CCW from d1 to d2 is the value). */
export function angleRefs(s: Sketch, d: Dimension): { a: Id; b: Id; c: Id; d: Id } | null {
  const [l1, l2] = d.refs.map((id) => s.entities[id]);
  if (l1?.type !== "line" || l2?.type !== "line") return null;
  const q = d.quadrant ?? 0;
  let [a, b] = q & 1 ? [l1.p2, l1.p1] : [l1.p1, l1.p2];
  let [c, dd] = q & 2 ? [l2.p2, l2.p1] : [l2.p1, l2.p2];
  if (q & 4) [a, b, c, dd] = [c, dd, a, b];
  return { a, b, c, d: dd };
}

/** Intersection of two infinite lines, or a midpoint fallback when parallel. */
export function lineIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 {
  const r = sub(b, a);
  const sv = sub(d, c);
  const den = cross(r, sv);
  if (Math.abs(den) < 1e-12) return mid(mid(a, b), mid(c, d));
  const t = cross(sub(c, a), sv) / den;
  return { x: a.x + r.x * t, y: a.y + r.y * t };
}

/** Current geometric value of a dimension. Angles are in degrees. */
export function measure(s: Sketch, d: Dimension): number {
  const E = d.refs.map((id) => s.entities[id]);
  if (E.some((e) => !e)) return NaN;
  switch (d.type) {
    case "distance":
    case "distanceX":
    case "distanceY": {
      const pts = distancePoints(s, d);
      if (!pts) return NaN;
      const [p, q] = pts;
      if (d.type === "distanceX") return Math.abs(q.x - p.x);
      if (d.type === "distanceY") return Math.abs(q.y - p.y);
      return dist(p, q);
    }
    case "pointLine": {
      const pl = pointLineRefs(s, d);
      if (!pl) return NaN;
      const p = ptv(s, pl.p);
      const a = ptv(s, pl.a);
      const b = ptv(s, pl.b);
      return Math.abs(cross(sub(b, a), sub(p, a))) / (len(sub(b, a)) || 1);
    }
    case "angle": {
      const r = angleRefs(s, d);
      if (!r) return NaN;
      const d1 = sub(ptv(s, r.b), ptv(s, r.a));
      const d2 = sub(ptv(s, r.d), ptv(s, r.c));
      return (Math.atan2(cross(d1, d2), dot(d1, d2)) * 180) / Math.PI;
    }
    case "radius":
    case "diameter": {
      const e = E[0];
      const r = e.type === "circle" ? e.r : e.type === "arc" ? arcGeom(s, e).r : NaN;
      return d.type === "diameter" ? 2 * r : r;
    }
    case "arcLength": {
      const e = E[0];
      if (e.type !== "arc") return NaN;
      const g = arcGeom(s, e);
      let sw = g.a1 - g.a0;
      while (sw <= 0) sw += 2 * Math.PI;
      return g.r * sw;
    }
    case "offset": {
      const o = offsetGeom(s, d);
      return o ? dist(o.from, o.to) : NaN;
    }
  }
}

/** Offset dimension: the two points it spans (on the source and on the offset entity). */
export function offsetGeom(s: Sketch, d: Dimension): { from: Vec2; to: Vec2 } | null {
  const [src, dst] = d.refs.map((id) => s.entities[id]);
  if (!src || !dst) return null;
  if (src.type === "line" && dst.type === "line") {
    const m = mid(ptv(s, dst.p1), ptv(s, dst.p2));
    const a = ptv(s, src.p1);
    const b = ptv(s, src.p2);
    const t = projectParam(m, a, b);
    return { from: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, to: m };
  }
  const radius = (e: Entity) => (e.type === "circle" ? e.r : e.type === "arc" ? arcGeom(s, e).r : NaN);
  if ((src.type === "circle" || src.type === "arc") && (dst.type === "circle" || dst.type === "arc")) {
    const c = ptv(s, src.c);
    let ang = 0;
    if (dst.type === "arc") {
      const g = arcGeom(s, dst);
      let sw = g.a1 - g.a0;
      while (sw <= 0) sw += 2 * Math.PI;
      ang = g.a0 + sw / 2;
    }
    const u = { x: Math.cos(ang), y: Math.sin(ang) };
    return { from: { x: c.x + u.x * radius(src), y: c.y + u.y * radius(src) }, to: { x: c.x + u.x * radius(dst), y: c.y + u.y * radius(dst) } };
  }
  return null;
}

/** The two points a distance dimension measures between. */
export function distancePointIds(s: Sketch, d: Dimension): [Id, Id] | null {
  const E = d.refs.map((id) => s.entities[id]);
  if (E.length === 1 && E[0]?.type === "line") return [E[0].p1, E[0].p2];
  if (E.length === 2) {
    const a = keyPoint(E[0]);
    const b = keyPoint(E[1]);
    if (a && b) return [a, b];
  }
  return null;
}
function distancePoints(s: Sketch, d: Dimension): [Vec2, Vec2] | null {
  const ids = distancePointIds(s, d);
  return ids ? [ptv(s, ids[0]), ptv(s, ids[1])] : null;
}

/** Point and line (as two point ids) for point-line / line-line / center-line distances. */
export function pointLineRefs(s: Sketch, d: Dimension): { p: Id; a: Id; b: Id; line: Id } | null {
  const E = d.refs.map((id) => s.entities[id]);
  if (E.length !== 2) return null;
  const [x, y] = E;
  if (x.type === "line" && y.type === "line") return { p: y.p1, a: x.p1, b: x.p2, line: x.id };
  const line = x.type === "line" ? x : y.type === "line" ? y : null;
  const other = line === x ? y : x;
  if (!line) return null;
  const p = keyPoint(other);
  return p ? { p, a: line.p1, b: line.p2, line: line.id } : null;
}

/** Anchor in sketch space that a dimension's label offset is relative to. */
export function dimAnchor(s: Sketch, d: Dimension): Vec2 {
  try {
    switch (d.type) {
      case "distance":
      case "distanceX":
      case "distanceY": {
        const p = distancePoints(s, d);
        return p ? mid(p[0], p[1]) : { x: 0, y: 0 };
      }
      case "pointLine": {
        const pl = pointLineRefs(s, d)!;
        const p = ptv(s, pl.p);
        const a = ptv(s, pl.a);
        const b = ptv(s, pl.b);
        const t = projectParam(p, a, b);
        return mid(p, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
      case "angle": {
        const r = angleRefs(s, d)!;
        return lineIntersection(ptv(s, r.a), ptv(s, r.b), ptv(s, r.c), ptv(s, r.d));
      }
      case "offset": {
        const o = offsetGeom(s, d);
        return o ? mid(o.from, o.to) : { x: 0, y: 0 };
      }
      default: {
        const e = s.entities[d.refs[0]];
        if (e?.type === "circle" || e?.type === "arc") return ptv(s, e.c);
      }
    }
  } catch {
    /* missing refs */
  }
  return { x: 0, y: 0 };
}

export const labelPos = (s: Sketch, d: Dimension): Vec2 => {
  const a = dimAnchor(s, d);
  return { x: a.x + d.label.x, y: a.y + d.label.y };
};

export interface DimProposal {
  type: DimensionType;
  refs: Id[];
  quadrant?: number;
}

/**
 * Infer the dimension SolidWorks would create for the picked entities and the
 * cursor position (where the user is dragging the label).
 */
export function inferDimension(s: Sketch, refs: Id[], cursor: Vec2): DimProposal | null {
  const E = refs.map((id) => s.entities[id]).filter(Boolean) as Entity[];
  if (!E.length) return null;
  const linear = (p: Vec2, q: Vec2, ids: Id[]): DimProposal => {
    // Cursor direction from the midpoint: along the normal → aligned; straight up/down → horizontal;
    // straight left/right → vertical (SolidWorks behavior).
    const dx = Math.abs(q.x - p.x);
    const dy = Math.abs(q.y - p.y);
    if (dx < 1e-9 * Math.max(1, dy) || dy < 1e-9 * Math.max(1, dx)) return { type: "distance", refs: ids };
    const u = norm(sub(cursor, mid(p, q)));
    const dir = norm(sub(q, p));
    const n = { x: -dir.y, y: dir.x };
    const along = Math.abs(dot(u, n));
    const up = Math.abs(u.y);
    const side = Math.abs(u.x);
    if (along >= up - 1e-9 && along >= side - 1e-9) return { type: "distance", refs: ids };
    return up > side ? { type: "distanceX", refs: ids } : { type: "distanceY", refs: ids };
  };
  if (E.length === 1) {
    const e = E[0];
    if (e.type === "line") return linear(ptv(s, e.p1), ptv(s, e.p2), refs);
    if (e.type === "circle") return { type: "diameter", refs };
    if (e.type === "arc") return { type: "radius", refs };
    return null;
  }
  if (E.length === 2) {
    const [a, b] = E;
    if (a.type === "line" && b.type === "line") {
      const d1 = norm(sub(ptv(s, a.p2), ptv(s, a.p1)));
      const d2 = norm(sub(ptv(s, b.p2), ptv(s, b.p1)));
      if (Math.abs(cross(d1, d2)) < 1e-6) return { type: "pointLine", refs };
      return { type: "angle", refs, quadrant: angleQuadrant(s, a, b, cursor) };
    }
    if (a.type === "line" || b.type === "line") {
      const other = a.type === "line" ? b : a;
      if (other.type === "point" || other.type === "circle" || other.type === "arc") return { type: "pointLine", refs };
      return null;
    }
    const pa = keyPoint(a);
    const pb = keyPoint(b);
    if (pa && pb) return linear(ptv(s, pa), ptv(s, pb), refs);
    return null;
  }
  if (E.length === 3) {
    // Arc + its two endpoints → arc length.
    const arc = E.find((e) => e.type === "arc");
    if (arc && arc.type === "arc") {
      const others = E.filter((e) => e !== arc).map((e) => e.id);
      if (others.includes(arc.s) && others.includes(arc.e)) return { type: "arcLength", refs: [arc.id] };
    }
  }
  return null;
}

/** Pick the quadrant whose angular sector contains the cursor. */
function angleQuadrant(s: Sketch, l1: Entity & { type: "line" }, l2: Entity & { type: "line" }, cursor: Vec2): number {
  const a = ptv(s, l1.p1);
  const b = ptv(s, l1.p2);
  const c = ptv(s, l2.p1);
  const d = ptv(s, l2.p2);
  const o = lineIntersection(a, b, c, d);
  const u = norm(sub(cursor, o));
  for (let q = 0; q < 4; q++) {
    const d1 = q & 1 ? sub(a, b) : sub(b, a);
    const d2 = q & 2 ? sub(c, d) : sub(d, c);
    // Bisector of the sector from d1 to d2 (the sector < 180°).
    const n1 = norm(d1);
    const n2 = norm(d2);
    let swap = 0;
    if (cross(n1, n2) < 0) swap = 4;
    const bis = norm({ x: n1.x + n2.x, y: n1.y + n2.y });
    const half = Math.acos(Math.max(-1, Math.min(1, dot(n1, n2)))) / 2;
    if (Math.acos(Math.max(-1, Math.min(1, dot(bis, u)))) <= half + 1e-9) return q | swap;
  }
  return 0;
}

/** Evaluate a dimension expression text against document variables. */
export function evaluateDimText(doc: Doc, text: string): { value: number; expr: string } {
  const t = text.trim();
  if (!t) throw new ExprError("Enter a value");
  const vars = evaluateVariables(doc.variables).values;
  const value = evalExpr(parseExpr(t), (n) => vars.get(n));
  if (!Number.isFinite(value)) throw new ExprError("Not a finite number");
  return { value, expr: isExpression(t) ? (t.startsWith("=") ? t : `=${t}`) : String(value) };
}

/**
 * Re-evaluate variables and every driving dimension's expression.
 * Returns the same doc when nothing changed.
 */
export function refreshExpressions(doc: Doc): Doc {
  const ev = evaluateVariables(doc.variables);
  let changed = false;
  const variables = doc.variables.map((v) => {
    const val = ev.values.get(v.name);
    if (val !== undefined && val !== v.value) {
      changed = true;
      return { ...v, value: val };
    }
    return v;
  });
  // Every sketch uses the same variables.
  const features = doc.features.map((f) => {
    const s = f.sketch;
    let dims: Sketch["dimensions"] | null = null;
    for (const d of Object.values(s.dimensions)) {
      if (!isExpression(d.expr)) continue;
      let val: number;
      try {
        val = evalExpr(parseExpr(d.expr), (n) => ev.values.get(n));
      } catch {
        continue;
      }
      if (Number.isFinite(val) && val !== d.value) {
        dims ??= { ...s.dimensions };
        dims[d.id] = { ...d, value: val };
      }
    }
    if (!dims) return f;
    changed = true;
    return { ...f, sketch: { ...s, dimensions: dims } };
  });
  return changed ? { ...doc, variables, features } : doc;
}

export const dimPrefix = (d: Dimension) => (d.type === "radius" ? "R" : d.type === "diameter" ? "⌀" : d.type === "arcLength" ? "⌒" : "");
