import { beforeAll, describe, expect, it } from "vitest";
import { bezierDeriv } from "../src/geom/bezier";
import type { Vec2 } from "../src/geom/vec";
import { cross, dist } from "../src/geom/vec";
import { applyCommand } from "../src/model/editor";
import type { Editor } from "../src/model/editor";
import { activeSketch, createDoc, ptv } from "../src/model/sketch";
import type { Doc, Id, Sketch, SplineEntity } from "../src/model/types";
import { buildSolverInput } from "../src/solver/build";
import { GcsCore } from "../src/solver/gcs";
import { addArc, addLine } from "../src/tools/common";
import { addSpline, cornerAt, extendAt, filletCorner, findChain, fitOffsetCubic, mirrorEntities, offsetChain, trimAt } from "../src/tools/edits";
import { refreshExpressions } from "../src/model/dimensions";

let core: GcsCore;
beforeAll(async () => {
  core = await GcsCore.create();
});

const ents = (d: Doc) => Object.values(activeSketch(d).entities);
const lines = (d: Doc) => ents(d).filter((e) => e.type === "line") as { id: Id; p1: Id; p2: Id; owner?: Id }[];
const P = (d: Doc, id: Id) => ptv(activeSketch(d), id);

function solveDoc(doc: Doc): Doc {
  const inp = buildSolverInput(activeSketch(doc));
  const r = core.solve(inp.params, inp.constraints);
  expect(r.ok).toBe(true);
  return applyCommand(doc, (ed) => {
    for (const p of r.params.points) ed.movePoint(p.id, p.x, p.y);
  });
}

describe("trim", () => {
  it("removes the clicked piece of a crossed line and keeps the rest", () => {
    let ids: Record<string, Id> = {};
    const d0 = applyCommand(createDoc(), (ed) => {
      ids.h = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 }).line;
      ids.v = addLine(ed, { x: 50, y: -50 }, { x: 50, y: 50 }).line;
      ed.addRelation({ type: "horizontal", refs: [ids.h] });
    });
    const d1 = applyCommand(d0, (ed) => trimAt(ed, ids.h, { x: 80, y: 0 }));
    const h = activeSketch(d1).entities[ids.h] as { p1: Id; p2: Id };
    expect(P(d1, h.p1)).toEqual({ x: 0, y: 0 });
    expect(P(d1, h.p2).x).toBeCloseTo(50, 9);
    const rels = Object.values(activeSketch(d1).relations);
    expect(rels.some((r) => r.type === "horizontal" && r.refs[0] === ids.h)).toBe(true); // other relations kept
    expect(rels.some((r) => r.type === "coincident" && r.refs.includes(h.p2) && r.refs.includes(ids.v))).toBe(true);
  });

  it("splits when the middle is trimmed and links the pieces as collinear", () => {
    let h = "";
    const d0 = applyCommand(createDoc(), (ed) => {
      h = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 }).line;
      addLine(ed, { x: 30, y: -50 }, { x: 30, y: 50 });
      addLine(ed, { x: 70, y: -50 }, { x: 70, y: 50 });
    });
    const d1 = applyCommand(d0, (ed) => trimAt(ed, h, { x: 50, y: 0 }));
    expect(lines(d1)).toHaveLength(4);
    expect(Object.values(activeSketch(d1).relations).some((r) => r.type === "collinear")).toBe(true);
  });

  it("deletes an entity with no intersections", () => {
    let h = "";
    const d0 = applyCommand(createDoc(), (ed) => (h = addLine(ed, { x: 0, y: 0 }, { x: 10, y: 0 }).line));
    const d1 = applyCommand(d0, (ed) => trimAt(ed, h, { x: 5, y: 0 }));
    expect(activeSketch(d1).entities[h]).toBeUndefined();
  });
});

describe("extend", () => {
  it("extends a line to the next entity", () => {
    let h = "";
    const d0 = applyCommand(createDoc(), (ed) => {
      h = addLine(ed, { x: 0, y: 0 }, { x: 40, y: 0 }).line;
      addLine(ed, { x: 70, y: -50 }, { x: 70, y: 50 });
    });
    const d1 = applyCommand(d0, (ed) => extendAt(ed, h, { x: 38, y: 0 }));
    const l = activeSketch(d1).entities[h] as { p2: Id };
    expect(P(d1, l.p2).x).toBeCloseTo(70, 9);
  });
});

describe("fillet", () => {
  it("rounds a corner with a tangent arc and the right radius", () => {
    let ids: Record<string, Id> = {};
    let doc = applyCommand(createDoc(), (ed) => {
      const a = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 });
      const b = addLine(ed, { x: 100, y: 0 }, { x: 100, y: 80 });
      ed.addRelation({ type: "coincident", refs: [a.p2, b.p1] });
      ids = { a: a.line, b: b.line, corner: a.p2 };
    });
    const corner = cornerAt(activeSketch(doc), ids.corner)!;
    expect(corner).not.toBeNull();
    doc = applyCommand(doc, (ed) => {
      ids.arc = filletCorner(ed, corner, 10).arc!;
    });
    doc = solveDoc(doc);
    const s = activeSketch(doc);
    const arc = s.entities[ids.arc] as { c: Id; s: Id };
    expect(dist(P(doc, arc.c), P(doc, arc.s))).toBeCloseTo(10, 6);
    expect(P(doc, arc.c).x).toBeCloseTo(90, 6);
    expect(P(doc, arc.c).y).toBeCloseTo(10, 6);
  });
});

