import { describe, expect, it } from "vitest";
import { exportSvg } from "../src/io/svg";
import { parseDoc, serializeDoc } from "../src/io/native";
import {
  artBackground,
  artDefaults,
  setArtBackground,
  artWeight,
  effectiveCorner,
  filletPolyline,
  setArtDefaults,
  trimPolyline,
  trimSegs,
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
    expect(s.segs).toBeNull();
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

  it("rounds a square path's corners", () => {
    const r = filletPolyline(square(0, 0, 10), true, () => 2, 1e-3);
    // A 10×10 square with 2-radius corners: 100 − (4 − π)·4.
    expect(Math.abs(polyArea(r))).toBeCloseTo(100 - (4 - Math.PI) * 4, 1);
    expect(filletPolyline(square(0, 0, 10), true, () => 0, 1e-3)).toHaveLength(4);
    // An open path keeps its end points.
    const open = filletPolyline(square(0, 0, 10), false, () => 2, 1e-3);
    expect(open[0]).toEqual({ x: 0, y: 0 });
    expect(open[open.length - 1]).toEqual({ x: 0, y: 10 });
  });

  it("draws corner radii below half the weight as half the weight", () => {
    expect(effectiveCorner({ weight: 4, corner: 0 })).toBe(0);
    expect(effectiveCorner({ weight: 4, corner: 1 })).toBe(2);
    expect(effectiveCorner({ weight: 4, corner: 5 })).toBe(5);
  });

  it("shortens lines for round ends so they stay within the line's length", () => {
    const t = trimPolyline(
      [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 10, y: 0 },
      ],
      2,
      3,
    );
    expect(t).toEqual([
      { x: 2, y: 0 },
      { x: 7, y: 0 },
    ]);
    const doc = applyCommand(createDoc(), (ed) => {
      addLine(ed, { x: 0, y: 0 }, { x: 20, y: 0 });
    });
    const [c] = docChains(doc);
    const segs = trimSegs(c.segs, 2, 2);
    expect(segs[0].start.x).toBeCloseTo(2, 9);
    expect(segs[0].end.x).toBeCloseTo(18, 9);
  });

  it("trims arcs exactly", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      addCircle(ed, { x: 0, y: 0 }, 10);
    });
    const half = docChains(doc)[0].segs[0]; // a half circle, length 10π
    const [a] = trimSegs([half], Math.PI * 10 * 0.25, 0);
    expect(a.kind).toBe("arc");
    if (a.kind === "arc") expect(Math.abs(a.sweep)).toBeCloseTo(Math.PI * 0.75, 9);
  });

  it("strokes a line with round ends and a rounded corner", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      const a = addLine(ed, { x: 0, y: 0 }, { x: 20, y: 0 });
      const b = addLine(ed, { x: 20, y: 0 }, { x: 20, y: 20 });
      ed.addRelation({ type: "coincident", refs: [a.p2, b.p1] });
    });
    const d = setChainStyle(setArtWeight(doc, 2), docChains(doc), { corner: 3, roundEnds: true });
    const [s] = buildArtScene(d, 1e-4).strokes;
    expect(s).toMatchObject({ join: "round", cap: "round", segs: null });
    // Ends pulled in by half the weight; the stroke's own centerline turns with radius 3 − 1 = 2.
    expect(s.path[0].x).toBeCloseTo(1, 9);
    expect(s.path[s.path.length - 1].y).toBeCloseTo(19, 9);
    const near = (x: number, y: number) => s.path.some((p) => Math.hypot(p.x - x, p.y - y) < 1e-3);
    expect(near(18 + 2 * Math.SQRT1_2, 2 - 2 * Math.SQRT1_2)).toBe(true);
    // Centered with no corner radius: exact pieces, shortened.
    const d2 = setChainStyle(d, docChains(d), { corner: 0 });
    const [s2] = buildArtScene(d2, 1e-4).strokes;
    expect(s2.segs?.[0].start.x).toBeCloseTo(1, 9);
    expect(s2.join).toBe("miter");
  });

  it("writes rounded strokes as SVG strokes and saves the new fields", () => {
    const { doc, open } = mixed();
    const d = setChainStyle(setArtDefaults(doc, { corner: 1, color: "#123456" }), [chainOf(docChains(doc), open[0])!], { roundEnds: true });
    const back = parseDoc(serializeDoc(d));
    expect(artDefaults(back)).toMatchObject({ corner: 1, color: "#123456", roundEnds: false });
    expect(chainStyle(back, chainOf(docChains(back), open[1])!).roundEnds).toBe(true);
    const svg = exportSvg(d, { arcs: "arc", construction: false, art: true });
    expect(svg.match(/stroke-width="2"/g)).toHaveLength(2);
    expect(svg.match(/stroke-linejoin="round"/g)).toHaveLength(2);
    expect(svg.match(/stroke-linecap="round"/g)).toHaveLength(1);
    expect(svg).toContain('stroke="#123456"');
  });

  it("keeps a background color, saves it, and writes it into the SVG", () => {
    const { doc } = mixed();
    expect(artBackground(doc)).toBe("#ffffff");
    expect(exportSvg(doc)).not.toContain("<rect");
    let d = setArtBackground(doc, "#FFEEDD");
    expect(artBackground(d)).toBe("#ffeedd");
    // Other art changes keep it.
    d = setArtDefaults(setChainStyle(d, docChains(d), { weight: 3 }), { color: "#112233" });
    expect(artBackground(d)).toBe("#ffeedd");
    expect(artBackground(parseDoc(serializeDoc(d)))).toBe("#ffeedd");
    const svg = exportSvg(d);
    expect(svg).toContain('fill="#ffeedd"');
    expect(svg.indexOf("<rect")).toBeLessThan(svg.indexOf("<path"));
    expect(setArtBackground(d, "blue")).toBe(d);
  });

  it("reads an older end radius as round ends", () => {
    const { doc, open } = mixed();
    const raw = JSON.parse(serializeDoc(doc));
    raw.art = { weight: 2, end: 1, styles: { [open[0]]: { end: 0.5 } } };
    const back = parseDoc(JSON.stringify(raw));
    expect(artDefaults(back).roundEnds).toBe(true);
    expect(chainStyle(back, chainOf(docChains(back), open[0])!).custom.roundEnds).toBe(true);
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

describe("round ends keep the drawn length", () => {
  // A round cap reaches half the weight past the end of its path, so the path stops half the weight short.
  const w = 10;
  const lineDoc = () =>
    setArtDefaults(
      applyCommand(createDoc(), (ed) => {
        addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 });
      }),
      { weight: w, roundEnds: true },
    );
  const strokeD = (doc: Doc) => (exportSvg(doc).match(/<path d="([^"]+)" fill="none" stroke="#000000" stroke-width="10"[^>]*stroke-linecap="round"/) ?? [])[1];

  it("exports a centered line shortened by half the weight at each end", () => {
    expect(strokeD(lineDoc())).toBe("M5 0L95 0");
  });

  it("shortens side strokes the same way", () => {
    const d = lineDoc();
    expect(strokeD(setChainStyle(d, docChains(d), { side: "left" }))).toBe("M5 -5L95 -5");
    expect(strokeD(setChainStyle(d, docChains(d), { side: "right" }))).toBe("M5 5L95 5");
  });

  it("keeps square ends at full length", () => {
    const d = setArtDefaults(lineDoc(), { roundEnds: false });
    expect(exportSvg(d)).toContain('d="M0 0L100 0"');
  });
});
