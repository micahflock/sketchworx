import { beforeAll, describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import { evaluateDimText, inferDimension, measure, refreshExpressions } from "../src/model/dimensions";
import { evalExpr, evaluateVariables, parseExpr } from "../src/model/expr";
import { activeSketch, createDoc } from "../src/model/sketch";
import type { Doc, Id } from "../src/model/types";
import { buildSolverInput } from "../src/solver/build";
import { GcsCore } from "../src/solver/gcs";
import { addArc, addLine } from "../src/tools/common";

describe("expressions", () => {
  const ev = (s: string, vars: Record<string, number> = {}) => evalExpr(parseExpr(s), (n) => vars[n]);
  it("arithmetic and precedence", () => {
    expect(ev("1 + 2 * 3")).toBe(7);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev("-2^".replace("^", "") + "*3")).toBe(-6);
    expect(ev("=10/4")).toBe(2.5);
    expect(ev("1e2 + .5")).toBe(100.5);
  });
  it("functions (degrees)", () => {
    expect(ev("min(3, 1, 2) + max(4, 5)")).toBe(6);
    expect(ev("sqrt(16)")).toBe(4);
    expect(ev("sin(30)")).toBeCloseTo(0.5, 12);
    expect(ev("cos(60)")).toBeCloseTo(0.5, 12);
  });
  it("variables, including SolidWorks quoted names", () => {
    expect(ev("=width*1.5", { width: 88 })).toBe(132);
    expect(ev('="width" + 2', { width: 88 })).toBe(90);
  });
  it("errors", () => {
    expect(() => ev("1 +")).toThrow();
    expect(() => ev("foo(1)")).toThrow();
    expect(() => ev("x")).toThrow();
    expect(() => ev("1/0")).toThrow();
    expect(() => ev("alert(1)")).toThrow();
  });
  it("variables in dependency order with cycle detection", () => {
    const r = evaluateVariables([
      { name: "b", expr: "a*2" },
      { name: "a", expr: "10" },
      { name: "c", expr: "d" },
      { name: "d", expr: "c" },
    ]);
    expect(r.values.get("a")).toBe(10);
    expect(r.values.get("b")).toBe(20);
    expect(r.errors.has("c") || r.errors.has("d")).toBe(true);
  });
});

describe("dimension inference", () => {
  const doc = applyCommand(createDoc(), (ed) => {
    addLine(ed, { x: 0, y: 0 }, { x: 100, y: 50 });
  });
  const s = activeSketch(doc);
  const line = Object.values(s.entities).find((e) => e.type === "line")!.id;
  it("aligned when dragged along the normal", () => {
    expect(inferDimension(s, [line], { x: 40, y: 60 })!.type).toBe("distance");
  });
  it("horizontal when dragged straight up", () => {
    expect(inferDimension(s, [line], { x: 50, y: 200 })!.type).toBe("distanceX");
  });
  it("vertical when dragged to the side", () => {
    expect(inferDimension(s, [line], { x: 300, y: 25 })!.type).toBe("distanceY");
  });
});

let core: GcsCore;
beforeAll(async () => {
  core = await GcsCore.create();
});

function solve(doc: Doc) {
  const s = activeSketch(doc);
  const inp = buildSolverInput(s);
  expect(inp.unsupported).toEqual([]);
  const r = core.solve(inp.params, inp.constraints);
  return r;
}

