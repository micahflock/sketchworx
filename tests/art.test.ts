import { describe, expect, it } from "vitest";
import { exportSvg } from "../src/io/svg";
import { parseDoc, serializeDoc } from "../src/io/native";
import {
  artDefaults,
  artWeight,
  roundPolygon,
  setArtDefaults,
  strokeOutline,
  buildArtScene,
  chainOf,
  chainStyle,
  docChains,
  hitChain,
  offsetPolyline,
  setArtWeight,
  setChainStyle,
} from "../src/model/art";
import { applyCommand } from "../src/model/editor";
import { createDoc } from "../src/model/sketch";
import type { Doc } from "../src/model/types";
import { addCircle, addLine } from "../src/tools/common";
import { buildLoop } from "../src/tools/shapes";

const square = (x: number, y: number, s: number) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

function polyArea(pts: { x: number; y: number }[]) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

/** A 10×10 square profile, an open two-line chain, and a construction line. */
function mixed(): { doc: Doc; open: string[] } {
  let open: string[] = [];
  const doc = applyCommand(createDoc(), (ed) => {
    buildLoop(ed, square(0, 0, 10), false);
    const a = addLine(ed, { x: 20, y: 0 }, { x: 30, y: 0 });
    const b = addLine(ed, { x: 30, y: 0 }, { x: 30, y: 10 });
    ed.addRelation({ type: "coincident", refs: [a.p2, b.p1] });
    addLine(ed, { x: 0, y: 20 }, { x: 10, y: 20 }, true);
    open = [a.line, b.line];
  });
  return { doc, open };
}

describe("art chains", () => {
  it("chains every non-construction curve: open runs and closed profiles", () => {
    const { doc, open } = mixed();
    const chains = docChains(doc);
    expect(chains).toHaveLength(2);
    const prof = chains.find((c) => c.closed)!;
    const run = chains.find((c) => !c.closed)!;
    expect(prof.ids).toHaveLength(4);
    expect(prof.area).toBeCloseTo(100, 6);
    expect(run.ids).toEqual(open);
    // The open chain runs along its first line's own direction.
    expect(run.segs[0].start).toEqual({ x: 20, y: 0 });
    expect(run.segs[1].end).toEqual({ x: 30, y: 10 });
  });

  it("keeps an open chain's direction when its first line is drawn the other way round", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      const a = addLine(ed, { x: 10, y: 0 }, { x: 0, y: 0 });
      const b = addLine(ed, { x: 10, y: 0 }, { x: 10, y: 10 });
      ed.addRelation({ type: "coincident", refs: [a.p1, b.p1] });
    });
    // The first line runs (10,0) → (0,0), so the chain does too: it starts at the far end of the second line.
    const [c] = docChains(doc);
    expect(c.segs[0].start).toEqual({ x: 10, y: 10 });
    expect(c.segs[c.segs.length - 1].end).toEqual({ x: 0, y: 0 });
  });

  it("finds a profile with a tail, and keeps the tail as its own chain", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      addLine(ed, { x: 10, y: 10 }, { x: 20, y: 20 }); // tail first, so a naive walk starts on it
      buildLoop(ed, square(0, 0, 10), false);
    });
    const chains = docChains(doc);
    expect(chains.filter((c) => c.closed)).toHaveLength(1);
    expect(chains.filter((c) => !c.closed)).toHaveLength(1);
  });

  it("splits branched geometry so every curve is in exactly one chain", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      buildLoop(ed, square(0, 0, 10), false);
      addLine(ed, { x: 0, y: 5 }, { x: 10, y: 5 }); // not coincident with the sides' ends: no branch
      // A real branch: three lines from one point.
      addLine(ed, { x: 50, y: 0 }, { x: 60, y: 0 });
      addLine(ed, { x: 50, y: 0 }, { x: 40, y: 0 });
      addLine(ed, { x: 50, y: 0 }, { x: 50, y: 10 });
    });
    const chains = docChains(doc);
    const all = chains.flatMap((c) => c.ids);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(4 + 1 + 3);
    // The three spokes stop at the branch point.
    expect(chains.filter((c) => !c.closed && c.segs.length === 1)).toHaveLength(4);
  });
});

