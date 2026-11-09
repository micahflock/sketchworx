/**
 * Print mode regions: the art flattened into one area per filament that tile the part with no
 * overlaps, the printability rules, and the first layer as the nozzle lays it down. Pure functions
 * on Clipper2 integer paths (SCALE units per mm), no DOM.
 */
import { Clipper, ClipType, EndType, FillRule, JoinType, PolyTree64 } from "@countertype/clipper2-ts";
import type { Path64, Paths64, PolyPath64 } from "@countertype/clipper2-ts";
import type { Box, Vec2 } from "../geom/vec";
import { boxAdd, emptyBox } from "../geom/vec";
import { artScene, MITER_LIMIT, samplePolyline } from "./art";
import type { ArtScene, Chain } from "./art";
import { minFeature } from "./print";
import type { Doc, Id } from "./types";

/** Integer units per mm (0.1 µm). */
export const SCALE = 10_000;
/** Curves are sampled to this chord error, in mm. */
export const SAMPLE_TOL = 0.001;
/** Pieces smaller than this (mm²) are numeric noise, not design. */
const SLIVER = 0.001;
/** Round offsets follow the true arc to this error (mm). */
const ARC_TOL = 0.0005;

const S = SCALE;
const toP = (pts: Vec2[]): Path64 => pts.map((p) => ({ x: Math.round(p.x * S), y: Math.round(p.y * S) }));
export const fromP = (path: Path64): Vec2[] => path.map((p) => ({ x: p.x / S, y: p.y / S }));
const NZ = FillRule.NonZero;

export const union = (a: Paths64, b: Paths64 = []): Paths64 => (a.length + b.length ? Clipper.union(a, b, NZ) : []);
export const minus = (a: Paths64, b: Paths64): Paths64 => (!a.length ? [] : !b.length ? a : Clipper.difference(a, b, NZ));
export const intersect = (a: Paths64, b: Paths64): Paths64 => (!a.length || !b.length ? [] : Clipper.intersect(a, b, NZ));
/** Grow (d > 0) or shrink (d < 0) closed areas by `d` mm with round corners. */
export function offset(a: Paths64, d: number): Paths64 {
  if (!a.length || d === 0) return a;
  return Clipper.inflatePaths(a, d * S, JoinType.Round, EndType.Polygon, 2, ARC_TOL * S);
}
/** Shrink then grow: what a round tool of radius r can cover. */
export const opening = (a: Paths64, r: number): Paths64 => offset(offset(a, -r), r);
/** Area in mm². */
export const areaOf = (a: Paths64): number => Clipper.areaPaths(a) / (S * S);
const dropSlivers = (a: Paths64): Paths64 => {
  // Keep holes with their outer path: drop only whole components that are tiny.
  return components(a)
    .filter((c) => areaOf(c) >= SLIVER)
    .flat();
};

/** Connected pieces, each an outer path followed by its holes. */
export function components(a: Paths64): Paths64[] {
  if (!a.length) return [];
  const tree = new PolyTree64();
  Clipper.booleanOpWithPolyTree(ClipType.Union, a, null, tree, NZ);
  const out: Paths64[] = [];
  const walk = (node: PolyPath64) => {
    for (let i = 0; i < node.count; i++) {
      const outer = node.child(i);
      const comp: Paths64 = [outer.polygon!];
      for (let j = 0; j < outer.count; j++) {
        const hole = outer.child(j);
        comp.push(hole.polygon!);
        walk(hole); // islands inside the hole
      }
      out.push(comp);
    }
  };
  walk(tree);
  return out;
}

export function boundsOf(a: Paths64): Box {
  const b = emptyBox();
  for (const path of a) for (const p of path) boxAdd(b, { x: p.x / S, y: p.y / S });
  return b;
}

// ------------------------------------------------------------------ art → shapes

/** One piece of paint, in painting order. */
interface Paint {
  chain: Chain;
  filament: string;
  area: Paths64;
}

function strokeArea(s: ArtScene["strokes"][number]): Paths64 {
  const w = s.style.weight;
  if (w <= 0 || s.path.length < 2) return [];
  const end = s.chain.closed ? EndType.Joined : s.cap === "round" ? EndType.Round : EndType.Butt;
  const join = s.join === "round" ? JoinType.Round : JoinType.Miter;
  return Clipper.inflatePaths([toP(s.path)], (w / 2) * S, join, end, MITER_LIMIT, ARC_TOL * S);
}

function loopArea(segs: Chain["segs"]): Path64 {
  return toP(samplePolyline(segs, true, SAMPLE_TOL).pts);
}

