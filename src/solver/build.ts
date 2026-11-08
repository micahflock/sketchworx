import { dist } from "../geom/vec";
import { bezierClosest } from "../geom/bezier";
import { definingPoints, endPoints, ptv } from "../model/sketch";
import type { Entity, Id, Relation, Sketch } from "../model/types";
import type { SolverConstraint, SolverGeom, SolverParams, SolverPoint } from "./types";
import { dimensionConstraints } from "./dimensions";

export interface BuildResult {
  params: SolverParams;
  constraints: SolverConstraint[];
  /** Relations that could not be expressed (invalid selection, unsupported combination). */
  unsupported: Id[];
}

/** Union-find of points joined by point-point coincident relations. */
export class CoincidenceGroups {
  private parent = new Map<Id, Id>();
  find(a: Id): Id {
    let p = this.parent.get(a) ?? a;
    if (p !== a) {
      p = this.find(p);
      this.parent.set(a, p);
    }
    return p;
  }
  union(a: Id, b: Id) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  same(a: Id, b: Id) {
    return this.find(a) === this.find(b);
  }
  static of(s: Sketch): CoincidenceGroups {
    const g = new CoincidenceGroups();
    for (const r of Object.values(s.relations)) {
      if (r.type !== "coincident") continue;
      const pts = r.refs.filter((id) => s.entities[id]?.type === "point");
      if (pts.length === r.refs.length) for (let i = 1; i < pts.length; i++) g.union(pts[0], pts[i]);
    }
    return g;
  }
}

/** Find an endpoint of `a` and an endpoint of `b` that are coincident. */
export function sharedEnd(groups: CoincidenceGroups, a: Entity, b: Entity): [Id, Id] | null {
  for (const pa of endPoints(a)) for (const pb of endPoints(b)) if (pa === pb || groups.same(pa, pb)) return [pa, pb];
  return null;
}

/** Translate a sketch into solver parameters and constraints. */
export function buildSolverInput(s: Sketch, opts: { dimensions?: boolean } = {}): BuildResult {
  const points: SolverPoint[] = [];
  const geoms: SolverGeom[] = [];
  const derived = derivedIds(s);
  const locked = s.ext ? lockedRefs(s) : null;
  for (const e of Object.values(s.entities)) {
    if (derived.has(e.id)) continue;
    // Geometry of earlier sketches: only what this sketch references, and locked in place.
    const fixed = !!s.ext?.[e.id];
    if (fixed && !locked!.has(e.id)) continue;
    const fx = fixed ? { fixed: true as const } : {};
    switch (e.type) {
      case "point":
        points.push({ id: e.id, x: e.x, y: e.y, ...fx });
        break;
      case "line":
        geoms.push({ kind: "line", id: e.id, p1: e.p1, p2: e.p2 });
        break;
      case "circle":
        geoms.push({ kind: "circle", id: e.id, c: e.c, r: e.r, ...fx });
        break;
      case "arc":
        geoms.push({ kind: "arc", id: e.id, c: e.c, s: e.s, e: e.e, ...fx });
        break;
      case "spline":
        break; // control vertices are points; polygon sides are construction lines
    }
  }
  const groups = CoincidenceGroups.of(s);
  const constraints: SolverConstraint[] = [];
  if (s.entities.origin) {
    constraints.push({ id: "origin#x", owner: "origin", kind: "coordX", p: "origin", v: 0 });
    constraints.push({ id: "origin#y", owner: "origin", kind: "coordY", p: "origin", v: 0 });
  }
  const unsupported: Id[] = [];
  for (const r of Object.values(s.relations)) {
    if (r.refs.some((id) => derived.has(id))) {
      unsupported.push(r.id);
      continue;
    }
    const out = relationConstraints(s, r, groups);
    if (out === null) unsupported.push(r.id);
    else constraints.push(...out);
  }
  if (opts.dimensions !== false)
    for (const d of Object.values(s.dimensions)) {
      if (d.driven) continue;
      const out = dimensionConstraints(s, d);
      if (out === null) unsupported.push(d.id);
      else constraints.push(...out);
    }
  const extras: { id: Id; value: number }[] = [];
  for (const c of constraints)
    if (c.kind === "pointOnBezier") {
      const cps = c.cps.map((id) => ptv(s, id));
      extras.push({ id: c.t, value: bezierClosest(cps, ptv(s, c.p)).t });
    }
  return { params: { points, geoms, ...(extras.length ? { extras } : {}) }, constraints, unsupported };
}

