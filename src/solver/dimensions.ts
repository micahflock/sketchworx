import { angleRefs, distancePointIds, pointLineRefs } from "../model/dimensions";
import { ptv } from "../model/sketch";
import type { Dimension, Sketch } from "../model/types";
import type { Body } from "./build";
import type { SolverConstraint } from "./types";

/** Driving dimension → solver constraints. Driven dimensions are measurements only. */
export function dimensionConstraints(s: Sketch, d: Dimension): SolverConstraint[] | null {
  if (d.refs.some((id) => !s.entities[id])) return null;
  const v = d.value;
  if (!Number.isFinite(v)) return null;
  const one = (c: Body): SolverConstraint[] => [{ ...c, id: `${d.id}#0`, owner: d.id } as SolverConstraint];
  switch (d.type) {
    case "distance":
    case "distanceX":
    case "distanceY": {
      const ids = distancePointIds(s, d);
      if (!ids) return null;
      const [a, b] = ids;
      if (d.type === "distance") return one({ kind: "distance", a, b, v: Math.abs(v) });
      // Keep the current left/right (below/above) order of the two points.
      const pa = ptv(s, a);
      const pb = ptv(s, b);
      const sign = d.type === "distanceX" ? (pb.x >= pa.x ? 1 : -1) : pb.y >= pa.y ? 1 : -1;
      return one({ kind: d.type, a, b, v: sign * Math.abs(v) });
    }
    case "pointLine": {
      const r = pointLineRefs(s, d);
      if (!r) return null;
      return one({ kind: "pointLineDistance", p: r.p, l: r.line, v: Math.abs(v) });
    }
    case "angle": {
      const r = angleRefs(s, d);
      if (!r) return null;
      return one({ kind: "angle", a: r.a, b: r.b, c: r.c, d: r.d, v: (v * Math.PI) / 180 });
    }
    case "radius":
    case "diameter": {
      const e = s.entities[d.refs[0]];
      if (e.type !== "circle" && e.type !== "arc") return null;
      return one({ kind: "radius", g: e.id, v: d.type === "diameter" ? v / 2 : v });
    }
    case "arcLength": {
      const e = s.entities[d.refs[0]];
      if (e.type !== "arc") return null;
      return one({ kind: "arcLength", g: e.id, v });
    }
    case "offset": {
      const [src, dst] = d.refs.map((id) => s.entities[id]);
      const out: SolverConstraint[] = [];
      const add = (c: Body) => out.push({ ...c, id: `${d.id}#${out.length}`, owner: d.id } as SolverConstraint);
      if (src.type === "line" && dst.type === "line") {
        add({ kind: "parallel", l1: src.id, l2: dst.id });
        add({ kind: "pointLineDistance", p: dst.p1, l: src.id, v: Math.abs(v) });
        for (const [sp, dp] of d.align ?? []) if (s.entities[sp] && s.entities[dp]) add({ kind: "perpPoints", a: sp, b: dp, c: src.p1, d: src.p2 });
        return out;
      }
      const round = (e: typeof src) => e.type === "circle" || e.type === "arc";
      if (round(src) && round(dst)) {
        const sc = (src as { c: string }).c;
        const dc = (dst as { c: string }).c;
        add({ kind: "coincident", a: sc, b: dc });
        // Keep the side: outward offsets grow the radius, inward ones shrink it.
        const rs = src.type === "circle" ? src.r : Math.hypot(ptv(s, src.s).x - ptv(s, src.c).x, ptv(s, src.s).y - ptv(s, src.c).y);
        const rd = dst.type === "circle" ? dst.r : Math.hypot(ptv(s, dst.s).x - ptv(s, dst.c).x, ptv(s, dst.s).y - ptv(s, dst.c).y);
        add({ kind: "radiusDiff", g1: src.id, g2: dst.id, v: (rd >= rs ? 1 : -1) * Math.abs(v) });
        for (const [sp, dp] of d.align ?? []) if (s.entities[sp] && s.entities[dp]) add({ kind: "pointOnLine", p: dp, a: sc, b: sp });
        return out;
      }
      return null;
    }
  }
}