function paintOrder(scene: ArtScene, filamentOf: (c: Chain) => string): Paint[] {
  const out: Paint[] = [];
  for (const layer of scene.layers) {
    for (const f of layer.fills) out.push({ chain: f.chain, filament: filamentOf(f.chain), area: union(f.loops.map((l) => loopArea(l.segs))) });
    for (const s of layer.strokes) {
      const area = strokeArea(s);
      if (area.length) out.push({ chain: s.chain, filament: filamentOf(s.chain), area: union(area) });
    }
  }
  return out;
}

// ------------------------------------------------------------------ flattening

export interface Region {
  filament: string;
  area: Paths64;
}

export interface Regions {
  /** The part: the outline profile and its own stroke. Empty when there is no closed profile. */
  part: Paths64;
  /** Chain key of the outline profile. */
  outline: Id | null;
  /** One per filament in slot / print order (empty areas included). */
  regions: Region[];
  /** Art outside the part (not printed). */
  outside: Paths64;
  bounds: Box;
}

/** The chain used as the part outline: the chosen one, else the largest filled profile, else the largest profile. */
export function outlineChain(doc: Doc, scene: ArtScene): Chain | null {
  const want = doc.print?.outline;
  const closed = scene.strokes.filter((s) => s.chain.closed);
  if (want) {
    const hit = closed.find((s) => s.chain.ids.includes(want));
    if (hit) return hit.chain;
  }
  const pick = (list: typeof closed) => list.reduce<Chain | null>((b, s) => (!b || s.chain.area > b.area ? s.chain : b), null);
  return pick(closed.filter((s) => s.style.fill)) ?? pick(closed);
}

const cache = new WeakMap<Doc, Regions>();

/** Flatten the art: later paint covers earlier, everything clipped to the part, the rest is the base. */
export function buildRegions(doc: Doc): Regions {
  const hit = cache.get(doc);
  if (hit) return hit;
  const pr = doc.print!;
  const scene = artScene(doc, SAMPLE_TOL);
  const ids = new Set(pr.filaments.map((f) => f.id));
  const filamentOf = (c: Chain): string => {
    for (const id of c.ids) {
      const f = doc.art?.styles[id]?.filament;
      if (f && ids.has(f)) return f;
    }
    return ids.has(pr.ink) ? pr.ink : pr.filaments[0].id;
  };
  const paints = paintOrder(scene, filamentOf);
  const oc = outlineChain(doc, scene);
  let part: Paths64 = [];
  if (oc) {
    const own = paints.filter((p) => p.chain.key === oc.key).map((p) => p.area);
    part = union([loopArea(oc.segs), ...own.flat()]);
  }
  // Top paint first: each takes what is not yet covered.
  const per = new Map<string, Paths64[]>();
  let covered: Paths64 = [];
  for (let i = paints.length - 1; i >= 0; i--) {
    const p = paints[i];
    const piece = minus(p.area, covered);
    if (piece.length) {
      const list = per.get(p.filament) ?? [];
      list.push(piece);
      per.set(p.filament, list);
    }
    covered = union(covered, p.area);
  }
  const regions: Region[] = pr.filaments.map((f) => {
    let area = intersect(union((per.get(f.id) ?? []).flat()), part);
    if (f.id === pr.base) area = union(area, minus(part, covered));
    return { filament: f.id, area: dropSlivers(area) };
  });
  const outside = dropSlivers(minus(covered, part));
  const bounds = boundsOf(union(part, outside));
  const out: Regions = { part, outline: oc?.key ?? null, regions, outside, bounds };
  cache.set(doc, out);
  return out;
}

// ------------------------------------------------------------------ rules

export interface Break {
  kind: "thin" | "neck";
  filament: string;
  /** Narrowest width found (mm). */
  width: number;
  /** The material that would not print, for marking. */
  area: Paths64;
  at: Vec2;
}

export interface RuleReport {
  breaks: Break[];
  /** Material lost in total (mm²), to tell whether an edit made things worse. */
  lost: number;
}

/** Largest d (to 1 µm) for which `ok(d)` still holds, searched in [0, hi]. */
function search(ok: (d: number) => boolean, hi: number): number {
  let lo = 0;
  if (ok(hi)) return hi;
  for (let k = 0; k < 20 && hi - lo > 0.0005; k++) {
    const m = (lo + hi) / 2;
    if (ok(m)) lo = m;
    else hi = m;
  }
  return lo;
}

const centerOf = (a: Paths64): Vec2 => {
  const b = boundsOf(a);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
};

/**
 * Parts of a region narrower than the minimum feature:
 * - a piece that a round tool of the minimum width cannot enter at all (a thin strip or a tiny island);
 * - a neck: the tool gets into the piece but not from one side of it to the other;
 * - a narrow stub off a wide part (what the tool leaves out is larger than a sharp corner leaves).
 * Corners are not breaks: the nozzle rounds every corner and the As printed preview shows it.
 */
