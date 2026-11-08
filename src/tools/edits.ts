/**
 * Geometry-editing commands (Trim, Extend, Fillet, Mirror, Offset, splines).
 * Each runs inside an Editor and carries relations through the edit.
 */
import { bezierDeriv, bezierPoint, bezierSplit } from "../geom/bezier";
import type { Curve } from "../geom/curves";
import { curveParam, curvePoint, intersect } from "../geom/curves";
import type { Vec2 } from "../geom/vec";
import { add, ccwSweep, cross, dist, dot, len, norm, perp, scale, sub } from "../geom/vec";
import type { Editor } from "../model/editor";
import { arcGeom, endPoints, ptv } from "../model/sketch";
import type { Entity, Id, Sketch, SplineEntity } from "../model/types";
import { addArc, addCircle, addLine } from "./common";

// ------------------------------------------------------------------ basics

export function entityCurve(s: Sketch, e: Entity): Curve | null {
  switch (e.type) {
    case "line":
      return { kind: "line", a: ptv(s, e.p1), b: ptv(s, e.p2) };
    case "circle":
      return { kind: "circle", c: ptv(s, e.c), r: e.r };
    case "arc": {
      const g = arcGeom(s, e);
      return { kind: "arc", c: g.c, r: g.r, a0: g.a0, a1: g.a1 };
    }
    case "spline":
      return { kind: "bezier", cps: e.cps.map((id) => ptv(s, id)) };
    default:
      return null;
  }
}

/** Curves that can cut/bound others: every curve except polygon sides and driven offsets. */
export function cutters(s: Sketch, skip: Id): { id: Id; cv: Curve }[] {
  const out: { id: Id; cv: Curve }[] = [];
  for (const e of Object.values(s.entities)) {
    if (e.id === skip || e.type === "point") continue;
    if (e.type === "line" && e.owner) continue;
    if (s.ext?.[e.id]?.hidden) continue; // hidden sketches do not bound anything
    const cv = entityCurve(s, e);
    if (cv) out.push({ id: e.id, cv });
  }
  return out;
}

/** Style spline with its control-polygon sides as construction lines. */
export function addSpline(ed: Editor, pts: Vec2[], construction = false): { spline: Id; cps: Id[]; sides: Id[] } {
  const spline = ed.newId("e");
  const cps = pts.map((p) => ed.addPoint(p.x, p.y, spline));
  ed.put({ id: spline, type: "spline", cps, ...(construction ? { construction } : {}) });
  const sides: Id[] = [];
  for (let i = 0; i < cps.length - 1; i++) {
    const id = ed.newId("e");
    ed.put({ id, type: "line", p1: cps[i], p2: cps[i + 1], construction: true, owner: spline });
    sides.push(id);
  }
  return { spline, cps, sides };
}

/**
 * Relate a new end point to whatever it landed on: an existing endpoint of the cutter
 * (then any "that endpoint lies on me" relation becomes implied and is removed), or the curve.
 */
function attach(ed: Editor, pointId: Id, at: Vec2, cutterId: Id | undefined, selfId?: Id) {
  if (!cutterId) return;
  const s = ed.s;
  const cut = s.entities[cutterId];
  if (!cut) return;
  const tol = 1e-7 * Math.max(1, len(at));
  for (const p of endPoints(cut))
    if (dist(ptv(s, p), at) < tol) {
      if (selfId)
        for (const r of Object.values(ed.s.relations))
          if (r.type === "coincident" && r.refs.length === 2 && r.refs.includes(p) && r.refs.includes(selfId)) ed.deleteRelation(r.id);
      return void ed.addRelation({ type: "coincident", refs: [pointId, p] });
    }
  ed.addRelation({ type: "coincident", refs: [pointId, cutterId] });
}

/** Drop relations/dimensions that described an endpoint's old connection. */
function detachEnd(ed: Editor, entityId: Id, pointId: Id) {
  const s = ed.s;
  const partners = new Set<Id>();
  for (const r of Object.values(s.relations)) {
    if (!r.refs.includes(pointId)) continue;
    for (const x of r.refs) {
      const e = s.entities[x];
      if (x !== pointId && e) partners.add(e.type === "point" && e.owner ? e.owner : x);
    }
    ed.deleteRelation(r.id);
  }
  for (const r of Object.values(s.relations)) {
    if (r.type === "tangent" && r.refs.includes(entityId) && r.refs.some((x) => partners.has(x))) ed.deleteRelation(r.id);
  }
  for (const d of Object.values(s.dimensions)) if (d.refs.includes(pointId)) ed.deleteDimension(d.id);
}

// ------------------------------------------------------------------ trim

export interface TrimResult {
  ok: boolean;
  message?: string;
}

