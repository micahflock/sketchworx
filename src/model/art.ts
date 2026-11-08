/**
 * Art view: every non-construction curve is drawn as a stroke. Curves are grouped into chains (open
 * runs and closed profiles); each chain has a weight, a side its stroke grows on, and (profiles only)
 * a fill. Styles are stored per curve on the Doc, so they survive edits that do not touch the solver.
 * Pure functions, no DOM.
 */
import type { Box, Vec2 } from "../geom/vec";
import { boxAdd, emptyBox } from "../geom/vec";
import type { Loop, Seg } from "./outline";
import { buildChains, loopPolygon, orientNested, pointInPolygon, reverseChain, segPoints } from "./outline";
import type { ArtSettings, ArtSide, ArtStyle, Doc, Id, Sketch } from "./types";

export const DEFAULT_ART_WEIGHT = 2;
/** Sharper corners than this are beveled (offset strokes) or clipped (canvas/SVG strokes). */
export const MITER_LIMIT = 4;

export interface Chain {
  /** First curve of the chain in creation order: a stable handle for selection. */
  key: Id;
  /** Curves in the chain, in creation order. */
  ids: Id[];
  /** Pieces in order. Profiles run CCW (left is inside); open chains run along their key curve. */
  segs: Seg[];
  closed: boolean;
  /** Enclosed area (profiles; 0 for open chains). */
  area: number;
  feature: Id;
}

const sketchCache = new WeakMap<Sketch, { feature: Id; chains: Chain[] }>();

function sketchChains(s: Sketch, feature: Id): Chain[] {
  const hit = sketchCache.get(s);
  if (hit && hit.feature === feature) return hit.chains;
  const order = new Map(Object.keys(s.entities).map((id, i) => [id, i]));
  const chains = buildChains(s).map((raw): Chain => {
    const ids = Array.from(new Set(raw.segs.map((g) => g.src))).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    const key = ids[0];
    let segs = raw.segs;
    let area = raw.area;
    if (raw.closed) {
      if (area < 0) {
        segs = reverseChain(segs);
        area = -area;
      }
    } else if (segs.find((g) => g.src === key)?.rev) segs = reverseChain(segs);
    return { key, ids, segs, closed: raw.closed, area, feature };
  });
  sketchCache.set(s, { feature, chains });
  return chains;
}

const docCache = new WeakMap<Doc, Chain[]>();

/** Chains of every visible sketch (each sketch chained on its own). */
export function docChains(doc: Doc): Chain[] {
  let c = docCache.get(doc);
  if (!c) docCache.set(doc, (c = doc.features.filter((f) => f.visible).flatMap((f) => sketchChains(f.sketch, f.id))));
  return c;
}

/** The chain that contains curve `id`. */
export function chainOf(chains: Chain[], id: Id): Chain | undefined {
  return chains.find((c) => c.ids.includes(id));
}

/** Chains containing any of `ids`, each once, in drawing order. */
export function chainsFor(chains: Chain[], ids: Id[]): Chain[] {
  if (!ids.length) return [];
  const want = new Set(ids);
  return chains.filter((c) => c.ids.some((id) => want.has(id)));
}

export function artWeight(doc: Doc): number {
  return doc.art?.weight ?? DEFAULT_ART_WEIGHT;
}

export interface ResolvedStyle {
  weight: number;
  side: ArtSide;
  fill: boolean;
  /** The weight is set on the chain (not the document default). */
  customWeight: boolean;
}

/** Stored style of a chain: the first of its curves (creation order) that has one. */
function storedStyle(doc: Doc, c: Chain): ArtStyle | undefined {
  const styles = doc.art?.styles;
  if (!styles) return undefined;
  for (const id of c.ids) if (styles[id]) return styles[id];
  return undefined;
}

export function chainStyle(doc: Doc, c: Chain): ResolvedStyle {
  const s = storedStyle(doc, c);
  return {
    weight: s?.weight ?? artWeight(doc),
    side: s?.side ?? "center",
    fill: c.closed && !!s?.fill,
    customWeight: s?.weight !== undefined,
  };
}

/** Changes to a chain's style. `weight: null` goes back to the document default. */
export interface StylePatch {
  weight?: number | null;
  side?: ArtSide;
  fill?: boolean;
}

