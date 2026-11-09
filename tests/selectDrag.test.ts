import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import { activeSketch, createDoc } from "../src/model/sketch";
import type { Id } from "../src/model/types";
import type { DragTarget } from "../src/solver/types";
import { addLine } from "../src/tools/common";
import { SelectTool } from "../src/tools/select";

/** A select tool over one line, recording the drag targets it sends to the solver. */
function setup(a: { x: number; y: number }, b: { x: number; y: number }) {
  let ids = { line: "", p1: "", p2: "" };
  const doc = applyCommand(createDoc(), (ed) => {
    ids = addLine(ed, a, b);
  });
  const s = activeSketch(doc);
  let last: DragTarget[] = [];
  let pick: Id = ids.line;
  const host = {
    sketch: () => s,
    showContextBar: () => {},
    hitAnnotation: () => null,
    hit: () => ({ id: pick }),
    selection: () => [],
    select: () => {},
    setHover: () => {},
    dragBegin: (t: DragTarget[]) => (last = t),
    dragUpdate: (t: DragTarget[]) => (last = t),
    dragEnd: () => {},
    requestRender: () => {},
    flash: () => {},
  };
  const tool = new SelectTool(host as never);
  const ev = (x: number, y: number) => ({ world: { x, y }, screen: { x, y: -y }, button: 0, shift: false, ctrl: false, alt: false, pointerType: "mouse" });
  const drag = (id: Id, from: { x: number; y: number }, to: { x: number; y: number }) => {
    pick = id;
    tool.onDown(ev(from.x, from.y) as never);
    tool.onMove(ev(to.x, to.y) as never);
    const t = last.map((x) => ({ point: x.point, x: Math.round(x.x), y: Math.round(x.y) }));
    tool.onUp(ev(to.x, to.y) as never);
    return t;
  };
  return { ids, drag };
}

describe("Select tool: dragging a line", () => {
  it("moves a vertical line only sideways", () => {
    const { ids, drag } = setup({ x: 100, y: 0 }, { x: 100, y: 200 });
    expect(drag(ids.line, { x: 100, y: 100 }, { x: 100, y: 180 })).toEqual([
      { point: ids.p1, x: 100, y: 0 },
      { point: ids.p2, x: 100, y: 200 },
    ]);
    expect(drag(ids.line, { x: 100, y: 100 }, { x: 160, y: 140 })).toEqual([
      { point: ids.p1, x: 160, y: 0 },
      { point: ids.p2, x: 160, y: 200 },
    ]);
  });

  it("moves a slanted line only across itself", () => {
    const { ids, drag } = setup({ x: 0, y: 0 }, { x: 100, y: 100 });
    // Along the line: nothing.
    expect(drag(ids.line, { x: 50, y: 50 }, { x: 90, y: 90 })).toEqual([
      { point: ids.p1, x: 0, y: 0 },
      { point: ids.p2, x: 100, y: 100 },
    ]);
  });

  it("drags an end point freely", () => {
    const { ids, drag } = setup({ x: 100, y: 0 }, { x: 100, y: 200 });
    expect(drag(ids.p2, { x: 100, y: 200 }, { x: 130, y: 260 })).toEqual([{ point: ids.p2, x: 130, y: 260 }]);
  });
});