/** Power Trim at a point on an entity: remove the piece between the nearest intersections. */
export function trimAt(ed: Editor, id: Id, at: Vec2): TrimResult {
  const s = ed.s;
  const e = s.entities[id];
  if (!e || e.type === "point") return { ok: false };
  if (e.type === "line" && e.owner) return { ok: false, message: "Polygon sides cannot be trimmed" };
  if (e.type === "spline" && e.derived) return { ok: false, message: "Driven offsets follow their source" };
  loosenOnEdge(ed, id);
  const cv = entityCurve(s, e)!;
  const tP = curveParam(cv, at);
  const hits: { t: number; p: Vec2; by: Id }[] = [];
  for (const c of cutters(s, id)) for (const h of intersect(cv, c.cv)) hits.push({ t: h.t1, p: h.p, by: c.id });
  if (e.type === "circle") {
    const ts = hits.filter((h) => h.t >= 0 && h.t < 1);
    if (ts.length < 2) {
      ed.deleteEntities([id]);
      return { ok: true };
    }
    // The kept arc runs CCW from the first cut after tP around to the last cut before it.
    const after = ts.filter((h) => h.t > tP).sort((a, b) => a.t - b.t)[0] ?? ts.sort((a, b) => a.t - b.t)[0];
    const before = ts.filter((h) => h.t < tP).sort((a, b) => b.t - a.t)[0] ?? ts.sort((a, b) => b.t - a.t)[0];
    const sId = ed.addPoint(after.p.x, after.p.y, id);
    const eId = ed.addPoint(before.p.x, before.p.y, id);
    ed.put({ id, type: "arc", c: e.c, s: sId, e: eId, ...(e.construction ? { construction: true } : {}) });
    attach(ed, sId, after.p, after.by, id);
    attach(ed, eId, before.p, before.by, id);
    return { ok: true };
  }
  const eps = 1e-6;
  const inner = hits.filter((h) => h.t > eps && h.t < 1 - eps);
  const lo = inner.filter((h) => h.t < tP).sort((a, b) => b.t - a.t)[0];
  const hi = inner.filter((h) => h.t > tP).sort((a, b) => a.t - b.t)[0];
  if (!lo && !hi) {
    ed.deleteEntities([id]);
    return { ok: true };
  }
  const [startId, endId] = endPoints(e);
  if (!lo) {
    // Remove [0, hi]: the start moves to hi.
    detachEnd(ed, id, startId);
    reshape(ed, e, hi.t, 1);
    attach(ed, startId, hi.p, hi.by, id);
    return { ok: true };
  }
  if (!hi) {
    detachEnd(ed, id, endId);
    reshape(ed, e, 0, lo.t);
    attach(ed, endId, lo.p, lo.by, id);
    return { ok: true };
  }
  // Split: keep [0, lo] on the original, [hi, 1] becomes a new entity that inherits the old end's relations.
  const tail = splitTail(ed, e, hi.t);
  ed.substitute(endId, tail.end);
  reshape(ed, ed.s.entities[id], 0, lo.t);
  attach(ed, endId, lo.p, lo.by, id);
  attach(ed, tail.start, hi.p, hi.by, tail.id);
  if (e.type === "line") ed.addRelation({ type: "collinear", refs: [id, tail.id] });
  if (e.type === "arc") ed.addRelation({ type: "coradial", refs: [id, tail.id] });
  return { ok: true };
}

/** Restrict an open curve to its parameter range [t0, t1], keeping ids. */
function reshape(ed: Editor, e: Entity, t0: number, t1: number) {
  const s = ed.s;
  const cv = entityCurve(s, e)!;
  if (e.type === "line" || e.type === "arc") {
    const a = curvePoint(cv, t0);
    const b = curvePoint(cv, t1);
    const [p0, p1] = endPoints(e);
    ed.movePoint(p0, a.x, a.y);
    ed.movePoint(p1, b.x, b.y);
  } else if (e.type === "spline") {
    const cps = subBezier(e.cps.map((id) => ptv(s, id)), t0, t1);
    e.cps.forEach((id, i) => ed.movePoint(id, cps[i].x, cps[i].y));
  }
}

export function subBezier(cps: Vec2[], t0: number, t1: number): Vec2[] {
  let c = cps;
  if (t1 < 1) c = bezierSplit(c, t1)[0];
  if (t0 > 0) c = bezierSplit(c, t0 / t1)[1];
  return c;
}

