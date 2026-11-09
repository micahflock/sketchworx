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
import { chainFilament, filamentById, snapWeight } from "./print";

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
export const OVERRIDABLE = ["weight", "color", "corner", "roundEnds"] as const;
export type Overridable = (typeof OVERRIDABLE)[number];

export function artDefaults(doc: Doc): ArtDefaults {
  const a = doc.art;
  return { weight: a?.weight ?? DEFAULT_ART_WEIGHT, color: a?.color ?? DEFAULT_ART_COLOR, corner: a?.corner ?? 0, roundEnds: a?.roundEnds ?? false };
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
  // In Print mode a chain's color is its filament's.
  const filament = chainFilament(doc, s);
  return {
    weight: s?.weight ?? d.weight,
    color: filament?.color ?? s?.color ?? d.color,
    corner: s?.corner ?? d.corner,
    roundEnds: s?.roundEnds ?? d.roundEnds,
    side: s?.side ?? "center",
    fill: c.closed && !!s?.fill,
    custom: { weight: s?.weight !== undefined, color: s?.color !== undefined, corner: s?.corner !== undefined, roundEnds: s?.roundEnds !== undefined },
  };
}

/** Changes to a chain's style. `null` for an overridable field goes back to the document default. */
export interface StylePatch {
  /** Print mode: filament id, or null for the document's ink filament. */
  filament?: string | null;
  weight?: number | null;
  color?: string | null;
  corner?: number | null;
  roundEnds?: boolean | null;
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
    for (const k of ["weight", "corner"] as const) {
      const v = patch[k];
      if (v === null) delete next[k];
      else if (v !== undefined) next[k] = k === "weight" ? snapWeight(doc, Math.max(0, v)) : Math.max(0, v);
    }
    if (patch.filament === null) delete next.filament;
    else if (patch.filament !== undefined && filamentById(doc, patch.filament)) next.filament = patch.filament;
    if (patch.roundEnds === null) delete next.roundEnds;
    else if (patch.roundEnds !== undefined) next.roundEnds = patch.roundEnds;
    if (patch.color === null) delete next.color;
    else if (isArtColor(patch.color)) next.color = patch.color.toLowerCase();
    if (patch.side === "center") delete next.side;
    else if (patch.side) next.side = patch.side;
    if (patch.fill !== undefined) {
      if (patch.fill && c.closed) next.fill = true;
      else delete next.fill;
    }
    const empty = Object.keys(next).length === 0;
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
  for (const k of ["weight", "corner"] as const) if (isLength(patch[k])) next[k] = patch[k] as number;
  next.weight = snapWeight(doc, next.weight);
  if (typeof patch.roundEnds === "boolean") next.roundEnds = patch.roundEnds;
  if (isArtColor(patch.color)) next.color = patch.color.toLowerCase();
  if (OVERRIDABLE.every((k) => next[k] === cur[k])) return doc;
  return { ...doc, art: { ...doc.art, ...next, styles: doc.art?.styles ?? {} } };
}

export const DEFAULT_ART_BACKGROUND = "#ffffff";

export function artBackground(doc: Doc): string {
  // In Print mode the background is the base filament.
  return filamentById(doc, doc.print?.base)?.color ?? doc.art?.background ?? DEFAULT_ART_BACKGROUND;
}

