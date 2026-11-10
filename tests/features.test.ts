import { beforeAll, describe, expect, it } from "vitest";
import { Store } from "../src/app/store";
import { SolverService } from "../src/app/solverService";
import { parseDoc, serializeDoc } from "../src/io/native";
import { applyCommand } from "../src/model/editor";
import { addFeature, crossRefs, danglingOf, deleteConflict, deleteFeature, dependents, moveConflict, moveFeature, setActive, setVisible } from "../src/model/features";
import { docOutline } from "../src/model/outline";
import { validRelations } from "../src/model/relations";
import { activeSketch, createDoc, ownSketch, ptv } from "../src/model/sketch";
import type { Doc, Id } from "../src/model/types";
import { buildSolverInput } from "../src/solver/build";
import { GcsCore } from "../src/solver/gcs";
import type { Solver } from "../src/solver/types";
import { addArc, addCircle, addLine, applyHV } from "../src/tools/common";
import { buildLoop } from "../src/tools/shapes";
import { addSpline, convertEntities, convertible, mirrorEntities, offsetChain, recomputeDerived, trimAt } from "../src/tools/edits";
import { missingKind, missingRefs, repairWith } from "../src/tools/repair";

let core: GcsCore;
beforeAll(async () => {
  core = await GcsCore.create();
});

/** The worker protocol, run in-process. */
const inProcess = (): Solver => ({
  solve: async (p, c, d) => core.solve(p, c, d),
  dragStart: async (p, c, t) => core.dragStart(p, c, t),
  dragMove: async (t) => core.dragMove(t),
  dragEnd: () => core.dragEnd(),
});

function service(doc: Doc) {
  const store = new Store(doc);
  const svc = new SolverService(store, inProcess());
  svc.postSolve = (d, fid) => applyCommand(d, recomputeDerived, fid);
  return { store, svc };
}

async function settle(store: Store, svc: SolverService) {
  svc.requestSolve();
  await svc.settled();
  return store.doc;
}

/** Sketch1: a fully defined 100×60 rectangle (H/V, corner on the origin, width/height dimensions). */
function base() {
  const ids: Record<string, Id> = {};
  const doc = applyCommand(createDoc(), (ed) => {
    const l = buildLoop(ed, [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 60 },
      { x: 0, y: 60 },
    ], false);
    ed.addRelation({ type: "horizontal", refs: [l[0].line, l[2].line] });
    ed.addRelation({ type: "vertical", refs: [l[1].line, l[3].line] });
    ed.addRelation({ type: "coincident", refs: [l[0].p1, "origin"] });
    ids.w = ed.addDimension({ type: "distance", refs: [l[0].line], expr: "100", value: 100, driven: false, label: { x: 50, y: -10 } });
    ed.addDimension({ type: "distance", refs: [l[1].line], expr: "60", value: 60, driven: false, label: { x: 110, y: 30 } });
    ids.bottom = l[0].line;
    ids.right = l[1].line;
    ids.top = l[2].line;
    ids.corner = l[1].p2; // top-right
    ids.br = l[0].p2; // bottom-right
  });
  return { doc, ids };
}

/** Sketch2 on top: a diagonal from the origin to Sketch1's top-right corner. */
function withDiagonal() {
  const b = base();
  let doc = addFeature(b.doc);
  const ids = { ...b.ids };
  doc = applyCommand(doc, (ed) => {
    const l = addLine(ed, { x: 1, y: 2 }, { x: 95, y: 55 });
    ed.addRelation({ type: "coincident", refs: [l.p1, "origin"] });
    ed.addRelation({ type: "coincident", refs: [l.p2, ids.corner] });
    ids.diag = l.line;
    ids.d2 = l.p2;
  });
  return { doc, ids };
}

