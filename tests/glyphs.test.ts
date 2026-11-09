import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import { activeSketch, createDoc } from "../src/model/sketch";
import { drawRelationGlyphs } from "../src/render/annotations";
import { addLine } from "../src/tools/common";

/** Screen = world with y flipped; badges are 14 px squares centered on the given point. */
const painter = {
  s: (q: { x: number; y: number }) => ({ x: q.x, y: -q.y }),
  badge: (_icon: unknown, x: number, y: number) => ({ x: x - 7, y: y - 7, w: 14, h: 14 }),
  crossScreen: () => {},
};

describe("Relation glyphs", () => {
  it("don't overlap where several points meet", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      const a = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 });
      const b = addLine(ed, { x: 100, y: 0 }, { x: 140, y: 120 });
      const c = addLine(ed, { x: 100, y: 0 }, { x: 60, y: 120 });
      // Two ends at the same corner, each on line b: both glyphs want the same spot.
      ed.addRelation({ type: "coincident", refs: [a.p2, b.line] });
      ed.addRelation({ type: "coincident", refs: [c.p1, b.line] });
      ed.addRelation({ type: "horizontal", refs: [a.line] });
      ed.addRelation({ type: "equal", refs: [b.line, c.line] });
      ed.addRelation({ type: "perpendicular", refs: [b.line, c.line] });
    });
    const hits = drawRelationGlyphs(painter as never, activeSketch(doc), new Set(), null, new Set());
    expect(hits.length).toBeGreaterThan(5);
    for (let i = 0; i < hits.length; i++)
      for (let j = i + 1; j < hits.length; j++) {
        const A = hits[i];
        const B = hits[j];
        const overlap = A.x < B.x + B.w && B.x < A.x + A.w && A.y < B.y + B.h && B.y < A.y + A.h;
        expect(overlap, `${i} and ${j} overlap`).toBe(false);
      }
  });
});
