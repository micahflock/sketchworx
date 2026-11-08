import { arcGeom, ptv, splinePts } from "../model/sketch";
import type { Entity, Id, Sketch } from "../model/types";
import type { EntityState, SketchStatus } from "../solver/types";
import { Painter } from "./painter";
import type { StrokeStyle } from "./painter";
import { theme } from "./theme";
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
  if ((x1 - x0) * (y1 - y0) > 40000) return;
  ctx.fillStyle = theme.gridDot;
  for (let i = x0; i <= x1; i++)
    for (let j = y0; j <= y1; j++) {
      const s = view.toScreen({ x: i * step, y: j * step });
      const major = i % 5 === 0 && j % 5 === 0;
      const r = major ? 1.4 : 0.9;
      ctx.fillRect(s.x - r, s.y - r, r * 2, r * 2);
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

export function strokeFor(e: Entity, opts: SceneOptions, s?: Sketch): StrokeStyle {
  const color = entityColor(e.id, opts, s);
  const emph = opts.selection.has(e.id) || opts.hover === e.id;
  if (e.type === "line" && e.owner) return { color, width: emph ? 2 : 0.9, dash: [4, 3] }; // spline control polygon
  if (e.type === "spline" && e.derived) return { color: emph || opts.muted ? color : theme.derived, width: emph ? 2.5 : 1.6 };
  return {
    color,
    width: emph ? 2.5 : 1.6,
    dash: e.construction ? [8, 3, 2, 3] : undefined,
  };
}

export function drawEntity(p: Painter, s: Sketch, e: Entity, st: StrokeStyle) {
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
      p.bezier(splinePts(s, e), { ...st, dash: e.construction ? st.dash : undefined });
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
        c.fillStyle = theme.handleFill;
        c.strokeStyle = color;
        c.lineWidth = 1.3;
        c.setLineDash([]);
        c.beginPath();
        c.rect(P.x - r, P.y - r, r * 2, r * 2);
        c.fill();
        c.stroke();
      } else {
        p.dot(e, emph ? 4 : 2.6, color);
      }
    } else {
      p.dot(e, emph ? 4.5 : 3.2, color);
      p.ring(e, emph ? 6.5 : 5, color, 1);
    }
  }
}