describe("feature tree model", () => {
  it("a new sketch borrows earlier geometry read-only and stores only its own", () => {
    const { doc, ids } = withDiagonal();
    expect(doc.features.map((f) => f.name)).toEqual(["Sketch1", "Sketch2"]);
    const s = activeSketch(doc);
    expect(s.ext?.[ids.corner]?.feature).toBe(doc.features[0].id);
    expect(ownSketch(doc).entities[ids.corner]).toBeUndefined();
    expect(ownSketch(doc).entities[ids.diag]).toBeDefined();
    // Edits to borrowed geometry are ignored.
    const d2 = applyCommand(doc, (ed) => {
      ed.movePoint(ids.corner, 500, 500);
      ed.update(ids.top, { construction: true });
      ed.deleteEntities([ids.right]);
    });
    expect(d2).toBe(doc);
    expect(ptv(ownSketch(doc, doc.features[0].id), ids.corner)).toEqual({ x: 100, y: 60 });
  });

  it("relations need at least one entity of the active sketch", () => {
    const { doc, ids } = withDiagonal();
    const s = activeSketch(doc);
    expect(validRelations(s, [ids.top, ids.right])).toEqual([]);
    expect(validRelations(s, [ids.diag, ids.right])).toContain("perpendicular");
    // One Fix / H / V per line would land on the locked line.
    expect(validRelations(s, [ids.diag, ids.right])).not.toContain("fix");
    expect(validRelations(s, [ids.diag, ids.right])).not.toContain("horizontal");
  });

  it("solves against locked geometry: fully defined, references do not move or count as DOF", () => {
    const { doc, ids } = withDiagonal();
    const inp = buildSolverInput(activeSketch(doc));
    expect(inp.unsupported).toEqual([]);
    // Only the referenced corner is borrowed, locked.
    expect(inp.params.points.filter((p) => p.fixed).map((p) => p.id)).toEqual([ids.corner]);
    const r = core.solve(inp.params, inp.constraints);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    expect(r.conflicts).toEqual([]);
    expect(r.redundant).toEqual([]);
    const end = r.params.points.find((p) => p.id === ids.d2)!;
    expect(end.x).toBeCloseTo(100, 6);
    expect(end.y).toBeCloseTo(60, 6);
  });

  it("locked circles and arcs keep their size and add no redundancy", () => {
    let doc = applyCommand(createDoc(), (ed) => {
      const c = addCircle(ed, { x: 0, y: 0 }, 30);
      ed.addRelation({ type: "coincident", refs: [c.c, "origin"] });
      ed.addDimension({ type: "radius", refs: [c.circle], expr: "30", value: 30, driven: false, label: { x: 30, y: 30 } });
    });
    const src = Object.values(ownSketch(doc).entities).find((e) => e.type === "circle")!.id;
    doc = addFeature(doc);
    let mine = "";
    doc = applyCommand(doc, (ed) => {
      const c = addCircle(ed, { x: 3, y: 2 }, 20);
      mine = c.circle;
      ed.addRelation({ type: "concentric", refs: [c.circle, src] });
      ed.addRelation({ type: "equal", refs: [c.circle, src] });
    });
    const inp = buildSolverInput(activeSketch(doc));
    const r = core.solve(inp.params, inp.constraints);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    expect(r.redundant).toEqual([]);
    expect(r.params.geoms.find((g) => g.id === mine && g.kind === "circle")).toMatchObject({ r: expect.closeTo(30, 6) });
    expect(r.params.geoms.find((g) => g.id === src && g.kind === "circle")).toMatchObject({ r: 30 });
  });

  it("lines can be tangent to a locked arc at its end without redundancy", () => {
    let arcId = "";
    let arcEnd = "";
    let doc = applyCommand(createDoc(), (ed) => {
      const a = addArc(ed, { x: 0, y: 0 }, { x: 40, y: 0 }, { x: 0, y: 40 });
      arcId = a.arc;
      arcEnd = a.e;
      ed.addRelation({ type: "coincident", refs: [a.c, "origin"] });
      ed.addRelation({ type: "horizontal", refs: [a.c, a.s] });
      ed.addRelation({ type: "vertical", refs: [a.c, a.e] });
      ed.addDimension({ type: "radius", refs: [a.arc], expr: "40", value: 40, driven: false, label: { x: 30, y: 30 } });
    });
    doc = addFeature(doc);
    let tip = "";
    doc = applyCommand(doc, (ed) => {
      const l = addLine(ed, { x: 1, y: 41 }, { x: -50, y: 43 });
      tip = l.p2;
      ed.addRelation({ type: "coincident", refs: [l.p1, arcEnd] });
      ed.addRelation({ type: "tangent", refs: [l.line, arcId] });
      ed.addDimension({ type: "distance", refs: [l.line], expr: "50", value: 50, driven: false, label: { x: -25, y: 50 } });
    });
    const inp = buildSolverInput(activeSketch(doc));
    expect(inp.unsupported).toEqual([]);
    const r = core.solve(inp.params, inp.constraints);
    expect(r.ok).toBe(true);
    expect(r.redundant).toEqual([]);
    expect(r.conflicts).toEqual([]);
    const p = r.params.points.find((q) => q.id === tip)!;
    // Tangent at the top of a circle centred on the origin: the line is horizontal at y = 40.
    expect(p.y).toBeCloseTo(40, 6);
    expect(Math.abs(p.x)).toBeCloseTo(50, 6);
  });

  it("deleting a sketch or reordering is refused while others depend on it", () => {
    const { doc } = withDiagonal();
    const [s1, s2] = doc.features;
    expect(dependents(doc, s1.id).map((f) => f.id)).toEqual([s2.id]);
    expect(typeof deleteFeature(doc, s1.id)).toBe("string");
    expect(typeof moveFeature(doc, s2.id, -1)).toBe("string");
    expect(typeof moveFeature(doc, s1.id, 1)).toBe("string");
    const d = deleteFeature(doc, s2.id);
    expect(typeof d).toBe("object");
    expect((d as Doc).features.map((f) => f.id)).toEqual([s1.id]);
    expect((d as Doc).active).toBe(s1.id);
  });

  it("a move that breaks references can remove them instead, in one step", () => {
    const { doc, ids } = withDiagonal();
    const [s1, s2] = doc.features;
    const c = moveConflict(doc, s2.id, -1)!;
    expect(c.lower.id).toBe(s2.id);
    expect(c.upper.id).toBe(s1.id);
    expect(c.refs.relations.length).toBe(1); // coincident with Sketch1's corner; the origin is shared, so it stays
    expect(c.refs.dimensions).toEqual([]);
    const moved = moveFeature(doc, s2.id, -1, true) as Doc;
    expect(moved.features.map((f) => f.id)).toEqual([s2.id, s1.id]);
    const kept = Object.values(ownSketch(moved, s2.id).relations);
    expect(kept.length).toBe(1);
    expect(kept[0].refs).toContain("origin");
    expect(ownSketch(moved, s2.id).entities[ids.diag]).toBeDefined();
    expect(danglingOf(moved, s2.id)).toEqual([]);
    expect(dependents(moved, s1.id)).toEqual([]);
    // Moving Sketch1 down is the same swap, so it removes the same reference.
    const down = moveFeature(doc, s1.id, 1, true) as Doc;
    expect(down.features.map((f) => f.id)).toEqual([s2.id, s1.id]);
    expect(Object.values(ownSketch(down, s2.id).relations).length).toBe(1);
  });

  it("deleting a referenced sketch can remove the references to it, and only those", () => {
    const { doc: d2, ids } = withDiagonal();
    // Sketch3 uses both Sketch1 (its corner) and Sketch2 (the diagonal's end).
    let doc = addFeature(d2);
    doc = applyCommand(doc, (ed) => {
      const l = addLine(ed, { x: 100, y: 60 }, { x: 140, y: 90 });
      ed.addRelation({ type: "coincident", refs: [l.p1, ids.corner] });
      ed.addRelation({ type: "coincident", refs: [l.p2, ids.d2] });
      ed.addDimension({ type: "distance", refs: [l.p2, ids.br], expr: "50", value: 50, driven: false, label: { x: 120, y: 40 } });
    });
    const [s1, s2, s3] = doc.features;
    const deps = deleteConflict(doc, s1.id);
    expect(deps.map((d) => d.feature.id)).toEqual([s2.id, s3.id]);
    expect(deps[1].refs.relations.length).toBe(1);
    expect(deps[1].refs.dimensions.length).toBe(1);
    expect(typeof deleteFeature(doc, s1.id)).toBe("string");
    const after = deleteFeature(doc, s1.id, true) as Doc;
    expect(after.features.map((f) => f.id)).toEqual([s2.id, s3.id]);
    const rels3 = Object.values(ownSketch(after, s3.id).relations);
    expect(rels3.map((r) => r.refs)).toEqual([[expect.any(String), ids.d2]]); // the tie to Sketch2 stays
    expect(Object.keys(ownSketch(after, s3.id).dimensions)).toEqual([]);
    expect(danglingOf(after, s2.id)).toEqual([]);
    expect(danglingOf(after, s3.id)).toEqual([]);
    expect(deleteConflict(doc, s3.id)).toEqual([]); // nothing uses the last sketch
  });

  it("a move with nothing to break needs no confirmation", () => {
    let doc = addFeature(base().doc);
    expect(moveConflict(doc, doc.features[1].id, -1)).toBeNull();
    doc = moveFeature(doc, doc.features[1].id, -1) as Doc;
    expect(doc.features.map((f) => f.name)).toEqual(["Sketch2", "Sketch1"]);
  });

  it("removing references on a move unlinks offsets, keeping the curve", () => {
    let sp = "";
    let doc = applyCommand(createDoc(), (ed) => {
      sp = addSpline(ed, [
        { x: 0, y: 0 },
        { x: 30, y: 40 },
        { x: 70, y: 40 },
        { x: 100, y: 0 },
      ]).spline;
    });
    doc = addFeature(doc);
    doc = applyCommand(doc, (ed) => {
      const r = offsetChain(ed, sp, { distance: 5, side: 1, both: false, cap: "none", link: "" });
      expect(r.message).toBeUndefined();
    });
    const [s1, s2] = doc.features;
    const off = crossRefs(ownSketch(doc, s2.id), ownSketch(doc, s1.id)).offsets;
    expect(off.length).toBeGreaterThan(0);
    const moved = moveFeature(doc, s2.id, -1, true) as Doc;
    for (const id of off) {
      const e = ownSketch(moved, s2.id).entities[id];
      expect(e?.type).toBe("spline");
      expect((e as { derived?: unknown }).derived).toBeUndefined();
    }
    expect(dependents(moved, s1.id)).toEqual([]);
  });

  it("deleting referenced geometry leaves the later sketch's relation dangling", () => {
    const { doc, ids } = withDiagonal();
    const [s1, s2] = doc.features;
    const d1 = applyCommand(setActive(doc, s1.id), (ed) => ed.deleteEntities([ids.right]));
    // The relation in Sketch2 is kept, and reported.
    const coinc = Object.values(ownSketch(d1, s2.id).relations).find((r) => r.refs.includes(ids.corner))!;
    expect(coinc).toBeDefined();
    expect(danglingOf(d1, s2.id)).toEqual([coinc.id]);
  });

  it("trimming in an earlier sketch re-points later sketches' references", () => {
    const { doc, ids } = withDiagonal();
    const [s1, s2] = doc.features;
    const d1 = applyCommand(setActive(doc, s1.id), (ed) => ed.substitute(ids.corner, ids.br));
    const coinc = Object.values(ownSketch(d1, s2.id).relations).find((r) => r.refs.includes(ids.br));
    expect(coinc).toBeDefined();
  });

  it("export and fills combine visible sketches, each chained on its own", () => {
    let { doc } = base();
    doc = addFeature(doc);
    doc = applyCommand(doc, (ed) => {
      buildLoop(ed, [
        { x: 200, y: 0 },
        { x: 260, y: 0 },
        { x: 260, y: 40 },
      ], false);
    });
    expect(docOutline(doc).loops).toHaveLength(2);
    expect(docOutline(setVisible(doc, doc.features[1].id, false)).loops).toHaveLength(1);
  });
});