export function regionBreaks(area: Paths64, filament: string, minW: number): Break[] {
  const r = minW / 2;
  const eps = 0.0005;
  const out: Break[] = [];
  for (const comp of components(area)) {
    const core = components(offset(comp, -(r - eps)));
    if (!core.length) {
      const d = search((x) => offset(comp, -x).length > 0, r);
      out.push({ kind: "thin", filament, width: 2 * d, area: comp, at: centerOf(comp) });
      continue;
    }
    const opened = core.map((c) => offset(c, r - eps));
    const rest = components(minus(comp, union(opened.flat())));
    const inNeck = new Set<Paths64>();
    if (core.length > 1) {
      // The neck: what is left over between the reachable parts.
      const neck = rest.filter((piece) => {
        const near = offset(piece, 0.002);
        return opened.filter((o) => intersect(near, o).length).length >= 2;
      });
      const d = search((x) => components(offset(comp, -x)).length <= 1, r);
      for (const n of neck) inNeck.add(n);
      const a = neck.length ? neck.flat() : comp;
      out.push({ kind: "neck", filament, width: 2 * d, area: a, at: centerOf(a) });
    }
    // Stubs: anything left out larger than a corner of about 20° or more leaves.
    for (const piece of rest) {
      if (inNeck.has(piece) || areaOf(piece) <= 4 * r * r) continue;
      const d = search((x) => offset(piece, -x).length > 0, r);
      out.push({ kind: "thin", filament, width: 2 * d, area: piece, at: centerOf(piece) });
    }
  }
  return out;
}

const ruleCache = new WeakMap<Doc, RuleReport>();

export function checkRules(doc: Doc): RuleReport {
  const hit = ruleCache.get(doc);
  if (hit) return hit;
  const pr = doc.print!;
  const minW = minFeature(pr.printer);
  const breaks = buildRegions(doc).regions.flatMap((reg) => regionBreaks(reg.area, reg.filament, minW));
  const rep = { breaks, lost: breaks.reduce((t, b) => t + areaOf(b.area), 0) };
  ruleCache.set(doc, rep);
  return rep;
}

/** An edit may fix or keep breaks, never add one or lose more material. */
export function isWorse(before: RuleReport, after: RuleReport): boolean {
  if (after.breaks.length > before.breaks.length) return true;
  return after.lost > before.lost * 1.01 + 0.001;
}

// ------------------------------------------------------------------ first layer as printed

export interface FirstLayer {
  /** What each filament covers, in print order. */
  laid: Region[];
  /** Bare bed inside the part. */
  pinholes: Paths64;
  count: number;
  /** Largest pinhole across (mm). */
  largest: number;
}

const layerCache = new WeakMap<Doc, FirstLayer>();

/**
 * Colors go down in print order. Each is what a round nozzle of the first-layer width can draw of
 * its region, spread by the squish into space that is still empty (not into plastic already down,
 * not outside the part). What is left uncovered is bare bed.
 */
export function firstLayer(doc: Doc): FirstLayer {
  const hit = layerCache.get(doc);
  if (hit) return hit;
  const pr = doc.print!;
  const { part, regions } = buildRegions(doc);
  const r = pr.printer.firstLayerWidth / 2;
  let taken: Paths64 = [];
  const laid: Region[] = [];
  for (const reg of regions) {
    const drawn = opening(reg.area, r);
    const spread = pr.printer.squish > 0 ? intersect(offset(drawn, pr.printer.squish), part) : drawn;
    const area = minus(spread, taken);
    laid.push({ filament: reg.filament, area });
    taken = union(taken, area);
  }
  // Uncovered spots that reach the part's edge are just its corners rounding, not holes.
  const holes = components(minus(part, taken)).filter((c) => areaOf(c) > 1e-6 && !minus(offset(c, 0.002), part).length);
  let largest = 0;
  for (const h of holes) {
    const b = boundsOf(h);
    largest = Math.max(largest, b.maxX - b.minX, b.maxY - b.minY);
  }
  const out = { laid, pinholes: holes.flat(), count: holes.length, largest };
  layerCache.set(doc, out);
  return out;
}

/** Path data for a canvas Path2D, y flipped (sketch y-up → screen y-down); `mirrorX` flips about x = mx. */
export function pathData(a: Paths64, mirrorAt?: number): string {
  const parts: string[] = [];
  for (const path of a) {
    if (path.length < 3) continue;
    parts.push(
      path
        .map((p, i) => {
          const x = p.x / S;
          return `${i ? "L" : "M"}${mirrorAt === undefined ? x : 2 * mirrorAt - x} ${-p.y / S}`;
        })
        .join("") + "Z",
    );
  }
  return parts.join("");
}