/** New entity covering [t, 1] of e. */
function splitTail(ed: Editor, e: Entity, t: number): { id: Id; start: Id; end: Id } {
  const s = ed.s;
  const cv = entityCurve(s, e)!;
  const c = !!e.construction;
  if (e.type === "line") {
    const r = addLine(ed, curvePoint(cv, t), ptv(s, e.p2), c);
    return { id: r.line, start: r.p1, end: r.p2 };
  }
  if (e.type === "arc") {
    const g = arcGeom(s, e);
    const r = addArc(ed, g.c, curvePoint(cv, t), g.p1, c);
    return { id: r.arc, start: r.s, end: r.e };
  }
  const sp = e as SplineEntity;
  const cps = subBezier(sp.cps.map((id) => ptv(s, id)), t, 1);
  const r = addSpline(ed, cps, c);
  return { id: r.spline, start: r.cps[0], end: r.cps[r.cps.length - 1] };
}

// ------------------------------------------------------------------ extend

/** Where Extend would take the end of `id` nearest `at` (for preview and commit). */
export function extendTarget(s: Sketch, id: Id, at: Vec2): { pointId: Id; to: Vec2; by: Id } | null {
  const e = s.entities[id];
  if (!e || (e.type !== "line" && e.type !== "arc") || (e.type === "line" && e.owner)) return null;
  const [p0, p1] = endPoints(e);
  const atEnd = dist(ptv(s, p1), at) <= dist(ptv(s, p0), at);
  const pointId = atEnd ? p1 : p0;
  let best: { score: number; to: Vec2; by: Id } | null = null;
  if (e.type === "line") {
    const a = ptv(s, e.p1);
    const b = ptv(s, e.p2);
    for (const c of cutters(s, id))
      for (const h of intersect({ kind: "line", a, b }, c.cv, true)) {
        const beyond = atEnd ? h.t1 - 1 : -h.t1;
        if (beyond > 1e-6 && (!best || beyond < best.score)) best = { score: beyond, to: h.p, by: c.id };
      }
  } else {
    const g = arcGeom(s, e);
    const full: Curve = { kind: "circle", c: g.c, r: g.r };
    const gap = ccwSweep(g.a1, g.a0); // angular room outside the arc
    for (const c of cutters(s, id))
      for (const h of intersect(full, c.cv)) {
        const ang = Math.atan2(h.p.y - g.c.y, h.p.x - g.c.x);
        const beyond = atEnd ? ccwSweep(g.a1, ang) : ccwSweep(ang, g.a0);
        if (beyond > 1e-6 && beyond < gap - 1e-9 && (!best || beyond < best.score)) best = { score: beyond, to: h.p, by: c.id };
      }
  }
  return best ? { pointId, to: best.to, by: best.by } : null;
}

export function extendAt(ed: Editor, id: Id, at: Vec2): TrimResult {
  const t = extendTarget(ed.s, id, at);
  if (!t) return { ok: false, message: "Nothing to extend to" };
  loosenOnEdge(ed, id);
  detachEnd(ed, id, t.pointId);
  ed.movePoint(t.pointId, t.to.x, t.to.y);
  attach(ed, t.pointId, t.to, t.by, id);
  return { ok: true };
}

// ------------------------------------------------------------------ fillet

/** The two lines meeting at a corner point, with the ids of their corner ends. */
export function cornerAt(s: Sketch, pointId: Id): { l1: Id; e1: Id; l2: Id; e2: Id } | null {
  const p = s.entities[pointId];
  if (p?.type !== "point") return null;
  const at = ptv(s, pointId);
  const ends: { line: Id; end: Id }[] = [];
  for (const e of Object.values(s.entities)) {
    if (e.type !== "line" || e.owner || e.construction) continue;
    for (const q of [e.p1, e.p2]) if (dist(ptv(s, q), at) < 1e-6 * Math.max(1, len(at))) ends.push({ line: e.id, end: q });
  }
  if (ends.length !== 2 || ends[0].line === ends[1].line) return null;
  return { l1: ends[0].line, e1: ends[0].end, l2: ends[1].line, e2: ends[1].end };
}