describe("art styles", () => {
  it("uses the default weight until a chain gets its own", () => {
    const { doc, open } = mixed();
    const run = chainOf(docChains(doc), open[0])!;
    expect(chainStyle(doc, run)).toMatchObject({ weight: artWeight(doc), side: "center", fill: false, custom: { weight: false } });
    const d2 = setArtWeight(doc, 5);
    expect(chainStyle(d2, chainOf(docChains(d2), open[0])!).weight).toBe(5);
    const d3 = setChainStyle(d2, [run], { weight: 1.5, side: "left" });
    const s3 = chainStyle(d3, chainOf(docChains(d3), open[1])!);
    expect(s3).toMatchObject({ weight: 1.5, side: "left", custom: { weight: true } });
    // Back to the default (which still follows the global weight).
    const d4 = setArtWeight(setChainStyle(d3, [run], { weight: null }), 3);
    expect(chainStyle(d4, chainOf(docChains(d4), open[0])!)).toMatchObject({ weight: 3, side: "left", custom: { weight: false } });
  });

  it("fills profiles only", () => {
    const { doc } = mixed();
    const chains = docChains(doc);
    const d = setChainStyle(doc, chains, { fill: true });
    const after = docChains(d);
    expect(chainStyle(d, after.find((c) => c.closed)!).fill).toBe(true);
    expect(chainStyle(d, after.find((c) => !c.closed)!).fill).toBe(false);
    expect(buildArtScene(d, 0.01).fills).toHaveLength(1);
  });

  it("cuts a hole only where both nested profiles are filled", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      addCircle(ed, { x: 0, y: 0 }, 10);
      addCircle(ed, { x: 0, y: 0 }, 5);
    });
    const [outer, inner] = [...docChains(doc)].sort((a, b) => b.area - a.area);
    const both = buildArtScene(setChainStyle(doc, [outer, inner], { fill: true }), 0.01);
    // One painted region: the outer profile with the inner one cut out (opposite direction).
    expect(both.fills).toHaveLength(1);
    expect(both.fills[0].loops.map((l) => Math.sign(l.area))).toEqual([1, -1]);
    const innerOnly = buildArtScene(setChainStyle(doc, [inner], { fill: true }), 0.01);
    expect(innerOnly.fills).toHaveLength(1);
    expect(innerOnly.fills[0].loops).toHaveLength(1);
    expect(innerOnly.fills[0].loops[0].area).toBeGreaterThan(0);
  });

  it("saves and loads styles, dropping styles of deleted curves", () => {
    const { doc, open } = mixed();
    let d = setChainStyle(setArtWeight(doc, 4), [chainOf(docChains(doc), open[0])!], { weight: 1, side: "right" });
    d = setChainStyle(d, docChains(d).filter((c) => c.closed), { fill: true });
    const back = parseDoc(serializeDoc(d));
    expect(back.art?.weight).toBe(4);
    expect(chainStyle(back, chainOf(docChains(back), open[1])!)).toMatchObject({ weight: 1, side: "right" });
    expect(chainStyle(back, docChains(back).find((c) => c.closed)!).fill).toBe(true);
    const gone = applyCommand(d, (ed) => ed.deleteAny(open));
    const saved = JSON.parse(serializeDoc(gone));
    expect(Object.keys(saved.art.styles).some((id) => open.includes(id))).toBe(false);
  });
});

