import type { Vec2 } from "../geom/vec";
import { add, cross, dist, dot, norm, perp, projectParam, scale, sub } from "../geom/vec";
import { angleRefs, dimAnchor, dimPrefix, distancePointIds, lineIntersection, measure, offsetGeom, pointLineRefs } from "../model/dimensions";
import { isExpression } from "../model/expr";
import { arcGeom, ptv } from "../model/sketch";
import type { Dimension, Id, Sketch } from "../model/types";
import { fmt } from "../tools/line";
import type { AnnotationHit } from "./annotations";
import type { Painter } from "./painter";
import { theme } from "./theme";

const ARROW = 9;

function arrowHead(p: Painter, tip: Vec2, dirScreen: Vec2, color: string) {
  const c = p.ctx;
  const d = norm(dirScreen);
  const n = perp(d);
  const T = p.s(tip);
  c.beginPath();
  c.moveTo(T.x, T.y);
  c.lineTo(T.x - d.x * ARROW + n.x * 3, T.y - d.y * ARROW + n.y * 3);
  c.lineTo(T.x - d.x * ARROW - n.x * 3, T.y - d.y * ARROW - n.y * 3);
  c.closePath();
  c.fillStyle = color;
  c.fill();
}

/** Screen-space direction of a world vector (y flipped). */
const sdir = (v: Vec2): Vec2 => ({ x: v.x, y: -v.y });

/** Dimension line between a and b (world) with arrows pointing outward to a and b. */
function dimLine(p: Painter, a: Vec2, b: Vec2, color: string) {
  p.line(a, b, { color, width: 1 });
  arrowHead(p, a, sdir(sub(a, b)), color);
  arrowHead(p, b, sdir(sub(b, a)), color);
}

export function dimText(d: Dimension, value: number) {
  const unit = d.type === "angle" ? "°" : "";
  const v = fmt(Math.abs(value)) + unit;
  const base = dimPrefix(d) + v;
  if (d.driven) return `(${base})`;
  return isExpression(d.expr) ? `Σ ${base}` : base;
}

function label(p: Painter, text: string, at: Vec2, color: string, hot: boolean): { x: number; y: number; w: number; h: number } {
  const c = p.ctx;
  const S = p.s(at);
  c.font = "12px system-ui, sans-serif";
  const w = c.measureText(text).width + 8;
  const h = 17;
  c.fillStyle = hot ? "#fff3df" : "rgba(244,246,249,0.92)";
  c.fillRect(S.x - w / 2, S.y - h / 2, w, h);
  if (hot) {
    c.strokeStyle = theme.hover;
    c.lineWidth = 1;
    c.setLineDash([]);
    c.strokeRect(S.x - w / 2, S.y - h / 2, w, h);
  }
  p.textScreen(text, S.x, S.y + 0.5, color, "12px system-ui, sans-serif");
  return { x: S.x - w / 2, y: S.y - h / 2, w, h };
}

