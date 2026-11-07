import { refreshExpressions } from "../model/dimensions";
import { applyCommand } from "../model/editor";
import { createDoc } from "../model/sketch";
import type { Doc } from "../model/types";
import { addArc, addLine } from "../tools/common";

/** Fully dimensioned straight slot driven by the `width` and `len` variables. */
export function slotSample(): Doc {
  const doc = applyCommand(createDoc(), (ed) => {
    ed.setVariables([
      { name: "width", expr: "40", value: 40 },
      { name: "len", expr: "160", value: 160 },
    ]);
    const top = addLine(ed, { x: 160, y: 20 }, { x: 0, y: 20 });
    const right = addArc(ed, { x: 160, y: 0 }, { x: 160, y: -20 }, { x: 160, y: 20 });
    const bottom = addLine(ed, { x: 0, y: -20 }, { x: 160, y: -20 });
    const left = addArc(ed, { x: 0, y: 0 }, { x: 0, y: 20 }, { x: 0, y: -20 });
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
    ed.addDimension({ type: "diameter", refs: [left.arc], expr: "=width", value: 40, driven: false, label: { x: -45, y: 30 } });
    ed.addDimension({ type: "distance", refs: [left.c, right.c], expr: "=len", value: 160, driven: false, label: { x: 0, y: 50 } });
  });
  return refreshExpressions(doc);
}