/** Borrowed (ext) entities this sketch's relations and dimensions use, with their defining points. */
function lockedRefs(s: Sketch): Set<Id> {
  const out = new Set<Id>();
  const add = (id: Id) => {
    const e = s.entities[id];
    if (!e || !s.ext?.[id] || out.has(id)) return;
    out.add(id);
    if (e.type !== "point") for (const p of definingPoints(e)) out.add(p);
  };
  for (const r of Object.values(s.relations)) r.refs.forEach(add);
  for (const d of Object.values(s.dimensions)) {
    d.refs.forEach(add);
    for (const pair of d.align ?? []) pair.forEach(add);
  }
  return out;
}

/** Whether a relation can be expressed for this sketch (right kinds of entities, shared ends, …). */
export function relationSupported(s: Sketch, r: Relation): boolean {
  return relationConstraints(s, r, CoincidenceGroups.of(s)) !== null;
}

type C = SolverConstraint;
/**
 * Driven (offset) splines and their control vertices: computed, not solved. Those of earlier sketches
 * are plain locked geometry here, so they are not listed.
 */
export function derivedIds(s: Sketch): Set<Id> {
  const out = new Set<Id>();
  for (const e of Object.values(s.entities))
    if (e.type === "spline" && e.derived && !s.ext?.[e.id]) {
      out.add(e.id);
      for (const p of e.cps) out.add(p);
    }
  return out;
}

export type Body = C extends infer T ? (T extends C ? Omit<T, "id" | "owner"> : never) : never;

