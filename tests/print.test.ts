import { describe, expect, it } from "vitest";
import { parseDoc, serializeDoc } from "../src/io/native";
import { chainOf, chainStyle, docChains, setChainStyle } from "../src/model/art";
import type { StylePatch } from "../src/model/art";
import { applyCommand } from "../src/model/editor";
import type { Editor } from "../src/model/editor";
import { addFilament, disablePrint, enablePrint, linesFor, removeFilament, setPrinter, snapWeight } from "../src/model/print";
import { areaOf, buildRegions, checkRules, firstLayer, intersect, isWorse, union } from "../src/model/regions";
import { createDoc } from "../src/model/sketch";
import type { Doc, Id } from "../src/model/types";
import { addCircle, addLine } from "../src/tools/common";
import { buildLoop } from "../src/tools/shapes";

type V = { x: number; y: number };
const rect = (x: number, y: number, w: number, h: number): V[] => [
  { x, y },
  { x: x + w, y },
  { x: x + w, y: y + h },
  { x, y: y + h },
];

/** Build geometry, turn Print mode on (white base, black ink), then style chains by one of their curves. */
function printDoc(build: (ed: Editor) => Record<string, Id>, styles: [string, StylePatch][] = [], prep?: (doc: Doc) => Doc): { doc: Doc; ids: Record<string, Id> } {
  let ids: Record<string, Id> = {};
  let doc = applyCommand(createDoc(), (ed) => {
    ids = build(ed);
  });
  const on = enablePrint(doc, { background: "#ffffff", colors: ["#000000"] });
  if ("error" in on) throw new Error(on.error);
  doc = prep ? prep(on.doc) : on.doc;
  for (const [key, patch] of styles) {
    const c = chainOf(docChains(doc), ids[key])!;
    doc = setChainStyle(doc, [c], patch);
  }
  return { doc, ids };
}

const WHITE = "f1";
const BLACK = "f2";

/** A 30 mm square part filled white with no stroke, and a black line across it. */
function badge(lineWeight = 1.35) {
  return printDoc(
    (ed) => ({ part: buildLoop(ed, rect(0, 0, 30, 30), false)[0].line, bar: addLine(ed, { x: 5, y: 15 }, { x: 25, y: 15 }).line }),
    [
      ["part", { fill: true, weight: 0, filament: WHITE }],
      ["bar", { weight: lineWeight, filament: BLACK }],
    ],
  );
}

const region = (doc: Doc, id: string) => buildRegions(doc).regions.find((r) => r.filament === id)!.area;

describe("print settings", () => {
  it("turns on with the Art colors as filaments, w and nozzle variables, whole-line widths", () => {
    const { doc } = badge(1.1);
    expect(doc.print!.filaments.map((f) => [f.name, f.color])).toEqual([
      ["White", "#ffffff"],
      ["Black", "#000000"],
    ]);
    expect(doc.print!.base).toBe(WHITE);
    const vars = Object.fromEntries(doc.variables.map((v) => [v.name, v]));
    expect(vars.w.value).toBe(0.45);
    expect(vars.nozzle.value).toBe(0.4);
    expect(vars.w.locked).toBe(true);
    // 1.1 mm is 2.44 lines: 2 lines.
    const bar = docChains(doc).find((c) => !c.closed)!;
    expect(chainStyle(doc, bar).weight).toBeCloseTo(0.9, 9);
    expect(chainStyle(doc, bar).color).toBe("#000000");
  });

  it("never goes below the minimum feature (2 lines)", () => {
    const { doc } = badge();
    expect(linesFor(doc.print!.printer, 0.45)).toBe(2);
    expect(snapWeight(doc, 0.45)).toBeCloseTo(0.9, 9);
    expect(snapWeight(doc, 1.5)).toBeCloseTo(1.35, 9);
  });

  it("refuses to take over a user variable named w", () => {
    const doc = { ...createDoc(), variables: [{ name: "w", expr: "3", value: 3 }] };
    expect("error" in enablePrint(doc, { background: "#ffffff", colors: [] })).toBe(true);
  });

  it("follows a nozzle change: variables, dimensions written with w, stroke widths", () => {
    let { doc } = badge(1.35);
    doc = applyCommand(doc, (ed) => {
      const l = Object.values(ed.s.entities).find((e) => e.type === "line")!;
      if (l.type !== "line") return;
      ed.addDimension({ type: "distance", refs: [l.p1, l.p2], expr: "=4*w", value: 1.8, driven: false, label: { x: 0, y: 0 } });
    });
    const { doc: next } = setPrinter(doc, { preset: "mk4s-0.25" });
    expect(next.variables.find((v) => v.name === "w")!.value).toBe(0.27);
    const dim = Object.values(next.features[0].sketch.dimensions)[0];
    expect(dim.value).toBeCloseTo(1.08, 9);
    // 1.35 mm at 0.27 mm lines is 5 lines.
    const bar = docChains(next).find((c) => !c.closed)!;
    expect(chainStyle(next, bar).weight).toBeCloseTo(1.35, 9);
  });

  it("limits filaments to the color setup and moves areas when one is removed", () => {
    let { doc } = badge();
    for (let i = 0; i < 3; i++) doc = addFilament(doc).doc!;
    expect(doc.print!.filaments.length).toBe(5);
    expect(addFilament(doc).error).toMatch(/at most 5/);
    doc = setPrinter(doc, { colorSetup: "manual" }).doc;
    expect(addFilament(doc).doc!.print!.filaments.length).toBe(6);
    const r = removeFilament(doc, BLACK, "f3");
    const bar = docChains(r.doc!).find((c) => !c.closed)!;
    expect(chainStyle(r.doc!, bar).color).toBe(r.doc!.print!.filaments.find((f) => f.id === "f3")!.color);
  });

  it("saves and opens print settings; turning off keeps w as a plain variable", () => {
    const { doc } = badge();
    const back = parseDoc(serializeDoc(doc));
    expect(back.print).toEqual(doc.print);
    const off = disablePrint(doc);
    expect(off.print).toBeUndefined();
    expect(off.variables.find((v) => v.name === "w")!.locked).toBeUndefined();
  });
});