describe("rebuild order", () => {
  it("editing an earlier sketch moves the sketches that reference it", async () => {
    const { doc, ids } = withDiagonal();
    const { store, svc } = service(doc);
    let d = await settle(store, svc);
    const [s1, s2] = d.features;
    expect(store.state.featureStatus[s1.id].state).toBe("full");
    expect(store.state.featureStatus[s2.id].state).toBe("full");
    expect(ptv(ownSketch(d, s2.id), ids.d2).x).toBeCloseTo(100, 6);

    // Activate Sketch1 and change its width: Sketch2's diagonal follows the corner.
    store.amendDoc(setActive(d, s1.id));
    store.commitDoc(applyCommand(store.doc, (ed) => ed.updateDimension(ids.w, { expr: "150", value: 150 })), "Edit Dimension");
    d = await settle(store, svc);
    expect(ptv(ownSketch(d, s1.id), ids.corner).x).toBeCloseTo(150, 6);
    expect(ptv(ownSketch(d, s2.id), ids.d2).x).toBeCloseTo(150, 6);
    expect(ptv(ownSketch(d, s2.id), ids.d2).y).toBeCloseTo(60, 6);
    expect(store.state.status.state).toBe("full"); // the active sketch's own status
    expect(store.state.featureStatus[s2.id].state).toBe("full");
  });

  it("dragging an earlier sketch updates the later ones live", async () => {
    // Sketch1: a free horizontal line; Sketch2: a line hanging from its right end.
    let doc = applyCommand(createDoc(), (ed) => {
      const l = addLine(ed, { x: 0, y: 0 }, { x: 50, y: 0 });
      ed.addRelation({ type: "coincident", refs: [l.p1, "origin"] });
      ed.addRelation({ type: "horizontal", refs: [l.line] });
    });
    const end = Object.values(ownSketch(doc).entities).find((e) => e.type === "line")!;
    const tip = (end as { p2: Id }).p2;
    doc = addFeature(doc);
    let hang = "";
    doc = applyCommand(doc, (ed) => {
      const l = addLine(ed, { x: 50, y: 0 }, { x: 50, y: -30 });
      ed.addRelation({ type: "coincident", refs: [l.p1, tip] });
      ed.addRelation({ type: "vertical", refs: [l.line] });
      hang = l.p1;
    });
    const s1 = doc.features[0].id;
    const { store, svc } = service(setActive(doc, s1));
    await settle(store, svc);
    svc.dragBegin([{ point: tip, x: 50, y: 0 }]);
    await new Promise((r) => setTimeout(r, 20));
    svc.dragUpdate([{ point: tip, x: 80, y: 0 }]);
    // Let the drag frame and the rebuild of Sketch2 run.
    for (let i = 0; i < 20; i++) await new Promise((r) => setTimeout(r, 5));
    expect(ptv(ownSketch(store.doc, doc.features[1].id), hang).x).toBeCloseTo(80, 4);
    svc.dragEnd(true, "Drag");
    const d = await settle(store, svc);
    expect(ptv(ownSketch(d, s1), tip).x).toBeCloseTo(80, 4);
    expect(ptv(ownSketch(d, doc.features[1].id), hang).x).toBeCloseTo(80, 4);
  });

  it("a dangling reference is reported, not counted as a conflict", async () => {
    const { doc, ids } = withDiagonal();
    const [s1, s2] = doc.features;
    const d1 = applyCommand(setActive(doc, s1.id), (ed) => ed.deleteEntities([ids.right]));
    const { store, svc } = service(setActive(d1, s2.id));
    await settle(store, svc);
    expect(store.state.status.dangling).toHaveLength(1);
    expect(store.state.status.conflicts).toEqual([]);
    expect(store.state.featureStatus[s2.id].dangling).toBe(1);
  });
});

