import type { SolverConstraint, SolverParams } from "./types";

/**
 * Residual functions over a flat parameter vector, mirroring the constraint
 * vocabulary. Used for DOF / dependency analysis and for checking whether a
 * solution actually satisfies each constraint.
 */

export interface ParamIndex {
  /** Param slots: `${pointId}.x`, `${pointId}.y`, `${circleId}.r`. */
  index: Map<string, number>;
  values: Float64Array;
  /** Geometry lookup for residuals. */
  geom: Map<string, SolverParams["geoms"][number]>;
}

export function indexParams(p: SolverParams): ParamIndex {
  const index = new Map<string, number>();
  const vals: number[] = [];
  for (const pt of p.points) {
    index.set(`${pt.id}.x`, vals.length);
    vals.push(pt.x);
    index.set(`${pt.id}.y`, vals.length);
    vals.push(pt.y);
  }
  const geom = new Map<string, SolverParams["geoms"][number]>();
  for (const g of p.geoms) {
    geom.set(g.id, g);
    if (g.kind === "circle") {
      index.set(`${g.id}.r`, vals.length);
      vals.push(g.r);
    }
  }
  return { index, values: Float64Array.from(vals), geom };
}

export interface Residual {
  owner: string;
  /** Parameter indices this residual depends on. */
  deps: number[];
  /** Evaluate all components. */
  f: (x: Float64Array) => number[];
}

type V = { x: number; y: number };