function relationConstraints(s: Sketch, r: Relation, groups: CoincidenceGroups): C[] | null {
  const E = (id: Id) => s.entities[id];
  const ents = r.refs.map(E);
  if (ents.some((e) => !e)) return null;
  const out: C[] = [];
  let k = 0;
  const add = (c: Body) => out.push({ ...c, id: `${r.id}#${k++}`, owner: r.id } as C);
  const pointsOf = ents.filter((e) => e.type === "point");
  const lines = ents.filter((e) => e.type === "line") as Extract<Entity, { type: "line" }>[];
  const round = ents.filter((e) => e.type === "circle" || e.type === "arc") as Extract<Entity, { type: "circle" | "arc" }>[];

  switch (r.type) {
    case "coincident": {
      if (pointsOf.length === ents.length) {
        for (let i = 1; i < ents.length; i++) add({ kind: "coincident", a: ents[0].id, b: ents[i].id });
        return out;
      }
      if (pointsOf.length !== 1 || ents.length !== 2) return null;
      const p = pointsOf[0].id;
      const curve = ents.find((e) => e.type !== "point")!;
      if (curve.type === "line") add({ kind: "pointOnLine", p, a: curve.p1, b: curve.p2 });
      else if (curve.type === "circle" || curve.type === "arc") add({ kind: "pointOnCircle", p, g: curve.id });
      else if (curve.type === "spline" && (!curve.derived || s.ext?.[curve.id])) add({ kind: "pointOnBezier", p, cps: curve.cps, t: `${r.id}#t` });
      else return null;
      return out;
    }
    case "horizontal":
    case "vertical": {
      const kind = r.type;
      if (lines.length === ents.length) {
        for (const l of lines) add({ kind, a: l.p1, b: l.p2 });
        return out;
      }
      if (pointsOf.length === ents.length && ents.length >= 2) {
        for (let i = 1; i < ents.length; i++) add({ kind, a: ents[0].id, b: ents[i].id });
        return out;
      }
      return null;
    }
    case "parallel":
    case "perpendicular": {
      if (lines.length !== ents.length || lines.length < 2) return null;
      for (let i = 1; i < lines.length; i++) add({ kind: r.type, l1: lines[0].id, l2: lines[i].id });
      return out;
    }
    case "collinear": {
      if (lines.length !== ents.length || lines.length < 2) return null;
      const l0 = lines[0];
      for (let i = 1; i < lines.length; i++) {
        add({ kind: "pointOnLine", p: lines[i].p1, a: l0.p1, b: l0.p2 });
        add({ kind: "pointOnLine", p: lines[i].p2, a: l0.p1, b: l0.p2 });
      }
      return out;
    }
    case "equal": {
      if (lines.length === ents.length && lines.length >= 2) {
        for (let i = 1; i < lines.length; i++) add({ kind: "equalLength", l1: lines[0].id, l2: lines[i].id });
        return out;
      }
      if (round.length === ents.length && round.length >= 2) {
        for (let i = 1; i < round.length; i++) add({ kind: "equalRadius", g1: round[0].id, g2: round[i].id });
        return out;
      }
      return null;
    }
    case "concentric":
    case "coradial": {
      if (round.length !== ents.length || round.length < 2) return null;
      for (let i = 1; i < round.length; i++) {
        add({ kind: "coincident", a: round[0].c, b: round[i].c });
        if (r.type === "coradial") add({ kind: "equalRadius", g1: round[0].id, g2: round[i].id });
      }
      return out;
    }
    case "midpoint": {
      if (ents.length !== 2 || pointsOf.length !== 1 || lines.length !== 1) return null;
      add({ kind: "symmetricPoint", a: lines[0].p1, b: lines[0].p2, p: pointsOf[0].id });
      return out;
    }
    case "symmetric": {
      if (ents.length !== 3) return null;
      const axis = ents[2];
      if (axis.type !== "line") return null;
      const [a, b] = ents;
      if (a.type === "point" && b.type === "point") add({ kind: "symmetricLine", a: a.id, b: b.id, l: axis.id });
      else if (a.type === "line" && b.type === "line") {
        // Pair endpoints the way the mirror image does.
        const pa1 = ptv(s, a.p1);
        const m = mirrorPoint(pa1, ptv(s, axis.p1), ptv(s, axis.p2));
        const straight = dist(m, ptv(s, b.p1)) <= dist(m, ptv(s, b.p2));
        add({ kind: "symmetricLine", a: a.p1, b: straight ? b.p1 : b.p2, l: axis.id });
        add({ kind: "symmetricLine", a: a.p2, b: straight ? b.p2 : b.p1, l: axis.id });
      } else if ((a.type === "circle" || a.type === "arc") && (b.type === "circle" || b.type === "arc")) {
        add({ kind: "symmetricLine", a: a.c, b: b.c, l: axis.id });
        add({ kind: "equalRadius", g1: a.id, g2: b.id });
        if (a.type === "arc" && b.type === "arc") add({ kind: "symmetricLine", a: a.s, b: b.e, l: axis.id });
      } else if (a.type === "spline" && b.type === "spline" && a.cps.length === b.cps.length) {
        const n = a.cps.length;
        const m = mirrorPoint(ptv(s, a.cps[0]), ptv(s, axis.p1), ptv(s, axis.p2));
        const straight = dist(m, ptv(s, b.cps[0])) <= dist(m, ptv(s, b.cps[n - 1]));
        for (let i = 0; i < n; i++) add({ kind: "symmetricLine", a: a.cps[i], b: straight ? b.cps[i] : b.cps[n - 1 - i], l: axis.id });
      } else return null;
      return out;
    }
    case "fix": {
      const vals = r.values ?? [];
      let vi = 0;
      for (const e of ents) {
        const pts = e.type === "point" ? [e.id] : definingPoints(e);
        for (const pid of pts) {
          const p = ptv(s, pid);
          add({ kind: "coordX", p: pid, v: vals[vi++] ?? p.x });
          add({ kind: "coordY", p: pid, v: vals[vi++] ?? p.y });
        }
        if (e.type === "circle") add({ kind: "radius", g: e.id, v: vals[vi++] ?? e.r });
      }
      return out;
    }
    case "tangent":
      return tangentConstraints(s, ents, groups, add) ? out : null;
    case "onEdge": {
      // The copy coincides with its source, point for point.
      const [src, copy] = ents;
      if (ents.length !== 2 || src.type !== copy.type) return null;
      const a = src.type === "point" ? [src.id] : definingPoints(src);
      const b = copy.type === "point" ? [copy.id] : definingPoints(copy);
      if (a.length !== b.length) return null;
      a.forEach((p, i) => add({ kind: "coincident", a: p, b: b[i] }));
      if (src.type === "circle" && copy.type === "circle") add({ kind: "equalRadius", g1: src.id, g2: copy.id });
      return out;
    }
    case "equalCurvature": {
      if (!tangentConstraints(s, ents, groups, add)) return null;
      const g2 = curvatureConstraint(ents, groups);
      if (!g2) return null;
      add(g2);
      return out;
    }
  }
}