/** Apply a style change to whole chains (written to every curve, so pieces split off keep it). */
export function setChainStyle(doc: Doc, chains: Chain[], patch: StylePatch): Doc {
  if (!chains.length) return doc;
  const styles = { ...(doc.art?.styles ?? {}) };
  for (const c of chains) {
    const next: ArtStyle = { ...(storedStyle(doc, c) ?? {}) };
    if (patch.weight === null) delete next.weight;
    else if (patch.weight !== undefined) next.weight = Math.max(0, patch.weight);
    if (patch.side === "center") delete next.side;
    else if (patch.side) next.side = patch.side;
    if (patch.fill !== undefined) {
      if (patch.fill && c.closed) next.fill = true;
      else delete next.fill;
    }
    const empty = next.weight === undefined && next.side === undefined && !next.fill;
    for (const id of c.ids) {
      if (empty) delete styles[id];
      else styles[id] = next;
    }
  }
  return { ...doc, art: { weight: artWeight(doc), styles } };
}

/** Change the default stroke weight (chains with their own weight keep it). */
export function setArtWeight(doc: Doc, weight: number): Doc {
  const w = Math.max(0, weight);
  if (w === artWeight(doc)) return doc;
  return { ...doc, art: { weight: w, styles: doc.art?.styles ?? {} } };
}

/** Art settings with styles of curves that no longer exist dropped (for saving). */
export function prunedArt(doc: Doc): ArtSettings | undefined {
  const art = doc.art;
  if (!art) return undefined;
  const styles: Record<Id, ArtStyle> = {};
  for (const [id, st] of Object.entries(art.styles)) if (doc.features.some((f) => f.sketch.entities[id])) styles[id] = st;
  return { weight: art.weight, styles };
}

// ------------------------------------------------------------------ geometry

/** Pieces per segment so the chord error stays under `tol`. */
function pieces(s: Seg, tol: number): number {
  if (s.kind === "line") return 1;
  if (s.kind === "arc") {
    const step = 2 * Math.acos(Math.max(-1, 1 - tol / Math.max(s.r, 1e-12)));
    return Math.min(720, Math.max(2, Math.ceil(Math.abs(s.sweep) / Math.max(step, 1e-3))));
  }
  // Wang's formula for a cubic.
  const d1 = Math.hypot(s.start.x - 2 * s.c1.x + s.c2.x, s.start.y - 2 * s.c1.y + s.c2.y);
  const d2 = Math.hypot(s.c1.x - 2 * s.c2.x + s.end.x, s.c1.y - 2 * s.c2.y + s.end.y);
  return Math.min(256, Math.max(2, Math.ceil(Math.sqrt((1.5 * Math.max(d1, d2)) / tol))));
}

/** A chain as a polyline (closed chains do not repeat the first point). */
export function chainPolyline(segs: Seg[], closed: boolean, tol: number): Vec2[] {
  const out: Vec2[] = [];
  segs.forEach((s, i) => {
    const pts = segPoints(s, pieces(s, tol));
    out.push(...(i === 0 ? pts : pts.slice(1)));
  });
  if (closed && out.length > 1) out.pop();
  return out;
}

const perp = (t: Vec2): Vec2 => ({ x: -t.y, y: t.x });

/**
 * The polyline moved sideways by `d` (positive: to the left of its direction), with mitered
 * corners; corners sharper than the miter limit are beveled.
 */
export function offsetPolyline(input: Vec2[], d: number, closed: boolean, miterLimit = MITER_LIMIT): Vec2[] {
  const pts: Vec2[] = [];
  for (const p of input) {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-12) pts.push(p);
  }
  if (closed && pts.length > 2) {
    const a = pts[0];
    const z = pts[pts.length - 1];
    if (Math.hypot(a.x - z.x, a.y - z.y) <= 1e-12) pts.pop();
  }
  const n = pts.length;
  if (n < 2 || d === 0) return pts.slice();
  const dir = (i: number): Vec2 => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const v = pts[i];
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    if (!hasPrev || !hasNext) {
      const nn = perp(dir(hasNext ? i : i - 1));
      out.push({ x: v.x + nn.x * d, y: v.y + nn.y * d });
      continue;
    }
    const n1 = perp(dir((i - 1 + n) % n));
    const n2 = perp(dir(i));
    const m = { x: n1.x + n2.x, y: n1.y + n2.y };
    const ml = Math.hypot(m.x, m.y);
    const cos = ml / 2; // cos of half the turn between the two normals
    if (ml < 1e-9 || 1 / cos > miterLimit) {
      out.push({ x: v.x + n1.x * d, y: v.y + n1.y * d }, { x: v.x + n2.x * d, y: v.y + n2.y * d });
      continue;
    }
    const k = d / cos / ml;
    out.push({ x: v.x + m.x * k, y: v.y + m.y * k });
  }
  return out;
}

