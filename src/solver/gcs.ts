/**
 * PlaneGCS adapter. The ONLY module that imports planegcs. Runs inside the
 * solver worker (or directly in tests).
 */
import { Algorithm, DebugMode, GcsWrapper, init_planegcs_module } from "./planegcs/index";
import { analyse } from "./analysis";
import { buildResiduals, indexParams } from "./residuals";
import type { DragTarget, EntityState, SolveResult, SolverConstraint, SolverParams } from "./types";

type Prim = Record<string, unknown> & { id: string; type: string };

const radiusRef = (gid: string) => ({ o_id: gid, prop: "radius" as const });

function toPrimitives(params: SolverParams, cons: SolverConstraint[]): Prim[] {
  const prims: Prim[] = [];
  for (const p of params.points) prims.push({ id: p.id, type: "point", x: p.x, y: p.y, fixed: !!p.fixed });
  const pos = new Map(params.points.map((p) => [p.id, p]));
  // B-splines must come straight after the points: the wrapper re-registers their poles.
  const bsplines = new Map<string, string>();
  for (const c of cons) {
    if (c.kind !== "pointOnBezier") continue;
    const key = c.cps.join(",");
    if (bsplines.has(key)) continue;
    const id = `#bs${bsplines.size}`;
    bsplines.set(key, id);
    const n = c.cps.length - 1;
    prims.push({ id, type: "bspline", pole_ids: c.cps, weights: c.cps.map(() => 1), knots: [0, 1], mult: [n + 1, n + 1], degree: n, periodic: false });
  }
  const geomKind = new Map<string, string>();
  for (const g of params.geoms) {
    geomKind.set(g.id, g.kind);
    if (g.kind === "line") prims.push({ id: g.id, type: "line", p1_id: g.p1, p2_id: g.p2 });
    else if (g.kind === "circle") prims.push({ id: g.id, type: "circle", c_id: g.c, radius: g.r, ...(g.fixed ? { fixed: true } : {}) });
    else {
      const c = pos.get(g.c)!;
      const s = pos.get(g.s)!;
      const e = pos.get(g.e)!;
      const r = Math.hypot(s.x - c.x, s.y - c.y);
      const sa = Math.atan2(s.y - c.y, s.x - c.x);
      let ea = Math.atan2(e.y - c.y, e.x - c.x);
      while (ea <= sa) ea += Math.PI * 2;
      prims.push({ id: g.id, type: "arc", c_id: g.c, start_id: g.s, end_id: g.e, radius: r, start_angle: sa, end_angle: ea, ...(g.fixed ? { fixed: true } : {}) });
      // A locked arc has locked angles and radius too (as FreeCAD does for external geometry): no rules.
      if (!g.fixed) prims.push({ id: `${g.id}#rules`, type: "arc_rules", a_id: g.id });
    }
  }
  const isArc = (id: string) => geomKind.get(id) === "arc";
  for (const c of cons) {
    const base = { id: c.id };
    switch (c.kind) {
      case "coincident":
        prims.push({ ...base, type: "p2p_coincident", p1_id: c.a, p2_id: c.b });
        break;
      case "horizontal":
        prims.push({ ...base, type: "horizontal_pp", p1_id: c.a, p2_id: c.b });
        break;
      case "vertical":
        prims.push({ ...base, type: "vertical_pp", p1_id: c.a, p2_id: c.b });
        break;
      case "coordX":
        prims.push({ ...base, type: "coordinate_x", p_id: c.p, x: c.v });
        break;
      case "coordY":
        prims.push({ ...base, type: "coordinate_y", p_id: c.p, y: c.v });
        break;
      case "radius":
        if (isArc(c.g)) prims.push({ ...base, type: "arc_radius", a_id: c.g, radius: c.v });
        else prims.push({ ...base, type: "circle_radius", c_id: c.g, radius: c.v });
        break;
      case "parallel":
        prims.push({ ...base, type: "parallel", l1_id: c.l1, l2_id: c.l2 });
        break;
      case "perpendicular":
        prims.push({ ...base, type: "perpendicular_ll", l1_id: c.l1, l2_id: c.l2 });
        break;
      case "perpPoints":
        prims.push({ ...base, type: "perpendicular_pppp", l1p1_id: c.a, l1p2_id: c.b, l2p1_id: c.c, l2p2_id: c.d });
        break;
      case "pointOnLine":
        prims.push({ ...base, type: "point_on_line_ppp", p_id: c.p, lp1_id: c.a, lp2_id: c.b });
        break;
      case "pointOnCircle":
        if (isArc(c.g)) prims.push({ ...base, type: "point_on_arc", p_id: c.p, a_id: c.g });
        else prims.push({ ...base, type: "point_on_circle", p_id: c.p, c_id: c.g });
        break;
      case "equalLength":
        prims.push({ ...base, type: "equal_length", l1_id: c.l1, l2_id: c.l2 });
        break;
      case "equalRadius":
        prims.push({ ...base, type: "equal", param1: radiusRef(c.g1), param2: radiusRef(c.g2) });
        break;
      case "tangentLineCircle":
        if (isArc(c.g)) prims.push({ ...base, type: "tangent_la", l_id: c.l, a_id: c.g });
        else prims.push({ ...base, type: "tangent_lc", l_id: c.l, c_id: c.g });
        break;
      case "tangentCircles": {
        const g1 = params.geoms.find((g) => g.id === c.g1)!;
        const g2 = params.geoms.find((g) => g.id === c.g2)!;
        if (g1.kind === "line" || g2.kind === "line") break;
        prims.push({ ...base, type: "tangent_circumf", p1_id: g1.c, p2_id: g2.c, rd1: radiusRef(c.g1), rd2: radiusRef(c.g2), internal: c.internal });
        break;
      }
      case "symmetricLine":
        prims.push({ ...base, type: "p2p_symmetric_ppl", p1_id: c.a, p2_id: c.b, l_id: c.l });
        break;
      case "symmetricPoint":
        prims.push({ ...base, type: "p2p_symmetric_ppp", p1_id: c.a, p2_id: c.b, p_id: c.p });
        break;
      case "distance":
        prims.push({ ...base, type: "p2p_distance", p1_id: c.a, p2_id: c.b, distance: c.v });
        break;
      case "distanceX":
        prims.push({ ...base, type: "difference", param1: { o_id: c.a, prop: "x" }, param2: { o_id: c.b, prop: "x" }, difference: c.v });
        break;
      case "distanceY":
        prims.push({ ...base, type: "difference", param1: { o_id: c.a, prop: "y" }, param2: { o_id: c.b, prop: "y" }, difference: c.v });
        break;
      case "pointLineDistance":
        prims.push({ ...base, type: "p2l_distance", p_id: c.p, l_id: c.l, distance: c.v });
        break;
      case "angle":
        prims.push({ ...base, type: "l2l_angle_pppp", l1p1_id: c.a, l1p2_id: c.b, l2p1_id: c.c, l2p2_id: c.d, angle: c.v });
        break;
      case "arcLength":
        prims.push({ ...base, type: "arc_length", a_id: c.g, dist: c.v });
        break;
      case "radiusDiff":
        prims.push({ ...base, type: "difference", param1: radiusRef(c.g1), param2: radiusRef(c.g2), difference: c.v });
        break;
      case "equalCurvatureBB":
        prims.push({ ...base, type: "equal_curvature_bb", ja_id: c.ja, a1_id: c.a1, a2_id: c.a2, na: c.na, jb_id: c.jb, b1_id: c.b1, b2_id: c.b2, nb: c.nb });
        break;
      case "equalCurvatureBA":
        prims.push({ ...base, type: "equal_curvature_ba", ja_id: c.ja, a1_id: c.a1, a2_id: c.a2, na: c.na, b_id: c.arc, arcSign: c.arcSign });
        break;
      case "pointOnBezier":
        prims.push({ ...base, type: "point_on_bspline", p_id: c.p, b_id: bsplines.get(c.cps.join(","))!, pointparam: c.t });
        break;
    }
  }
  return prims;
}

