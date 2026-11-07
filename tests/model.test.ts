import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import { commit, createHistory, redo, undo } from "../src/model/history";
import { activeSketch, createDoc } from "../src/model/sketch";
import { parseDoc, serializeDoc } from "../src/io/native";
import { addArc, addLine } from "../src/tools/common";

function closedShape() {
  // Two lines + an arc, closed with coincident relations.
  return applyCommand(createDoc(), (ed) => {
    const l1 = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 });
    const l2 = addLine(ed, { x: 100, y: 0 }, { x: 100, y: 50 });
    const a = addArc(ed, { x: 50, y: 50 }, { x: 100, y: 50 }, { x: 0, y: 50 });
    const l3 = addLine(ed, { x: 0, y: 50 }, { x: 0, y: 0 });
    ed.addRelation({ type: "coincident", refs: [l1.p2, l2.p1] });
    ed.addRelation({ type: "coincident", refs: [l2.p2, a.s] });
    ed.addRelation({ type: "coincident", refs: [a.e, l3.p1] });
    ed.addRelation({ type: "coincident", refs: [l3.p2, l1.p1] });
    ed.addRelation({ type: "horizontal", refs: [l1.line] });
  });
}

describe("editor", () => {
  it("is copy-on-write", () => {
    const d0 = createDoc();
    const d1 = applyCommand(d0, (ed) => addLine(ed, { x: 0, y: 0 }, { x: 1, y: 1 }));
    expect(Object.keys(activeSketch(d0).entities)).toHaveLength(1); // origin
    expect(Object.keys(activeSketch(d1).entities)).toHaveLength(4);
    const d2 = applyCommand(d1, () => {});
    expect(d2).toBe(d1);
  });

  it("deletes owned points and dangling relations with a curve", () => {
    const d = closedShape();
    const s = activeSketch(d);
    const line = Object.values(s.entities).find((e) => e.type === "line")!;
    const d2 = applyCommand(d, (ed) => ed.deleteEntities([line.id]));
    const s2 = activeSketch(d2);
    expect(s2.entities[line.id]).toBeUndefined();
    expect(Object.values(s2.entities).filter((e) => e.type === "point" && e.owner === line.id)).toHaveLength(0);
    for (const r of Object.values(s2.relations)) for (const ref of r.refs) expect(s2.entities[ref]).toBeDefined();
  });

  it("keeps ids unique", () => {
    const d = closedShape();
    const ids = new Set<string>();
    const s = activeSketch(d);
    for (const rec of [s.entities, s.relations, s.dimensions]) for (const id of Object.keys(rec)) ids.add(id);
    expect(ids.size).toBe(Object.keys(s.entities).length + Object.keys(s.relations).length);
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    const d0 = createDoc();
    let h = createHistory(d0);
    const d1 = closedShape();
    h = commit(h, d1, "shape");
    h = undo(h);
    expect(h.present).toBe(d0);
    h = redo(h);
    expect(h.present).toBe(d1);
  });
});

describe("native file", () => {
  it("round-trips identically", () => {
    const d = closedShape();
    const text = serializeDoc(d);
    const back = parseDoc(text);
    expect(back).toEqual(d);
    expect(serializeDoc(back)).toBe(text);
  });

  it("rejects garbage", () => {
    expect(() => parseDoc("nope")).toThrow();
    expect(() => parseDoc("{}")).toThrow();
    expect(() => parseDoc(JSON.stringify({ version: 99, slots: [] }))).toThrow();
  });
});
