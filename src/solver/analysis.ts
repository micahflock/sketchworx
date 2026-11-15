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

/** One Jacobian row, sparse and normalized to unit length. */
interface Row {
  deps: number[];
  vals: number[];
}

/** A residual's value and its Jacobian rows at x (degenerate rows dropped). */
function jacobian(r: Residual, x: Float64Array): { f0: number[]; rows: Row[] } {
  const f0 = r.f(x);
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
  const rows: Row[] = [];
  for (let i = 0; i < f0.length; i++) {
    const vals = r.deps.map((_, k) => cols[k][i]);
    const norm = Math.hypot(...vals);
    if (!(norm > 1e-12)) continue; // degenerate row (e.g. zero-length line): carries no information here
    rows.push({ deps: r.deps, vals: vals.map((v) => v / norm) });
  }
  return { f0, rows };
}

const unsat = (f0: number[], tol: number) => f0.some((v) => !Number.isFinite(v) || Math.abs(v) > tol);

/** Parameters grouped into independent clusters (connected through rows), with each cluster's rows. */
function clusters(n: number, rows: Row[], extra: Row[] = []) {
  const dsu = new DSU(n);
  for (const r of [...rows, ...extra]) for (let k = 1; k < r.deps.length; k++) dsu.union(r.deps[0], r.deps[k]);
  const cols = new Map<number, number[]>();
  for (let j = 0; j < n; j++) {
    const root = dsu.find(j);
    let a = cols.get(root);
    if (!a) cols.set(root, (a = []));
    a.push(j);
  }
  const rowsOf = new Map<number, Row[]>();
  for (const r of rows) {
    const root = dsu.find(r.deps[0]);
    let a = rowsOf.get(root);
    if (!a) rowsOf.set(root, (a = []));
    a.push(r);
  }
  return { root: (j: number) => dsu.find(j), cols, rowsOf };
}

/** A cluster's rows in reduced row echelon form (partial pivoting). */
function rref(crows: Row[], cols: number[]) {
  const local = new Map<number, number>();
  cols.forEach((j, k) => local.set(j, k));
  const m = crows.length;
  const w = cols.length;
  const A: Float64Array[] = crows.map((r) => {
    const row = new Float64Array(w);
    r.deps.forEach((j, k) => (row[local.get(j)!] += r.vals[k]));
    return row;
  });
  const pivTol = 1e-8;
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
  const free: number[] = [];
  for (let c = 0; c < w; c++) if (pivotRowOfCol[c] < 0) free.push(c);
  return { A, local, rank, pivotRowOfCol, free };
}

export function analyse(pi: ParamIndex, residuals: Residual[], satTol = 1e-6): Analysis {
  const x = Float64Array.from(pi.values);
  const n = x.length;
  const scale = lengthScale(x);
  const unsatisfied = new Set<string>();
  const rows: Row[] = [];
  for (const r of residuals) {
    const j = jacobian(r, x);
    if (unsat(j.f0, satTol * scale)) unsatisfied.add(r.owner);
    rows.push(...j.rows);
  }

  const cl = clusters(n, rows);
  const determined = new Uint8Array(n);
  let dof = 0;
  for (const [root, cols] of cl.cols) {
    const crows = cl.rowsOf.get(root) ?? [];
    if (crows.length === 0) {
      dof += cols.length;
      continue;
    }
    const { A, rank, pivotRowOfCol, free } = rref(crows, cols);
    dof += cols.length - rank;
    for (let c = 0; c < cols.length; c++) {
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

/** Orthonormalize vectors in place (modified Gram-Schmidt, twice), dropping ones that vanish. */
function orthonormal(vs: Float64Array[]): Float64Array[] {
  const out: Float64Array[] = [];
  for (const v of vs) {
    for (let pass = 0; pass < 2; pass++)
      for (const u of out) {
        let d = 0;
        for (let k = 0; k < v.length; k++) d += u[k] * v[k];
        for (let k = 0; k < v.length; k++) v[k] -= d * u[k];
      }
    let nn = 0;
    for (let k = 0; k < v.length; k++) nn += v[k] * v[k];
    nn = Math.sqrt(nn);
    if (nn < 1e-9) continue;
    for (let k = 0; k < v.length; k++) v[k] /= nn;
    out.push(v);
  }
  return out;
}

/**
 * Which `soft` residuals, taken in order, add nothing at the current point: each holds there and its
 * Jacobian rows already lie in the row space of `hard` plus the soft residuals kept before it. Those
 * can be left out without freeing anything or reporting them as redundant.
 */
export function dependentSoft(pi: ParamIndex, hard: Residual[], soft: Residual[], satTol = 1e-6): boolean[] {
  const x = Float64Array.from(pi.values);
  const tol = satTol * lengthScale(x);
  const hardRows = hard.flatMap((r) => jacobian(r, x).rows);
  const softJ = soft.map((r) => jacobian(r, x));
  const cl = clusters(x.length, hardRows, softJ.flatMap((j) => j.rows));

  // Per cluster, an orthonormal basis of the null space of its hard rows, built when first needed.
  const nulls = new Map<number, { local: Map<number, number>; N: Float64Array[] }>();
  const nullOf = (root: number) => {
    let z = nulls.get(root);
    if (z) return z;
    const cols = cl.cols.get(root)!;
    const { A, local, pivotRowOfCol, free } = rref(cl.rowsOf.get(root) ?? [], cols);
    const raw = free.map((f) => {
      const v = new Float64Array(cols.length);
      v[f] = 1;
      for (let c = 0; c < cols.length; c++) if (pivotRowOfCol[c] >= 0) v[c] = -A[pivotRowOfCol[c]][f];
      return v;
    });
    z = { local, N: orthonormal(raw) };
    nulls.set(root, z);
    return z;
  };

  return softJ.map(({ f0, rows }) => {
    if (unsat(f0, tol)) return false;
    let dependent = true;
    for (const row of rows) {
      const z = nullOf(cl.root(row.deps[0]));
      // The row's component in the remaining free directions.
      const y = z.N.map((v) => row.deps.reduce((s, j, k) => s + v[z.local.get(j)!] * row.vals[k], 0));
      const norm = Math.hypot(...y);
      if (norm < 1e-6) continue;
      dependent = false;
      // Keep it: the free directions shrink to those it leaves unchanged. A Householder reflection
      // turns y into a multiple of e_p; dropping column p of N·H leaves an orthonormal basis.
      let p = 0;
      for (let i = 1; i < y.length; i++) if (Math.abs(y[i]) > Math.abs(y[p])) p = i;
      const v = y.map((t) => t / norm);
      v[p] += Math.sign(v[p]) || 1;
      const vv = v.reduce((s, t) => s + t * t, 0);
      const w = z.N[0].length;
      const Nv = new Float64Array(w);
      z.N.forEach((col, i) => {
        if (v[i]) for (let k = 0; k < w; k++) Nv[k] += col[k] * v[i];
      });
      z.N = z.N.flatMap((col, i) => {
        if (i === p) return [];
        const f = (2 * v[i]) / vv;
        if (f) for (let k = 0; k < w; k++) col[k] -= f * Nv[k];
        return [col];
      });
    }
    return dependent;
  });
}