/** Temporary drag constraints referencing sketch params so frames can update them cheaply. */
function dragPrims(targets: DragTarget[], params: SolverParams): { prims: Prim[]; sketchParams: { type: "param"; name: string; value: number }[] } {
  const prims: Prim[] = [];
  const sp: { type: "param"; name: string; value: number }[] = [];
  const kinds = new Map(params.geoms.map((g) => [g.id, g.kind]));
  targets.forEach((t, i) => {
    if (t.point) {
      sp.push({ type: "param", name: `drag${i}x`, value: t.x }, { type: "param", name: `drag${i}y`, value: t.y });
      prims.push({ id: `#drag${i}x`, type: "coordinate_x", p_id: t.point, x: `drag${i}x`, temporary: true });
      prims.push({ id: `#drag${i}y`, type: "coordinate_y", p_id: t.point, y: `drag${i}y`, temporary: true });
    } else if (t.radiusOf && t.r !== undefined) {
      sp.push({ type: "param", name: `drag${i}r`, value: t.r });
      if (kinds.get(t.radiusOf) === "arc") prims.push({ id: `#drag${i}r`, type: "arc_radius", a_id: t.radiusOf, radius: `drag${i}r`, temporary: true });
      else prims.push({ id: `#drag${i}r`, type: "circle_radius", c_id: t.radiusOf, radius: `drag${i}r`, temporary: true });
    }
  });
  return { prims, sketchParams: sp };
}