/** Build residuals for the constraints plus the implicit arc-consistency rule. */
export function buildResiduals(pi: ParamIndex, cons: SolverConstraint[]): Residual[] {
  const { index, geom } = pi;
  const I = (k: string) => {
    const i = index.get(k);
    if (i === undefined) throw new Error(`unknown param ${k}`);
    return i;
  };
  const P = (id: string) => ({ ix: I(`${id}.x`), iy: I(`${id}.y`) });
  const pv = (x: Float64Array, p: { ix: number; iy: number }): V => ({ x: x[p.ix], y: x[p.iy] });

  /** Circle-like accessor: center + radius function. */
  const round = (gid: string) => {
    const g = geom.get(gid);
    if (!g || g.kind === "line") throw new Error(`not a circle/arc ${gid}`);
    const c = P(g.c);
    if (g.kind === "circle") {
      const ir = I(`${g.id}.r`);
      return { c, deps: [c.ix, c.iy, ir], r: (x: Float64Array) => x[ir], g };
    }
    const s = P(g.s);
    return { c, deps: [c.ix, c.iy, s.ix, s.iy], r: (x: Float64Array) => Math.hypot(x[s.ix] - x[c.ix], x[s.iy] - x[c.iy]), g };
  };
  const line = (lid: string) => {
    const g = geom.get(lid);
    if (!g || g.kind !== "line") throw new Error(`not a line ${lid}`);
    return { a: P(g.p1), b: P(g.p2) };
  };
  const out: Residual[] = [];
  const push = (owner: string, deps: number[], f: (x: Float64Array) => number[]) => out.push({ owner, deps: Array.from(new Set(deps)), f });
  const dp = (...ps: { ix: number; iy: number }[]) => ps.flatMap((p) => [p.ix, p.iy]);

  for (const g of geom.values()) {
    if (g.kind !== "arc") continue;
    const c = P(g.c);
    const s = P(g.s);
    const e = P(g.e);
    push(`arc:${g.id}`, dp(c, s, e), (x) => [Math.hypot(x[e.ix] - x[c.ix], x[e.iy] - x[c.iy]) - Math.hypot(x[s.ix] - x[c.ix], x[s.iy] - x[c.iy])]);
  }

  for (const c of cons) {
    const o = c.owner;
    switch (c.kind) {
      case "coincident": {
        const a = P(c.a);
        const b = P(c.b);
        push(o, dp(a, b), (x) => [x[a.ix] - x[b.ix], x[a.iy] - x[b.iy]]);
        break;
      }
      case "horizontal": {
        const a = P(c.a);
        const b = P(c.b);
        push(o, [a.iy, b.iy], (x) => [x[a.iy] - x[b.iy]]);
        break;
      }
      case "vertical": {
        const a = P(c.a);
        const b = P(c.b);
        push(o, [a.ix, b.ix], (x) => [x[a.ix] - x[b.ix]]);
        break;
      }
      case "coordX": {
        const p = P(c.p);
        push(o, [p.ix], (x) => [x[p.ix] - c.v]);
        break;
      }
      case "coordY": {
        const p = P(c.p);
        push(o, [p.iy], (x) => [x[p.iy] - c.v]);
        break;
      }
      case "radius": {
        const r = round(c.g);
        push(o, r.deps, (x) => [r.r(x) - c.v]);
        break;
      }
      case "parallel":
      case "perpendicular": {
        const l1 = line(c.l1);
        const l2 = line(c.l2);
        const par = c.kind === "parallel";
        push(o, dp(l1.a, l1.b, l2.a, l2.b), (x) => {
          const d1 = sub(pv(x, l1.b), pv(x, l1.a));
          const d2 = sub(pv(x, l2.b), pv(x, l2.a));
          const n = Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y) || 1;
          return [par ? (d1.x * d2.y - d1.y * d2.x) / n : (d1.x * d2.x + d1.y * d2.y) / n];
        });
        break;
      }
      case "perpPoints": {
        const a = P(c.a);
        const b = P(c.b);
        const cc = P(c.c);
        const d = P(c.d);
        push(o, dp(a, b, cc, d), (x) => {
          const d1 = sub(pv(x, b), pv(x, a));
          const d2 = sub(pv(x, d), pv(x, cc));
          const n = Math.hypot(d1.x, d1.y) * Math.hypot(d2.x, d2.y) || 1;
          return [(d1.x * d2.x + d1.y * d2.y) / n];
        });
        break;
      }
      case "pointOnLine": {
        const p = P(c.p);
        const a = P(c.a);
        const b = P(c.b);
        push(o, dp(p, a, b), (x) => {
          const ab = sub(pv(x, b), pv(x, a));
          const ap = sub(pv(x, p), pv(x, a));
          return [(ab.x * ap.y - ab.y * ap.x) / (Math.hypot(ab.x, ab.y) || 1)];
        });
        break;
      }
      case "pointOnCircle": {
        const p = P(c.p);
        const r = round(c.g);
        push(o, [...dp(p), ...r.deps], (x) => [Math.hypot(x[p.ix] - x[r.c.ix], x[p.iy] - x[r.c.iy]) - r.r(x)]);
        break;
      }
      case "equalLength": {
        const l1 = line(c.l1);
        const l2 = line(c.l2);
        push(o, dp(l1.a, l1.b, l2.a, l2.b), (x) => [len(pv(x, l1.a), pv(x, l1.b)) - len(pv(x, l2.a), pv(x, l2.b))]);
        break;
      }
      case "equalRadius": {
        const r1 = round(c.g1);
        const r2 = round(c.g2);
        push(o, [...r1.deps, ...r2.deps], (x) => [r1.r(x) - r2.r(x)]);
        break;
      }
      case "tangentLineCircle": {
        const l = line(c.l);
        const r = round(c.g);
        push(o, [...dp(l.a, l.b), ...r.deps], (x) => {
          const ab = sub(pv(x, l.b), pv(x, l.a));
          const ac = sub(pv(x, r.c), pv(x, l.a));
          const d = Math.abs(ab.x * ac.y - ab.y * ac.x) / (Math.hypot(ab.x, ab.y) || 1);
          return [d - r.r(x)];
        });
        break;
      }
      case "tangentCircles": {
        const r1 = round(c.g1);
        const r2 = round(c.g2);
        push(o, [...r1.deps, ...r2.deps], (x) => {
          const d = len(pv(x, r1.c), pv(x, r2.c));
          return [c.internal ? d - Math.abs(r1.r(x) - r2.r(x)) : d - (r1.r(x) + r2.r(x))];
        });
        break;
      }
      case "symmetricLine": {
        const a = P(c.a);
        const b = P(c.b);
        const l = line(c.l);
        push(o, dp(a, b, l.a, l.b), (x) => {
          const A = pv(x, a);
          const B = pv(x, b);
          const la = pv(x, l.a);
          const d = sub(pv(x, l.b), la);
          const n = Math.hypot(d.x, d.y) || 1;
          const m = { x: (A.x + B.x) / 2 - la.x, y: (A.y + B.y) / 2 - la.y };
          const ab = sub(B, A);
          return [(d.x * m.y - d.y * m.x) / n, (d.x * ab.x + d.y * ab.y) / n];
        });
        break;
      }
      case "symmetricPoint": {
        const a = P(c.a);
        const b = P(c.b);
        const p = P(c.p);
        push(o, dp(a, b, p), (x) => [x[a.ix] + x[b.ix] - 2 * x[p.ix], x[a.iy] + x[b.iy] - 2 * x[p.iy]]);
        break;
      }
      case "distance": {
        const a = P(c.a);
        const b = P(c.b);
        push(o, dp(a, b), (x) => [len(pv(x, a), pv(x, b)) - c.v]);
        break;
      }
      case "distanceX": {
        const a = P(c.a);
        const b = P(c.b);
        push(o, [a.ix, b.ix], (x) => [x[b.ix] - x[a.ix] - c.v]);
        break;
      }
      case "distanceY": {
        const a = P(c.a);
        const b = P(c.b);
        push(o, [a.iy, b.iy], (x) => [x[b.iy] - x[a.iy] - c.v]);
        break;
      }
      case "pointLineDistance": {
        const p = P(c.p);
        const l = line(c.l);
        push(o, dp(p, l.a, l.b), (x) => {
          const ab = sub(pv(x, l.b), pv(x, l.a));
          const ap = sub(pv(x, p), pv(x, l.a));
          return [Math.abs(ab.x * ap.y - ab.y * ap.x) / (Math.hypot(ab.x, ab.y) || 1) - c.v];
        });
        break;
      }
      case "angle": {
        const a = P(c.a);
        const b = P(c.b);
        const cc = P(c.c);
        const d = P(c.d);
        push(o, dp(a, b, cc, d), (x) => {
          const d1 = sub(pv(x, b), pv(x, a));
          const d2 = sub(pv(x, d), pv(x, cc));
          let t = Math.atan2(d1.x * d2.y - d1.y * d2.x, d1.x * d2.x + d1.y * d2.y) - c.v;
          while (t > Math.PI) t -= 2 * Math.PI;
          while (t < -Math.PI) t += 2 * Math.PI;
          return [t];
        });
        break;
      }
      case "radiusDiff": {
        const r1 = round(c.g1);
        const r2 = round(c.g2);
        push(o, [...r1.deps, ...r2.deps], (x) => [r2.r(x) - r1.r(x) - c.v]);
        break;
      }
      case "arcLength": {
        const g = geom.get(c.g);
        if (!g || g.kind !== "arc") break;
        const cc = P(g.c);
        const s = P(g.s);
        const e = P(g.e);
        push(o, dp(cc, s, e), (x) => {
          const C = pv(x, cc);
          const S = pv(x, s);
          const E = pv(x, e);
          const r = len(C, S);
          let sw = Math.atan2(E.y - C.y, E.x - C.x) - Math.atan2(S.y - C.y, S.x - C.x);
          while (sw <= 0) sw += 2 * Math.PI;
          return [r * sw - c.v];
        });
        break;
      }
    }
  }
  return out;
}

const sub = (a: V, b: V): V => ({ x: a.x - b.x, y: a.y - b.y });
const len = (a: V, b: V) => Math.hypot(a.x - b.x, a.y - b.y);
