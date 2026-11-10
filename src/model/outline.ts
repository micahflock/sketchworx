/**
 * Outline extraction: chains non-construction geometry into closed loops (fills) and open
 * chains (Art view strokes), and reports open ends and self-intersections.
 */
import { bezierClosest, toCubics } from "../geom/bezier";
import type { Curve } from "../geom/curves";
import { intersect } from "../geom/curves";
import type { Box, Vec2 } from "../geom/vec";
import { boxAdd, ccwSweep, dist, distToSegment, emptyBox, normAngle } from "../geom/vec";
import { arcGeom, ptv } from "./sketch";
import type { Doc, Id, Sketch } from "./types";

/** One piece of an outline, oriented from `start` to `end`. */
/** `rev` is set when the piece runs against its entity's own direction. */
export type Seg =
  | { kind: "line"; start: Vec2; end: Vec2; src: Id; rev?: boolean }
  /** sweep > 0 is CCW (y-up). */
  | { kind: "arc"; start: Vec2; end: Vec2; c: Vec2; r: number; a0: number; sweep: number; src: Id; rev?: boolean }
  | { kind: "cubic"; start: Vec2; end: Vec2; c1: Vec2; c2: Vec2; src: Id; rev?: boolean };

export interface Loop {
  segs: Seg[];
  /** Signed area (y-up, CCW positive). */
  area: number;
}

export interface Outline {
  loops: Loop[];
  openEnds: Vec2[];
  selfIntersections: Vec2[];
  bounds: Box;
}

export function reverseSeg(s: Seg): Seg {
  const rev = !s.rev || undefined;
  if (s.kind === "line") return { ...s, start: s.end, end: s.start, rev };
  if (s.kind === "arc") return { ...s, start: s.end, end: s.start, a0: s.a0 + s.sweep, sweep: -s.sweep, rev };
  return { ...s, start: s.end, end: s.start, c1: s.c2, c2: s.c1, rev };
}
const reverse = reverseSeg;

/** A chain reversed (pieces in reverse order, each flipped). */
export function reverseChain(segs: Seg[]): Seg[] {
  return segs.map(reverse).reverse();
}

/** Segments of every fillable (non-construction) curve. Full circles become standalone loops. */
function collect(s: Sketch): { segs: Seg[]; circles: Loop[] } {
  const segs: Seg[] = [];
  const circles: Loop[] = [];
  for (const e of Object.values(s.entities)) {
    if (e.construction) continue;
    if (e.type === "line") {
      if (e.owner) continue;
      segs.push({ kind: "line", start: ptv(s, e.p1), end: ptv(s, e.p2), src: e.id });
    } else if (e.type === "arc") {
      const g = arcGeom(s, e);
      segs.push({ kind: "arc", start: g.p0, end: { x: g.c.x + g.r * Math.cos(g.a1), y: g.c.y + g.r * Math.sin(g.a1) }, c: g.c, r: g.r, a0: g.a0, sweep: ccwSweep(g.a0, g.a1), src: e.id });
    } else if (e.type === "circle") {
      const c = ptv(s, e.c);
      const p = { x: c.x + e.r, y: c.y };
      const q = { x: c.x - e.r, y: c.y };
      circles.push({
        segs: [
          { kind: "arc", start: p, end: q, c, r: e.r, a0: 0, sweep: Math.PI, src: e.id },
          { kind: "arc", start: q, end: p, c, r: e.r, a0: Math.PI, sweep: Math.PI, src: e.id },
        ],
        area: Math.PI * e.r * e.r,
      });
    } else if (e.type === "spline") {
      const cps = e.cps.map((id) => ptv(s, id));
      for (const c of toCubics(cps, 1e-4 * Math.max(1, spread(cps))))
        segs.push({ kind: "cubic", start: c[0], end: c[3], c1: c[1], c2: c[2], src: e.id });
    }
  }
  return { segs, circles };
}

const spread = (pts: Vec2[]) => {
  const b = emptyBox();
  for (const p of pts) boxAdd(b, p);
  return Math.max(b.maxX - b.minX, b.maxY - b.minY);
};