const ownerOf = (cid: string) => cid.split("#")[0];

/** Extra scalars are free solver parameters (not fixed like ordinary sketch params). */
function pushExtras(w: GcsWrapper, params: SolverParams) {
  for (const e of params.extras ?? []) w.push_sketch_param(e.id, e.value, false);
}

export class GcsCore {
  private dragSession: { gcs: GcsWrapper; params: SolverParams; n: number } | null = null;

  private constructor(private mod: Awaited<ReturnType<typeof init_planegcs_module>>) {}

  static async create(moduleOptions?: Parameters<typeof init_planegcs_module>[0]): Promise<GcsCore> {
    const mod = await init_planegcs_module(moduleOptions);
    return new GcsCore(mod);
  }

  private newWrapper(): GcsWrapper {
    const w = new GcsWrapper(new this.mod.GcsSystem(), this.mod);
    w.debug_mode = DebugMode.NoDebug;
    return w;
  }

  private read(w: GcsWrapper, params: SolverParams): SolverParams {
    const points = params.points.map((p) => {
      const q = w.sketch_index.get_primitive(p.id) as { x: number; y: number } | undefined;
      return q ? { ...p, x: q.x, y: q.y } : p;
    });
    const geoms = params.geoms.map((g) => {
      if (g.kind !== "circle") return g;
      const q = w.sketch_index.get_primitive(g.id) as { radius: number } | undefined;
      return q ? { ...g, r: Math.abs(q.radius) } : g;
    });
    const extras = params.extras?.map((e) => ({ id: e.id, value: w.get_sketch_param_value(e.id) ?? e.value }));
    return { points, geoms, ...(extras ? { extras } : {}) };
  }

  /** Full solve: two passes so that redundancy is diagnosed at the solved geometry. */
  solve(params: SolverParams, cons: SolverConstraint[], drag?: DragTarget[]): SolveResult {
    const t0 = now();
    const w = this.newWrapper();
    try {
      if (drag && drag.length) {
        const d = dragPrims(drag, params);
        pushExtras(w, params);
        w.push_primitives_and_params([...d.sketchParams, ...toPrimitives(params, cons), ...d.prims] as any);
        const st = w.solve(Algorithm.DogLeg);
        const ok = st === 0 || st === 1;
        if (ok) w.apply_solution();
        return this.finish(ok ? this.read(w, params) : params, cons, ok, [], [], t0);
      }
      pushExtras(w, params);
      w.push_primitives_and_params(toPrimitives(params, cons) as any);
      const st1 = w.solve(Algorithm.DogLeg);
      if (!(st1 === 0 || st1 === 1)) {
        const conflicts = uniq(w.get_gcs_conflicting_constraints().map(ownerOf));
        const redundant = uniq(w.get_gcs_redundant_constraints().map(ownerOf));
        return this.finish(params, cons, false, conflicts, redundant, t0);
      }
      w.apply_solution();
      const solved1 = this.read(w, params);
      // Pass 2 at the solved geometry for an accurate redundancy diagnosis.
      w.clear_data();
      pushExtras(w, solved1);
      w.push_primitives_and_params(toPrimitives(solved1, cons) as any);
      const st2 = w.solve(Algorithm.DogLeg);
      const ok2 = st2 === 0 || st2 === 1;
      if (ok2) w.apply_solution();
      const solved = ok2 ? this.read(w, solved1) : solved1;
      const conflicts = uniq(w.get_gcs_conflicting_constraints().map(ownerOf));
      const redundant = uniq(w.get_gcs_redundant_constraints().map(ownerOf));
      return this.finish(solved, cons, true, conflicts, redundant, t0);
    } finally {
      w.destroy_gcs_module();
    }
  }