/** Sketch Fillet between two lines meeting at a corner. Returns the new arc id. */
export function filletCorner(ed: Editor, corner: { l1: Id; e1: Id; l2: Id; e2: Id }, r: number): { arc?: Id; message?: string } {
  const s = ed.s;
  const L1 = s.entities[corner.l1];
  const L2 = s.entities[corner.l2];
  if (L1?.type !== "line" || L2?.type !== "line") return { message: "Fillet needs two lines" };
  const P = ptv(s, corner.e1);
  const o1 = ptv(s, L1.p1 === corner.e1 ? L1.p2 : L1.p1);
  const o2 = ptv(s, L2.p1 === corner.e2 ? L2.p2 : L2.p1);
  const u1 = norm(sub(o1, P));
  const u2 = norm(sub(o2, P));
  const cosT = Math.max(-1, Math.min(1, dot(u1, u2)));
  const theta = Math.acos(cosT);
  if (theta < 1e-3 || Math.PI - theta < 1e-3) return { message: "Lines are parallel" };
  const d = r / Math.tan(theta / 2);
  if (d >= dist(P, o1) || d >= dist(P, o2)) return { message: "Radius too large for these lines" };
  loosenOnEdge(ed, corner.l1);
  loosenOnEdge(ed, corner.l2);
  const T1 = add(P, scale(u1, d));
  const T2 = add(P, scale(u2, d));
  const C = add(P, scale(norm(add(u1, u2)), r / Math.sin(theta / 2)));
  // Remove the corner's relations (the corner point no longer exists).
  for (const rel of Object.values(s.relations)) if (rel.refs.includes(corner.e1) || rel.refs.includes(corner.e2)) ed.deleteRelation(rel.id);
  for (const dm of Object.values(s.dimensions)) if (dm.refs.includes(corner.e1) || dm.refs.includes(corner.e2)) ed.deleteDimension(dm.id);
  ed.movePoint(corner.e1, T1.x, T1.y);
  ed.movePoint(corner.e2, T2.x, T2.y);
  const ccw = cross(sub(T1, C), sub(T2, C)) > 0;
  const a = ccw ? addArc(ed, C, T1, T2) : addArc(ed, C, T2, T1);
  ed.addRelation({ type: "coincident", refs: [ccw ? a.s : a.e, corner.e1] });
  ed.addRelation({ type: "coincident", refs: [ccw ? a.e : a.s, corner.e2] });
  ed.addRelation({ type: "tangent", refs: [corner.l1, a.arc] });
  ed.addRelation({ type: "tangent", refs: [corner.l2, a.arc] });
  return { arc: a.arc };
}

// ------------------------------------------------------------------ mirror

export function mirrorPoint(p: Vec2, a: Vec2, b: Vec2): Vec2 {
  const d = sub(b, a);
  const t = dot(sub(p, a), d) / (dot(d, d) || 1);
  const f = add(a, scale(d, t));
  return sub(scale(f, 2), p);
}

/**
 * Mirror entities about a centerline. Copies stay linked by Symmetric relations;
 * points on the centerline are shared via Coincident instead (no redundancy).
 */
export function mirrorEntities(ed: Editor, ids: Id[], axisId: Id): Id[] {
  const s = ed.s;
  const axis = s.entities[axisId];
  if (axis?.type !== "line") return [];
  const A = ptv(s, axis.p1);
  const B = ptv(s, axis.p2);
  const scaleLen = Math.max(1, dist(A, B));
  const onAxis = (p: Vec2) => Math.abs(cross(sub(B, A), sub(p, A))) / (dist(A, B) || 1) < 1e-6 * scaleLen;
  const created: Id[] = [];
  const pointMap = new Map<Id, Id>();
  const relatePoint = (orig: Id, copy: Id) => {
    pointMap.set(orig, copy);
    if (onAxis(ptv(s, orig))) {
      ed.addRelation({ type: "coincident", refs: [copy, orig] });
      const already = Object.values(ed.s.relations).some((r) => r.type === "coincident" && r.refs.includes(orig) && r.refs.includes(axisId));
      if (!already) ed.addRelation({ type: "coincident", refs: [orig, axisId] });
    } else ed.addRelation({ type: "symmetric", refs: [orig, copy, axisId] });
  };
  const M = (id: Id) => mirrorPoint(ptv(s, id), A, B);
  for (const id of ids) {
    const e = s.entities[id];
    if (!e || id === axisId) continue;
    const c = !!e.construction;
    switch (e.type) {
      case "point": {
        if (e.owner) continue;
        const p = M(id);
        const q = ed.addPoint(p.x, p.y);
        relatePoint(id, q);
        created.push(q);
        break;
      }
      case "line": {
        if (e.owner) continue;
        const r = addLine(ed, M(e.p1), M(e.p2), c);
        relatePoint(e.p1, r.p1);
        relatePoint(e.p2, r.p2);
        created.push(r.line);
        break;
      }
      case "circle": {
        const r = addCircle(ed, M(e.c), e.r, c);
        relatePoint(e.c, r.c);
        ed.addRelation({ type: "equal", refs: [e.id, r.circle] });
        created.push(r.circle);
        break;
      }
      case "arc": {
        // Mirroring reverses orientation: the copy runs CCW from mirror(e) to mirror(s).
        const r = addArc(ed, M(e.c), M(e.e), M(e.s), c);
        relatePoint(e.c, r.c);
        relatePoint(e.e, r.s);
        // r.e is determined by the center, radius and mirrored start; relate it by coincidence on-axis only.
        if (onAxis(ptv(s, e.s))) ed.addRelation({ type: "coincident", refs: [r.e, e.s] });
        else ed.addRelation({ type: "equal", refs: [e.id, r.arc] });
        pointMap.set(e.s, r.e);
        created.push(r.arc);
        break;
      }
      case "spline": {
        if (e.derived) continue;
        const r = addSpline(ed, e.cps.map(M), c);
        e.cps.forEach((cp, i) => relatePoint(cp, r.cps[i]));
        created.push(r.spline);
        break;
      }
    }
  }
  return created;
}