describe("undo", () => {
  it("returns to the sketch the change was made in", () => {
    const { doc, ids } = withDiagonal();
    const [s1, s2] = doc.features;
    const store = new Store(setActive(doc, s1.id));
    store.commitDoc(applyCommand(store.doc, (ed) => ed.updateDimension(ids.w, { expr: "120", value: 120 })), "Edit Dimension");
    store.amendDoc(setActive(store.doc, s2.id)); // switching sketches is not an undo step
    expect(store.doc.active).toBe(s2.id);
    store.undo();
    expect(store.doc.active).toBe(s1.id);
    expect(ownSketch(store.doc, s1.id).dimensions[ids.w].value).toBe(100);
  });
});

describe("building on an earlier sketch", () => {
  it("offsets an earlier sketch's line into the active sketch and follows it", async () => {
    const { doc: d0, ids } = base();
    let doc = addFeature(d0);
    doc = applyCommand(doc, (ed) => {
      const r = offsetChain(ed, ids.top, { distance: 10, side: 1, both: false, cap: "none", link: "offset1" });
      expect(r.message).toBeUndefined();
      expect(r.created.length).toBeGreaterThan(0);
    });
    expect(Object.values(ownSketch(doc).entities).some((e) => e.type === "line")).toBe(true);
    const { store, svc } = service(doc);
    let d = await settle(store, svc);
    const [s1, s2] = d.features;
    expect(store.state.status.conflicts).toEqual([]);
    const yOf = (dd: Doc) => {
      const l = Object.values(ownSketch(dd, s2.id).entities).find((e) => e.type === "line") as { p1: Id };
      return ptv(ownSketch(dd, s2.id), l.p1).y;
    };
    const y0 = yOf(d);
    expect(Math.abs(y0 - 60)).toBeCloseTo(10, 6);
    // Make Sketch1 taller: the offset follows.
    store.amendDoc(setActive(d, s1.id));
    const hDim = Object.values(ownSketch(store.doc, s1.id).dimensions).find((x) => x.value === 60)!;
    store.commitDoc(applyCommand(store.doc, (ed) => ed.updateDimension(hDim.id, { expr: "80", value: 80 })), "Edit");
    d = await settle(store, svc);
    expect(yOf(d) - y0).toBeCloseTo(20, 6);
  });
});