/** Change the Art view background color. */
export function setArtBackground(doc: Doc, color: string): Doc {
  if (!isArtColor(color) || color.toLowerCase() === artBackground(doc)) return doc;
  return { ...doc, art: { ...(doc.art ?? { weight: DEFAULT_ART_WEIGHT, styles: {} }), background: color.toLowerCase() } };
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
      for (const k of ["weight", "corner"] as const) if (isLength(st[k])) out[k] = st[k];
      // Files from before round ends was a switch stored an end radius.
      if (typeof st.roundEnds === "boolean") out.roundEnds = st.roundEnds;
      else if (isLength(st.end) && st.end > 0) out.roundEnds = true;
      if (isArtColor(st.color)) out.color = st.color.toLowerCase();
      if (st.side === "left" || st.side === "right") out.side = st.side;
      if (st.fill === true) out.fill = true;
      if (typeof st.filament === "string" && st.filament) out.filament = st.filament;
      if (Object.keys(out).length) styles[id] = out;
    }
  const out: ArtSettings = { weight: isLength(raw.weight) ? raw.weight : DEFAULT_ART_WEIGHT, styles };
  if (isArtColor(raw.color)) out.color = raw.color.toLowerCase();
  if (isLength(raw.corner)) out.corner = raw.corner;
  if (isArtColor(raw.background)) out.background = raw.background.toLowerCase();
  if (typeof raw.roundEnds === "boolean") out.roundEnds = raw.roundEnds;
  else if (isLength(raw.end) && raw.end > 0) out.roundEnds = true;
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

/**
 * A chain as a polyline (closed chains do not repeat the first point). `joints[i]` marks points where
 * two pieces of the chain meet: the only places a corner radius applies.
 */
export function samplePolyline(segs: Seg[], closed: boolean, tol: number): { pts: Vec2[]; joints: boolean[] } {
  const pts: Vec2[] = [];
  const joints: boolean[] = [];
  segs.forEach((s, i) => {
    const sp = segPoints(s, pieces(s, tol));
    // The previous piece's last point is where this one starts.
    if (i > 0) joints[pts.length - 1] = true;
    for (let k = i > 0 ? 1 : 0; k < sp.length; k++) {
      pts.push(sp[k]);
      joints.push(false);
    }
  });
  if (closed && pts.length > 1) {
    pts.pop();
    joints.pop();
    joints[0] = true;
  }
  return { pts, joints };
}

export function chainPolyline(segs: Seg[], closed: boolean, tol: number): Vec2[] {
  return samplePolyline(segs, closed, tol).pts;
}

const perp = (t: Vec2): Vec2 => ({ x: -t.y, y: t.x });

/**
 * The polyline moved sideways by `d` (positive: to the left of its direction), with mitered
 * corners; corners sharper than the miter limit are beveled. `flags` (one per input point) are
 * carried to the output points made from each input point.
 */
export function offsetPolylineFlags(input: Vec2[], d: number, closed: boolean, flags: boolean[], miterLimit = MITER_LIMIT): { pts: Vec2[]; flags: boolean[] } {
  const pts: Vec2[] = [];
  const fl: boolean[] = [];
  input.forEach((p, i) => {
    const q = pts[pts.length - 1];
    if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-12) {
      pts.push(p);
      fl.push(!!flags[i]);
    } else fl[fl.length - 1] ||= !!flags[i];
  });
  if (closed && pts.length > 2) {
    const a = pts[0];
    const z = pts[pts.length - 1];
    if (Math.hypot(a.x - z.x, a.y - z.y) <= 1e-12) {
      pts.pop();
      fl[0] ||= fl.pop()!;
    }
  }
  const n = pts.length;
  if (n < 2 || d === 0) return { pts: pts.slice(), flags: fl };
  const dir = (i: number): Vec2 => {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    return { x: (b.x - a.x) / l, y: (b.y - a.y) / l };
  };
  const out: Vec2[] = [];
  const outFl: boolean[] = [];
  for (let i = 0; i < n; i++) {
    const v = pts[i];
    const hasPrev = closed || i > 0;
    const hasNext = closed || i < n - 1;
    if (!hasPrev || !hasNext) {
      const nn = perp(dir(hasNext ? i : i - 1));
      out.push({ x: v.x + nn.x * d, y: v.y + nn.y * d });
      outFl.push(fl[i]);
      continue;
    }
    const n1 = perp(dir((i - 1 + n) % n));
    const n2 = perp(dir(i));
    const m = { x: n1.x + n2.x, y: n1.y + n2.y };
    const ml = Math.hypot(m.x, m.y);
    const cos = ml / 2; // cos of half the turn between the two normals
    if (ml < 1e-9 || 1 / cos > miterLimit) {
      out.push({ x: v.x + n1.x * d, y: v.y + n1.y * d }, { x: v.x + n2.x * d, y: v.y + n2.y * d });
      outFl.push(fl[i], fl[i]);
      continue;
    }
    const k = d / cos / ml;
    out.push({ x: v.x + m.x * k, y: v.y + m.y * k });
    outFl.push(fl[i]);
  }
  return { pts: out, flags: outFl };
}

