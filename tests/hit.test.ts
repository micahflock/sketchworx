import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import { activeSketch, createDoc } from "../src/model/sketch";
import type { Id, Sketch } from "../src/model/types";
import { hitTest } from "../src/render/hit";
import { addLine } from "../src/tools/common";

/** An own line and a borrowed (other sketch) line; `borrowed` lists the ids that came from elsewhere. */
function scene(own: [number, number, number, number], other: [number, number, number, number]) {
  let a = { line: "", p1: "", p2: "" };
  let b = { line: "", p1: "", p2: "" };
  const doc = applyCommand(createDoc(), (ed) => {
    b = addLine(ed, { x: other[0], y: other[1] }, { x: other[2], y: other[3] });
    a = addLine(ed, { x: own[0], y: own[1] }, { x: own[2], y: own[3] });
  });
  const s0 = activeSketch(doc);
  const ext: Record<Id, { feature: Id; hidden: boolean }> = {};
  for (const id of [b.line, b.p1, b.p2]) ext[id] = { feature: "other", hidden: false };
  const s: Sketch = { ...s0, ext };
  return { s, own: a, other: b };
}

describe("hit test", () => {
  it("prefers the active sketch's line where it overlaps a borrowed one", () => {
    const { s, own } = scene([0, 0, 100, 0], [-50, 0, 150, 0]);
    expect(hitTest(s, { x: 50, y: 1 }, 8)?.id).toBe(own.line);
  });

  it("prefers the active sketch's point over a borrowed point at the same place", () => {
    const { s, own } = scene([0, 0, 100, 0], [100, 0, 100, 100]);
    expect(hitTest(s, { x: 100, y: 0 }, 8)?.id).toBe(own.p2);
  });

  it("still picks a borrowed line the pointer is clearly on", () => {
    const { s, other } = scene([0, 0, 100, 0], [-50, 6, 150, 6]);
    expect(hitTest(s, { x: 50, y: 6 }, 8)?.id).toBe(other.line);
  });
});
