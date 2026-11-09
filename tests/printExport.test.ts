import { describe, expect, it } from "vitest";
import { Clipper, FillRule } from "@countertype/clipper2-ts";
import type { Paths64 } from "@countertype/clipper2-ts";
import { badgeSample } from "../src/io/samples";
import { crc32, printFiles, zip } from "../src/io/printExport";
import { chainOf, docChains, setChainStyle } from "../src/model/art";
import { enablePrint } from "../src/model/print";
import { SCALE } from "../src/model/regions";
import type { Doc } from "../src/model/types";

function badge(): Doc {
  const doc = badgeSample();
  const on = enablePrint(doc, { background: "#ffffff", colors: docChains(doc).map(() => "#000000").concat("#dc2828") });
  if ("error" in on) throw new Error(on.error);
  return on.doc;
}

/** Read our DXF back: closed polylines (arcs sampled finely) and circles, as Clipper paths. */
function readDxf(text: string): { paths: Paths64; circles: number; polylines: number } {
  const t = text.split("\n");
  const paths: Paths64 = [];
  let circles = 0;
  let polylines = 0;
  let cur: { x: number; y: number; b: number }[] | null = null;
  const S = SCALE;
  const close = () => {
    if (!cur) return;
    const pts: { x: number; y: number }[] = [];
    cur.forEach((a, i) => {
      const b = cur![(i + 1) % cur!.length];
      pts.push({ x: a.x, y: a.y });
      if (!a.b) return;
      const sweep = 4 * Math.atan(a.b);
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
      // Center: left of the chord for a CCW (positive) bulge.
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const h = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2)) * (Math.abs(sweep) > Math.PI ? -1 : 1);
      const nx = -(b.y - a.y) / chord, ny = (b.x - a.x) / chord;
      const s = Math.sign(sweep);
      const cx = mx + nx * h * s, cy = my + ny * h * s;
      const a0 = Math.atan2(a.y - cy, a.x - cx);
      const k = 64;
      for (let j = 1; j < k; j++) pts.push({ x: cx + r * Math.cos(a0 + (sweep * j) / k), y: cy + r * Math.sin(a0 + (sweep * j) / k) });
    });
    paths.push(pts.map((p) => ({ x: Math.round(p.x * S), y: Math.round(p.y * S) })));
    cur = null;
  };
  for (let i = 0; i < t.length - 1; i += 2) {
    const code = t[i].trim();
    const v = t[i + 1].trim();
    if (code === "0") {
      if (v === "SEQEND") close();
      if (v === "POLYLINE") (cur = []), polylines++;
      if (v === "VERTEX") cur!.push({ x: 0, y: 0, b: 0 });
      if (v === "CIRCLE") {
        circles++;
        let cx = 0, cy = 0, r = 0;
        for (let j = i + 2; j < t.length - 1 && t[j].trim() !== "0"; j += 2) {
          const c = t[j].trim();
          const n = Number(t[j + 1]);
          if (c === "10") cx = n;
          if (c === "20") cy = n;
          if (c === "40") r = n;
        }
        const k = 720;
        paths.push(Array.from({ length: k }, (_, j) => ({ x: Math.round((cx + r * Math.cos((2 * Math.PI * j) / k)) * S), y: Math.round((cy + r * Math.sin((2 * Math.PI * j) / k)) * S) })));
      }
    } else if (cur && cur.length) {
      const last = cur[cur.length - 1];
      if (code === "10") last.x = Number(v);
      if (code === "20") last.y = Number(v);
      if (code === "42") last.b = Number(v);
    }
  }
  return { paths, circles, polylines };
}

const area = (p: Paths64) => Clipper.areaPaths(Clipper.union(p, FillRule.EvenOdd)) / (SCALE * SCALE);
const evenOdd = (p: Paths64) => Clipper.union(p, FillRule.EvenOdd);

describe("print export", () => {
  it("writes one DXF and SVG per filament, an outline and a README", () => {
    const r = printFiles(badge(), "badge");
    if ("error" in r) throw new Error(r.error);
    expect(r.files.map((f) => f.name)).toEqual([
      "badge-F1-White.dxf",
      "badge-F1-White.svg",
      "badge-F2-Black.dxf",
      "badge-F2-Black.svg",
      "badge-F3-Red.dxf",
      "badge-F3-Red.svg",
      "badge-outline.dxf",
      "README.txt",
    ]);
    const readme = r.files.find((f) => f.name === "README.txt")!.text;
    expect(readme).toMatch(/slot = PrusaSlicer extruder number/);
    const dx = r.files[0].text;
    expect(dx).toMatch(/\$INSUNITS\n70\n4/);
  });

  it("the colors tile the part exactly: no overlap, no gap", () => {
    const r = printFiles(badge(), "badge");
    if ("error" in r) throw new Error(r.error);
    const get = (n: string) => readDxf(r.files.find((f) => f.name === n)!.text);
    const white = evenOdd(get("badge-F1-White.dxf").paths);
    const black = evenOdd(get("badge-F2-Black.dxf").paths);
    const red = evenOdd(get("badge-F3-Red.dxf").paths);
    const outline = evenOdd(get("badge-outline.dxf").paths);
    expect(area(outline)).toBeCloseTo(40 * 24, 3);
    const all = Clipper.union([...white, ...black, ...red], FillRule.NonZero);
    expect(Clipper.areaPaths(all) / SCALE ** 2).toBeCloseTo(40 * 24, 2);
    for (const [a, b] of [
      [white, black],
      [white, red],
      [black, red],
    ])
      expect(Clipper.areaPaths(Clipper.intersect(a, b, FillRule.NonZero)) / SCALE ** 2).toBeLessThan(0.001);
    // The red disc is one circle; the black file has curves as arcs, not dozens of tiny lines.
    expect(get("badge-F3-Red.dxf").circles).toBe(1);
    expect(get("badge-F3-Red.dxf").polylines).toBe(0);
    const blackText = r.files.find((f) => f.name === "badge-F2-Black.dxf")!.text;
    expect((blackText.match(/VERTEX/g) ?? []).length).toBeLessThan(40);
  });

  it("is blocked while something is too thin", () => {
    let doc = badge();
    const bar = docChains(doc).find((c) => !c.closed)!;
    // Move a bar's stroke to 2 lines and the disc's edge… simplest: shrink the part outline stroke into a thin band.
    doc = setChainStyle(doc, [chainOf(docChains(doc), bar.key)!], { weight: 0.9 });
    const thin = { ...doc, print: { ...doc.print!, printer: { ...doc.print!.printer, minFeatureLines: 20 } } };
    const r = printFiles(thin, "badge");
    expect("error" in r && r.error).toMatch(/Fix the \d+ issues? in Print view first/);
  });

  it("zips the files", () => {
    expect(crc32(new TextEncoder().encode("hello"))).toBe(0x3610a686);
    const z = zip([{ name: "a.txt", text: "hello" }]);
    expect(new DataView(z.buffer).getUint32(0, true)).toBe(0x04034b50);
    expect(z.length).toBe(30 + 5 + 5 + 46 + 5 + 22);
  });
});
