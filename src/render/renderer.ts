import { bezierPolyline } from "../geom/bezier";
import type { Vec2 } from "../geom/vec";
import { polar } from "../geom/vec";
import { arcGeom, ptv, splinePts } from "../model/sketch";
import type { Entity, Id, Sketch } from "../model/types";
import type { EntityState, SketchStatus } from "../solver/types";
import { Painter } from "./painter";
import type { StrokeStyle } from "./painter";
import { theme } from "./theme";
import type { StateStyle } from "./theme";
import type { View } from "./view";

export interface SceneOptions {
  selection: Set<Id>;
  hover: Id | null;
  status: SketchStatus;
  showGrid: boolean;
  /** Ids highlighted because a related glyph/relation is hovered. */
  related?: Set<Id>;
  /** Draw everything in one faded color (sketches below the active one: visible, not pickable). */
  muted?: boolean;
}

export function gridStep(view: View): number {
  const minPx = 18;
  let step = Math.pow(10, Math.ceil(Math.log10(minPx / view.scale)));
  if (step * view.scale / 5 >= minPx) step /= 5;
  else if (step * view.scale / 2 >= minPx) step /= 2;
  return step;
}

export function drawGrid(p: Painter) {
  const { ctx, view } = p;
  const step = gridStep(view);
  const b = view.visibleBox();
  const x0 = Math.floor(b.minX / step);
  const x1 = Math.ceil(b.maxX / step);
  const y0 = Math.floor(b.minY / step);
  const y1 = Math.ceil(b.maxY / step);
  if (theme.gridStyle === "lines") {
    // Graticule: minor lines every step, major every fifth, snapped to device pixels for crisp hairlines.
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    const pass = (major: boolean, color: string) => {
      if (color === "transparent") return;
      ctx.beginPath();
      for (let i = x0; i <= x1; i++) {
        if ((i % 5 === 0) !== major) continue;
        const x = Math.round(view.toScreen({ x: i * step, y: 0 }).x) + 0.5;
        ctx.moveTo(x, 0);
        ctx.lineTo(x, view.height);
      }
      for (let j = y0; j <= y1; j++) {
        if ((j % 5 === 0) !== major) continue;
        const y = Math.round(view.toScreen({ x: 0, y: j * step }).y) + 0.5;
        ctx.moveTo(0, y);
        ctx.lineTo(view.width, y);
      }
      ctx.strokeStyle = color;
      ctx.stroke();
    };
    pass(false, theme.gridMinor);
    pass(true, theme.gridMajor);
  } else if ((x1 - x0) * (y1 - y0) <= 40000) {
    for (let i = x0; i <= x1; i++)
      for (let j = y0; j <= y1; j++) {
        const s = view.toScreen({ x: i * step, y: j * step });
        const major = i % 5 === 0 && j % 5 === 0;
        const r = major ? 1.3 : 1;
        ctx.fillStyle = major ? theme.gridMajor : theme.gridMinor;
        ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
      }
  }
  // Origin marker (SolidWorks shows a red origin arrow pair).
  const o = view.toScreen({ x: 0, y: 0 });
  ctx.setLineDash([]);
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = theme.origin;
  ctx.beginPath();
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x + 22, o.y);
  ctx.moveTo(o.x, o.y);
  ctx.lineTo(o.x, o.y - 22);
  ctx.stroke();
  ctx.fillStyle = theme.origin;
  ctx.beginPath();
  ctx.moveTo(o.x + 26, o.y);
  ctx.lineTo(o.x + 20, o.y - 3);
  ctx.lineTo(o.x + 20, o.y + 3);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(o.x, o.y - 26);
  ctx.lineTo(o.x - 3, o.y - 20);
  ctx.lineTo(o.x + 3, o.y - 20);
  ctx.fill();
}

export function entityColor(id: Id, opts: SceneOptions, s?: Sketch): string {
  if (opts.muted) return theme.later;
  if (opts.selection.has(id)) return theme.selected;
  if (opts.hover === id || opts.related?.has(id)) return theme.hover;
  if (s?.ext?.[id]) return theme.reference; // geometry of an earlier sketch
  const st: EntityState = opts.status.entity[id] ?? "under";
  return theme.state[st];
}

/** Line-shape traits of an entity's constraint state (HELL MODE); none for faded or other sketches' geometry. */
export function shapeFor(id: Id, opts: SceneOptions, s?: Sketch): StateStyle {
  if (opts.muted || s?.ext?.[id]) return {};
  return theme.stateStyle[opts.status.entity[id] ?? "under"] ?? {};
}

export function strokeFor(e: Entity, opts: SceneOptions, s?: Sketch): StrokeStyle {
  const color = entityColor(e.id, opts, s);
  const emph = opts.selection.has(e.id) || opts.hover === e.id;
  const width = emph ? theme.emphWidth : theme.lineWidth;
  if (e.type === "line" && e.owner) return { color, width: emph ? 2 : 0.9, dash: [4, 3] }; // spline control polygon
  if (e.type === "spline" && e.derived) return { color: emph || opts.muted ? color : theme.derived, width };
  const shape = shapeFor(e.id, opts, s);
  return {
    color,
    width,
    dash: e.construction ? [8, 3, 2, 3] : shape.dash,
    jagged: shape.jagged,
  };
}