describe("mirror", () => {
  it("mirrors an earlier sketch's line about a centerline of the active sketch, linked", async () => {
    const { doc: d0, ids } = base();
    let doc = addFeature(d0);
    doc = applyCommand(doc, (ed) => {
      const axis = addLine(ed, { x: 120, y: -10 }, { x: 120, y: 80 }, true);
      ed.addRelation({ type: "vertical", refs: [axis.line] });
      ed.addDimension({ type: "distanceX", refs: ["origin", axis.p1], expr: "120", value: 120, driven: false, label: { x: 60, y: -20 } });
      mirrorEntities(ed, [ids.right], axis.line);
    });
    const { store, svc } = service(doc);
    const d = await settle(store, svc);
    expect(store.state.status.conflicts).toEqual([]);
    expect(store.state.status.state).not.toBe("failed");
    const s2 = ownSketch(d, d.features[1].id);
    const copy = Object.values(s2.entities).find((e) => e.type === "line" && !e.construction) as { p1: Id; p2: Id };
    expect(copy).toBeDefined();
    expect(ptv(s2, copy.p1).x).toBeCloseTo(140, 6); // x = 100 mirrored about x = 120
    expect(ptv(s2, copy.p2).x).toBeCloseTo(140, 6);
    // Each endpoint is linked to Sketch1's by a Symmetric relation.
    const ctx = activeSketch(d);
    expect(Object.values(s2.relations).filter((r) => r.type === "symmetric" && ctx.ext?.[r.refs[0]]).length).toBe(2);
  });
});