// ------------------------------------------------------------------ offset

interface ChainSeg {
  id: Id;
  /** Traversed from the entity's end to its start. */
  rev: boolean;
}

/** Connected chain (by coincident endpoints) through `id`, in order. */
export function findChain(s: Sketch, id: Id): { segs: ChainSeg[]; closed: boolean } {
  const usable = (e: Entity) => (e.type === "line" && !e.owner) || e.type === "arc" || (e.type === "spline" && !e.derived);
  const start = s.entities[id];
  if (!start || !usable(start)) return { segs: [], closed: false };
  const tol = (p: Vec2) => 1e-6 * Math.max(1, len(p));
  const endsOf = (e: Entity) => endPoints(e).map((p) => ptv(s, p));
  const others = Object.values(s.entities).filter((e) => usable(e) && e.construction === start.construction);
  const segs: ChainSeg[] = [{ id, rev: false }];
  const used = new Set([id]);
  const extend = (forward: boolean) => {
    for (;;) {
      const last = forward ? segs[segs.length - 1] : segs[0];
      const le = endsOf(s.entities[last.id]);
      const tip = forward ? (last.rev ? le[0] : le[1]) : last.rev ? le[1] : le[0];
      const next = others.find((e) => {
        if (used.has(e.id)) return false;
        const [a, b] = endsOf(e);
        return dist(a, tip) < tol(tip) || dist(b, tip) < tol(tip);
      });
      if (!next) return;
      const [a] = endsOf(next);
      const startsAtTip = dist(a, tip) < tol(tip);
      used.add(next.id);
      if (forward) segs.push({ id: next.id, rev: !startsAtTip });
      else segs.unshift({ id: next.id, rev: startsAtTip });
    }
  };
  extend(true);
  extend(false);
  const first = endsOf(s.entities[segs[0].id]);
  const last = endsOf(s.entities[segs[segs.length - 1].id]);
  const head = segs[0].rev ? first[1] : first[0];
  const tail = segs[segs.length - 1].rev ? last[0] : last[1];
  const closed = segs.length > 1 && dist(head, tail) < tol(head);
  return { segs, closed };
}

/** Which side of entity `id` the point lies on, relative to the chain direction (+1 left). */
export function sideOf(s: Sketch, seg: ChainSeg, p: Vec2): 1 | -1 {
  const cv = entityCurve(s, s.entities[seg.id])!;
  const t = curveParam(cv, p);
  const q = curvePoint(cv, t);
  let tan = cv.kind === "line" ? sub(cv.b, cv.a) : cv.kind === "bezier" ? bezierDeriv(cv.cps, t) : perp(sub(q, cv.c));
  if (seg.rev) tan = scale(tan, -1);
  return cross(tan, sub(p, q)) >= 0 ? 1 : -1;
}

/** Offset of a Bézier as a few cubic segments within `tol`. Returns parameter ranges and cubics. */
export function offsetBezier(cps: Vec2[], d: number, tol: number): { t0: number; t1: number; cps: Vec2[] }[] {
  const out: { t0: number; t1: number; cps: Vec2[] }[] = [];
  const rec = (t0: number, t1: number, depth: number) => {
    const fit = fitOffsetCubic(cps, d, t0, t1);
    if (fit.err <= tol || depth >= 6) out.push({ t0, t1, cps: fit.cps });
    else {
      const m = (t0 + t1) / 2;
      rec(t0, m, depth + 1);
      rec(m, t1, depth + 1);
    }
  };
  rec(0, 1, 0);
  return out;
}

const offsetAt = (cps: Vec2[], d: number, t: number) => {
  const p = bezierPoint(cps, t);
  const n = norm(perp(bezierDeriv(cps, t)));
  return add(p, scale(n, d));
};

