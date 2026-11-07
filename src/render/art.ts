import { buildOutline } from "../model/outline";
import type { Outline } from "../model/outline";
import type { Sketch } from "../model/types";
import { loopsToPathData } from "../io/svg";
import type { Painter } from "./painter";
import { theme } from "./theme";
import type { View } from "./view";

const cache = new WeakMap<Sketch, { diag: boolean; o: Outline; path: Path2D }>();

/** Outline for a sketch, cached per immutable sketch object. */
export function outlineOf(s: Sketch, diagnostics: boolean): { o: Outline; path: Path2D } {
  const hit = cache.get(s);
  if (hit && (hit.diag || !diagnostics)) return hit;
  const o = buildOutline(s, diagnostics);
  const v = { diag: diagnostics, o, path: new Path2D(loopsToPathData(o.loops, "arc")) };
  cache.set(s, v);
  return v;
}

/** Fill closed loops (nonzero) in sketch space. Path data is (x, -y). */
export function fillOutline(ctx: CanvasRenderingContext2D, view: View, path: Path2D, color: string) {
  ctx.save();
  const k = view.dpr;
  ctx.setTransform(k * view.scale, 0, 0, k * view.scale, k * (view.width / 2 - view.cx * view.scale), k * (view.height / 2 + view.cy * view.scale));
  ctx.fillStyle = color;
  ctx.fill(path, "nonzero");
  ctx.restore();
}

/** Orange markers at open ends and self-intersections (they break fills). */
export function drawDiagnostics(p: Painter, o: Outline) {
  for (const q of o.openEnds) {
    p.ring(q, 7, theme.openEnd, 2.5);
    p.dot(q, 2.5, theme.openEnd);
  }
  for (const q of o.selfIntersections) {
    const S = p.s(q);
    const c = p.ctx;
    c.strokeStyle = theme.openEnd;
    c.lineWidth = 2.5;
    c.setLineDash([]);
    c.beginPath();
    c.moveTo(S.x - 6, S.y - 6);
    c.lineTo(S.x + 6, S.y + 6);
    c.moveTo(S.x + 6, S.y - 6);
    c.lineTo(S.x - 6, S.y + 6);
    c.stroke();
  }
}
