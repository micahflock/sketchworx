import { beforeAll, describe, expect, it } from "vitest";
import { PrintGuard } from "../src/app/printGuard";
import { SolverService } from "../src/app/solverService";
import { Store } from "../src/app/store";
import { chainOf, chainStyle, docChains, setChainStyle } from "../src/model/art";
import { applyCommand } from "../src/model/editor";
import { enablePrint } from "../src/model/print";
import { checkRules } from "../src/model/regions";
import { createDoc, ptv } from "../src/model/sketch";
import type { Doc, Id } from "../src/model/types";
import { GcsCore } from "../src/solver/gcs";
import type { Solver } from "../src/solver/types";
import { addLine } from "../src/tools/common";
import { buildLoop } from "../src/tools/shapes";

let core: GcsCore;
beforeAll(async () => {
  core = await GcsCore.create();
});

const inProcess = (): Solver => ({
  solve: async (p, c, d) => core.solve(p, c, d),
  dragStart: async (p, c, t) => core.dragStart(p, c, t),
  dragMove: async (t) => core.dragMove(t),
  dragEnd: () => core.dragEnd(),
});

/**
 * A white 30 mm part with two black 3-line (1.35 mm) bars: the lower one fixed, the upper one
 * horizontal, `dy` mm above it by a dimension. The white strip between them is dy − 1.35 mm.
 */
function twoBars(dy = 3) {
  const ids: Record<string, Id> = {};
  let doc = applyCommand(createDoc(), (ed) => {
    ids.part = buildLoop(
      ed,
      [
        { x: 0, y: 0 },
        { x: 30, y: 0 },
        { x: 30, y: 30 },
        { x: 0, y: 30 },
      ],
      false,
    )[0].line;
    const a = addLine(ed, { x: 5, y: 10 }, { x: 25, y: 10 });
    const b = addLine(ed, { x: 5, y: 10 + dy }, { x: 25, y: 10 + dy });
    ids.a = a.line;
    ids.b = b.line;
    ids.bp = b.p1;
    ed.addRelation({ type: "fix", refs: [a.p1] });
    ed.addRelation({ type: "fix", refs: [a.p2] });
    ed.addRelation({ type: "horizontal", refs: [b.line] });
    ids.dim = ed.addDimension({ type: "distanceY", refs: [a.p1, b.p1], expr: String(dy), value: dy, driven: false, label: { x: 0, y: 12 } });
  });
  const on = enablePrint(doc, { background: "#ffffff", colors: ["#000000"] });
  if ("error" in on) throw new Error(on.error);
  doc = on.doc;
  const c = (id: Id) => chainOf(docChains(doc), id)!;
  doc = setChainStyle(doc, [c(ids.part)], { fill: true, weight: 0, filament: "f1" });
  doc = setChainStyle(doc, [c(ids.a), c(ids.b)], { weight: 1.35, filament: "f2" });
  return { doc, ids };
}

async function setup(doc: Doc) {
  const store = new Store(doc);
  const svc = new SolverService(store, inProcess());
  const guard = new PrintGuard(store, svc);
  svc.onSettled = (d) => guard.onSettled(d);
  svc.dragFilter = (d) => guard.filterDrag(d);
  svc.requestSolve();
  await svc.settled();
  return { store, svc, guard };
}

async function settle(svc: SolverService, guard: PrintGuard) {
  svc.requestSolve();
  await svc.settled();
  await guard.idle();
  await svc.settled();
}

const gap = (doc: Doc, ids: Record<string, Id>) => ptv(doc.features[0].sketch, ids.bp).y - 10 - 1.35;