/** Fit a cubic to the offset over [t0,t1]: endpoints and tangent directions fixed, handle lengths by least squares. */
export function fitOffsetCubic(cps: Vec2[], d: number, t0: number, t1: number): { cps: Vec2[]; err: number } {
  const P0 = offsetAt(cps, d, t0);
  const P3 = offsetAt(cps, d, t1);
  const T0 = norm(bezierDeriv(cps, t0));
  const T1 = norm(bezierDeriv(cps, t1));
  // Least squares for a, b in B(u) = P0 b0 + (P0 + a T0) b1 + (P3 - b T1) b2 + P3 b3.
  let s11 = 0;
  let s12 = 0;
  let s22 = 0;
  let r1 = 0;
  let r2 = 0;
  const N = 12;
  for (let i = 1; i < N; i++) {
    const u = i / N;
    const Q = offsetAt(cps, d, t0 + (t1 - t0) * u);
    const b0 = (1 - u) ** 3;
    const b1 = 3 * u * (1 - u) ** 2;
    const b2 = 3 * u * u * (1 - u);
    const b3 = u ** 3;
    const base = { x: P0.x * (b0 + b1) + P3.x * (b2 + b3), y: P0.y * (b0 + b1) + P3.y * (b2 + b3) };
    const A1 = scale(T0, b1);
    const A2 = scale(T1, -b2);
    const R = sub(Q, base);
    s11 += dot(A1, A1);
    s12 += dot(A1, A2);
    s22 += dot(A2, A2);
    r1 += dot(A1, R);
    r2 += dot(A2, R);
  }
  const det = s11 * s22 - s12 * s12;
  const chord = dist(P0, P3) / 3;
  let a = chord;
  let b = chord;
  if (Math.abs(det) > 1e-18) {
    a = (r1 * s22 - r2 * s12) / det;
    b = (s11 * r2 - s12 * r1) / det;
  }
  if (!(a > 0)) a = chord;
  if (!(b > 0)) b = chord;
  const cub = [P0, add(P0, scale(T0, a)), sub(P3, scale(T1, b)), P3];
  let err = 0;
  for (let i = 1; i < 16; i++) {
    const u = i / 16;
    err = Math.max(err, dist(bezierPoint(cub, u), offsetAt(cps, d, t0 + (t1 - t0) * u)));
  }
  return { cps: cub, err };
}

export interface OffsetOptions {
  distance: number;
  side: 1 | -1;
  both: boolean;
  cap: "none" | "arcs" | "lines";
  /** Variable that drives the offset (created if missing). */
  link: string;
  /** SolidWorks "Base geometry: Construction": turn the source chain into construction. */
  baseConstruction?: boolean;
}

