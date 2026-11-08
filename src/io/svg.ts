import { toCubics } from "../geom/bezier";
import type { Box, Vec2 } from "../geom/vec";
import { boxAdd, boxValid, emptyBox } from "../geom/vec";
import type { Loop, Outline, Seg } from "../model/outline";
import { docOutline, segPoints } from "../model/outline";
import { arcGeom, ptv } from "../model/sketch";
import type { Doc, Sketch } from "../model/types";
import { artBackground, artScene, DEFAULT_ART_BACKGROUND, MITER_LIMIT } from "../model/art";
import { paintArt } from "../render/artPaint";

export interface SvgOptions {
  arcs: "arc" | "cubic";
  /** Presentation export: also stroke construction geometry. */
  construction: boolean;
  /** As in Art view (stroked chains with their weights, filled profiles); otherwise every closed loop filled. */
  art?: boolean;
}

export const defaultSvgOptions: SvgOptions = { arcs: "arc", construction: false, art: true };

const n = (v: number) => {
  const r = Math.round(v * 10000) / 10000;
  return (Object.is(r, -0) ? 0 : r).toString();
};

/** Cubic pieces (≤ 90° each) approximating a circular arc. */
export function arcToCubics(c: Vec2, r: number, a0: number, sweep: number): Vec2[][] {
  const parts = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
  const d = sweep / parts;
  const k = (4 / 3) * Math.tan(d / 4);
  const out: Vec2[][] = [];
  for (let i = 0; i < parts; i++) {
    const t0 = a0 + d * i;
    const t1 = t0 + d;
    const p0 = { x: c.x + r * Math.cos(t0), y: c.y + r * Math.sin(t0) };
    const p3 = { x: c.x + r * Math.cos(t1), y: c.y + r * Math.sin(t1) };
    const p1 = { x: p0.x - k * r * Math.sin(t0), y: p0.y + k * r * Math.cos(t0) };
    const p2 = { x: p3.x + k * r * Math.sin(t1), y: p3.y - k * r * Math.cos(t1) };
    out.push([p0, p1, p2, p3]);
  }
  return out;
}

/** SVG path data for one chain. Sketch space is y-up; SVG is y-down, so y is negated. */
export function segsToPathData(segs: Seg[], closed: boolean, arcs: "arc" | "cubic", dx = 0): string {
  if (!segs.length) return "";
  const X = (p: Vec2) => n(p.x + dx);
  const Y = (p: Vec2) => n(-p.y);
  const d: string[] = [`M${X(segs[0].start)} ${Y(segs[0].start)}`];
  segs.forEach((s, i) => {
    const last = i === segs.length - 1;
    if (s.kind === "line") {
      if (!last || !closed) d.push(`L${X(s.end)} ${Y(s.end)}`);
    } else if (s.kind === "arc") {
      if (arcs === "arc") {
        const large = Math.abs(s.sweep) > Math.PI + 1e-12 ? 1 : 0;
        // CCW in y-up becomes the negative-angle direction after the y flip.
        const sweepFlag = s.sweep > 0 ? 0 : 1;
        const r = n(s.r);
        if (Math.abs(Math.abs(s.sweep) - 2 * Math.PI) < 1e-9) {
          const mid = { x: s.c.x + s.r * Math.cos(s.a0 + s.sweep / 2), y: s.c.y + s.r * Math.sin(s.a0 + s.sweep / 2) };
          d.push(`A${r} ${r} 0 0 ${sweepFlag} ${X(mid)} ${Y(mid)}`);
        }
        d.push(`A${r} ${r} 0 ${large} ${sweepFlag} ${X(s.end)} ${Y(s.end)}`);
      } else for (const c of arcToCubics(s.c, s.r, s.a0, s.sweep)) d.push(`C${X(c[1])} ${Y(c[1])} ${X(c[2])} ${Y(c[2])} ${X(c[3])} ${Y(c[3])}`);
    } else d.push(`C${X(s.c1)} ${Y(s.c1)} ${X(s.c2)} ${Y(s.c2)} ${X(s.end)} ${Y(s.end)}`);
  });
  if (closed) d.push("Z");
  return d.join("");
}

/** SVG path data for closed loops. */
export function loopsToPathData(loops: Loop[], arcs: "arc" | "cubic", dx = 0): string {
  return loops.map((l) => segsToPathData(l.segs, true, arcs, dx)).join("");
}

function polylineData(pts: Vec2[], closed: boolean): string {
  return pts.map((p, i) => `${i ? "L" : "M"}${n(p.x)} ${n(-p.y)}`).join("") + (closed ? "Z" : "");
}

/** Stroked path data for construction geometry (presentation export). */
function constructionPath(s: Sketch, dx: number): string {
  const d: string[] = [];
  const X = (p: Vec2) => n(p.x + dx);
  const Y = (p: Vec2) => n(-p.y);
  for (const e of Object.values(s.entities)) {
    if (!e.construction) continue;
    if (e.type === "line" && !e.owner) {
      const a = ptv(s, e.p1);
      const b = ptv(s, e.p2);
      d.push(`M${X(a)} ${Y(a)}L${X(b)} ${Y(b)}`);
    } else if (e.type === "circle") {
      const c = ptv(s, e.c);
      d.push(`M${X({ x: c.x + e.r, y: c.y })} ${Y(c)}A${n(e.r)} ${n(e.r)} 0 1 0 ${X({ x: c.x - e.r, y: c.y })} ${Y(c)}A${n(e.r)} ${n(e.r)} 0 1 0 ${X({ x: c.x + e.r, y: c.y })} ${Y(c)}`);
    } else if (e.type === "arc") {
      const g = arcGeom(s, e);
      let sw = g.a1 - g.a0;
      while (sw <= 0) sw += Math.PI * 2;
      const end = { x: g.c.x + g.r * Math.cos(g.a1), y: g.c.y + g.r * Math.sin(g.a1) };
      d.push(`M${X(g.p0)} ${Y(g.p0)}A${n(g.r)} ${n(g.r)} 0 ${sw > Math.PI ? 1 : 0} 0 ${X(end)} ${Y(end)}`);
    } else if (e.type === "spline") {
      for (const c of toCubics(e.cps.map((id) => ptv(s, id)))) d.push(`M${X(c[0])} ${Y(c[0])}C${X(c[1])} ${Y(c[1])} ${X(c[2])} ${Y(c[2])} ${X(c[3])} ${Y(c[3])}`);
    }
  }
  return d.join("");
}

