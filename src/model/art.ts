/**
 * Art view: every non-construction curve is drawn as a stroke. Curves are grouped into chains (open
 * runs and closed profiles); each chain has a weight, a side its stroke grows on, and (profiles only)
 * a fill. Styles are stored per curve on the Doc, so they survive edits that do not touch the solver.
 * Pure functions, no DOM.
 */
import type { Box, Vec2 } from "../geom/vec";
import { boxAdd, emptyBox } from "../geom/vec";
import type { Loop, Seg } from "./outline";
import { buildChains, loopPolygon, pointInPolygon, reverseChain, segPoints } from "./outline";
import type { ArtDefaults, ArtSettings, ArtSide, ArtStyle, Doc, Id, Sketch } from "./types";

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

export const DEFAULT_ART_COLOR = "#000000";

/** The fields a chain can override, each falling back to the document default. */
export const OVERRIDABLE = ["weight", "color", "corner", "end"] as const;
export type Overridable = (typeof OVERRIDABLE)[number];

export function artDefaults(doc: Doc): ArtDefaults {
  const a = doc.art;
  return { weight: a?.weight ?? DEFAULT_ART_WEIGHT, color: a?.color ?? DEFAULT_ART_COLOR, corner: a?.corner ?? 0, end: a?.end ?? 0 };
}

export function artWeight(doc: Doc): number {
  return artDefaults(doc).weight;
}

export interface ResolvedStyle extends ArtDefaults {
  side: ArtSide;
  fill: boolean;
  /** Which fields are set on the chain rather than taken from the document defaults. */
  custom: Record<Overridable, boolean>;
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
  const d = artDefaults(doc);
  return {
    weight: s?.weight ?? d.weight,
    color: s?.color ?? d.color,
    corner: s?.corner ?? d.corner,
    end: s?.end ?? d.end,
    side: s?.side ?? "center",
    fill: c.closed && !!s?.fill,
    custom: { weight: s?.weight !== undefined, color: s?.color !== undefined, corner: s?.corner !== undefined, end: s?.end !== undefined },
  };
}

/** Changes to a chain's style. `null` for an overridable field goes back to the document default. */
export interface StylePatch {
  weight?: number | null;
  color?: string | null;
  corner?: number | null;
  end?: number | null;
  side?: ArtSide;
  fill?: boolean;
}

const HEX = /^#[0-9a-f]{6}$/i;
export const isArtColor = (v: unknown): v is string => typeof v === "string" && HEX.test(v);
const isLength = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;

/** Apply a style change to whole chains (written to every curve, so pieces split off keep it). */
export function setChainStyle(doc: Doc, chains: Chain[], patch: StylePatch): Doc {
  if (!chains.length) return doc;
  const styles = { ...(doc.art?.styles ?? {}) };
  for (const c of chains) {
    const next: ArtStyle = { ...(storedStyle(doc, c) ?? {}) };
    for (const k of ["weight", "corner", "end"] as const) {
      const v = patch[k];
      if (v === null) delete next[k];
      else if (v !== undefined) next[k] = Math.max(0, v);
    }
    if (patch.color === null) delete next.color;
    else if (isArtColor(patch.color)) next.color = patch.color.toLowerCase();
    if (patch.side === "center") delete next.side;
    else if (patch.side) next.side = patch.side;
    if (patch.fill !== undefined) {
      if (patch.fill && c.closed) next.fill = true;
      else delete next.fill;
    }
    const empty = Object.values(next).every((v) => v === undefined || v === false);
    for (const id of c.ids) {
      if (empty) delete styles[id];
      else styles[id] = next;
    }
  }
  return { ...doc, art: { ...(doc.art ?? { weight: DEFAULT_ART_WEIGHT }), styles } };
}

/** Change document defaults (chains that set a field themselves keep their value). */
export function setArtDefaults(doc: Doc, patch: Partial<ArtDefaults>): Doc {
  const cur = artDefaults(doc);
  const next: ArtDefaults = { ...cur };
  for (const k of ["weight", "corner", "end"] as const) if (isLength(patch[k])) next[k] = patch[k] as number;
  if (isArtColor(patch.color)) next.color = patch.color.toLowerCase();
  if (OVERRIDABLE.every((k) => next[k] === cur[k])) return doc;
  return { ...doc, art: { ...next, styles: doc.art?.styles ?? {} } };
}

