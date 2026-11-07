import { beforeAll, describe, expect, it } from "vitest";
import { bezierCurvature } from "../src/geom/bezier";
import type { Vec2 } from "../src/geom/vec";
import { dist } from "../src/geom/vec";
import { applyCommand } from "../src/model/editor";
import { addRelationCmd, validRelations } from "../src/model/relations";
import { activeSketch, createDoc, ptv } from "../src/model/sketch";
import type { Doc, Id, Sketch, SplineEntity } from "../src/model/types";
import { buildSolverInput } from "../src/solver/build";
import { GcsCore } from "../src/solver/gcs";
import { addArc, addLine } from "../src/tools/common";
import { addSpline, mirrorEntities } from "../src/tools/edits";

let core: GcsCore;
beforeAll(async () => {
  core = await GcsCore.create();
});

/** Curvature passing through the joint from a into b (sign-consistent for either orientation). */
function jointCurvatures(s: Sketch, a: Id, b: Id, pos: Map<Id, Vec2>): [number, number] {
  const A = s.entities[a] as SplineEntity;
  const B = s.entities[b] as SplineEntity;
  const ca = A.cps.map((id) => pos.get(id) ?? ptv(s, id));
  const cb = B.cps.map((id) => pos.get(id) ?? ptv(s, id));
  let best: [number, number] = [0, 0];
  let bd = Infinity;
  for (const i of [0, ca.length - 1]) for (const j of [0, cb.length - 1]) if (dist(ca[i], cb[j]) < bd) ((bd = dist(ca[i], cb[j])), (best = [i, j]));
  // Orient a to end at the joint and b to start there.
  const oa = best[0] === 0 ? [...ca].reverse() : ca;
  const ob = best[1] === 0 ? cb : [...cb].reverse();
  return [bezierCurvature(oa, 1), bezierCurvature(ob, 0)];
}

function letterO(g2: boolean) {
  const ids = { tr: "", br: "", tl: "", bl: "" };
  const doc = applyCommand(createDoc(), (ed) => {
    const axis = addLine(ed, { x: 0, y: -150 }, { x: 0, y: 150 }, true);
    const tr = addSpline(ed, [
      { x: 0, y: 100 },
      { x: 55, y: 100 },
      { x: 100, y: 55 },
      { x: 100, y: 0 },
    ]);
    const br = addSpline(ed, [
      { x: 100, y: 0 },
      { x: 100, y: -55 },
      { x: 55, y: -100 },
      { x: 0, y: -100 },
    ]);
    ed.addRelation({ type: "coincident", refs: [tr.cps[3], br.cps[0]] });
    addRelationCmd(ed, g2 ? "equalCurvature" : "tangent", [tr.spline, br.spline]);
    ed.addRelation({ type: "coincident", refs: [tr.cps[0], axis.line] });
    ed.addRelation({ type: "coincident", refs: [br.cps[3], axis.line] });
    const [tl, bl] = mirrorEntities(ed, [tr.spline, br.spline], axis.line);
    ed.addRelation({ type: "tangent", refs: [tr.spline, tl] });
    ed.addRelation({ type: "tangent", refs: [br.spline, bl] });
    Object.assign(ids, { tr: tr.spline, br: br.spline, tl, bl });
  });
  return { doc, ...ids };
}

function dragAndCheck(doc: Doc, handle: Id) {
  const inp = buildSolverInput(activeSketch(doc));
  expect(inp.unsupported).toEqual([]);
  const r0 = core.solve(inp.params, inp.constraints);
  expect(r0.ok).toBe(true);
  expect(r0.conflicts).toEqual([]);
  expect(r0.redundant).toEqual([]);
  const frames: Map<Id, Vec2>[] = [new Map(r0.params.points.map((p) => [p.id, p]))];
  const start = frames[0].get(handle)!;
  core.dragStart(r0.params, inp.constraints, [{ point: handle, ...start }]);
  for (let i = 1; i <= 12; i++) {
    const p = core.dragMove([{ point: handle, x: start.x + i * 3, y: start.y + i * 2 }]);
    frames.push(new Map(p.points.map((q) => [q.id, q])));
  }
  core.dragEnd();
  return { r0, frames };
}