export function outlineBounds(o: Outline): Box {
  const b = emptyBox();
  for (const l of o.loops) for (const s of l.segs) for (const p of segPoints(s as Seg, 12)) boxAdd(b, p);
  return b;
}

function viewBoxOf(box: Box, pad = 0.02) {
  if (!boxValid(box)) return { x: 0, y: 0, w: 100, h: 100 };
  const m = Math.max(box.maxX - box.minX, box.maxY - box.minY) * pad;
  return { x: box.minX - m, y: -box.maxY - m, w: box.maxX - box.minX + 2 * m, h: box.maxY - box.minY + 2 * m };
}

/** Art view as SVG elements: a filled path per filled profile (holes cut out), then one path per chain. */
function artElements(doc: Doc, arcs: "arc" | "cubic"): { paths: string[]; box: Box } {
  const box0 = artScene(doc, 1).bounds;
  const size = boxValid(box0) ? Math.max(box0.maxX - box0.minX, box0.maxY - box0.minY) : 100;
  const scene = artScene(doc, size * 2e-4);
  const paths: string[] = [];
  const styleOf = new Map(scene.strokes.map((s) => [s.chain.key, s.style]));
  for (const f of scene.fills) {
    // Under an outside stroke, a hairline in the fill color closes the anti-aliasing seam at the edge.
    const st = styleOf.get(f.chain.key);
    const seam = st && st.side === "right" && st.weight > 0 ? ` stroke="${f.color}" stroke-width="1.5" vector-effect="non-scaling-stroke"` : "";
    paths.push(`  <path d="${loopsToPathData(f.loops, arcs)}" fill="${f.color}" fill-rule="nonzero"${seam}/>`);
  }
  for (const s of scene.strokes) {
    if (s.style.weight <= 0) continue;
    const d = s.segs ? segsToPathData(s.segs, s.chain.closed, arcs) : polylineData(s.path, s.chain.closed);
    const ends = s.cap === "round" ? ' stroke-linecap="round"' : "";
    const join = s.join === "round" ? ' stroke-linejoin="round"' : ` stroke-linejoin="miter" stroke-miterlimit="${MITER_LIMIT}"`;
    paths.push(`  <path d="${d}" fill="none" stroke="${s.style.color}" stroke-width="${n(s.style.weight)}"${join}${ends}/>`);
  }
  return { paths, box: scene.bounds };
}

/** The sketch as SVG: Art view styling, or (art off) every closed loop filled as one nonzero path. */
export function exportSvg(doc: Doc, o: SvgOptions = defaultSvgOptions): string {
  let paths: string[];
  let box: Box;
  if (o.art) ({ paths, box } = artElements(doc, o.arcs));
  else {
    const outline = docOutline(doc);
    box = outlineBounds(outline);
    paths = [`  <path d="${loopsToPathData(outline.loops, o.arcs)}" fill="#000" fill-rule="nonzero"/>`];
  }
  if (o.construction) {
    const cd = doc.features
      .filter((f) => f.visible)
      .map((f) => constructionPath(f.sketch, 0))
      .join("");
    if (cd) paths.push(`  <path d="${cd}" fill="none" stroke="#3f6fd8" stroke-width="1" stroke-dasharray="8 3 2 3" vector-effect="non-scaling-stroke"/>`);
  }
  const vb = viewBoxOf(box);
  // A background other than white is written as a rectangle under the drawing (white stays transparent).
  const bg = o.art ? artBackground(doc) : DEFAULT_ART_BACKGROUND;
  if (bg !== DEFAULT_ART_BACKGROUND) paths.unshift(`  <rect x="${n(vb.x)}" y="${n(vb.y)}" width="${n(vb.w)}" height="${n(vb.h)}" fill="${bg}"/>`);
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" width="${n(vb.w)}" height="${n(vb.h)}">`,
    ...paths,
    `</svg>`,
    "",
  ].join("\n");
}

/** Art view of the document as a PNG of the given size. */
export async function exportPng(doc: Doc, size: number): Promise<Blob> {
  const b = artScene(doc, 1).bounds;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = artBackground(doc);
  ctx.fillRect(0, 0, size, size);
  if (boxValid(b)) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const sc = (size * 0.9) / Math.max(w, h, 1e-9);
    const ox = (size - w * sc) / 2 - b.minX * sc;
    const oy = (size - h * sc) / 2 + b.maxY * sc;
    paintArt(ctx, artScene(doc, 0.3 / sc), { k: sc, ox, oy, unit: 1 / sc });
  }
  return new Promise((resolve, reject) => canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error("PNG encode failed"))), "image/png"));
}