/** Change the default stroke weight (chains with their own weight keep it). */
export function setArtWeight(doc: Doc, weight: number): Doc {
  return setArtDefaults(doc, { weight: Math.max(0, weight) });
}

/** Art settings with styles of curves that no longer exist dropped (for saving). */
export function prunedArt(doc: Doc): ArtSettings | undefined {
  const art = doc.art;
  if (!art) return undefined;
  const styles: Record<Id, ArtStyle> = {};
  for (const [id, st] of Object.entries(art.styles)) if (doc.features.some((f) => f.sketch.entities[id])) styles[id] = st;
  return { ...art, styles };
}

/** Art settings read from a file; anything malformed is dropped. */
export function readArtSettings(raw: any): ArtSettings | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const styles: Record<Id, ArtStyle> = {};
  if (raw.styles && typeof raw.styles === "object")
    for (const [id, st] of Object.entries<any>(raw.styles)) {
      if (!st || typeof st !== "object") continue;
      const out: ArtStyle = {};
      for (const k of ["weight", "corner", "end"] as const) if (isLength(st[k])) out[k] = st[k];
      if (isArtColor(st.color)) out.color = st.color.toLowerCase();
      if (st.side === "left" || st.side === "right") out.side = st.side;
      if (st.fill === true) out.fill = true;
      if (Object.keys(out).length) styles[id] = out;
    }
  const out: ArtSettings = { weight: isLength(raw.weight) ? raw.weight : DEFAULT_ART_WEIGHT, styles };
  if (isArtColor(raw.color)) out.color = raw.color.toLowerCase();
  if (isLength(raw.corner)) out.corner = raw.corner;
  if (isLength(raw.end)) out.end = raw.end;
  return out;
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

/**
 * Round the corners of a closed polygon. `radius(i, convex)` gives the radius at vertex i; convex is
 * judged for a polygon whose inside is on the right of its direction. A fillet never uses more than
 * half of either neighbouring edge, so neighbouring fillets cannot overlap.
 */
export function roundPolygon(pts: Vec2[], radius: (i: number, convex: boolean) => number, tol: number): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const p = pts[(i - 1 + n) % n];
    const v = pts[i];
    const q = pts[(i + 1) % n];
    const l1 = Math.hypot(v.x - p.x, v.y - p.y);
    const l2 = Math.hypot(q.x - v.x, q.y - v.y);
    if (l1 < 1e-12 || l2 < 1e-12) {
      out.push(v);
      continue;
    }
    const d1 = { x: (v.x - p.x) / l1, y: (v.y - p.y) / l1 };
    const d2 = { x: (q.x - v.x) / l2, y: (q.y - v.y) / l2 };
    const cross = d1.x * d2.y - d1.y * d2.x;
    const turn = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
    const r = radius(i, cross < 0);
    if (r <= 0 || turn < 1e-6 || turn > Math.PI - 1e-6) {
      out.push(v);
      continue;
    }
    const t = Math.min(r * Math.tan(turn / 2), l1 / 2, l2 / 2);
    const rr = t / Math.tan(turn / 2);
    const sgn = cross > 0 ? 1 : -1; // left turn: the arc's center is on the left
    const st = { x: v.x - d1.x * t, y: v.y - d1.y * t };
    const c = { x: st.x - d1.y * rr * sgn, y: st.y + d1.x * rr * sgn };
    const step = 2 * Math.acos(Math.max(-1, 1 - tol / Math.max(rr, 1e-12)));
    const k = Math.min(64, Math.max(1, Math.ceil(turn / Math.max(step, 1e-3))));
    const a0 = Math.atan2(st.y - c.y, st.x - c.x);
    for (let j = 0; j <= k; j++) {
      const a = a0 + (sgn * turn * j) / k;
      out.push({ x: c.x + rr * Math.cos(a), y: c.y + rr * Math.sin(a) });
    }
  }
  return out;
}

