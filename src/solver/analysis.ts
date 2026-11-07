import type { ParamIndex, Residual } from "./residuals";

/**
 * Degrees-of-freedom analysis. Builds the constraint Jacobian numerically,
 * splits it into independent clusters, and reduces each cluster to row-echelon
 * form. A parameter is fully determined when its unit vector lies in the row
 * space of the Jacobian (equivalently, every null-space direction leaves it
 * unchanged). FreeCAD does the same with a QR decomposition.
 */

export interface Analysis {
  /** Remaining degrees of freedom (number of free directions). */
  dof: number;
  /** Per-parameter: true when the constraints pin it down. */
  determined: Uint8Array;
  /** Residual owners whose value is not ~0 at the analysed point. */
  unsatisfied: Set<string>;
}

class DSU {
  p: Int32Array;
  constructor(n: number) {
    this.p = new Int32Array(n);
    for (let i = 0; i < n; i++) this.p[i] = i;
  }
  find(a: number): number {
    while (this.p[a] !== a) {
      this.p[a] = this.p[this.p[a]];
      a = this.p[a];
    }
    return a;
  }
  union(a: number, b: number) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.p[ra] = rb;
  }
}

/** Typical length scale of the sketch, for tolerances. */
function lengthScale(x: Float64Array) {
  let m = 1;
  for (let i = 0; i < x.length; i++) m = Math.max(m, Math.abs(x[i]));
  return m;
}

export function analyse(pi: ParamIndex, residuals: Residual[], satTol = 1e-6): Analysis {
  const x = Float64Array.from(pi.values);
  const n = x.length;
  const scale = lengthScale(x);
  const unsatisfied = new Set<string>();

  // Jacobian rows (sparse: deps + values).
  interface Row {
    deps: number[];
    vals: number[];
  }
  const rows: Row[] = [];
  for (const r of residuals) {
    const f0 = r.f(x);
    if (f0.some((v) => !Number.isFinite(v) || Math.abs(v) > satTol * scale)) unsatisfied.add(r.owner);
    const cols: number[][] = r.deps.map(() => []);
    r.deps.forEach((j, k) => {
      const h = 1e-6 * Math.max(1, Math.abs(x[j]));
      const old = x[j];
      x[j] = old + h;
      const fp = r.f(x);
      x[j] = old - h;
      const fm = r.f(x);
      x[j] = old;
      cols[k] = fp.map((v, i) => (v - fm[i]) / (2 * h));
    });
    for (let i = 0; i < f0.length; i++) {
      const vals = r.deps.map((_, k) => cols[k][i]);
      const norm = Math.hypot(...vals);
      if (!(norm > 1e-12)) continue; // degenerate row (e.g. zero-length line): carries no information here
      rows.push({ deps: r.deps, vals: vals.map((v) => v / norm) });
    }
  }

  // Cluster parameters connected through rows.
  const dsu = new DSU(n);
  for (const r of rows) for (let k = 1; k < r.deps.length; k++) dsu.union(r.deps[0], r.deps[k]);
  const clusterCols = new Map<number, number[]>();
  for (let j = 0; j < n; j++) {
    const root = dsu.find(j);
    let a = clusterCols.get(root);
    if (!a) clusterCols.set(root, (a = []));
    a.push(j);
  }
  const clusterRows = new Map<number, Row[]>();
  for (const r of rows) {
    const root = dsu.find(r.deps[0]);
    let a = clusterRows.get(root);
    if (!a) clusterRows.set(root, (a = []));
    a.push(r);
  }

  const determined = new Uint8Array(n);
  let dof = 0;
  const pivTol = 1e-8;
  for (const [root, cols] of clusterCols) {
    const crows = clusterRows.get(root) ?? [];
    if (crows.length === 0) {
      dof += cols.length;
      continue;
    }
    const local = new Map<number, number>();
    cols.forEach((j, k) => local.set(j, k));
    const m = crows.length;
    const w = cols.length;
    const A: Float64Array[] = crows.map((r) => {
      const row = new Float64Array(w);
      r.deps.forEach((j, k) => (row[local.get(j)!] += r.vals[k]));
      return row;
    });
    // Reduced row echelon form with partial pivoting.
    const pivotRowOfCol = new Int32Array(w).fill(-1);
    let rank = 0;
    for (let c = 0; c < w && rank < m; c++) {
      let best = rank;
      let bv = Math.abs(A[rank][c]);
      for (let r = rank + 1; r < m; r++) {
        const v = Math.abs(A[r][c]);
        if (v > bv) {
          bv = v;
          best = r;
        }
      }
      if (bv < pivTol) continue;
      [A[rank], A[best]] = [A[best], A[rank]];
      const pr = A[rank];
      const inv = 1 / pr[c];
      for (let k = 0; k < w; k++) pr[k] *= inv;
      for (let r = 0; r < m; r++) {
        if (r === rank) continue;
        const row = A[r];
        const f = row[c];
        if (f === 0) continue;
        for (let k = c; k < w; k++) row[k] -= f * pr[k];
      }
      pivotRowOfCol[c] = rank;
      rank++;
    }
    dof += w - rank;
    const free: number[] = [];
    for (let c = 0; c < w; c++) if (pivotRowOfCol[c] < 0) free.push(c);
    for (let c = 0; c < w; c++) {
      const r = pivotRowOfCol[c];
      if (r < 0) continue;
      let ok = true;
      for (const f of free)
        if (Math.abs(A[r][f]) > 1e-6) {
          ok = false;
          break;
        }
      if (ok) determined[cols[c]] = 1;
    }
  }
  return { dof, determined, unsatisfied };
}