/** Draw one dimension at its label position (anchor + offset, or an override for previews). */
export function drawDimension(p: Painter, s: Sketch, d: Dimension, color: string, hot: boolean, labelOverride?: Vec2) {
  const value = d.driven ? measure(s, d) : d.value;
  const L = labelOverride ?? add(dimAnchor(s, d), d.label);
  const ext = { color, width: 0.8 };
  const gap = p.view.px(3);
  const over = p.view.px(6);
  switch (d.type) {
    case "distance":
    case "distanceX":
    case "distanceY": {
      const ids = distancePointIds(s, d);
      if (!ids) return null;
      const a = ptv(s, ids[0]);
      const b = ptv(s, ids[1]);
      let dir: Vec2;
      if (d.type === "distanceX") dir = { x: 1, y: 0 };
      else if (d.type === "distanceY") dir = { x: 0, y: 1 };
      else dir = dist(a, b) > 1e-12 ? norm(sub(b, a)) : { x: 1, y: 0 };
      const n = perp(dir);
      // Project both points onto the dimension line through L.
      const off = (q: Vec2) => dot(sub(L, q), n);
      const A = add(a, scale(n, off(a)));
      const B = add(b, scale(n, off(b)));
      for (const [q, Q] of [
        [a, A],
        [b, B],
      ] as const) {
        const o = off(q);
        if (Math.abs(o) > gap) p.line(add(q, scale(n, Math.sign(o) * gap)), add(Q, scale(n, Math.sign(o) * over)), ext);
      }
      dimLine(p, A, B, color);
      // Extend the dimension line to the label when it sits outside.
      const t = projectParam(L, A, B);
      if (t < 0) p.line(A, L, { color, width: 1 });
      if (t > 1) p.line(B, L, { color, width: 1 });
      return label(p, dimText(d, value), L, color, hot);
    }
    case "pointLine": {
      const r = pointLineRefs(s, d);
      if (!r) return null;
      const P = ptv(s, r.p);
      const a = ptv(s, r.a);
      const b = ptv(s, r.b);
      const dir = norm(sub(b, a));
      const t = projectParam(P, a, b);
      const F = add(a, scale(sub(b, a), t));
      const shift = dot(sub(L, F), dir);
      const P2 = add(P, scale(dir, shift));
      const F2 = add(F, scale(dir, shift));
      if (Math.abs(shift) > gap) {
        p.line(P, add(P2, scale(dir, Math.sign(shift) * over)), ext);
        const onSeg = t + shift / (dist(a, b) || 1);
        if (onSeg < 0 || onSeg > 1) p.line(F, add(F2, scale(dir, Math.sign(shift) * over)), ext);
      }
      dimLine(p, P2, F2, color);
      const tt = projectParam(L, P2, F2);
      if (tt < 0) p.line(P2, L, { color, width: 1 });
      if (tt > 1) p.line(F2, L, { color, width: 1 });
      return label(p, dimText(d, value), L, color, hot);
    }
    case "angle": {
      const r = angleRefs(s, d);
      if (!r) return null;
      const a = ptv(s, r.a);
      const b = ptv(s, r.b);
      const c = ptv(s, r.c);
      const dd = ptv(s, r.d);
      const O = lineIntersection(a, b, c, dd);
      const rad = Math.max(dist(O, L), p.view.px(12));
      const d1 = norm(sub(b, a));
      const d2 = norm(sub(dd, c));
      const a0 = Math.atan2(d1.y, d1.x);
      let sweep = Math.atan2(cross(d1, d2), dot(d1, d2));
      if (sweep < 0) sweep += Math.PI * 2;
      p.arc(O, rad, a0, a0 + sweep, { color, width: 1 });
      const e0 = add(O, scale(d1, rad));
      const e1 = add(O, scale(d2, rad));
      arrowHead(p, e0, sdir(perp(d1)), color);
      arrowHead(p, e1, sdir(scale(perp(d2), -1)), color);
      // Extension lines from the nearer line ends to the arc.
      for (const [dirv, p1, p2, end] of [
        [d1, a, b, e0],
        [d2, c, dd, e1],
      ] as const) {
        const far = dist(O, p1) > dist(O, p2) ? p1 : p2;
        const tFar = dot(sub(far, O), dirv);
        if (tFar < rad - gap) p.line(add(O, scale(dirv, Math.max(0, tFar) + gap)), add(end, scale(dirv, over)), ext);
      }
      return label(p, dimText(d, value), L, color, hot);
    }
    case "radius":
    case "diameter": {
      const e = s.entities[d.refs[0]];
      if (e.type !== "circle" && e.type !== "arc") return null;
      const C = ptv(s, e.c);
      const R = e.type === "circle" ? e.r : arcGeom(s, e).r;
      const u = dist(L, C) > 1e-12 ? norm(sub(L, C)) : { x: 1, y: 0 };
      const onCurve = add(C, scale(u, R));
      if (d.type === "radius") {
        p.line(C, L, { color, width: 1 });
        arrowHead(p, onCurve, sdir(u), color);
      } else {
        const opp = add(C, scale(u, -R));
        p.line(opp, dist(L, C) > R ? L : onCurve, { color, width: 1 });
        arrowHead(p, onCurve, sdir(u), color);
        arrowHead(p, opp, sdir(scale(u, -1)), color);
      }
      return label(p, dimText(d, value), L, color, hot);
    }
    case "offset": {
      const o = offsetGeom(s, d);
      if (!o) return null;
      const dir = dist(o.from, o.to) > 1e-12 ? norm(sub(o.to, o.from)) : { x: 0, y: 1 };
      const along = perp(dir);
      const shift = dot(sub(L, o.from), along);
      const A = add(o.from, scale(along, shift));
      const B = add(o.to, scale(along, shift));
      if (Math.abs(shift) > gap) {
        p.line(o.from, A, ext);
        p.line(o.to, B, ext);
      }
      dimLine(p, A, B, color);
      return label(p, dimText(d, value), L, color, hot);
    }
    case "arcLength": {
      const e = s.entities[d.refs[0]];
      if (e.type !== "arc") return null;
      const g = arcGeom(s, e);
      const rr = Math.max(dist(g.c, L), g.r + p.view.px(8));
      p.arc(g.c, rr, g.a0, g.a1, { color, width: 1 });
      const e0 = add(g.c, scale(norm(sub(g.p0, g.c)), rr));
      const e1 = add(g.c, scale(norm(sub(g.p1, g.c)), rr));
      p.line(g.p0, e0, ext);
      p.line(g.p1, e1, ext);
      arrowHead(p, e0, sdir(scale(perp(norm(sub(g.p0, g.c))), -1)), color);
      arrowHead(p, e1, sdir(perp(norm(sub(g.p1, g.c)))), color);
      return label(p, dimText(d, value), L, color, hot);
    }
  }
}

export function drawDimensions(
  p: Painter,
  s: Sketch,
  opts: { conflicts: Set<Id>; hover: Id | null; selection: Set<Id>; labelOffset?: (id: Id) => Vec2 | null },
): AnnotationHit[] {
  const hits: AnnotationHit[] = [];
  for (const d of Object.values(s.dimensions)) {
    if (d.hidden || d.refs.some((id) => !s.entities[id])) continue; // dangling: listed in Relations, not drawn
    const hot = opts.hover === d.id || opts.selection.has(d.id);
    const color = opts.conflicts.has(d.id) ? theme.dimConflict : opts.selection.has(d.id) ? theme.selected : d.driven ? theme.dimDriven : theme.dim;
    const extra = opts.labelOffset?.(d.id);
    const L = extra ? add(add(dimAnchor(s, d), d.label), extra) : undefined;
    const r = drawDimension(p, s, d, color, hot, L);
    if (r) hits.push({ id: d.id, kind: "dimension", ...r });
  }
  return hits;
}
