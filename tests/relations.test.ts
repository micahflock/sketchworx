import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import { addRelationCmd, relationIcons, relationNames, validRelations } from "../src/model/relations";
import { activeSketch, createDoc } from "../src/model/sketch";
import { addArc, addCircle, addLine } from "../src/tools/common";

function fixture() {
  let ids: Record<string, string> = {};
  const doc = applyCommand(createDoc(), (ed) => {
    const l1 = addLine(ed, { x: 0, y: 0 }, { x: 10, y: 1 });
    const l2 = addLine(ed, { x: 0, y: 5 }, { x: 10, y: 6 });
    const cl = addLine(ed, { x: 5, y: -5 }, { x: 5, y: 15 }, true);
    const c = addCircle(ed, { x: 20, y: 0 }, 3);
    const a = addArc(ed, { x: 30, y: 0 }, { x: 33, y: 0 }, { x: 30, y: 3 });
    const p = ed.addPoint(1, 1);
    const q = ed.addPoint(9, 1);
    ids = { l1: l1.line, l2: l2.line, cl: cl.line, c: c.circle, a: a.arc, p, q, l1p1: l1.p1 };
  });
  return { s: activeSketch(doc), ids, doc };
}

describe("validRelations", () => {
  const { s, ids } = fixture();
  it("two lines", () => {
    expect(validRelations(s, [ids.l1, ids.l2])).toEqual(["horizontal", "vertical", "equal", "parallel", "perpendicular", "collinear", "fix"]);
  });
  it("point + line", () => {
    expect(validRelations(s, [ids.p, ids.l1])).toEqual(["coincident", "midpoint", "fix"]);
    // a line's own endpoint cannot be made coincident with it
    expect(validRelations(s, [ids.l1p1, ids.l1])).toEqual(["fix"]);
  });
  it("line + circle and arc + circle", () => {
    expect(validRelations(s, [ids.l1, ids.c])).toContain("tangent");
    expect(validRelations(s, [ids.a, ids.c])).toEqual(["tangent", "equal", "concentric", "coradial", "fix"]);
  });
  it("symmetric needs a centerline", () => {
    expect(validRelations(s, [ids.p, ids.q, ids.cl])).toContain("symmetric");
    expect(validRelations(s, [ids.p, ids.q, ids.l1])).not.toContain("symmetric");
  });
  it("two points", () => {
    expect(validRelations(s, [ids.p, ids.q])).toEqual(["horizontal", "vertical", "coincident", "fix"]);
  });
});

describe("addRelationCmd", () => {
  it("horizontal on lines makes one relation per line", () => {
    const { doc, ids } = fixture();
    const d2 = applyCommand(doc, (ed) => addRelationCmd(ed, "horizontal", [ids.l1, ids.l2]));
    const rels = Object.values(activeSketch(d2).relations);
    expect(rels.filter((r) => r.type === "horizontal")).toHaveLength(2);
  });
  it("fix snapshots values", () => {
    const { doc, ids } = fixture();
    const d2 = applyCommand(doc, (ed) => addRelationCmd(ed, "fix", [ids.c]));
    const r = Object.values(activeSketch(d2).relations)[0];
    expect(r.values).toEqual([20, 0, 3]);
  });
});

describe("relationIcons", () => {
  it("has an icon for every relation, drawn inside the 10×10 tag box", () => {
    for (const type of Object.keys(relationNames) as (keyof typeof relationNames)[]) {
      const icon = relationIcons[type];
      expect(icon?.stroke, type).toBeTruthy();
      const nums = `${icon.stroke} ${icon.fill ?? ""}`.match(/-?\d*\.?\d+/g)!.map(Number);
      for (const n of nums) expect(n >= 0 && n <= 10, `${type}: ${n}`).toBe(true);
    }
  });
});