describe("art geometry", () => {
  it("offsets a CCW square inward to the left", () => {
    const sq = square(0, 0, 10);
    const inner = offsetPolyline(sq, 1, true);
    expect(inner).toHaveLength(4);
    expect(polyArea(inner)).toBeCloseTo(64, 9);
    expect(inner[0].x).toBeCloseTo(1, 9);
    expect(inner[0].y).toBeCloseTo(1, 9);
    expect(polyArea(offsetPolyline(sq, -1, true))).toBeCloseTo(144, 9);
  });

  it("offsets an open polyline with square ends and a mitered corner", () => {
    const out = offsetPolyline(
      [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      -1,
      false,
    );
    expect(out[0]).toEqual({ x: 0, y: -1 });
    expect(out[1].x).toBeCloseTo(11, 9);
    expect(out[1].y).toBeCloseTo(-1, 9);
    expect(out[2].x).toBeCloseTo(11, 9);
    expect(out[2].y).toBeCloseTo(10, 9);
  });

  it("puts a side stroke wholly on its side of the chain", () => {
    const { doc } = mixed();
    const prof = docChains(doc).find((c) => c.closed)!;
    const d = setChainStyle(setArtWeight(doc, 2), [prof], { side: "left" });
    const s = buildArtScene(d, 0.01).strokes.find((x) => x.chain.key === prof.key)!;
    // Stroke centerline is 1 unit inside: a 8×8 square.
    expect(Math.abs(polyArea(s.path))).toBeCloseTo(64, 6);
    expect(s.centered).toBe(false);
  });

  it("hits strokes near the line and filled profiles inside", () => {
    const { doc, open } = mixed();
    const prof = docChains(doc).find((c) => c.closed)!;
    let sc = buildArtScene(doc, 0.01);
    expect(hitChain(sc, { x: 25, y: 0.5 }, 0.5)?.ids).toEqual(open);
    expect(hitChain(sc, { x: 5, y: 5 }, 0.5)).toBeNull();
    sc = buildArtScene(setChainStyle(doc, [prof], { fill: true }), 0.01);
    expect(hitChain(sc, { x: 5, y: 5 }, 0.5)?.key).toBe(prof.key);
  });
});

describe("art color and rounding", () => {
  it("colors chains from the default until they set their own", () => {
    const { doc, open } = mixed();
    const run = chainOf(docChains(doc), open[0])!;
    expect(chainStyle(doc, run).color).toBe("#000000");
    const d1 = setArtDefaults(doc, { color: "#FF0000" });
    expect(artDefaults(d1).color).toBe("#ff0000");
    expect(chainStyle(d1, run).color).toBe("#ff0000");
    const d2 = setChainStyle(d1, [run], { color: "#00ff00" });
    expect(chainStyle(d2, chainOf(docChains(d2), open[1])!)).toMatchObject({ color: "#00ff00", custom: { color: true } });
    expect(chainStyle(setChainStyle(d2, [run], { color: null }), run).color).toBe("#ff0000");
    // Not a color: ignored.
    expect(setArtDefaults(doc, { color: "red" })).toBe(doc);
  });

  it("paints fills in their profile's color, islands over holes", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      addCircle(ed, { x: 0, y: 0 }, 10);
      addCircle(ed, { x: 0, y: 0 }, 6);
      addCircle(ed, { x: 0, y: 0 }, 3);
    });
    const [big, mid, small] = [...docChains(doc)].sort((a, b) => b.area - a.area);
    let d = setChainStyle(doc, [big, mid, small], { fill: true });
    d = setChainStyle(d, [big], { color: "#ff0000" });
    d = setChainStyle(d, [small], { color: "#0000ff" });
    const fills = buildArtScene(d, 0.01).fills;
    expect(fills.map((f) => [f.color, f.loops.length])).toEqual([
      ["#ff0000", 2],
      ["#0000ff", 1],
    ]);
  });

  it("rounds a square's corners", () => {
    const r = roundPolygon(square(0, 0, 10).reverse(), () => 2, 1e-3);
    // A 10×10 square with 2-radius corners: 100 − (4 − π)·4.
    expect(Math.abs(polyArea(r))).toBeCloseTo(100 - (4 - Math.PI) * 4, 1);
    // No rounding: unchanged.
    expect(roundPolygon(square(0, 0, 10), () => 0, 1e-3)).toHaveLength(4);
  });

  it("rounds a line's ends fully at half the weight", () => {
    const line = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
    ];
    const [ring] = strokeOutline(line, -2, 2, false, 0, 2, 1e-3);
    // A 20×4 band with semicircular ends inside its length: 20·4 − (4 − π)·4.
    expect(Math.abs(polyArea(ring))).toBeCloseTo(80 - (4 - Math.PI) * 4, 1);
    const xs = ring.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0, 9);
    expect(Math.max(...xs)).toBeCloseTo(20, 9);
  });

  it("keeps a turn's inside and outside concentric", () => {
    const corner = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
    ];
    // Weight 2 centered, corner radius 3: the outside edge turns with radius 3, the inside with 1.
    const [ring] = strokeOutline(corner, -1, 1, false, 3, 0, 1e-4);
    const near = (x: number, y: number) => ring.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-3);
    expect(near(21 - 3 + 3 * Math.SQRT1_2, -1 + 3 - 3 * Math.SQRT1_2)).toBe(true); // outside arc midpoint, center (18, 2)
    expect(near(19 - 1 + Math.SQRT1_2, 1 + 1 - Math.SQRT1_2)).toBe(true); // inside arc midpoint, center (18, 2)
  });

  it("fills a rounded stroke from its outline and saves the new fields", () => {
    const { doc, open } = mixed();
    const d = setChainStyle(setArtDefaults(doc, { corner: 1, color: "#123456" }), [chainOf(docChains(doc), open[0])!], { end: 0.5 });
    const sc = buildArtScene(d, 0.01);
    expect(sc.strokes.every((s) => s.outline)).toBe(true);
    const back = parseDoc(serializeDoc(d));
    expect(artDefaults(back)).toMatchObject({ corner: 1, color: "#123456", end: 0 });
    expect(chainStyle(back, chainOf(docChains(back), open[1])!).end).toBe(0.5);
    const svg = exportSvg(d, { arcs: "arc", construction: false, art: true });
    expect(svg).toContain('fill="#123456"');
    expect(svg).not.toContain("stroke-width");
  });
});

describe("art export", () => {
  it("writes strokes with their weights and filled profiles", () => {
    const { doc } = mixed();
    const prof = docChains(doc).find((c) => c.closed)!;
    const d = setChainStyle(setArtWeight(doc, 3), [prof], { fill: true });
    const svg = exportSvg(d, { arcs: "arc", construction: false, art: true });
    expect(svg.match(/stroke-width="3"/g)).toHaveLength(2);
    expect(svg).toContain('fill="#000000" fill-rule="nonzero"');
    // Construction stays out.
    expect(svg).not.toContain("M0 -20");
  });
});