/**
 * Outline of a stroke whose band spans offsets [a, b] from the chain (b on the left), with rounded
 * corners and ends. Returns the rings to fill (nonzero): one for an open chain, the outer and inner
 * edge (opposite directions) for a closed one. Inner corners get the corner radius less the weight,
 * so both edges of a turn stay concentric.
 */
export function strokeOutline(center: Vec2[], a: number, b: number, closed: boolean, corner: number, end: number, tol: number): Vec2[][] {
  const w = b - a;
  const join = (convex: boolean) => (convex ? corner : Math.max(0, corner - w));
  const left = offsetPolyline(center, b, closed);
  const right = offsetPolyline(center, a, closed).reverse();
  if (closed) return [left, right].map((ring) => roundPolygon(ring, (_, convex) => join(convex), tol));
  const ring = left.concat(right);
  const caps = new Set([0, left.length - 1, left.length, ring.length - 1]);
  return [roundPolygon(ring, (i, convex) => (caps.has(i) ? Math.min(end, w / 2) : join(convex)), tol)];
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
  /** With rounded corners or ends, the stroke is filled from this outline instead of stroked. */
  outline: Vec2[][] | null;
}

/** A filled profile in its color, with the filled profiles directly inside it cut out as holes. */
export interface ArtFill {
  chain: Chain;
  color: string;
  /** The profile (CCW) then its holes (CW): fill nonzero. */
  loops: Loop[];
}

export interface ArtScene {
  strokes: ArtStroke[];
  /** Outermost first, so islands inside holes paint over. */
  fills: ArtFill[];
  /** Everything drawn, stroke widths included. */
  bounds: Box;
}

/**
 * Filled profiles nest: one inside a filled profile is a hole in it, one inside that hole paints again,
 * and so on. Unfilled profiles do not take part.
 */
function nestFills(filled: ArtStroke[]): ArtFill[] {
  const loops = filled.map((s) => ({ segs: s.chain.segs.slice(), area: s.chain.area }));
  const polys = loops.map((l) => loopPolygon(l));
  const parent: number[] = [];
  const depth: number[] = [];
  loops.forEach((l, i) => {
    let par = -1;
    let d = 0;
    loops.forEach((m, j) => {
      if (j === i || m.area <= l.area || !pointInPolygon(polys[i][0], polys[j])) return;
      d++;
      if (par < 0 || m.area < loops[par].area) par = j;
    });
    parent.push(par);
    depth.push(d);
  });
  const out: { f: ArtFill; d: number }[] = [];
  loops.forEach((l, i) => {
    if (depth[i] % 2) return;
    const holes = loops.filter((_, j) => parent[j] === i).map((h) => ({ segs: reverseChain(h.segs), area: -h.area }));
    out.push({ f: { chain: filled[i].chain, color: filled[i].style.color, loops: [l, ...holes] }, d: depth[i] });
  });
  return out.sort((x, y) => x.d - y.d).map((x) => x.f);
}

/** Stroke and fill geometry of the document. `tol` is the sampling tolerance in sketch units. */
export function buildArtScene(doc: Doc, tol: number): ArtScene {
  const strokes: ArtStroke[] = [];
  const bounds = emptyBox();
  for (const chain of docChains(doc)) {
    const style = chainStyle(doc, chain);
    const center = chainPolyline(chain.segs, chain.closed, tol);
    const w = style.weight;
    const centered = style.side === "center" || w === 0;
    const path = centered ? center : offsetPolyline(center, style.side === "left" ? w / 2 : -w / 2, chain.closed);
    const rounded = w > 0 && (style.corner > 0 || (!chain.closed && style.end > 0));
    const [lo, hi] = style.side === "left" ? [0, w] : style.side === "right" ? [-w, 0] : [-w / 2, w / 2];
    const outline = rounded ? strokeOutline(center, lo, hi, chain.closed, style.corner, style.end, tol) : null;
    strokes.push({ chain, style, center, path, centered, outline });
    const pad = w / 2;
    for (const p of path) {
      boxAdd(bounds, { x: p.x - pad, y: p.y - pad });
      boxAdd(bounds, { x: p.x + pad, y: p.y + pad });
    }
    for (const p of center) boxAdd(bounds, p);
  }
  return { strokes, fills: nestFills(strokes.filter((s) => s.style.fill)), bounds };
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