/** Polyline sample of a segment (for areas, containment and rendering fallbacks). */
export function segPoints(s: Seg, n = 16): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    if (s.kind === "line") out.push({ x: s.start.x + (s.end.x - s.start.x) * t, y: s.start.y + (s.end.y - s.start.y) * t });
    else if (s.kind === "arc") {
      const a = s.a0 + s.sweep * t;
      out.push({ x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) });
    } else {
      const u = 1 - t;
      out.push({
        x: u * u * u * s.start.x + 3 * u * u * t * s.c1.x + 3 * u * t * t * s.c2.x + t * t * t * s.end.x,
        y: u * u * u * s.start.y + 3 * u * u * t * s.c1.y + 3 * u * t * t * s.c2.y + t * t * t * s.end.y,
      });
    }
  }
  return out;
}

function polyArea(pts: Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function loopPolygon(l: Loop, n = 16): Vec2[] {
  const pts: Vec2[] = [];
  for (const s of l.segs) pts.push(...segPoints(s, s.kind === "line" ? 1 : n).slice(0, -1));
  return pts;
}

export function pointInPolygon(p: Vec2, poly: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

interface Graph {
  nodes: Vec2[];
  edges: { sg: Seg; a: number; b: number; used: boolean }[];
  adj: Map<number, number[]>;
}

/** Endpoints clustered into nodes (tolerance relative to the geometry size). */
function graphOf(segs: Seg[], tol: number): Graph {
  const nodes: Vec2[] = [];
  const nodeOf = (p: Vec2) => {
    for (let i = 0; i < nodes.length; i++) if (dist(nodes[i], p) <= tol) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges = segs.map((sg) => ({ sg, a: nodeOf(sg.start), b: nodeOf(sg.end), used: false }));
  const adj = new Map<number, number[]>();
  edges.forEach((e, i) => {
    for (const n of [e.a, e.b]) {
      let l = adj.get(n);
      if (!l) adj.set(n, (l = []));
      l.push(i);
    }
  });
  return { nodes, edges, adj };
}

/** Snap a chain's joints exactly (each piece ends where the next starts). */
function snapJoints(path: Seg[], closed: boolean): Seg[] {
  const n = closed ? path.length : path.length - 1;
  for (let k = 0; k < n; k++) {
    const nxt = path[(k + 1) % path.length];
    path[k] = { ...path[k], end: nxt.start };
  }
  return path;
}

/**
 * Closed loops of the graph. A walk that does not come back to its start (it ran into a dead end or
 * a side loop) gives its edges back, so a tail or a side branch does not stop a loop being found.
 * Marks the edges of every loop used.
 */
function findLoops(g: Graph): Seg[][] {
  const { edges, adj } = g;
  const loops: Seg[][] = [];
  for (let i = 0; i < edges.length; i++) {
    if (edges[i].used) continue;
    const path: Seg[] = [];
    const walked: number[] = [];
    let cur = i;
    let at = edges[i].a;
    const startNode = at;
    let closed = false;
    for (let guard = 0; guard <= edges.length; guard++) {
      const e = edges[cur];
      e.used = true;
      walked.push(cur);
      const forward = e.a === at;
      path.push(forward ? e.sg : reverse(e.sg));
      at = forward ? e.b : e.a;
      if (at === startNode) {
        closed = true;
        break;
      }
      const next = (adj.get(at) ?? []).find((k) => !edges[k].used);
      if (next === undefined) break;
      cur = next;
    }
    if (!closed) {
      for (const k of walked) edges[k].used = false;
      continue;
    }
    loops.push(snapJoints(path, true));
  }
  return loops;
}

/**
 * Open chains from the edges not in a loop: runs between nodes where the chain ends or branches
 * (any node not joining exactly two remaining pieces). Any left-over ring is returned closed.
 */
function findOpenChains(g: Graph): { segs: Seg[]; closed: boolean }[] {
  const { edges, adj } = g;
  // Ends and branch points of what is left after the loops: open chains start and stop there.
  const stops = new Set<number>();
  for (const [n, l] of adj) {
    const d = l.filter((k) => !edges[k].used).length;
    if (d > 0 && d !== 2) stops.add(n);
  }
  const out: { segs: Seg[]; closed: boolean }[] = [];
  const walk = (cur: number, at: number) => {
    const startNode = at;
    const path: Seg[] = [];
    for (let guard = 0; guard <= edges.length; guard++) {
      const e = edges[cur];
      e.used = true;
      const forward = e.a === at;
      path.push(forward ? e.sg : reverse(e.sg));
      at = forward ? e.b : e.a;
      if (at === startNode && !stops.has(at)) return void out.push({ segs: snapJoints(path, true), closed: true });
      if (stops.has(at)) break;
      const next = (adj.get(at) ?? []).find((k) => !edges[k].used);
      if (next === undefined) break;
      cur = next;
    }
    out.push({ segs: snapJoints(path, false), closed: false });
  };
  for (const n of stops) for (const k of adj.get(n) ?? []) if (!edges[k].used) walk(k, n);
  for (let i = 0; i < edges.length; i++) if (!edges[i].used) walk(i, edges[i].a);
  return out;
}

function sizeTol(segs: Seg[], circles: Loop[]): { bounds: Box; tol: number } {
  const bounds = emptyBox();
  for (const sg of segs) for (const p of segPoints(sg, 8)) boxAdd(bounds, p);
  for (const c of circles) for (const sg of c.segs) for (const p of segPoints(sg, 8)) boxAdd(bounds, p);
  const size = Math.max(1, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  return { bounds, tol: 1e-5 * size };
}

/** One connected run of non-construction geometry, in walk order. */
export interface RawChain {
  segs: Seg[];
  closed: boolean;
  /** Signed area (closed chains; 0 for open ones). */
  area: number;
}

/**
 * Every non-construction curve of a sketch, chained: closed loops (profiles, circles included) and
 * open chains between ends and branch points. Each piece belongs to exactly one chain.
 */
export function buildChains(s: Sketch): RawChain[] {
  const { segs, circles } = collect(s);
  const { tol } = sizeTol(segs, circles);
  const g = graphOf(segs, tol);
  const out: RawChain[] = circles.map((c) => ({ segs: c.segs, closed: true, area: c.area }));
  for (const path of findLoops(g)) out.push({ segs: path, closed: true, area: polyArea(loopPolygon({ segs: path, area: 0 })) });
  for (const c of findOpenChains(g)) out.push({ ...c, area: c.closed ? polyArea(loopPolygon({ segs: c.segs, area: 0 })) : 0 });
  return out;
}

/** Orient loops in place by nesting depth (even depth CCW, odd CW), so holes cut with nonzero fill. */
export function orientNested(loops: Loop[]): Loop[] {
  const polys = loops.map((l) => loopPolygon(l));
  loops.forEach((l, i) => {
    const probe = polys[i][0];
    let depth = 0;
    loops.forEach((_, j) => {
      if (j !== i && Math.abs(loops[j].area) > Math.abs(l.area) && pointInPolygon(probe, polys[j])) depth++;
    });
    const wantCCW = depth % 2 === 0;
    if (l.area > 0 !== wantCCW) {
      l.segs = reverseChain(l.segs);
      l.area = -l.area;
    }
  });
  return loops;
}

/** Distance from p to a segment. */
function distToSeg(p: Vec2, sg: Seg): number {
  if (sg.kind === "line") return distToSegment(p, sg.start, sg.end);
  if (sg.kind === "arc") {
    const lo = sg.sweep >= 0 ? sg.a0 : sg.a0 + sg.sweep;
    if (normAngle(Math.atan2(p.y - sg.c.y, p.x - sg.c.x) - lo) > Math.abs(sg.sweep) + 1e-9) return Math.min(dist(p, sg.start), dist(p, sg.end));
    return Math.abs(dist(p, sg.c) - sg.r);
  }
  return bezierClosest([sg.start, sg.c1, sg.c2, sg.end], p).d;
}

/** Points that have a coincident relation to a curve (they sit on it, usually mid-span). */
function curveJoints(s: Sketch): Vec2[] {
  const out: Vec2[] = [];
  for (const r of Object.values(s.relations ?? {})) {
    if (r.type !== "coincident" || r.refs.length !== 2) continue;
    const [a, b] = r.refs.map((id) => s.entities[id]);
    if (!a || !b) continue;
    const pt = a.type === "point" && b.type !== "point" ? a : b.type === "point" && a.type !== "point" ? b : null;
    if (pt?.type === "point") out.push({ x: pt.x, y: pt.y });
  }
  return out;
}

/** Build closed loops; orient them so nested loops alternate direction (holes render with nonzero). */
export function buildOutline(s: Sketch, diagnostics = true): Outline {
  const { segs, circles } = collect(s);
  const { bounds, tol } = sizeTol(segs, circles);
  const g = graphOf(segs, tol);
  const joints = curveJoints(s);
  // Hanging ends only: an end shared by no other segment, not made coincident with a curve, and not
  // lying along another segment. Junctions (3+ ends at a point, T-junctions) are deliberate.
  const openEnds: Vec2[] = [];
  const eps = tol * 10;
  const curveSegs = [...segs, ...circles.flatMap((c) => c.segs)];
  for (const [n, l] of g.adj) {
    if (l.length !== 1) continue;
    const q = g.nodes[n];
    if (joints.some((j) => dist(j, q) <= tol)) continue;
    if (curveSegs.some((sg) => dist(sg.start, q) > tol && dist(sg.end, q) > tol && distToSeg(q, sg) <= eps)) continue;
    openEnds.push(q);
  }
  const loops: Loop[] = [...circles];
  for (const path of findLoops(g)) loops.push({ segs: path, area: polyArea(loopPolygon({ segs: path, area: 0 })) });
  orientNested(loops);
  // Self-intersections: any two segments of the outline crossing away from shared endpoints.
  const selfIntersections: Vec2[] = [];
  const all = diagnostics ? loops.flatMap((l) => l.segs) : [];
  const boxes = all.map((sg) => {
    const b = emptyBox();
    for (const p of segPoints(sg, 8)) boxAdd(b, p);
    return b;
  });
  const pad = tol * 10;
  for (let i = 0; i < all.length; i++)
    for (let j = i + 1; j < all.length; j++) {
      const A = boxes[i];
      const B = boxes[j];
      if (A.minX > B.maxX + pad || B.minX > A.maxX + pad || A.minY > B.maxY + pad || B.minY > A.maxY + pad) continue;
      for (const h of intersect(segCurve(all[i]), segCurve(all[j]))) {
        const nearEnd = [all[i].start, all[i].end, all[j].start, all[j].end].some((p) => dist(p, h.p) < tol * 10);
        if (!nearEnd && !selfIntersections.some((q) => dist(q, h.p) < tol * 10)) selfIntersections.push(h.p);
      }
    }
  return { loops, openEnds, selfIntersections, bounds };
}

export function segCurve(s: Seg): Curve {
  if (s.kind === "line") return { kind: "line", a: s.start, b: s.end };
  if (s.kind === "arc") {
    const a0 = s.sweep >= 0 ? s.a0 : s.a0 + s.sweep;
    return { kind: "arc", c: s.c, r: s.r, a0, a1: a0 + Math.abs(s.sweep) };
  }
  return { kind: "bezier", cps: [s.start, s.c1, s.c2, s.end] };
}


const docCache = new WeakMap<Doc, { diag: boolean; o: Outline }>();

/**
 * Outline of the document: every visible sketch, each chained into loops on its own (a loop never
 * runs through two sketches), drawn together.
 */
export function docOutline(doc: Doc, diagnostics = true): Outline {
  const hit = docCache.get(doc);
  if (hit && (hit.diag || !diagnostics)) return hit.o;
  const parts = doc.features.filter((f) => f.visible).map((f) => buildOutline(f.sketch, diagnostics));
  const bounds = emptyBox();
  for (const p of parts) if (p.bounds.minX <= p.bounds.maxX) (boxAdd(bounds, { x: p.bounds.minX, y: p.bounds.minY }), boxAdd(bounds, { x: p.bounds.maxX, y: p.bounds.maxY }));
  const o: Outline = {
    loops: parts.flatMap((p) => p.loops),
    openEnds: parts.flatMap((p) => p.openEnds),
    selfIntersections: parts.flatMap((p) => p.selfIntersections),
    bounds,
  };
  docCache.set(doc, { diag: diagnostics, o });
  return o;
}