describe("offset", () => {
  it("offsets a line + arc chain, linked to a variable", () => {
    let src = "";
    let doc = applyCommand(createDoc(), (ed) => {
      const l = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 });
      const a = addArc(ed, { x: 100, y: 50 }, { x: 100, y: 0 }, { x: 150, y: 50 });
      ed.addRelation({ type: "coincident", refs: [l.p2, a.s] });
      ed.addRelation({ type: "tangent", refs: [l.line, a.arc] });
      src = l.line;
    });
    expect(findChain(activeSketch(doc), src).segs).toHaveLength(2);
    doc = applyCommand(doc, (ed) => {
      const r = offsetChain(ed, src, { distance: 10, side: 1, both: false, cap: "none", link: "offset1" });
      expect(r.message).toBeUndefined();
    });
    doc = solveDoc(doc);
    const s = activeSketch(doc);
    const offs = Object.values(s.dimensions).filter((d) => d.type === "offset");
    expect(offs).toHaveLength(2);
    // Offset line sits 10 above the source.
    const ol = s.entities[offs[0].refs[1]] as { p1: Id; p2: Id };
    expect(P(doc, ol.p1).y).toBeCloseTo(10, 6);
    // Changing the variable moves the offset.
    let d2 = refreshExpressions({ ...doc, variables: doc.variables.map((v) => (v.name === "offset1" ? { ...v, expr: "20" } : v)) });
    d2 = solveDoc(d2);
    const sl = activeSketch(d2).entities[offs[0].refs[0]] as { p1: Id; p2: Id };
    const a = P(d2, sl.p1);
    const b = P(d2, sl.p2);
    const q = P(d2, ol.p1);
    const distToSrc = Math.abs(cross({ x: b.x - a.x, y: b.y - a.y }, { x: q.x - a.x, y: q.y - a.y })) / dist(a, b);
    expect(distToSrc).toBeCloseTo(20, 6);
  });

  it("approximates a spline offset within tolerance", () => {
    const cps = [
      { x: 0, y: 0 },
      { x: 50, y: 120 },
      { x: 150, y: -40 },
      { x: 200, y: 60 },
    ];
    const fit = fitOffsetCubic(cps, 8, 0, 0.5);
    expect(fit.err).toBeLessThan(1);
  });
});

/** Oval ("O" shape): four style splines, tangent joints, right half mirrored about a centerline. */
function ovalShape(): { doc: Doc; tr: Id; br: Id; tl: Id; bl: Id } {
  const out = { tr: "", br: "", tl: "", bl: "" };
  const doc = applyCommand(createDoc(), (ed: Editor) => {
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
    ed.addRelation({ type: "tangent", refs: [tr.spline, br.spline] });
    ed.addRelation({ type: "coincident", refs: [tr.cps[0], axis.line] });
    ed.addRelation({ type: "coincident", refs: [br.cps[3], axis.line] });
    const [tl, bl] = mirrorEntities(ed, [tr.spline, br.spline], axis.line);
    ed.addRelation({ type: "tangent", refs: [tr.spline, tl] });
    ed.addRelation({ type: "tangent", refs: [br.spline, bl] });
    Object.assign(out, { tr: tr.spline, br: br.spline, tl, bl });
  });
  return { doc, ...out };
}

/** Angle (radians) between end tangents of two splines at their shared joint. */
function jointKink(s: Sketch, a: Id, b: Id, ptsOverride?: Map<Id, Vec2>): number {
  const pos = (id: Id) => ptsOverride?.get(id) ?? ptv(s, id);
  const A = s.entities[a] as SplineEntity;
  const B = s.entities[b] as SplineEntity;
  const ca = A.cps.map(pos);
  const cb = B.cps.map(pos);
  // find the shared end
  let best: [number, number] = [0, 0];
  let bd = Infinity;
  for (const i of [0, ca.length - 1]) for (const j of [0, cb.length - 1]) if (dist(ca[i], cb[j]) < bd) ((bd = dist(ca[i], cb[j])), (best = [i, j]));
  expect(bd).toBeLessThan(1e-6);
  const ta = bezierDeriv(ca, best[0] === 0 ? 0 : 1);
  const tb = bezierDeriv(cb, best[1] === 0 ? 0 : 1);
  return Math.abs(Math.asin(Math.max(-1, Math.min(1, cross(ta, tb) / (Math.hypot(ta.x, ta.y) * Math.hypot(tb.x, tb.y))))));
}

describe("milestone 5: O shape", () => {
  it("solves without conflicts and stays tangent while a control vertex is dragged", () => {
    const { doc, tr, br, tl, bl } = ovalShape();
    const s = activeSketch(doc);
    const inp = buildSolverInput(s);
    expect(inp.unsupported).toEqual([]);
    const r0 = core.solve(inp.params, inp.constraints);
    expect(r0.ok).toBe(true);
    expect(r0.conflicts).toEqual([]);
    expect(r0.redundant).toEqual([]);
    const handle = (s.entities[tr] as SplineEntity).cps[2];
    core.dragStart(r0.params, inp.constraints, [{ point: handle, x: 100, y: 55 }]);
    let last = r0.params;
    for (let i = 1; i <= 15; i++) last = core.dragMove([{ point: handle, x: 100 + i * 4, y: 55 + i * 3 }]);
    core.dragEnd();
    const pos = new Map(last.points.map((p) => [p.id, { x: p.x, y: p.y }]));
    expect(pos.get(handle)!.x).toBeGreaterThan(130);
    for (const [a, b] of [
      [tr, br],
      [tr, tl],
      [br, bl],
      [tl, bl],
    ])
      expect(jointKink(s, a, b, pos)).toBeLessThan(1e-6);
  });
});