/** Offset Entities on the chain through `id`. Returns created entity ids. */
export function offsetChain(ed: Editor, id: Id, o: OffsetOptions): { created: Id[]; message?: string } {
  const s = ed.s;
  const chain = findChain(s, id);
  if (!chain.segs.length) return { created: [], message: "Select a line, arc or spline" };
  if (!ed.d.variables.some((v) => v.name === o.link))
    ed.setVariables([...ed.d.variables, { name: o.link, expr: String(o.distance), value: o.distance }]);
  const created: Id[] = [];
  let firstDim = true;
  const sides: (1 | -1)[] = o.both ? [o.side, (-o.side) as 1 | -1] : [o.side];
  const ends: { start: Id | null; end: Id | null; srcStart: Id; srcEnd: Id }[] = [];
  for (const side of sides) {
    const d = o.distance * side;
    type Piece = { id: Id; start: Id | null; end: Id | null; solved: boolean };
    const pieces: Piece[] = [];
    for (const seg of chain.segs) {
      const e = s.entities[seg.id];
      const c = !!e.construction;
      if (e.type === "line") {
        const a = ptv(s, seg.rev ? e.p2 : e.p1);
        const b = ptv(s, seg.rev ? e.p1 : e.p2);
        const n = scale(norm(perp(sub(b, a))), d);
        const r = addLine(ed, add(a, n), add(b, n), c);
        pieces.push({ id: r.line, start: r.p1, end: r.p2, solved: true });
        ed.addDimension({ type: "offset", refs: [e.id, r.line], expr: `=${o.link}`, value: o.distance, driven: false, label: { x: 0, y: 0 }, hidden: !firstDim, link: o.link });
        firstDim = false;
      } else if (e.type === "arc") {
        const g = arcGeom(s, e);
        // Left of CCW travel is inward.
        const ccwTravel = !seg.rev;
        const r2 = ccwTravel ? g.r - d : g.r + d;
        if (r2 <= 1e-9) return { created, message: "Offset is larger than an arc radius" };
        const k = r2 / g.r;
        const ps = add(g.c, scale(sub(g.p0, g.c), k));
        const pe = add(g.c, scale(sub(g.p1, g.c), k));
        const r = addArc(ed, g.c, ps, pe, c);
        pieces.push({ id: r.arc, start: seg.rev ? r.e : r.s, end: seg.rev ? r.s : r.e, solved: true });
        ed.addDimension({ type: "offset", refs: [e.id, r.arc], expr: `=${o.link}`, value: o.distance, driven: false, label: { x: 0, y: 0 }, hidden: !firstDim, link: o.link });
        firstDim = false;
      } else if (e.type === "spline") {
        // Driven geometry: cubic approximation of the true offset, recomputed after each solve.
        const cps = e.cps.map((p) => ptv(s, p));
        const dd = seg.rev ? -d : d; // left of travel is right of increasing t when reversed
        const parts = offsetBezier(cps, dd, Math.max(1e-2, 1e-3 * spanOf(cps)));
        const made: Id[] = [];
        for (const part of parts) {
          const sid = ed.newId("e");
          const ids = part.cps.map((p) => ed.addPoint(p.x, p.y, sid));
          ed.put({ id: sid, type: "spline", cps: ids, derived: { source: e.id, side: dd >= 0 ? 1 : -1, link: o.link, t0: part.t0, t1: part.t1 }, ...(c ? { construction: c } : {}) });
          made.push(sid);
        }
        if (seg.rev) made.reverse();
        for (const m of made) pieces.push({ id: m, start: null, end: null, solved: false });
      }
    }
    // Joints: coincident between consecutive solver-backed pieces.
    const n = pieces.length;
    for (let i = 0; i < n - (chain.closed ? 0 : 1); i++) {
      const a = pieces[i];
      const b = pieces[(i + 1) % n];
      if (a.solved && b.solved && a.end && b.start) {
        // Corner joints: move both ends to the intersection of the offset lines first.
        joinEnds(ed, a, b);
        ed.addRelation({ type: "coincident", refs: [a.end, b.start] });
      }
    }
    // Open ends stay square to the source ends.
    if (!chain.closed) {
      const f = chain.segs[0];
      const l = chain.segs[chain.segs.length - 1];
      const fe = s.entities[f.id];
      const le = s.entities[l.id];
      const srcStart = f.rev ? endPoints(fe)[1] : endPoints(fe)[0];
      const srcEnd = l.rev ? endPoints(le)[0] : endPoints(le)[1];
      const p0 = pieces[0];
      const pn = pieces[n - 1];
      alignEnd(ed, f.id, p0.id, srcStart, p0.start);
      alignEnd(ed, l.id, pn.id, srcEnd, pn.end);
      ends.push({ start: p0.start, end: pn.end, srcStart, srcEnd });
    }
    created.push(...pieces.map((p) => p.id));
  }
  if (o.baseConstruction) for (const seg of chain.segs) ed.update(seg.id, { construction: true });
  // Cap ends (both directions, open chain).
  if (o.both && o.cap !== "none" && ends.length === 2) {
    const [L, R] = ends;
    for (const [pa, pb, src] of [
      [L.start, R.start, L.srcStart],
      [L.end, R.end, L.srcEnd],
    ] as const) {
      if (!pa || !pb) continue;
      const A = ptv(ed.s, pa);
      const B = ptv(ed.s, pb);
      if (o.cap === "lines") {
        const r = addLine(ed, A, B);
        ed.addRelation({ type: "coincident", refs: [r.p1, pa] });
        ed.addRelation({ type: "coincident", refs: [r.p2, pb] });
        created.push(r.line);
      } else {
        const C = ptv(ed.s, src);
        // Round cap on the outside: CCW from A to B if B is left of A around C... pick the side away from the chain.
        const ccw = cross(sub(A, C), sub(B, C)) <= 0 ? false : true;
        const r = ccw ? addArc(ed, C, A, B) : addArc(ed, C, B, A);
        ed.addRelation({ type: "coincident", refs: [r.c, src] });
        ed.addRelation({ type: "coincident", refs: [ccw ? r.s : r.e, pa] });
        ed.addRelation({ type: "coincident", refs: [ccw ? r.e : r.s, pb] });
        created.push(r.arc);
      }
    }
  }
  return { created };
}

const spanOf = (pts: Vec2[]) => {
  let m = 0;
  for (const p of pts) for (const q of pts) m = Math.max(m, dist(p, q));
  return m;
};