describe("file format", () => {
  it("round-trips the feature tree", () => {
    const { doc } = withDiagonal();
    const d = setVisible(doc, doc.features[0].id, false);
    const back = parseDoc(serializeDoc(d));
    expect(back.features.map((f) => [f.id, f.name, f.visible])).toEqual(d.features.map((f) => [f.id, f.name, f.visible]));
    expect(back.active).toBe(d.active);
    expect(back.features[1].sketch.relations).toEqual(d.features[1].sketch.relations);
    expect(back.nextId).toBeGreaterThanOrEqual(d.nextId);
  });

  it("keeps dangling references when loading", () => {
    const { doc, ids } = withDiagonal();
    const d1 = applyCommand(setActive(doc, doc.features[0].id), (ed) => ed.deleteEntities([ids.right]));
    const back = parseDoc(serializeDoc(d1));
    expect(danglingOf(back, back.features[1].id)).toHaveLength(1);
  });

  it("opens a version 2 file as one sketch", () => {
    const v2 = JSON.stringify({
      format: "sketchworx",
      version: 2,
      nextId: 5,
      variables: [],
      entities: [
        { id: "origin", type: "point", x: 0, y: 0 },
        { id: "p2", type: "point", x: 0, y: 0, owner: "e1" },
        { id: "p3", type: "point", x: 10, y: 0, owner: "e1" },
        { id: "e1", type: "line", p1: "p2", p2: "p3" },
      ],
      relations: [{ id: "r4", type: "horizontal", refs: ["e1"] }],
      dimensions: [],
      picture: { dataUrl: "data:image/png;base64,", x: 0, y: 0, scale: 1, opacity: 0.5 },
    });
    const d = parseDoc(v2);
    expect(d.features).toHaveLength(1);
    expect(d.features[0].name).toBe("Sketch1");
    expect(Object.keys(d.features[0].sketch.entities)).toHaveLength(4);
    expect(d.picture?.opacity).toBe(0.5);
    expect(d.nextId).toBeGreaterThan(4);
  });
});

