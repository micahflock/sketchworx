import { bezierDeriv, bezierPoint } from "../geom/bezier";
import type { Vec2 } from "../geom/vec";
import { norm } from "../geom/vec";
import { relationGlyphs, relationHasGlyph } from "../model/relations";
import { arcGeom, ptv, splinePts } from "../model/sketch";
import type { Entity, Id, Sketch } from "../model/types";
import type { Painter } from "./painter";
import { theme } from "./theme";

export interface AnnotationHit {
  id: Id;
  kind: "relation" | "dimension";
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Screen anchor and tangent direction for placing glyphs beside an entity. */
function glyphAnchor(p: Painter, s: Sketch, e: Entity): { at: Vec2; dir: Vec2 } {
  switch (e.type) {
    case "point": {
      const q = p.s(e);
      return { at: { x: q.x + 12, y: q.y - 12 }, dir: { x: 1, y: 0 } };
    }
    case "line": {
      const a = p.s(ptv(s, e.p1));
      const b = p.s(ptv(s, e.p2));
      const d = norm({ x: b.x - a.x, y: b.y - a.y });
      let n = { x: -d.y, y: d.x };
      if (n.y > 0 || (Math.abs(n.y) < 1e-9 && n.x < 0)) n = { x: -n.x, y: -n.y }; // prefer above/right
      return { at: { x: (a.x + b.x) / 2 + n.x * 13, y: (a.y + b.y) / 2 + n.y * 13 }, dir: d.x < 0 ? { x: -d.x, y: -d.y } : d };
    }
    case "circle": {
      const c = ptv(s, e.c);
      const q = p.s({ x: c.x + e.r * Math.SQRT1_2, y: c.y + e.r * Math.SQRT1_2 });
      return { at: { x: q.x + 10, y: q.y - 10 }, dir: { x: 1, y: 0 } };
    }
    case "arc": {
      const g = arcGeom(s, e);
      let sw = g.a1 - g.a0;
      while (sw <= 0) sw += Math.PI * 2;
      const m = g.a0 + sw / 2;
      const q = p.s({ x: g.c.x + (g.r) * Math.cos(m), y: g.c.y + g.r * Math.sin(m) });
      return { at: { x: q.x + Math.cos(m) * 12, y: q.y - Math.sin(m) * 12 }, dir: { x: -Math.sin(m), y: -Math.cos(m) } };
    }
    case "spline": {
      const cps = splinePts(s, e);
      const q = p.s(bezierPoint(cps, 0.5));
      const d0 = bezierDeriv(cps, 0.5);
      const d = norm({ x: d0.x, y: -d0.y });
      return { at: { x: q.x - d.y * 13, y: q.y + d.x * 13 }, dir: d };
    }
  }
}

/** Draw relation glyphs; returns their hit rectangles. */
export function drawRelationGlyphs(p: Painter, s: Sketch, conflicts: Set<Id>, hover: Id | null, selection: Set<Id>): AnnotationHit[] {
  const hits: AnnotationHit[] = [];
  const count = new Map<Id, number>();
  for (const r of Object.values(s.relations)) {
    if (!relationHasGlyph(s, r)) continue;
    const bad = conflicts.has(r.id);
    const hot = hover === r.id || selection.has(r.id);
    // SolidWorks draws the glyph next to each related entity. Point-on-curve shows it at the point.
    const targets =
      r.type === "coincident" || r.type === "midpoint"
        ? r.refs.filter((id) => s.entities[id]?.type === "point")
        : r.type === "symmetric"
          ? r.refs.slice(0, 2) // not on the centerline
          : r.type === "onEdge"
            ? r.refs.slice(1) // on the converted copy only
            : r.refs;
    for (const id of targets) {
      const e = s.entities[id];
      if (!e || s.ext?.[id]?.hidden) continue;
      const k = count.get(id) ?? 0;
      count.set(id, k + 1);
      const { at, dir } = glyphAnchor(p, s, e);
      const x = at.x + dir.x * k * 18;
      const y = at.y + dir.y * k * 18;
      const bg = bad ? theme.relGlyphConflict : hot ? theme.relGlyphHotBg : theme.relGlyphBg;
      const fg = bad ? theme.relGlyphConflictFg : hot ? theme.relGlyphHotFg : theme.relGlyphFg;
      const rect = p.badge(relationGlyphs[r.type], x, y, bg, fg, bad ? theme.relGlyphConflictBorder : hot ? theme.hover : theme.relGlyphBorder);
      hits.push({ id: r.id, kind: "relation", ...rect });
    }
  }
  return hits;
}

export function hitAnnotations(hits: AnnotationHit[], q: Vec2, pad = 2): AnnotationHit | null {
  for (let i = hits.length - 1; i >= 0; i--) {
    const h = hits[i];
    if (q.x >= h.x - pad && q.x <= h.x + h.w + pad && q.y >= h.y - pad && q.y <= h.y + h.h + pad) return h;
  }
  return null;
}