/** Straight slot: two lines + two arcs, tangent joints, dimensioned by variables. */
export function slotDoc(width = 20): { doc: Doc; ids: Record<string, Id> } {
  const ids: Record<string, Id> = {};
  let doc = applyCommand(createDoc(), (ed) => {
    ed.setVariables([
      { name: "width", expr: String(width), value: width },
      { name: "len", expr: "100", value: 100 },
    ]);
    const top = addLine(ed, { x: 102, y: 11 }, { x: -1, y: 9 });
    const right = addArc(ed, { x: 101, y: 1 }, { x: 99, y: -9 }, { x: 100, y: 10 });
    const bottom = addLine(ed, { x: 1, y: -11 }, { x: 99, y: -9 });
    const left = addArc(ed, { x: 0, y: 0 }, { x: 0, y: 10 }, { x: 0, y: -10 });
    ed.addRelation({ type: "coincident", refs: [top.p1, right.e] });
    ed.addRelation({ type: "coincident", refs: [top.p2, left.s] });
    ed.addRelation({ type: "coincident", refs: [left.e, bottom.p1] });
    ed.addRelation({ type: "coincident", refs: [bottom.p2, right.s] });
    for (const [l, a] of [
      [top.line, right.arc],
      [top.line, left.arc],
      [bottom.line, left.arc],
      [bottom.line, right.arc],
    ])
      ed.addRelation({ type: "tangent", refs: [l, a] });
    ed.addRelation({ type: "horizontal", refs: [top.line] });
    ed.addRelation({ type: "equal", refs: [left.arc, right.arc] });
    ed.addRelation({ type: "coincident", refs: [left.c, "origin"] });
    ed.addDimension({ type: "radius", refs: [left.arc], expr: "=width/2", value: width / 2, driven: false, label: { x: 5, y: 5 } });
    ed.addDimension({ type: "distance", refs: [left.c, right.c], expr: "=len", value: 100, driven: false, label: { x: 0, y: 20 } });
    Object.assign(ids, { top: top.line, bottom: bottom.line, left: left.arc, right: right.arc, lc: left.c, rc: right.c });
  });
  doc = refreshExpressions(doc);
  return { doc, ids };
}

describe("dimensions through the solver", () => {
  it("fully dimensioned slot is fully defined", () => {
    const { doc } = slotDoc();
    const r = solve(doc);
    expect(r.ok).toBe(true);
    expect(r.conflicts).toEqual([]);
    expect(r.redundant).toEqual([]);
    expect(r.dof).toBe(0);
    for (const st of Object.values(r.entityStatus)) expect(st).toBe("full");
  });

  it("changing a variable re-evaluates dimensions", () => {
    const { doc, ids } = slotDoc();
    const d2 = refreshExpressions({ ...doc, variables: doc.variables.map((v) => (v.name === "width" ? { ...v, expr: "30" } : v)) });
    const dim = Object.values(activeSketch(d2).dimensions).find((d) => d.type === "radius")!;
    expect(dim.value).toBe(15);
    const r = solve(d2);
    const s = activeSketch(d2);
    const left = s.entities[ids.left] as { c: Id; s: Id };
    const byId = new Map(r.params.points.map((p) => [p.id, p]));
    const c = byId.get(left.c)!;
    const p = byId.get(left.s)!;
    expect(Math.hypot(p.x - c.x, p.y - c.y)).toBeCloseTo(15, 6);
  });

  it("a redundant dimension is reported", () => {
    const { doc, ids } = slotDoc();
    const d2 = applyCommand(doc, (ed) =>
      ed.addDimension({ type: "radius", refs: [ids.right], expr: "10", value: 10, driven: false, label: { x: 0, y: 0 } }),
    );
    const r = solve(d2);
    expect([...r.conflicts, ...r.redundant].length).toBeGreaterThan(0);
  });

  it("measures driven values and evaluates text", () => {
    const { doc, ids } = slotDoc();
    const s = activeSketch(doc);
    const m = measure(s, { id: "x", type: "distance", refs: [ids.lc, ids.rc], expr: "", value: 0, driven: true, label: { x: 0, y: 0 } });
    expect(m).toBeCloseTo(Math.hypot(101, 1), 9); // unsolved fixture positions
    expect(evaluateDimText(doc, "=width*2").value).toBe(40);
    expect(evaluateDimText(doc, "12.5").expr).toBe("12.5");
  });
});