  private finish(params: SolverParams, cons: SolverConstraint[], ok: boolean, conflicts: string[], redundant: string[], t0: number): SolveResult {
    const pi = indexParams(params);
    const res = buildResiduals(pi, cons);
    // Locked parameters (geometry of earlier sketches) are known, not degrees of freedom.
    const pin = (k: string) => {
      const i = pi.index.get(k);
      if (i === undefined) return;
      const v0 = pi.values[i];
      res.push({ owner: "#fixed", deps: [i], f: (x) => [x[i] - v0] });
    };
    for (const p of params.points) if (p.fixed) (pin(`${p.id}.x`), pin(`${p.id}.y`));
    for (const g of params.geoms) if (g.kind === "circle" && g.fixed) pin(`${g.id}.r`);
    const an = analyse(pi, res);
    const entityStatus: Record<string, EntityState> = {};
    const det = (k: string) => an.determined[pi.index.get(k)!] === 1;
    const ptFull = (id: string) => det(`${id}.x`) && det(`${id}.y`);
    for (const p of params.points) entityStatus[p.id] = ptFull(p.id) ? "full" : "under";
    for (const g of params.geoms) {
      let full: boolean;
      if (g.kind === "line") full = ptFull(g.p1) && ptFull(g.p2);
      else if (g.kind === "circle") full = ptFull(g.c) && det(`${g.id}.r`);
      else full = ptFull(g.c) && ptFull(g.s) && ptFull(g.e);
      entityStatus[g.id] = full ? "full" : "under";
    }
    // Constraints that the (failed) solution does not satisfy turn their geometry yellow.
    const bad = new Set([...conflicts, ...redundant]);
    if (!ok && bad.size === 0) for (const o of an.unsatisfied) bad.add(o);
    const markState: EntityState = conflicts.length || redundant.length ? "over" : "failed";
    if (bad.size) {
      const touched = touchedIds(params, cons, bad);
      for (const id of touched) entityStatus[id] = markState;
    }
    return { params, ok, entityStatus, conflicts, redundant, dof: an.dof, ms: now() - t0 };
  }

  // ---- drag sessions
  dragStart(params: SolverParams, cons: SolverConstraint[], targets: DragTarget[]): SolverParams {
    this.dragEnd();
    const w = this.newWrapper();
    const d = dragPrims(targets, params);
    pushExtras(w, params);
    w.push_primitives_and_params([...d.sketchParams, ...toPrimitives(params, cons), ...d.prims] as any);
    this.dragSession = { gcs: w, params, n: targets.length };
    return this.dragSolve();
  }

  dragMove(targets: DragTarget[]): SolverParams {
    const s = this.dragSession;
    if (!s) throw new Error("no drag session");
    targets.forEach((t, i) => {
      if (i >= s.n) return;
      if (t.point) {
        s.gcs.set_sketch_param(`drag${i}x`, t.x);
        s.gcs.set_sketch_param(`drag${i}y`, t.y);
      } else if (t.r !== undefined) s.gcs.set_sketch_param(`drag${i}r`, t.r);
    });
    return this.dragSolve();
  }

  private dragSolve(): SolverParams {
    const s = this.dragSession!;
    const st = s.gcs.solve(Algorithm.DogLeg);
    if (st === 0 || st === 1) {
      s.gcs.apply_solution();
      s.params = this.read(s.gcs, s.params);
    }
    return s.params;
  }

  dragEnd() {
    if (this.dragSession) {
      this.dragSession.gcs.destroy_gcs_module();
      this.dragSession = null;
    }
  }
}

/** Point and geometry ids referenced by the constraints of the given owners. */
function touchedIds(params: SolverParams, cons: SolverConstraint[], owners: Set<string>): Set<string> {
  const out = new Set<string>();
  const geomIds = new Set(params.geoms.map((g) => g.id));
  for (const c of cons) {
    if (!owners.has(c.owner)) continue;
    for (const [k, v] of Object.entries(c)) {
      if (k === "id" || k === "owner" || k === "kind") continue;
      if (typeof v === "string") out.add(v);
      else if (Array.isArray(v)) for (const x of v) if (typeof x === "string") out.add(x);
    }
  }
  // A line/arc whose point is involved is involved too.
  for (const g of params.geoms) {
    if (!geomIds.has(g.id)) continue;
    const pts = g.kind === "line" ? [g.p1, g.p2] : g.kind === "circle" ? [g.c] : [g.c, g.s, g.e];
    if (out.has(g.id)) for (const p of pts) out.add(p);
  }
  return out;
}

const uniq = (a: string[]) => Array.from(new Set(a));
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());