describe("milestone 7: equal curvature", () => {
  it("is offered for two splines meeting at an end", () => {
    const { doc, tr, br } = letterO(false);
    expect(validRelations(activeSketch(doc), [tr, br])).toContain("equalCurvature");
  });

  it("the O with a G2 joint keeps continuous curvature at every joint while dragging", () => {
    const { doc, tr, br, tl, bl } = letterO(true);
    const s = activeSketch(doc);
    // Equal Curvature replaced the Tangent relation between tr and br.
    expect(Object.values(s.relations).filter((r) => r.type === "tangent" && r.refs.includes(tr) && r.refs.includes(br))).toHaveLength(0);
    const handle = (s.entities[tr] as SplineEntity).cps[1];
    const { frames } = dragAndCheck(doc, handle);
    for (const pos of frames.slice(1))
      for (const [a, b] of [
        [tr, br],
        [tl, bl],
        [tr, tl],
        [br, bl],
      ]) {
        const [ka, kb] = jointCurvatures(s, a, b, pos);
        expect(Math.abs(ka - kb)).toBeLessThan(1e-6 * Math.max(1, Math.abs(ka)) + 1e-9);
      }
    // The handle actually moved.
    expect(frames[frames.length - 1].get(handle)!.x).toBeGreaterThan(frames[0].get(handle)!.x + 10);
  });

  it("without G2 the right joint has a curvature jump after dragging", () => {
    const { doc, tr, br } = letterO(false);
    const s = activeSketch(doc);
    const { frames } = dragAndCheck(doc, (s.entities[tr] as SplineEntity).cps[1]);
    const [ka, kb] = jointCurvatures(s, tr, br, frames[frames.length - 1]);
    expect(Math.abs(ka - kb)).toBeGreaterThan(1e-4);
  });

  it("spline to arc G2", () => {
    let ids = { sp: "", arc: "" };
    const doc = applyCommand(createDoc(), (ed) => {
      const a = addArc(ed, { x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }); // CCW quarter, r=50
      const sp = addSpline(ed, [
        { x: 0, y: 50 },
        { x: -30, y: 50 },
        { x: -70, y: 60 },
        { x: -100, y: 100 },
      ]);
      ed.addRelation({ type: "coincident", refs: [a.e, sp.cps[0]] });
      addRelationCmd(ed, "equalCurvature", [sp.spline, a.arc]);
      ids = { sp: sp.spline, arc: a.arc };
    });
    const inp = buildSolverInput(activeSketch(doc));
    expect(inp.unsupported).toEqual([]);
    const r = core.solve(inp.params, inp.constraints);
    expect(r.ok).toBe(true);
    const pos = new Map(r.params.points.map((p) => [p.id, p]));
    const s = activeSketch(doc);
    const sp = s.entities[ids.sp] as SplineEntity;
    const arc = s.entities[ids.arc] as { c: Id; e: Id };
    const radius = dist(pos.get(arc.c)!, pos.get(arc.e)!);
    // Travelling CCW along the arc into the spline: curvature +1/r on both sides.
    expect(bezierCurvature(sp.cps.map((id) => pos.get(id)!), 0)).toBeCloseTo(1 / radius, 6);
  });
});

describe("milestone 7: point on spline", () => {
  it("keeps a point on a style spline", () => {
    let ids = { p: "", sp: "" };
    const doc = applyCommand(createDoc(), (ed) => {
      const sp = addSpline(ed, [
        { x: 0, y: 0 },
        { x: 50, y: 100 },
        { x: 150, y: 100 },
        { x: 200, y: 0 },
      ]);
      const p = ed.addPoint(120, 20);
      ids = { p, sp: sp.spline };
    });
    expect(validRelations(activeSketch(doc), [ids.p, ids.sp])).toContain("coincident");
    const d2 = applyCommand(doc, (ed) => addRelationCmd(ed, "coincident", [ids.p, ids.sp]));
    const inp = buildSolverInput(activeSketch(d2));
    expect(inp.unsupported).toEqual([]);
    const r = core.solve(inp.params, inp.constraints);
    expect(r.ok).toBe(true);
    const pos = new Map(r.params.points.map((q) => [q.id, q]));
    const sp = activeSketch(d2).entities[ids.sp] as SplineEntity;
    const t = r.params.extras![0].value;
    const cps = sp.cps.map((id) => pos.get(id)!);
    const u = 1 - t;
    const bx = u ** 3 * cps[0].x + 3 * u * u * t * cps[1].x + 3 * u * t * t * cps[2].x + t ** 3 * cps[3].x;
    const by = u ** 3 * cps[0].y + 3 * u * u * t * cps[1].y + 3 * u * t * t * cps[2].y + t ** 3 * cps[3].y;
    expect(Math.hypot(bx - pos.get(ids.p)!.x, by - pos.get(ids.p)!.y)).toBeLessThan(1e-7);
    // 8 cv params + 2 point params + t - 2 equations = 9 DOF (plus the fixed origin).
    expect(r.dof).toBe(9);
  });
});