describe("regions", () => {
  it("tiles the part: black bar and white base, no overlap, no gap", () => {
    const { doc } = badge();
    const white = region(doc, WHITE);
    const black = region(doc, BLACK);
    expect(areaOf(black)).toBeCloseTo(20 * 1.35, 3);
    expect(areaOf(white)).toBeCloseTo(900 - 20 * 1.35, 3);
    expect(areaOf(intersect(white, black))).toBeLessThan(1e-6);
    expect(areaOf(union(white, black))).toBeCloseTo(900, 3);
  });

  it("clips art outside the part", () => {
    const { doc } = printDoc(
      (ed) => ({ part: buildLoop(ed, rect(0, 0, 10, 10), false)[0].line, bar: addLine(ed, { x: 5, y: 5 }, { x: 15, y: 5 }).line }),
      [
        ["part", { fill: true, weight: 0, filament: WHITE }],
        ["bar", { weight: 0.9, filament: BLACK }],
      ],
    );
    expect(areaOf(region(doc, BLACK))).toBeCloseTo(5 * 0.9, 3);
    expect(areaOf(buildRegions(doc).outside)).toBeCloseTo(5 * 0.9, 3);
  });

  it("later paint covers earlier; a different color inside a fill is an inlay", () => {
    const { doc } = printDoc(
      (ed) => ({
        part: buildLoop(ed, rect(0, 0, 20, 20), false)[0].line,
        a: buildLoop(ed, rect(2, 2, 10, 10), false)[0].line,
        b: buildLoop(ed, rect(6, 6, 10, 10), false)[0].line,
      }),
      [
        ["part", { fill: true, weight: 0, filament: WHITE }],
        ["a", { fill: true, weight: 0, filament: BLACK }],
        ["b", { fill: true, weight: 0, filament: "f3" }],
      ],
      (doc) => addFilament(doc, "#dc2828").doc!,
    );
    // b is drawn after a, so it covers a's top-right 6×6 corner.
    expect(areaOf(region(doc, BLACK))).toBeCloseTo(100 - 36, 3);
    expect(areaOf(region(doc, "f3"))).toBeCloseTo(100, 3);
    expect(areaOf(region(doc, WHITE))).toBeCloseTo(400 - 164, 3);
  });

  it("a profile inside a fill of the same color is a hole", () => {
    const { doc } = printDoc(
      (ed) => ({
        part: buildLoop(ed, rect(0, 0, 20, 20), false)[0].line,
        o: buildLoop(ed, rect(2, 2, 10, 10), false)[0].line,
        hole: buildLoop(ed, rect(4, 4, 6, 6), false)[0].line,
      }),
      [
        ["part", { fill: true, weight: 0, filament: WHITE }],
        ["o", { fill: true, weight: 0, filament: BLACK }],
        ["hole", { fill: true, weight: 0, filament: BLACK }],
      ],
    );
    expect(areaOf(region(doc, BLACK))).toBeCloseTo(100 - 36, 3);
  });
});