export function offsetPolyline(input: Vec2[], d: number, closed: boolean, miterLimit = MITER_LIMIT): Vec2[] {
  return offsetPolylineFlags(input, d, closed, [], miterLimit).pts;
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
 * Round corners of a polyline with arcs: `radius(i)` at vertex i (the ends of an open polyline are
 * left alone). A fillet never uses more than half of either neighbouring edge, so neighbouring
 * fillets cannot overlap.
 */
export function filletPolyline(pts: Vec2[], closed: boolean, radius: (i: number) => number, tol: number): Vec2[] {
  const n = pts.length;
  if (n < 3) return pts.slice();
  const out: Vec2[] = [];
  for (let i = 0; i < n; i++) {
    const v = pts[i];
    if (!closed && (i === 0 || i === n - 1)) {
      out.push(v);
      continue;
    }
    const p = pts[(i - 1 + n) % n];
    const q = pts[(i + 1) % n];
    const l1 = Math.hypot(v.x - p.x, v.y - p.y);
    const l2 = Math.hypot(q.x - v.x, q.y - v.y);
    const r = radius(i);
    if (r <= 0 || l1 < 1e-12 || l2 < 1e-12) {
      out.push(v);
      continue;
    }
    const d1 = { x: (v.x - p.x) / l1, y: (v.y - p.y) / l1 };
    const d2 = { x: (q.x - v.x) / l2, y: (q.y - v.y) / l2 };
    const cross = d1.x * d2.y - d1.y * d2.x;
    const turn = Math.acos(Math.max(-1, Math.min(1, d1.x * d2.x + d1.y * d2.y)));
    if (turn < 1e-6 || turn > Math.PI - 1e-6) {
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

/** Length of a polyline. */
function polyLength(pts: Vec2[]): number {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  return l;
}

/** How much to cut from each end so a round cap of `w/2` stays within the line (never all of it). */
function capTrim(length: number, w: number): number {
  return Math.min(w / 2, length * 0.4999);
}

/** An open polyline shortened by `d0` at the start and `d1` at the end. */
export function trimPolyline(pts: Vec2[], d0: number, d1: number): Vec2[] {
  const cut = (src: Vec2[], d: number): Vec2[] => {
    const out = src.slice();
    while (d > 0 && out.length > 1) {
      const a = out[0];
      const b = out[1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l <= d && out.length > 2) {
        out.shift();
        d -= l;
        continue;
      }
      const f = Math.min(1, d / Math.max(l, 1e-12));
      out[0] = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      break;
    }
    return out;
  };
  return cut(cut(pts, d0).reverse(), d1).reverse();
}

const segLength = (s: Seg): number =>
  s.kind === "line" ? Math.hypot(s.end.x - s.start.x, s.end.y - s.start.y) : s.kind === "arc" ? Math.abs(s.sweep) * s.r : polyLength(segPoints(s, 64));

const lerp = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** The part of a segment from fraction `f0` to `f1` of its length (exact for lines and arcs). */
function subSeg(s: Seg, f0: number, f1: number): Seg {
  if (s.kind === "line") return { ...s, start: lerp(s.start, s.end, f0), end: lerp(s.start, s.end, f1) };
  if (s.kind === "arc") {
    const a0 = s.a0 + s.sweep * f0;
    const sweep = s.sweep * (f1 - f0);
    const at = (a: number) => ({ x: s.c.x + s.r * Math.cos(a), y: s.c.y + s.r * Math.sin(a) });
    return { ...s, a0, sweep, start: at(a0), end: at(a0 + sweep) };
  }
  // Cubic: parameter at a length fraction from a sampled length table, then de Casteljau.
  const pts = segPoints(s, 64);
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
  const L = cum[cum.length - 1] || 1;
  const tAt = (f: number) => {
    const want = f * L;
    let i = 1;
    while (i < cum.length - 1 && cum[i] < want) i++;
    const span = cum[i] - cum[i - 1] || 1;
    return (i - 1 + (want - cum[i - 1]) / span) / (cum.length - 1);
  };
  const split = (p0: Vec2, p1: Vec2, p2: Vec2, p3: Vec2, t: number) => {
    const a = lerp(p0, p1, t), b = lerp(p1, p2, t), c = lerp(p2, p3, t);
    const d = lerp(a, b, t), e = lerp(b, c, t), m = lerp(d, e, t);
    return { left: [p0, a, d, m], right: [m, e, c, p3] };
  };
  const t0 = tAt(f0);
  const t1 = tAt(f1);
  let q = [s.start, s.c1, s.c2, s.end];
  if (t0 > 0) q = split(q[0], q[1], q[2], q[3], t0).right;
  if (t1 < 1) q = split(q[0], q[1], q[2], q[3], (t1 - t0) / Math.max(1 - t0, 1e-12)).left;
  return { ...s, start: q[0], c1: q[1], c2: q[2], end: q[3] };
}

/** Open chain pieces shortened by `d0` at the start and `d1` at the end. */
export function trimSegs(segs: Seg[], d0: number, d1: number): Seg[] {
  const out = segs.slice();
  while (d0 > 0 && out.length) {
    const L = segLength(out[0]);
    if (L <= d0 && out.length > 1) {
      out.shift();
      d0 -= L;
      continue;
    }
    out[0] = subSeg(out[0], Math.min(1, d0 / Math.max(L, 1e-12)), 1);
    break;
  }
  while (d1 > 0 && out.length) {
    const k = out.length - 1;
    const L = segLength(out[k]);
    if (L <= d1 && out.length > 1) {
      out.pop();
      d1 -= L;
      continue;
    }
    out[k] = subSeg(out[k], 0, 1 - Math.min(1, d1 / Math.max(L, 1e-12)));
    break;
  }
  return out;
}

/** Corner radius as drawn: 0 (sharp), else at least half the weight (strokes cannot round tighter). */
export function effectiveCorner(style: { weight: number; corner: number }): number {
  return style.corner > 0 ? Math.max(style.corner, style.weight / 2) : 0;
}

// ------------------------------------------------------------------ scene

export interface ArtStroke {
  chain: Chain;
  style: ResolvedStyle;
  /** The chain itself, as a polyline. */
  center: Vec2[];
  /**
   * Where the stroke runs, as a polyline: the chain, or for a side stroke the chain moved half the
   * weight over; with corners rounded and ends shortened for round caps.
   */
  path: Vec2[];
  /** The same as `path` in exact pieces, when it is the chain itself (centered, no corner radius). */
  segs: Seg[] | null;
  join: "miter" | "round";
  cap: "butt" | "round";
}

/** A filled profile in its color, with the filled profiles directly inside it cut out as holes. */
export interface ArtFill {
  chain: Chain;
  color: string;
  /** The profile (CCW) then its holes (CW): fill nonzero. */
  loops: Loop[];
}

/** One sketch's drawing: its fills, then its strokes over them. */
export interface ArtLayer {
  feature: Id;
  /** Outermost first, so islands inside holes paint over. */
  fills: ArtFill[];
  strokes: ArtStroke[];
}

export interface ArtScene {
  /** Every stroke, in painting order. */
  strokes: ArtStroke[];
  /** Every fill, in painting order. */
  fills: ArtFill[];
  /**
   * One layer per visible sketch in tree order: the top sketch is painted first and each sketch below
   * it paints over the ones above. Profiles nest (cut holes) only within their own sketch.
   */
  layers: ArtLayer[];
  /** Everything drawn, stroke widths included. */
  bounds: Box;
}

/**
 * Filled profiles nest: one inside a filled profile is a hole in it, one inside that hole paints again,
 * and so on. Unfilled profiles do not take part.
 *
 * With `inlays` (Print mode) only profiles of the same color nest that way; a profile of another color
 * inside a fill is an inlay painted over it, and starts its own nesting.
 */
function nestFills(filled: ArtStroke[], inlays = false): ArtFill[] {
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
  const color = (i: number) => filled[i].style.color;
  // Hole/paint alternation: counts containers up to the first one of another color (inlays only).
  const parity: number[] = [];
  const parityOf = (i: number): number => {
    if (parity[i] !== undefined) return parity[i];
    const p = parent[i];
    return (parity[i] = p < 0 ? 0 : inlays && color(p) !== color(i) ? 0 : 1 - parityOf(p));
  };
  const out: { f: ArtFill; d: number }[] = [];
  loops.forEach((l, i) => {
    if (inlays ? parityOf(i) : depth[i] % 2) return;
    const holes = loops
      .filter((_, j) => parent[j] === i && (!inlays || color(j) === color(i)))
      .map((h) => ({ segs: reverseChain(h.segs), area: -h.area }));
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
    const { pts: center, joints } = samplePolyline(chain.segs, chain.closed, tol);
    const w = style.weight;
    const corner = effectiveCorner(style);
    // The stroke's own centerline is filleted, so its outside edge turns with the corner radius.
    const fillet = Math.max(0, corner - w / 2);
    const roundEnds = !chain.closed && style.roundEnds && w > 0;
    const trim = roundEnds ? capTrim(polyLength(center), w) : 0;
    let path: Vec2[];
    let segs: Seg[] | null = null;
    if (style.side === "center" || w === 0) {
      path = fillet > 0 ? filletPolyline(center, chain.closed, (i) => (joints[i] ? fillet : 0), tol) : center;
      if (fillet === 0) segs = trim > 0 ? trimSegs(chain.segs, trim, trim) : chain.segs;
    } else {
      const off = offsetPolylineFlags(center, style.side === "left" ? w / 2 : -w / 2, chain.closed, joints);
      path = fillet > 0 ? filletPolyline(off.pts, chain.closed, (i) => (off.flags[i] ? fillet : 0), tol) : off.pts;
    }
    if (trim > 0) path = trimPolyline(path, trim, trim);
    strokes.push({ chain, style, center, path, segs, join: corner > 0 ? "round" : "miter", cap: roundEnds ? "round" : "butt" });
    const pad = w / 2;
    for (const p of path) {
      boxAdd(bounds, { x: p.x - pad, y: p.y - pad });
      boxAdd(bounds, { x: p.x + pad, y: p.y + pad });
    }
    for (const p of center) boxAdd(bounds, p);
  }
  const layers: ArtLayer[] = [];
  for (const s of strokes) {
    let l = layers[layers.length - 1];
    if (!l || l.feature !== s.chain.feature) layers.push((l = { feature: s.chain.feature, fills: [], strokes: [] }));
    l.strokes.push(s);
  }
  for (const l of layers) l.fills = nestFills(l.strokes.filter((s) => s.style.fill), !!doc.print);
  return { strokes, fills: layers.flatMap((l) => l.fills), layers, bounds };
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
 * The chain under `p`: the nearest stroke within `tol` of its painted band, else the filled profile
 * on top at the point (the latest sketch's; within a sketch, the smallest).
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
  // Strokes run in painting order, so a later sketch's profile replaces an earlier one.
  for (const s of scene.strokes) {
    if (!s.style.fill) continue;
    if (!pointInPolygon(p, loopPolygon({ segs: s.chain.segs, area: s.chain.area }))) continue;
    if (!inside || inside.chain.feature !== s.chain.feature || s.chain.area < inside.chain.area) inside = s;
  }
  return inside?.chain ?? null;
}