describe("convert entities", () => {
  /** Sketch1 with one of each convertible kind, fully defined. */
  function kinds() {
    const ids: Record<string, Id> = {};
    let doc = applyCommand(createDoc(), (ed) => {
      const l = addLine(ed, { x: 0, y: 0 }, { x: 80, y: 0 });
      ed.addRelation({ type: "coincident", refs: [l.p1, "origin"] });
      ed.addRelation({ type: "fix", refs: [l.p2], values: [80, 0] });
      const c = addCircle(ed, { x: 40, y: 50 }, 15);
      ed.addRelation({ type: "fix", refs: [c.circle], values: [40, 50, 15] });
      const a = addArc(ed, { x: 0, y: 0 }, { x: 30, y: 0 }, { x: 0, y: 30 });
      ed.addRelation({ type: "fix", refs: [a.arc], values: [0, 0, 30, 0, 0, 30] });
      const sp = addSpline(ed, [
        { x: 100, y: 0 },
        { x: 110, y: 30 },
        { x: 140, y: 30 },
        { x: 150, y: 0 },
      ]);
      ed.addRelation({ type: "fix", refs: [sp.spline], values: [100, 0, 110, 30, 140, 30, 150, 0] });
      const p = ed.addPoint(-20, -20);
      ed.addRelation({ type: "fix", refs: [p], values: [-20, -20] });
      Object.assign(ids, { line: l.line, lp2: l.p2, circle: c.circle, arc: a.arc, spline: sp.spline, point: p });
    });
    doc = addFeature(doc);
    return { doc, ids };
  }

  it("copies each kind fully defined, without redundancy, and refuses a second copy", () => {
    const { doc: d0, ids } = kinds();
    let created: Id[] = [];
    const doc = applyCommand(d0, (ed) => {
      const r = convertEntities(ed, [ids.line, ids.circle, ids.arc, ids.spline, ids.point]);
      expect(r.message).toBeUndefined();
      created = r.created;
    });
    expect(created).toHaveLength(5);
    expect(Object.values(ownSketch(doc).relations).filter((r) => r.type === "onEdge")).toHaveLength(5);
    const inp = buildSolverInput(activeSketch(doc));
    expect(inp.unsupported).toEqual([]);
    const r = core.solve(inp.params, inp.constraints);
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(0);
    expect(r.redundant).toEqual([]);
    expect(r.conflicts).toEqual([]);
    // Converting again adds nothing.
    const again = applyCommand(doc, (ed) => expect(convertEntities(ed, [ids.line]).created).toEqual([]));
    expect(again).toBe(doc);
    // Endpoints and polygon sides are not converted on their own.
    expect(convertible(activeSketch(doc), ids.lp2)).toBe(false);
  });

  it("converted geometry follows its source", async () => {
    const { doc: d0, ids } = withDiagonal();
    let copy = "";
    const doc = applyCommand(d0, (ed) => (copy = convertEntities(ed, [ids.top]).created[0]));
    const { store, svc } = service(doc);
    let d = await settle(store, svc);
    const [s1, s2] = d.features;
    expect(store.state.status.conflicts).toEqual([]);
    store.amendDoc(setActive(d, s1.id));
    store.commitDoc(applyCommand(store.doc, (ed) => ed.updateDimension(ids.w, { expr: "130", value: 130 })), "Edit");
    d = await settle(store, svc);
    const l = ownSketch(d, s2.id).entities[copy] as { p1: Id; p2: Id };
    const xs = [ptv(ownSketch(d, s2.id), l.p1).x, ptv(ownSketch(d, s2.id), l.p2).x].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0, 6);
    expect(xs[1]).toBeCloseTo(130, 6);
  });

  it("trimming a converted line keeps it on its source (Collinear)", async () => {
    const { doc: d0, ids } = withDiagonal();
    let copy = "";
    let doc = applyCommand(d0, (ed) => (copy = convertEntities(ed, [ids.top]).created[0]));
    // A vertical cutter in Sketch2 at x = 30; trim the piece of the copy left of it.
    doc = applyCommand(doc, (ed) => {
      const v = addLine(ed, { x: 30, y: 80 }, { x: 30, y: 40 });
      ed.addRelation({ type: "vertical", refs: [v.line] });
    });
    doc = applyCommand(doc, (ed) => expect(trimAt(ed, copy, { x: 10, y: 60 }).ok).toBe(true));
    const rels = Object.values(ownSketch(doc).relations);
    expect(rels.some((r) => r.type === "onEdge" && r.refs[1] === copy)).toBe(false);
    expect(rels.some((r) => r.type === "collinear" && r.refs[0] === ids.top && r.refs[1] === copy)).toBe(true);
    const { store, svc } = service(doc);
    const d = await settle(store, svc);
    expect(store.state.status.conflicts).toEqual([]);
    const l = ownSketch(d).entities[copy] as { p1: Id; p2: Id };
    expect(ptv(ownSketch(d), l.p1).y).toBeCloseTo(60, 6);
    expect(ptv(ownSketch(d), l.p2).y).toBeCloseTo(60, 6);
  });
});