/** Screen-dense samples of a curve, for zigzag strokes. */
function curveSamples(p: Painter, s: Sketch, e: Entity): Vec2[] {
  const along = (r: number, sweep: number) => Math.max(12, Math.min(720, Math.ceil((r * p.view.scale * sweep) / 6)));
  switch (e.type) {
    case "line":
      return [ptv(s, e.p1), ptv(s, e.p2)];
    case "circle": {
      const c = ptv(s, e.c);
      const n = along(e.r, Math.PI * 2);
      return Array.from({ length: n + 1 }, (_, i) => polar(c, e.r, (i / n) * Math.PI * 2));
    }
    case "arc": {
      const g = arcGeom(s, e);
      let sweep = g.a1 - g.a0;
      while (sweep <= 0) sweep += Math.PI * 2;
      const n = along(g.r, sweep);
      return Array.from({ length: n + 1 }, (_, i) => polar(g.c, g.r, g.a0 + (sweep * i) / n));
    }
    case "spline":
      return bezierPolyline(splinePts(s, e), 96);
    case "point":
      return [];
  }
}

export function drawEntity(p: Painter, s: Sketch, e: Entity, st: StrokeStyle) {
  if (st.jagged && e.type !== "point") return p.zigzag(curveSamples(p, s, e), st);
  switch (e.type) {
    case "line":
      p.line(ptv(s, e.p1), ptv(s, e.p2), st);
      break;
    case "circle":
      p.circle(ptv(s, e.c), e.r, st);
      break;
    case "arc": {
      const g = arcGeom(s, e);
      p.arc(g.c, g.r, g.a0, g.a1, st);
      break;
    }
    case "spline": {
      // The control polygon is drawn by its side lines.
      p.bezier(splinePts(s, e), st);
      break;
    }
    case "point":
      break;
  }
}

/** Draw all sketch geometry (curves, then points on top). */
export function drawSketch(p: Painter, s: Sketch, opts: SceneOptions) {
  const ents = Object.values(s.entities).filter((e) => !s.ext?.[e.id]?.hidden);
  for (const e of ents) if (e.type !== "point") drawEntity(p, s, e, strokeFor(e, opts, s));
  for (const e of ents) {
    if (e.type !== "point") continue;
    if (opts.muted && e.id === "origin") continue;
    const color = entityColor(e.id, opts, s);
    const emph = opts.selection.has(e.id) || opts.hover === e.id;
    // Endpoints of other sketches' curves only show when picked, to keep the view quiet.
    if (e.owner && (opts.muted || s.ext?.[e.id]) && !emph && !opts.related?.has(e.id)) continue;
    if (e.id === "origin") {
      if (emph || opts.related?.has(e.id)) p.ring(e, 6, color, 2);
      continue;
    }
    if (e.owner) {
      const owner = s.entities[e.owner];
      // Centers of arcs/circles drawn as small crosses, endpoints as dots.
      if (owner && (owner.type === "circle" || owner.type === "arc") && owner.c === e.id) {
        const P = p.s(e);
        const c = p.ctx;
        c.strokeStyle = color;
        c.lineWidth = emph ? 2 : 1.2;
        c.setLineDash([]);
        c.beginPath();
        c.moveTo(P.x - 4, P.y);
        c.lineTo(P.x + 4, P.y);
        c.moveTo(P.x, P.y - 4);
        c.lineTo(P.x, P.y + 4);
        c.stroke();
        if (emph) p.ring(e, 5, color);
      } else if (owner && owner.type === "spline" && owner.derived) {
        if (emph) p.dot(e, 3, color);
      } else if (owner && owner.type === "spline") {
        const P = p.s(e);
        const c = p.ctx;
        const r = emph ? 4.5 : 3.5;
        c.fillStyle = shapeFor(e.id, opts, s).solidHandles ? color : theme.handleFill;
        c.strokeStyle = color;
        c.lineWidth = 1.3;
        c.setLineDash([]);
        c.beginPath();
        c.rect(P.x - r, P.y - r, r * 2, r * 2);
        c.fill();
        c.stroke();
      } else if (shapeFor(e.id, opts, s).crossPoints) {
        const P = p.s(e);
        p.crossScreen(P.x, P.y, emph ? 10 : 8, color, emph ? 2.5 : 2);
      } else if (shapeFor(e.id, opts, s).hollow) {
        p.dot(e, emph ? 4 : 3, theme.bg);
        p.ring(e, emph ? 4 : 3, color, 1.3);
      } else {
        p.dot(e, emph ? 4 : 2.6, color);
      }
    } else if (shapeFor(e.id, opts, s).crossPoints) {
      const P = p.s(e);
      p.crossScreen(P.x, P.y, emph ? 11 : 9, color, emph ? 2.5 : 2);
    } else {
      if (shapeFor(e.id, opts, s).hollow) {
        p.dot(e, emph ? 4.5 : 3.2, theme.bg);
        p.ring(e, emph ? 4.5 : 3.2, color, 1.3);
      } else p.dot(e, emph ? 4.5 : 3.2, color);
      p.ring(e, emph ? 6.5 : 5, color, 1);
    }
  }
}
