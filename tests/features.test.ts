import { beforeAll, describe, expect, it } from "vitest";
import { Store } from "../src/app/store";
import { SolverService } from "../src/app/solverService";
import { parseDoc, serializeDoc } from "../src/io/native";
import { applyCommand } from "../src/model/editor";
import { addFeature, danglingOf, deleteFeature, dependents, moveFeature, setActive, setVisible } from "../src/model/features";
import { docOutline } from "../src/model/outline";
import { validRelations } from "../src/model/relations";
import { activeSketch, createDoc, ownSketch, ptv } from "../src/model/sketch";
import type { Doc, Id } from "../src/model/types";
import { buildSolverInput } from "../src/solver/build";
import { GcsCore } from "../src/solver/gcs";
import type { Solver } from "../src/solver/types";
import { addArc, addCircle, addLine } from "../src/tools/common";
import { buildLoop } from "../src/tools/shapes";
import { mirrorEntities, offsetChain, recomputeDerived } from "../src/tools/edits";

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