function joinEnds(ed: Editor, a: { id: Id; end: Id | null }, b: { id: Id; start: Id | null }) {
  const s = ed.s;
  const A = s.entities[a.id];
  const B = s.entities[b.id];
  if (!a.end || !b.start) return;
  const pa = ptv(s, a.end);
  const pb = ptv(s, b.start);
  if (dist(pa, pb) < 1e-9 * Math.max(1, len(pa))) return;
  if (A.type === "line" && B.type === "line") {
    const h = intersect({ kind: "line", a: ptv(s, A.p1), b: ptv(s, A.p2) }, { kind: "line", a: ptv(s, B.p1), b: ptv(s, B.p2) }, true);
    const hh = h.length ? h : [];
    if (hh.length) {
      ed.movePoint(a.end, hh[0].p.x, hh[0].p.y);
      ed.movePoint(b.start, hh[0].p.x, hh[0].p.y);
      return;
    }
  }
  const m = { x: (pa.x + pb.x) / 2, y: (pa.y + pb.y) / 2 };
  ed.movePoint(a.end, m.x, m.y);
  ed.movePoint(b.start, m.x, m.y);
}

function alignEnd(ed: Editor, srcId: Id, dstId: Id, srcPoint: Id, dstPoint: Id | null) {
  if (!dstPoint) return;
  const dim = Object.values(ed.s.dimensions).find((d) => d.type === "offset" && d.refs[0] === srcId && d.refs[1] === dstId);
  if (!dim) return;
  ed.updateDimension(dim.id, { align: [...(dim.align ?? []), [srcPoint, dstPoint]] });
}

/** Recompute every driven offset spline from its source (after a solve or variable change). */
export function recomputeDerived(ed: Editor) {
  const s = ed.s;
  const vars = new Map(ed.d.variables.map((v) => [v.name, v.value]));
  for (const e of Object.values(s.entities)) {
    if (e.type !== "spline" || !e.derived) continue;
    const src = s.entities[e.derived.source];
    if (src?.type !== "spline") continue;
    const d = (vars.get(e.derived.link) ?? 0) * e.derived.side;
    const fit = fitOffsetCubic(src.cps.map((p) => ptv(s, p)), d, e.derived.t0, e.derived.t1);
    e.cps.forEach((id, i) => {
      const q = fit.cps[Math.min(i, fit.cps.length - 1)];
      ed.movePoint(id, q.x, q.y);
    });
  }
}

// ---------------------------------------------------------------- Convert Entities

/** Entities of earlier sketches that Convert Entities can copy (not endpoints or spline polygon sides). */
export function convertible(s: Sketch, id: Id): boolean {
  const e = s.entities[id];
  if (!e || !s.ext?.[id] || e.id === "origin") return false;
  if (e.type === "point") return !e.owner;
  if (e.type === "line") return !e.owner;
  return true;
}

/**
 * Convert Entities: copy geometry of earlier sketches into the active sketch, each copy tied to its
 * source by an On Edge relation, so it is fully defined and follows the source.
 */
export function convertEntities(ed: Editor, ids: Id[]): { created: Id[]; message?: string } {
  const s = ed.s;
  const created: Id[] = [];
  const done = new Set(Object.values(s.relations).filter((r) => r.type === "onEdge").map((r) => r.refs[0]));
  let skipped = 0;
  for (const id of ids) {
    if (!convertible(s, id) || done.has(id)) {
      skipped++;
      continue;
    }
    const e = s.entities[id];
    const c = !!e.construction;
    let copy: Id;
    switch (e.type) {
      case "point":
        copy = ed.addPoint(e.x, e.y, undefined, c);
        break;
      case "line":
        copy = addLine(ed, ptv(s, e.p1), ptv(s, e.p2), c).line;
        break;
      case "circle":
        copy = addCircle(ed, ptv(s, e.c), e.r, c).circle;
        break;
      case "arc":
        copy = addArc(ed, ptv(s, e.c), ptv(s, e.s), ptv(s, e.e), c).arc;
        break;
      case "spline":
        copy = addSpline(ed, e.cps.map((p) => ptv(s, p)), c).spline;
        break;
    }
    ed.addRelation({ type: "onEdge", refs: [id, copy] });
    done.add(id);
    created.push(copy);
  }
  if (!created.length) return { created, message: skipped ? "Pick curves or points of an earlier sketch that are not converted yet" : "Nothing to convert" };
  return { created };
}

/**
 * Before reshaping a converted copy (trim, extend, fillet), loosen its On Edge link so it can change
 * length but stays on its source: lines become Collinear, arcs and circles Coradial. A spline copy is
 * unlinked.
 */
export function loosenOnEdge(ed: Editor, id: Id) {
  for (const r of Object.values(ed.s.relations)) {
    if (r.type !== "onEdge" || r.refs[1] !== id) continue;
    const [src, copy] = r.refs;
    const t = ed.s.entities[copy]?.type;
    ed.deleteRelation(r.id);
    if (t === "line") ed.addRelation({ type: "collinear", refs: [src, copy] });
    else if (t === "arc" || t === "circle") ed.addRelation({ type: "coradial", refs: [src, copy] });
  }
}
