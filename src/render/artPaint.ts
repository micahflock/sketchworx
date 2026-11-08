/** Paints an Art view scene (strokes and filled profiles) on a canvas. */
import type { Vec2 } from "../geom/vec";
import type { ArtScene, ArtStroke } from "../model/art";
import { MITER_LIMIT } from "../model/art";
import type { Seg } from "../model/outline";
import type { Id } from "../model/types";

const INK = "#000000";
const SELECT = "rgba(31,111,235,0.55)";
const SELECT_LINE = "#1f6feb";
const HOVER = "rgba(31,111,235,0.28)";

/** World (y-up) to device pixels: device = (x·k + ox, −y·k + oy). */
export interface ArtTransform {
  k: number;
  ox: number;
  oy: number;
  /** Sketch units per CSS pixel (for chrome drawn at a fixed screen size). */
  unit: number;
}

export interface ArtHighlight {
  /** Chain keys. */
  selected?: Set<Id>;
  hover?: Id | null;
}

/** Exact path of chain pieces in world coordinates (the transform flips y). */
export function segsPath(segs: Seg[], closed: boolean, into = new Path2D()): Path2D {
  if (!segs.length) return into;
  into.moveTo(segs[0].start.x, segs[0].start.y);
  for (const s of segs) {
    if (s.kind === "line") into.lineTo(s.end.x, s.end.y);
    else if (s.kind === "arc") into.arc(s.c.x, s.c.y, s.r, s.a0, s.a0 + s.sweep, s.sweep < 0);
    else into.bezierCurveTo(s.c1.x, s.c1.y, s.c2.x, s.c2.y, s.end.x, s.end.y);
  }
  if (closed) into.closePath();
  return into;
}

function polyPath(pts: Vec2[], closed: boolean): Path2D {
  const p = new Path2D();
  pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)));
  if (closed) p.closePath();
  return p;
}

const strokePaths = new WeakMap<ArtStroke, { stroke: Path2D; center: Path2D }>();
function pathsOf(s: ArtStroke) {
  let p = strokePaths.get(s);
  if (!p) {
    const center = segsPath(s.chain.segs, s.chain.closed);
    p = { center, stroke: s.centered ? center : polyPath(s.path, s.chain.closed) };
    strokePaths.set(s, p);
  }
  return p;
}

/** Small arrow at the middle of an open chain, showing which way is left and right. */
function arrow(ctx: CanvasRenderingContext2D, pts: Vec2[], size: number) {
  if (pts.length < 2) return;
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  let run = 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (run + l >= total / 2 && l > 0) {
      const t = (total / 2 - run) / l;
      const m = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      const d = { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
      const n = { x: -d.y, y: d.x };
      ctx.beginPath();
      ctx.moveTo(m.x + d.x * size, m.y + d.y * size);
      ctx.lineTo(m.x - d.x * size + n.x * size * 0.8, m.y - d.y * size + n.y * size * 0.8);
      ctx.lineTo(m.x - d.x * size - n.x * size * 0.8, m.y - d.y * size - n.y * size * 0.8);
      ctx.closePath();
      ctx.fill();
      return;
    }
    run += l;
  }
}

/** Draw the scene. The caller has filled the background. */
export function paintArt(ctx: CanvasRenderingContext2D, scene: ArtScene, t: ArtTransform, hl: ArtHighlight = {}) {
  ctx.save();
  ctx.setTransform(t.k, 0, 0, -t.k, t.ox, t.oy);
  ctx.setLineDash([]);
  if (scene.fills.length) {
    const fill = new Path2D();
    for (const l of scene.fills) segsPath(l.segs, true, fill);
    ctx.fillStyle = INK;
    ctx.fill(fill, "nonzero");
  }
  ctx.lineJoin = "miter";
  ctx.miterLimit = MITER_LIMIT;
  ctx.lineCap = "butt";
  // Selection and hover: a blue halo behind the ink, so the stroke itself stays visible.
  const marked = scene.strokes.filter((s) => hl.selected?.has(s.chain.key) || hl.hover === s.chain.key);
  for (const s of marked) {
    const sel = hl.selected?.has(s.chain.key);
    ctx.strokeStyle = sel ? SELECT : HOVER;
    ctx.lineWidth = Math.max(0, s.style.weight) + 8 * t.unit;
    ctx.stroke(pathsOf(s).stroke);
  }
  ctx.strokeStyle = INK;
  for (const s of scene.strokes) {
    if (s.style.weight <= 0) continue;
    ctx.lineWidth = s.style.weight;
    ctx.stroke(pathsOf(s).stroke);
  }
  // The chain itself and its direction on top of selected strokes.
  for (const s of marked) {
    if (!hl.selected?.has(s.chain.key)) continue;
    ctx.strokeStyle = SELECT_LINE;
    ctx.lineWidth = 1.5 * t.unit;
    ctx.stroke(pathsOf(s).center);
    if (!s.chain.closed) {
      ctx.fillStyle = SELECT_LINE;
      arrow(ctx, s.center, 7 * t.unit);
    }
  }
  ctx.restore();
}