/** Distance from `p` to a polyline. */
export function distToPolyline(p: Vec2, pts: Vec2[], closed: boolean): number {
  if (pts.length === 1) return Math.hypot(p.x - pts[0].x, p.y - pts[0].y);
  let best = Infinity;
  const m = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < m; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
}

// ------------------------------------------------------------------ scene

export interface ArtStroke {
  chain: Chain;
  style: ResolvedStyle;
  /** The chain itself, as a polyline. */
  center: Vec2[];
  /** Where the stroke runs: the chain, or for a side stroke the chain moved half the weight over. */
  path: Vec2[];
  /** True when `path` is the chain itself (exact curves can be drawn instead). */
  centered: boolean;
}

export interface ArtScene {
  strokes: ArtStroke[];
  /** Filled profiles, nested ones oriented as holes (nonzero fill). */
  fills: Loop[];
  /** Everything drawn, stroke widths included. */
  bounds: Box;
}

/** Stroke and fill geometry of the document. `tol` is the sampling tolerance in sketch units. */
export function buildArtScene(doc: Doc, tol: number): ArtScene {
  const strokes: ArtStroke[] = [];
  const fills: Loop[] = [];
  const bounds = emptyBox();
  for (const chain of docChains(doc)) {
    const style = chainStyle(doc, chain);
    const center = chainPolyline(chain.segs, chain.closed, tol);
    const w = style.weight;
    const centered = style.side === "center" || w === 0;
    const path = centered ? center : offsetPolyline(center, style.side === "left" ? w / 2 : -w / 2, chain.closed);
    strokes.push({ chain, style, center, path, centered });
    const pad = w / 2;
    for (const p of path) {
      boxAdd(bounds, { x: p.x - pad, y: p.y - pad });
      boxAdd(bounds, { x: p.x + pad, y: p.y + pad });
    }
    for (const p of center) boxAdd(bounds, p);
    if (style.fill) fills.push({ segs: chain.segs.slice(), area: chain.area });
  }
  orientNested(fills);
  return { strokes, fills, bounds };
}

const sceneCache = new WeakMap<Doc, Map<number, ArtScene>>();

/** Cached scene; the tolerance is rounded to half powers of two so zooming reuses it. */
export function artScene(doc: Doc, tol: number): ArtScene {
  const q = Math.pow(2, Math.round(Math.log2(Math.max(tol, 1e-9)) * 2) / 2);
  let m = sceneCache.get(doc);
  if (!m) sceneCache.set(doc, (m = new Map()));
  let sc = m.get(q);
  if (!sc) m.set(q, (sc = buildArtScene(doc, q)));
  return sc;
}

/**
 * The chain under `p`: the nearest stroke within `tol` of its painted band, else the smallest
 * filled profile containing the point.
 */
export function hitChain(scene: ArtScene, p: Vec2, tol: number): Chain | null {
  let best: Chain | null = null;
  let bestD = Infinity;
  for (const s of scene.strokes) {
    const d = Math.max(0, distToPolyline(p, s.path, s.chain.closed) - s.style.weight / 2);
    const dc = distToPolyline(p, s.center, s.chain.closed);
    const dd = Math.min(d, dc);
    if (dd <= tol && dd < bestD) {
      best = s.chain;
      bestD = dd;
    }
  }
  if (best) return best;
  let inside: ArtStroke | null = null;
  for (const s of scene.strokes) {
    if (!s.style.fill) continue;
    if (pointInPolygon(p, loopPolygon({ segs: s.chain.segs, area: s.chain.area })) && (!inside || s.chain.area < inside.chain.area)) inside = s;
  }
  return inside?.chain ?? null;
}
