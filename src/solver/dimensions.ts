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
  }
}
