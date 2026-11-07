import { bezierCurvature, bezierDeriv, bezierPoint } from "../geom/bezier";
import type { Vec2 } from "../geom/vec";
import { arcGeom, ptv } from "../model/sketch";
import type { Sketch } from "../model/types";
import type { Painter } from "./painter";

const COMB = "rgba(200, 60, 160, 0.75)";
const SPINE = "rgba(200, 60, 160, 0.45)";

interface Tooth {
  at: Vec2;
  tip: Vec2;
}

/**
 * SolidWorks-style curvature combs on style splines and arcs. Teeth point away from the
 * centre of curvature with length ∝ curvature; one scale for the whole sketch so combs on
 * either side of a joint are comparable (a G2 joint shows no step).
 */
export function drawCurvatureCombs(p: Painter, s: Sketch, density = 48) {
  const curves: { pts: (t: number) => Vec2; tan: (t: number) => Vec2; k: (t: number) => number }[] = [];
  let kmax = 0;
  for (const e of Object.values(s.entities)) {
    if (e.type === "spline" && e.cps.length >= 3) {
      const cps = e.cps.map((id) => ptv(s, id));
      curves.push({ pts: (t) => bezierPoint(cps, t), tan: (t) => bezierDeriv(cps, t), k: (t) => bezierCurvature(cps, t) });
    } else if (e.type === "arc") {
      const g = arcGeom(s, e);
      let sw = g.a1 - g.a0;
      while (sw <= 0) sw += Math.PI * 2;
      curves.push({
        pts: (t) => ({ x: g.c.x + g.r * Math.cos(g.a0 + sw * t), y: g.c.y + g.r * Math.sin(g.a0 + sw * t) }),
        tan: (t) => ({ x: -Math.sin(g.a0 + sw * t), y: Math.cos(g.a0 + sw * t) }),
        k: () => 1 / g.r,
      });
    }
  }
  if (!curves.length) return;
  for (const c of curves)
    for (let i = 0; i <= 16; i++) {
      kmax = Math.max(kmax, Math.abs(c.k(i / 16)));
    }
  if (kmax < 1e-12) return;
  // Longest tooth about 60 px on screen.
  const scale = p.view.px(60) / kmax;
  for (const c of curves) {
    const teeth: Tooth[] = [];
    for (let i = 0; i <= density; i++) {
      const t = i / density;
      const at = c.pts(t);
      const d = c.tan(t);
      const l = Math.hypot(d.x, d.y) || 1;
      const n = { x: -d.y / l, y: d.x / l };
      const k = c.k(t);
      teeth.push({ at, tip: { x: at.x - n.x * k * scale, y: at.y - n.y * k * scale } });
    }
    for (const t of teeth) p.line(t.at, t.tip, { color: COMB, width: 0.8 });
    p.polyline(
      teeth.map((t) => t.tip),
      { color: SPINE, width: 1.2 },
    );
  }
}