describe("repair dangling references", () => {
  it("re-points a dangling relation to new geometry, and refuses the wrong kind", async () => {
    const { doc, ids } = withDiagonal();
    const [s1, s2] = doc.features;
    // Delete Sketch1's right side (its corner point goes with it), then add a free point there.
    let np = "";
    let d1 = applyCommand(setActive(doc, s1.id), (ed) => {
      ed.deleteEntities([ids.right]);
      np = ed.addPoint(100, 60);
    });
    d1 = setActive(d1, s2.id);
    const s = activeSketch(d1);
    const rel = s.relations[danglingOf(d1, s2.id)[0]];
    expect(missingRefs(s, rel)).toEqual([ids.corner]);
    expect(missingKind(ids.corner)).toBe("point");
    expect(typeof repairWith(s, rel, ids.corner, ids.top)).toBe("string"); // a line for a point
    const r = repairWith(s, rel, ids.corner, np);
    expect(typeof r).toBe("object");
    const fixed = applyCommand(d1, (ed) => ed.updateRelation(rel.id, { refs: (r as { relation: { refs: Id[] } }).relation.refs }));
    expect(danglingOf(fixed, s2.id)).toEqual([]);
    const { store, svc } = service(fixed);
    await settle(store, svc);
    expect(store.state.status.dangling).toEqual([]);
    expect(store.state.status.conflicts).toEqual([]);
  });

  it("refuses geometry that does not fit the relation", () => {
    const { doc: d0, ids } = withDiagonal();
    const [s1, s2] = d0.features;
    // Sketch2: a line perpendicular to Sketch1's top line.
    let doc = applyCommand(d0, (ed) => {
      const l = addLine(ed, { x: 50, y: 70 }, { x: 50, y: 90 });
      ed.addRelation({ type: "perpendicular", refs: [l.line, ids.top] });
    });
    doc = applyCommand(setActive(doc, s1.id), (ed) => ed.deleteEntities([ids.top]));
    doc = applyCommand(doc, (ed) => void addCircle(ed, { x: 50, y: 100 }, 5));
    const circle = Object.values(ownSketch(doc, s1.id).entities).find((e) => e.type === "circle")!.id;
    doc = setActive(doc, s2.id);
    const s = activeSketch(doc);
    const rel = Object.values(s.relations).find((r) => r.type === "perpendicular")!;
    expect(repairWith(s, rel, ids.top, circle)).toBe("That does not fit this relation");
    expect(typeof repairWith(s, rel, ids.top, ids.bottom)).toBe("object");
  });
});

describe("automatic H/V that would over-define", () => {
  /** Commit like the app does: the command's tentative relations go to the solver service. */
  function drawLine(store: Store, svc: SolverService, a: { x: number; y: number; to?: Id }, b: { x: number; y: number; to?: Id }) {
    let tentative: Id[] = [];
    let line = "";
    const next = applyCommand(store.doc, (ed) => {
      const r = addLine(ed, a, b);
      line = r.line;
      if (a.to) ed.addRelation({ type: "coincident", refs: [r.p1, a.to] });
      if (b.to) ed.addRelation({ type: "coincident", refs: [r.p2, b.to] });
      applyHV(ed, r.line, { hv: "horizontal", pos: b, guides: [], glyphs: [] });
      tentative = [...ed.tentative];
    });
    store.commitDoc(next, "Line");
    svc.markTentative(tentative);
    return line;
  }
  const hasH = (doc: Doc, line: Id) => Object.values(activeSketch(doc).relations).some((r) => r.type === "horizontal" && r.refs.includes(line));

  it("is dropped when both ends are already fixed", async () => {
    const { doc, ids } = base();
    const { store, svc } = service(doc);
    await settle(store, svc);
    expect(store.state.status.conflicts).toEqual([]);
    const s = activeSketch(store.doc);
    const tl = (s.entities[ids.top] as { p2: Id }).p2; // top-left corner
    const line = drawLine(store, svc, { ...ptv(s, tl), to: tl }, { ...ptv(s, ids.corner), to: ids.corner });
    const d = await settle(store, svc);
    expect(hasH(d, line)).toBe(false);
    expect(store.state.status.conflicts).toEqual([]);
  });

  it("is kept when it constrains the line", async () => {
    const { doc, ids } = base();
    const { store, svc } = service(doc);
    await settle(store, svc);
    const s = activeSketch(store.doc);
    const line = drawLine(store, svc, { ...ptv(s, ids.corner), to: ids.corner }, { x: 200, y: 61 });
    const d = await settle(store, svc);
    expect(hasH(d, line)).toBe(true);
    expect(store.state.status.conflicts).toEqual([]);
  });
});
