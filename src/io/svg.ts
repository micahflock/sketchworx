import { toCubics } from "../geom/bezier";
import type { Box, Vec2 } from "../geom/vec";
import { boxAdd, boxValid, emptyBox } from "../geom/vec";
import type { Loop, Outline, Seg } from "../model/outline";
import { buildOutline, segPoints } from "../model/outline";
import { arcGeom, ptv } from "../model/sketch";
import type { Doc, Sketch } from "../model/types";

export interface SvgOptions {
  /** Which slots: the active one, or all laid out by advance width. */
  slots: "active" | "all";
  arcs: "arc" | "cubic";
  viewBox: "bounds" | "guides";
  /** Presentation export: also stroke construction geometry. */
  construction: boolean;
}

export const defaultSvgOptions: SvgOptions = { slots: "active", arcs: "arc", viewBox: "bounds", construction: false };

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

/** SVG path data for loops. Sketch space is y-up; SVG is y-down, so y is negated. */
export function loopsToPathData(loops: Loop[], arcs: "arc" | "cubic", dx = 0): string {
  const X = (p: Vec2) => n(p.x + dx);
  const Y = (p: Vec2) => n(-p.y);
  const parts: string[] = [];
  for (const l of loops) {
    if (!l.segs.length) continue;
    const d: string[] = [`M${X(l.segs[0].start)} ${Y(l.segs[0].start)}`];
    l.segs.forEach((s, i) => {
      const last = i === l.segs.length - 1;
      if (s.kind === "line") {
        if (!last) d.push(`L${X(s.end)} ${Y(s.end)}`);
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
    d.push("Z");
    parts.push(d.join(""));
  }
  return parts.join("");
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

/** Vertical metrics from the metric-guide variables, if present. */
export function guideMetrics(doc: Doc): { top: number; bottom: number } | null {
  const v = new Map(doc.variables.map((x) => [x.name, x.value]));
  const top = v.get("ascender") ?? v.get("capheight");
  const bottom = v.get("descender") ?? v.get("baseline");
  return top !== undefined && bottom !== undefined && top > bottom ? { top, bottom } : null;
}

export function exportSvg(doc: Doc, o: SvgOptions = defaultSvgOptions): string {
  const slots = o.slots === "all" ? doc.slots : [doc.slots[doc.activeSlot]];
  const paths: string[] = [];
  const box = emptyBox();
  let x = 0;
  for (const s of slots) {
    const outline = buildOutline(s);
    const ob = outlineBounds(outline);
    const dx = o.slots === "all" ? x : 0;
    const d = loopsToPathData(outline.loops, o.arcs, dx);
    const id = s.name.replace(/[^A-Za-z0-9_-]/g, "_") || s.id;
    paths.push(`  <path id="${id}" d="${d}" fill="#000" fill-rule="nonzero"/>`);
    if (o.construction) {
      const cd = constructionPath(s, dx);
      if (cd) paths.push(`  <path d="${cd}" fill="none" stroke="#3f6fd8" stroke-width="1" stroke-dasharray="8 3 2 3" vector-effect="non-scaling-stroke"/>`);
    }
    if (boxValid(ob)) {
      boxAdd(box, { x: ob.minX + dx, y: ob.minY });
      boxAdd(box, { x: ob.maxX + dx, y: ob.maxY });
    }
    x += s.advance;
  }
  let vb: { x: number; y: number; w: number; h: number };
  const metrics = o.viewBox === "guides" ? guideMetrics(doc) : null;
  if (metrics) {
    const w = o.slots === "all" ? x : slots[0].advance;
    vb = { x: 0, y: -metrics.top, w, h: metrics.top - metrics.bottom };
  } else if (boxValid(box)) {
    const m = Math.max(box.maxX - box.minX, box.maxY - box.minY) * 0.02;
    vb = { x: box.minX - m, y: -box.maxY - m, w: box.maxX - box.minX + 2 * m, h: box.maxY - box.minY + 2 * m };
  } else vb = { x: 0, y: 0, w: 100, h: 100 };
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(vb.x)} ${n(vb.y)} ${n(vb.w)} ${n(vb.h)}" width="${n(vb.w)}" height="${n(vb.h)}">`,
    ...paths,
    `</svg>`,
    "",
  ].join("\n");
}

/** Art view (black fills) of the active slot as a PNG of the given size. */
export async function exportPng(doc: Doc, size: number): Promise<Blob> {
  const s = doc.slots[doc.activeSlot];
  const outline = buildOutline(s);
  const b = outlineBounds(outline);
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, size, size);
  if (boxValid(b)) {
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const sc = (size * 0.9) / Math.max(w, h, 1e-9);
    const ox = (size - w * sc) / 2 - b.minX * sc;
    const oy = (size - h * sc) / 2 + b.maxY * sc;
    ctx.setTransform(sc, 0, 0, sc, ox, oy);
    ctx.fill(new Path2D(loopsToPathData(outline.loops, "arc")), "nonzero");
  }
  return new Promise((resolve, reject) => canvas.toBlob((bl) => (bl ? resolve(bl) : reject(new Error("PNG encode failed"))), "image/png"));
}