describe("print guard", () => {
  it("pulls a typed dimension back to the closest value that prints", async () => {
    const { doc, ids } = twoBars(3);
    const { store, svc, guard } = await setup(doc);
    expect(checkRules(store.doc).breaks).toEqual([]);
    const before = store.doc;
    guard.expectValue({
      from: 3,
      to: 2,
      apply: (v) => applyCommand(before, (ed) => ed.updateDimension(ids.dim, { expr: String(v), value: v })),
      show: (v) => `${v} mm`,
    });
    store.commitDoc(applyCommand(before, (ed) => ed.updateDimension(ids.dim, { expr: "2", value: 2 })), "Edit Dimension");
    await settle(svc, guard);
    // The strip may be no narrower than 2 lines (0.90 mm): 1.35 + 0.90 = 2.25.
    const dim = store.doc.features[0].sketch.dimensions[ids.dim];
    expect(dim.value).toBeGreaterThanOrEqual(2.25 - 0.002);
    expect(dim.value).toBeLessThan(2.26);
    expect(gap(store.doc, ids)).toBeCloseTo(dim.value - 1.35, 6);
    expect(checkRules(store.doc).breaks).toEqual([]);
    expect(store.state.notice?.kind).toBe("adjusted");
    expect(store.state.notice?.text).toMatch(/^Set to 2\.2\d mm: 2 mm would leave a 0\.65 mm white strip; min feature is 2 lines \(0\.90 mm\)/);
    // One undo step for the edit.
    store.undo();
    expect(store.doc.features[0].sketch.dimensions[ids.dim].value).toBe(3);
  });

  it("refuses an edit that adds a break, with a notice and the spot marked", async () => {
    const { doc, ids } = twoBars(3);
    const { store, svc, guard } = await setup(doc);
    const good = store.doc;
    store.commitDoc(applyCommand(good, (ed) => ed.updateDimension(ids.dim, { expr: "2", value: 2 })), "Edit Dimension");
    await settle(svc, guard);
    expect(store.doc.features[0].sketch.dimensions[ids.dim].value).toBe(3);
    expect(store.state.history.future).toEqual([]);
    expect(store.state.notice?.kind).toBe("refused");
    expect(store.state.notice?.text).toMatch(/^Edit Dimension not done: it would leave a 0\.65 mm white strip/);
    expect(store.state.printMarker?.length).toBeGreaterThan(0);
  });

  it("steps a stroke width back in whole lines", async () => {
    const { doc, ids } = twoBars(3);
    const { store, svc, guard } = await setup(doc);
    const before = store.doc;
    const b = chainOf(docChains(before), ids.b)!;
    // 7 lines (3.15 mm) grows 0.9 mm into the 1.65 mm strip; 6 lines leaves 0.975 mm.
    guard.expectValue({ from: 1.35, to: 3.15, step: 0.45, apply: (v) => setChainStyle(before, [b], { weight: v }), show: (v) => `${v}`, noSolve: true });
    store.commitDoc(setChainStyle(before, [b], { weight: 3.15 }), "Line Weight");
    await settle(svc, guard);
    expect(chainStyle(store.doc, chainOf(docChains(store.doc), ids.b)!).weight).toBeCloseTo(2.7, 9);
    expect(checkRules(store.doc).breaks).toEqual([]);
  });

  it("trusts undo and printer changes, then lets edits keep but not add breaks", async () => {
    const { doc, ids } = twoBars(2); // a 0.65 mm strip from the start
    const { store, svc, guard } = await setup(doc);
    expect(store.state.printReport?.breaks.length).toBe(1);
    // Widening the strip a little (still too thin) is allowed: it does not add a break.
    store.commitDoc(applyCommand(store.doc, (ed) => ed.updateDimension(ids.dim, { expr: "2.1", value: 2.1 })), "Edit Dimension");
    await settle(svc, guard);
    expect(store.doc.features[0].sketch.dimensions[ids.dim].value).toBe(2.1);
    expect(store.state.printReport?.breaks.length).toBe(1);
    // Narrowing it is refused.
    store.commitDoc(applyCommand(store.doc, (ed) => ed.updateDimension(ids.dim, { expr: "1.9", value: 1.9 })), "Edit Dimension");
    await settle(svc, guard);
    expect(store.doc.features[0].sketch.dimensions[ids.dim].value).toBe(2.1);
    expect(store.state.notice?.kind).toBe("refused");
    // Undo is trusted: back to the 0.65 mm strip.
    store.undo();
    await settle(svc, guard);
    expect(store.doc.features[0].sketch.dimensions[ids.dim].value).toBe(2);
  });

  it("holds a drag at the last frame that prints", async () => {
    const { doc, ids } = twoBars(3);
    const { store, guard } = await setup(doc);
    const ok = applyCommand(store.doc, (ed) => ed.movePoint(ids.bp, 5, 12.8));
    const bad = applyCommand(store.doc, (ed) => ed.movePoint(ids.bp, 5, 12));
    expect(guard.filterDrag(ok)).toBe(ok);
    expect(guard.filterDrag(bad)).toBeNull();
    expect(store.state.printMarker?.length).toBeGreaterThan(0);
  });
});
