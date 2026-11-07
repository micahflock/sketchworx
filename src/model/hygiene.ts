import { bezierDeriv, bezierPoint } from "../geom/bezier";
import type { Vec2 } from "../geom/vec";
import { angleInSweep, ccwSweep } from "../geom/vec";
import { arcGeom, ptv } from "./sketch";
import type { Id, Sketch } from "./types";

/** Roots of f on (0,1) by sampling for sign changes and bisecting. */
function roots(f: (t: number) => number, n = 64): number[] {
  const out: number[] = [];
  let t0 = 0;
  let f0 = f(0);
  for (let i = 1; i <= n; i++) {
    const t1 = i / n;
    const f1 = f(t1);
    if (f0 === 0 && t0 > 0) out.push(t0);
    else if (f0 * f1 < 0) {
      let a = t0;
      let b = t1;
      let fa = f0;
      for (let k = 0; k < 50; k++) {
        const m = (a + b) / 2;
        const fm = f(m);
        if (fa * fm <= 0) b = m;
        else {
          a = m;
          fa = fm;
        }
      }
      out.push((a + b) / 2);
    }
    t0 = t1;
    f0 = f1;
  }
  return out;
}

/**
 * Handle hygiene (font-design rule): horizontal/vertical extrema of a curve should sit on
 * on-curve points. Returns the extrema that fall inside a curve instead of at its ends.
 */
export function extremaWithoutPoints(s: Sketch): { at: Vec2; id: Id; axis: "x" | "y" }[] {
  const out: { at: Vec2; id: Id; axis: "x" | "y" }[] = [];
  const eps = 1e-3;
  for (const e of Object.values(s.entities)) {
    if (e.construction) continue;
    if (e.type === "spline") {
      const cps = e.cps.map((id) => ptv(s, id));
      for (const axis of ["x", "y"] as const)
        for (const t of roots((u) => bezierDeriv(cps, u)[axis]))
          if (t > eps && t < 1 - eps) out.push({ at: bezierPoint(cps, t), id: e.id, axis: axis === "x" ? "y" : "x" });
    } else if (e.type === "arc") {
      const g = arcGeom(s, e);
      const sw = ccwSweep(g.a0, g.a1);
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2;
        if (!angleInSweep(a, g.a0, g.a1)) continue;
        const d = ((a - g.a0) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
        if (d < eps * sw || d > sw * (1 - eps)) continue;
        out.push({ at: { x: g.c.x + g.r * Math.cos(a), y: g.c.y + g.r * Math.sin(a) }, id: e.id, axis: k % 2 === 0 ? "y" : "x" });
      }
    }
  }
  return out;
}