describe("rules", () => {
  it("passes a plain badge: corners are not breaks", () => {
    const { doc } = printDoc(
      (ed) => ({ part: buildLoop(ed, rect(0, 0, 30, 30), false)[0].line, sq: buildLoop(ed, rect(10, 10, 5, 5), false)[0].line }),
      [
        ["part", { fill: true, weight: 0, filament: WHITE }],
        ["sq", { fill: true, weight: 0, filament: BLACK }],
      ],
    );
    expect(checkRules(doc).breaks).toEqual([]);
  });

  it("flags a white strip narrower than 2 lines between two black bars", () => {
    const gap = 0.6;
    const { doc } = printDoc(
      (ed) => ({
        part: buildLoop(ed, rect(0, 0, 30, 30), false)[0].line,
        a: addLine(ed, { x: 5, y: 15 }, { x: 25, y: 15 }).line,
        b: addLine(ed, { x: 5, y: 15 + 1.35 + gap }, { x: 25, y: 15 + 1.35 + gap }).line,
      }),
      [
        ["part", { fill: true, weight: 0, filament: WHITE }],
        ["a", { weight: 1.35, filament: BLACK }],
        ["b", { weight: 1.35, filament: BLACK }],
      ],
    );
    const br = checkRules(doc).breaks;
    expect(br.length).toBe(1);
    expect(br[0].filament).toBe(WHITE);
    expect(br[0].width).toBeCloseTo(gap, 2);
  });

  it("flags a tiny island and a narrow neck", () => {
    const { doc } = printDoc(
      (ed) => ({
        part: buildLoop(ed, rect(0, 0, 40, 30), false)[0].line,
        dot: addCircle(ed, { x: 35, y: 25 }, 0.3).circle,
        // Two 5 mm squares joined by a 0.5 mm wide, 2 mm long bar.
        dumbbell: buildLoop(
          ed,
          [
            { x: 5, y: 5 },
            { x: 10, y: 5 },
            { x: 10, y: 7.25 },
            { x: 12, y: 7.25 },
            { x: 12, y: 5 },
            { x: 17, y: 5 },
            { x: 17, y: 10 },
            { x: 12, y: 10 },
            { x: 12, y: 7.75 },
            { x: 10, y: 7.75 },
            { x: 10, y: 10 },
            { x: 5, y: 10 },
          ],
          false,
        )[0].line,
      }),
      [
        ["part", { fill: true, weight: 0, filament: WHITE }],
        ["dot", { fill: true, weight: 0, filament: BLACK }],
        ["dumbbell", { fill: true, weight: 0, filament: BLACK }],
      ],
    );
    const br = checkRules(doc).breaks;
    const island = br.find((b) => b.kind === "thin")!;
    const neck = br.find((b) => b.kind === "neck")!;
    expect(island.width).toBeCloseTo(0.6, 2);
    expect(neck.width).toBeCloseTo(0.5, 2);
    expect(neck.at.x).toBeCloseTo(11, 0);
    expect(br.length).toBe(2);
  });

  it("an edit is worse when it adds a break", () => {
    const ok = checkRules(badge().doc);
    const bad = { breaks: [{} as never], lost: 1 };
    expect(isWorse(ok, bad)).toBe(true);
    expect(isWorse(bad, ok)).toBe(false);
  });
});

describe("first layer as printed", () => {
  const squareOnBase = (squish: number, blackFirst = false) => {
    let { doc } = printDoc(
      (ed) => ({ part: buildLoop(ed, rect(0, 0, 30, 30), false)[0].line, sq: buildLoop(ed, rect(10, 10, 5, 5), false)[0].line }),
      [
        ["part", { fill: true, weight: 0, filament: WHITE }],
        ["sq", { fill: true, weight: 0, filament: BLACK }],
      ],
    );
    doc = setPrinter(doc, { squish }).doc;
    if (blackFirst) doc = { ...doc, print: { ...doc.print!, filaments: doc.print!.filaments.slice().reverse() } };
    return doc;
  };

  it("leaves a pinhole at each outside corner of the square (squish off)", () => {
    const doc = squareOnBase(0);
    const fl = firstLayer(doc);
    const r = doc.print!.printer.firstLayerWidth / 2;
    expect(fl.count).toBe(4);
    expect(areaOf(fl.pinholes)).toBeCloseTo(4 * (1 - Math.PI / 4) * r * r, 3);
  });

  it("squish lets the first color spread into the next and shrinks the pinholes", () => {
    const off = firstLayer(squareOnBase(0));
    const on = firstLayer(squareOnBase(0.05));
    expect(areaOf(on.pinholes)).toBeLessThan(areaOf(off.pinholes));
    const blackOn = areaOf(on.laid.find((l) => l.filament === BLACK)!.area);
    const blackOff = areaOf(off.laid.find((l) => l.filament === BLACK)!.area);
    // White goes first and pushes 0.05 mm into each side of the black square.
    // (a little less than 4 × 5 × 0.05 mm², since the square's corners are rounded)
    expect(blackOff - blackOn).toBeGreaterThan(0.85);
    expect(blackOff - blackOn).toBeLessThan(1);
    // Black first: black grows instead.
    const blackFirst = areaOf(firstLayer(squareOnBase(0.05, true)).laid.find((l) => l.filament === BLACK)!.area);
    expect(blackFirst).toBeGreaterThan(blackOff);
  });
});
