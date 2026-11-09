import { refreshExpressions } from "../model/dimensions";
import { applyCommand } from "../model/editor";
import { createDoc } from "../model/sketch";
import type { Doc } from "../model/types";
import { addArc, addCircle, addLine } from "../tools/common";
import { buildLoop } from "../tools/shapes";
import { chainOf, docChains, setChainStyle } from "../model/art";
import type { StylePatch } from "../model/art";
import { addSpline, mirrorEntities } from "../tools/edits";

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

/** Oval ("O" shape) from four style splines, curvature-continuous (G2) joints, the left half mirrored. */
export function ovalSample(): Doc {
  return applyCommand(createDoc(), (ed) => {
    const axis = addLine(ed, { x: 0, y: -40 }, { x: 0, y: 740 }, true);
    const tr = addSpline(ed, [
      { x: 0, y: 700 },
      { x: 170, y: 700 },
      { x: 300, y: 540 },
      { x: 300, y: 350 },
    ]);
    const br = addSpline(ed, [
      { x: 300, y: 350 },
      { x: 300, y: 160 },
      { x: 170, y: 0 },
      { x: 0, y: 0 },
    ]);
    ed.addRelation({ type: "coincident", refs: [tr.cps[3], br.cps[0]] });
    // G2 at the right extreme; the mirror makes the left, top and bottom joints G2 by symmetry.
    ed.addRelation({ type: "equalCurvature", refs: [tr.spline, br.spline] });
    ed.addRelation({ type: "coincident", refs: [tr.cps[0], axis.line] });
    ed.addRelation({ type: "coincident", refs: [br.cps[3], axis.line] });
    ed.addRelation({ type: "coincident", refs: [axis.p1, "origin"] });
    ed.addRelation({ type: "vertical", refs: [axis.line] });
    const [tl, bl] = mirrorEntities(ed, [tr.spline, br.spline], axis.line);
    ed.addRelation({ type: "tangent", refs: [tr.spline, tl] });
    ed.addRelation({ type: "tangent", refs: [br.spline, bl] });
  });
}

/**
 * A 40 × 24 mm badge for Print mode: a white plate, a black border 2 mm in, a red disc and two black
 * bars (Art colors; turning Print mode on makes them filaments).
 */
export function badgeSample(): Doc {
  const ids: Record<string, string> = {};
  const rect = (x: number, y: number, w: number, h: number) => [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ];
  let doc = applyCommand(createDoc(), (ed) => {
    ids.plate = buildLoop(ed, rect(0, 0, 40, 24), false)[0].line;
    ids.border = buildLoop(ed, rect(2, 2, 36, 20), false)[0].line;
    ids.disc = addCircle(ed, { x: 12, y: 12 }, 6).circle;
    ids.bar1 = addLine(ed, { x: 21, y: 14.5 }, { x: 34, y: 14.5 }).line;
    ids.bar2 = addLine(ed, { x: 21, y: 9.5 }, { x: 30, y: 9.5 }).line;
  });
  const style = (key: string, patch: StylePatch) => (doc = setChainStyle(doc, [chainOf(docChains(doc), ids[key])!], patch));
  style("plate", { fill: true, weight: 0, color: "#ffffff" });
  style("border", { weight: 1.35, color: "#000000", side: "left" });
  style("disc", { fill: true, weight: 0, color: "#dc2828" });
  style("bar1", { weight: 1.8, color: "#000000", roundEnds: true });
  style("bar2", { weight: 1.8, color: "#000000", roundEnds: true });
  return { ...doc, art: { ...doc.art!, background: "#ffffff" } };
}