function tangentConstraints(s: Sketch, ents: Entity[], groups: CoincidenceGroups, add: (c: Body) => void): boolean {
  if (ents.length !== 2) return false;
  let [a, b] = ents;
  const order: Record<string, number> = { line: 0, circle: 1, arc: 2, spline: 3 };
  if ((order[a.type] ?? 9) > (order[b.type] ?? 9)) [a, b] = [b, a];
  const shared = sharedEnd(groups, a, b);
  if (a.type === "line" && (b.type === "circle" || b.type === "arc")) {
    if (shared && b.type === "arc") add({ kind: "perpPoints", a: a.p1, b: a.p2, c: b.c, d: shared[1] });
    else add({ kind: "tangentLineCircle", l: a.id, g: b.id });
    return true;
  }
  if ((a.type === "circle" || a.type === "arc") && (b.type === "circle" || b.type === "arc")) {
    if (shared && a.type === "arc" && b.type === "arc") {
      // Centers and the shared point are collinear.
      add({ kind: "pointOnLine", p: b.c, a: a.c, b: shared[0] });
    } else {
      const ra = a.type === "circle" ? a.r : dist(ptv(s, a.c), ptv(s, a.s));
      const rb = b.type === "circle" ? b.r : dist(ptv(s, b.c), ptv(s, b.s));
      const d = dist(ptv(s, a.c), ptv(s, b.c));
      add({ kind: "tangentCircles", g1: a.id, g2: b.id, internal: Math.abs(d - Math.abs(ra - rb)) < Math.abs(d - (ra + rb)) });
    }
    return true;
  }
  // Style splines: tangency is a condition on the control polygon.
  if (b.type === "spline") {
    if (!shared) return false;
    const [pa, pb] = shared;
    const n = b.cps.length;
    const atStart = b.cps[0] === pb;
    const end = atStart ? b.cps[0] : b.cps[n - 1];
    const inner = atStart ? b.cps[1] : b.cps[n - 2];
    if (a.type === "line") {
      // First/last polygon side collinear with the line (the end point already lies on it).
      add({ kind: "pointOnLine", p: inner, a: a.p1, b: a.p2 });
      return true;
    }
    if (a.type === "arc") {
      add({ kind: "perpPoints", a: end, b: inner, c: a.c, d: pa });
      return true;
    }
    if (a.type === "spline") {
      const m = a.cps.length;
      const aStart = a.cps[0] === pa;
      const aInner = aStart ? a.cps[1] : a.cps[m - 2];
      // Adjacent polygon sides collinear through the joint.
      add({ kind: "pointOnLine", p: aInner, a: end, b: inner });
      return true;
    }
  }
  return false;
}

/** The joint and the next two control points of a spline end, leaving the joint. */
function splineEnd(sp: Extract<Entity, { type: "spline" }>, joint: Id) {
  const n = sp.cps.length - 1;
  return sp.cps[0] === joint ? { j: sp.cps[0], q1: sp.cps[1], q2: sp.cps[2], n } : { j: sp.cps[n], q1: sp.cps[n - 1], q2: sp.cps[n - 2], n };
}

function curvatureConstraint(ents: Entity[], groups: CoincidenceGroups): Body | null {
  let [a, b] = ents;
  if (a.type !== "spline") [a, b] = [b, a];
  if (a.type !== "spline" || a.cps.length < 3) return null;
  const shared = sharedEnd(groups, a, b);
  if (!shared) return null;
  const A = splineEnd(a, shared[0]);
  if (b.type === "spline") {
    if (b.cps.length < 3) return null;
    const B = splineEnd(b, shared[1]);
    return { kind: "equalCurvatureBB", ja: A.j, a1: A.q1, a2: A.q2, na: A.n, jb: B.j, b1: B.q1, b2: B.q2, nb: B.n };
  }
  if (b.type === "arc") return { kind: "equalCurvatureBA", ja: A.j, a1: A.q1, a2: A.q2, na: A.n, arc: b.id, arcSign: shared[1] === b.s ? 1 : -1 };
  return null;
}

function mirrorPoint(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy || 1;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2;
  const fx = a.x + t * dx;
  const fy = a.y + t * dy;
  return { x: 2 * fx - p.x, y: 2 * fy - p.y };
}

