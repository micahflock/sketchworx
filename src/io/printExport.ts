/**
 * Print mode export: one DXF (and SVG) per filament with that color's closed profiles, an outline
 * file and a README with the print order. Curves come back as lines and arcs fitted to the region
 * polygons; every boundary between two colors is cut at the same points and fitted the same way in
 * both files, so the CAD bodies meet exactly. Pure functions, no DOM.
 */
import type { Path64, Paths64 } from "@countertype/clipper2-ts";
import type { Doc, Filament } from "../model/types";
import { buildRegions, checkRules, components, SCALE } from "../model/regions";
import { COLOR_SETUP_LABEL, minFeature } from "../model/print";

/** Fitted curves stay within this distance of the regions (mm). */
export const FIT_TOL = 0.005;

interface P {
  x: number;
  y: number;
}
/** A closed profile: vertices with the bulge of the piece leaving each (0: straight). */
export interface Profile {
  pts: P[];
  bulge: number[];
  /** The whole profile is one circle. */
  circle?: { c: P; r: number };
}

const key = (p: P) => `${p.x},${p.y}`;

// ------------------------------------------------------------------ shared vertices

/** Paths with every vertex of the other paths that lies on one of their edges inserted (T-junctions). */
function weld(all: Path64[]): Path64[] {
  const cell = 2000; // 0.2 mm
  const grid = new Map<string, P[]>();
  const seen = new Set<string>();
  for (const path of all)
    for (const p of path) {
      const k = key(p);
      if (seen.has(k)) continue;
      seen.add(k);
      const g = `${Math.floor(p.x / cell)},${Math.floor(p.y / cell)}`;
      (grid.get(g) ?? grid.set(g, []).get(g)!).push(p);
    }
  return all.map((path) => {
    const out: P[] = [];
    for (let i = 0; i < path.length; i++) {
      const a = path[i];
      const b = path[(i + 1) % path.length];
      out.push(a);
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const L2 = dx * dx + dy * dy;
      if (!L2) continue;
      const on: { t: number; p: P }[] = [];
      const x0 = Math.floor(Math.min(a.x, b.x) / cell), x1 = Math.floor(Math.max(a.x, b.x) / cell);
      const y0 = Math.floor(Math.min(a.y, b.y) / cell), y1 = Math.floor(Math.max(a.y, b.y) / cell);
      for (let gx = x0; gx <= x1; gx++)
        for (let gy = y0; gy <= y1; gy++)
          for (const q of grid.get(`${gx},${gy}`) ?? []) {
            const t = ((q.x - a.x) * dx + (q.y - a.y) * dy) / L2;
            if (t <= 0 || t >= 1) continue;
            const cross = Math.abs((q.x - a.x) * dy - (q.y - a.y) * dx) / Math.sqrt(L2);
            if (cross <= 1) on.push({ t, p: q });
          }
      on.sort((u, v) => u.t - v.t);
      for (const o of on) if (key(o.p) !== key(out[out.length - 1])) out.push(o.p);
    }
    return out;
  });
}

// ------------------------------------------------------------------ fitting

interface Piece {
  /** Index of the end point within the chain. */
  to: number;
  bulge: number;
}

/** Circle through three points, or null when they are (nearly) in line. */
function circle3(a: P, b: P, c: P): { c: P; r: number } | null {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const ux = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const uy = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { c: { x: ux, y: uy }, r: Math.hypot(a.x - ux, a.y - uy) };
}

/** Signed angle a→b about c, in (-π, π]. */
const turn = (c: P, a: P, b: P) => Math.atan2((a.x - c.x) * (b.y - c.y) - (a.y - c.y) * (b.x - c.x), (a.x - c.x) * (b.x - c.x) + (a.y - c.y) * (b.y - c.y));

function fitsLine(pts: P[], i: number, j: number, tol: number): boolean {
  const a = pts[i], b = pts[j];
  const dx = b.x - a.x, dy = b.y - a.y;
  const L = Math.hypot(dx, dy);
  if (!L) return false;
  for (let k = i + 1; k < j; k++) {
    const t = ((pts[k].x - a.x) * dx + (pts[k].y - a.y) * dy) / (L * L);
    if (t < 0 || t > 1) return false;
    if (Math.abs((pts[k].x - a.x) * dy - (pts[k].y - a.y) * dx) / L > tol) return false;
  }
  return true;
}

/** Bulge of an arc through pts[i..j], or null if they do not lie on one (within tol, turning one way). */
function fitsArc(pts: P[], i: number, j: number, tol: number): number | null {
  if (j - i < 2) return null;
  const c = circle3(pts[i], pts[(i + j) >> 1], pts[j]);
  if (!c || c.r > 1e4 * SCALE) return null;
  let sweep = 0;
  let sign = 0;
  for (let k = i; k <= j; k++) {
    if (Math.abs(Math.hypot(pts[k].x - c.c.x, pts[k].y - c.c.y) - c.r) > tol) return null;
    if (k > i) {
      const t = turn(c.c, pts[k - 1], pts[k]);
      const s = Math.sign(t);
      if (s && sign && s !== sign) return null;
      if (s) sign = s;
      sweep += t;
      // The chord between two samples must stay close to the circle too.
      const half = Math.abs(t) / 2;
      if (c.r * (1 - Math.cos(half)) > tol) return null;
    }
  }
  if (Math.abs(sweep) >= 2 * Math.PI - 1e-6) return null;
  return Math.tan(sweep / 4);
}

/** Lines and arcs through an open chain of points (greedy: the longest piece first). */
function fitChain(pts: P[], tol: number): Piece[] {
  const out: Piece[] = [];
  let i = 0;
  while (i < pts.length - 1) {
    let best: Piece = { to: i + 1, bulge: 0 };
    for (let j = i + 2; j < pts.length; j++) {
      if (fitsLine(pts, i, j, tol)) best = { to: j, bulge: 0 };
      else {
        const b = fitsArc(pts, i, j, tol);
        if (b !== null) best = { to: j, bulge: b };
        else if (j - best.to > 8) break; // nothing has fit for a while
      }
    }
    out.push(best);
    i = best.to;
  }
  return out;
}

/** The chain fitted the same way whichever way round it is given (so both neighbours get one result). */
function fitCanonical(pts: P[], tol: number): Piece[] {
  const a = pts[0], z = pts[pts.length - 1];
  const less = (p: P, q: P) => p.x < q.x || (p.x === q.x && p.y < q.y);
  const flip = less(z, a) || (key(a) === key(z) && pts.length > 2 && less(pts[pts.length - 2], pts[1]));
  if (!flip) return fitChain(pts, tol);
  return reversePieces(fitChain(pts.slice().reverse(), tol), pts.length - 1);
}

/**
 * Closed paths as profiles. Paths are cut at corners and at points used by three or more paths
 * (where colors meet); each run between cuts is fitted on its own, canonically, and remembered, so a
 * run shared by two colors gets the same lines and arcs in both.
 */
export function fitProfiles(paths: Path64[], uses: Map<string, number>, tol = FIT_TOL): Profile[] {
  const t = tol * SCALE;
  const cache = new Map<string, Piece[]>();
  const out: Profile[] = [];
  for (const raw of paths) {
    const path = raw.map((p) => ({ x: p.x, y: p.y }));
    const n = path.length;
    if (n < 3) continue;
    const cut = path.map((p, i) => {
      if ((uses.get(key(p)) ?? 0) >= 3) return true;
      const a = path[(i - 1 + n) % n], b = path[(i + 1) % n];
      const t1 = Math.atan2(p.y - a.y, p.x - a.x), t2 = Math.atan2(b.y - p.y, b.x - p.x);
      let d = Math.abs(t2 - t1);
      if (d > Math.PI) d = 2 * Math.PI - d;
      return d > (35 * Math.PI) / 180;
    });
    let starts = cut.map((c, i) => (c ? i : -1)).filter((i) => i >= 0);
    // No cut at all: one closed run, started at its smallest vertex.
    if (!starts.length) {
      let m = 0;
      for (let i = 1; i < n; i++) if (path[i].x < path[m].x || (path[i].x === path[m].x && path[i].y < path[m].y)) m = i;
      starts = [m];
      // Whole circle?
      const c = circle3(path[0], path[Math.floor(n / 3)], path[Math.floor((2 * n) / 3)]);
      if (c && path.every((p) => Math.abs(Math.hypot(p.x - c.c.x, p.y - c.c.y) - c.r) <= t)) {
        out.push({ pts: [], bulge: [], circle: { c: { x: c.c.x / SCALE, y: c.c.y / SCALE }, r: c.r / SCALE } });
        continue;
      }
    }
    const pts: P[] = [];
    const bulge: number[] = [];
    for (let s = 0; s < starts.length; s++) {
      const from = starts[s];
      const to = s + 1 < starts.length ? starts[s + 1] : starts[0] + n;
      const run: P[] = [];
      for (let i = from; i <= to; i++) run.push(path[i % n]);
      const k = run.map(key).join(";");
      const kr = run.slice().reverse().map(key).join(";");
      let pieces = cache.get(k);
      if (!pieces) {
        pieces = fitCanonical(run, t);
        cache.set(k, pieces);
        // The same run seen from the other side.
        cache.set(kr, reversePieces(pieces, run.length - 1));
      }
      let prev = 0;
      for (const p of pieces) {
        pts.push({ x: run[prev].x / SCALE, y: run[prev].y / SCALE });
        bulge.push(p.bulge);
        prev = p.to;
      }
    }
    out.push({ pts, bulge });
  }
  return out;
}

/** Pieces of a run of m+1 points, for the same run walked backwards. */
function reversePieces(pieces: Piece[], m: number): Piece[] {
  const spans: { from: number; to: number; bulge: number }[] = [];
  let prev = 0;
  for (const p of pieces) {
    spans.push({ from: prev, to: p.to, bulge: p.bulge });
    prev = p.to;
  }
  return spans.reverse().map((sp) => ({ to: m - sp.from, bulge: -sp.bulge }));
}

// ------------------------------------------------------------------ writers

const num = (v: number) => {
  const s = (Math.round(v * 1e6) / 1e6).toString();
  return s === "-0" ? "0" : s;
};

/** A DXF (R12, mm) with closed profiles on one layer. */
export function dxf(profiles: Profile[], layer: string): string {
  const L: string[] = [];
  const g = (code: number, v: string | number) => L.push(String(code), typeof v === "number" ? num(v) : v);
  g(0, "SECTION"), g(2, "HEADER");
  g(9, "$ACADVER"), g(1, "AC1009");
  g(9, "$INSUNITS"), g(70, "4");
  g(9, "$MEASUREMENT"), g(70, "1");
  g(0, "ENDSEC");
  g(0, "SECTION"), g(2, "TABLES");
  g(0, "TABLE"), g(2, "LAYER"), g(70, "1");
  g(0, "LAYER"), g(2, layer), g(70, "0"), g(62, "7"), g(6, "CONTINUOUS");
  g(0, "ENDTAB");
  g(0, "ENDSEC");
  g(0, "SECTION"), g(2, "ENTITIES");
  for (const p of profiles) {
    if (p.circle) {
      g(0, "CIRCLE"), g(8, layer), g(10, p.circle.c.x), g(20, p.circle.c.y), g(30, 0), g(40, p.circle.r);
      continue;
    }
    g(0, "POLYLINE"), g(8, layer), g(66, "1"), g(10, 0), g(20, 0), g(30, 0), g(70, "1");
    p.pts.forEach((q, i) => {
      g(0, "VERTEX"), g(8, layer), g(10, q.x), g(20, q.y), g(30, 0);
      if (p.bulge[i]) g(42, p.bulge[i]);
    });
    g(0, "SEQEND"), g(8, layer);
  }
  g(0, "ENDSEC");
  g(0, "EOF");
  return L.join("\n") + "\n";
}

/** SVG path data for profiles (y flipped so the drawing is upright). */
export function svgPathData(profiles: Profile[]): string {
  const parts: string[] = [];
  for (const p of profiles) {
    if (p.circle) {
      const { c, r } = p.circle;
      parts.push(`M${num(c.x + r)} ${num(-c.y)}A${num(r)} ${num(r)} 0 1 0 ${num(c.x - r)} ${num(-c.y)}A${num(r)} ${num(r)} 0 1 0 ${num(c.x + r)} ${num(-c.y)}Z`);
      continue;
    }
    let d = "";
    p.pts.forEach((a, i) => {
      if (!i) d += `M${num(a.x)} ${num(-a.y)}`;
      const b = p.pts[(i + 1) % p.pts.length];
      const bu = p.bulge[i];
      if (!bu) d += `L${num(b.x)} ${num(-b.y)}`;
      else {
        const sweep = 4 * Math.atan(bu);
        const chord = Math.hypot(b.x - a.x, b.y - a.y);
        const r = chord / (2 * Math.sin(Math.abs(sweep) / 2));
        // CCW in the sketch is clockwise once y is flipped.
        d += `A${num(r)} ${num(r)} 0 ${Math.abs(sweep) > Math.PI ? 1 : 0} ${sweep > 0 ? 0 : 1} ${num(b.x)} ${num(-b.y)}`;
      }
    });
    parts.push(d + "Z");
  }
  return parts.join("");
}

function svg(profiles: Profile[], color: string, box: { minX: number; minY: number; maxX: number; maxY: number }): string {
  const w = box.maxX - box.minX, h = box.maxY - box.minY;
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(box.minX)} ${num(-box.maxY)} ${num(w)} ${num(h)}" width="${num(w)}mm" height="${num(h)}mm">`,
    `  <path d="${svgPathData(profiles)}" fill="${color}" fill-rule="evenodd"/>`,
    `</svg>`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ the file set

export interface OutFile {
  name: string;
  text: string;
}

const safe = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "x";

/** Profiles of every filament (in slot order) and of the part outline. */
export function printProfiles(doc: Doc): { filament: Filament; profiles: Profile[] }[] & { outline?: Profile[] } {
  const pr = doc.print!;
  const reg = buildRegions(doc);
  const groups: Paths64[] = reg.regions.map((r) => r.area);
  const all = weld([...groups.flat(), ...reg.part]);
  // Split the welded paths back into their groups.
  let at = 0;
  const welded: Path64[][] = groups.map((g) => {
    const part = all.slice(at, at + g.length);
    at += g.length;
    return part;
  });
  const partPaths = all.slice(at);
  const uses = new Map<string, number>();
  for (const paths of [...welded, partPaths]) {
    const here = new Set<string>();
    for (const path of paths) for (const p of path) here.add(key(p));
    for (const k of here) uses.set(k, (uses.get(k) ?? 0) + 1);
  }
  const out = pr.filaments.map((f, i) => ({ filament: f, profiles: fitProfiles(welded[i], uses) })) as ReturnType<typeof printProfiles>;
  out.outline = fitProfiles(partPaths, uses);
  return out;
}

/** The export set, or why there is none. */
export function printFiles(doc: Doc, base: string): { files: OutFile[] } | { error: string } {
  const pr = doc.print;
  if (!pr) return { error: "Print mode is off" };
  const rep = checkRules(doc);
  if (rep.breaks.length) return { error: `Fix the ${rep.breaks.length} issue${rep.breaks.length === 1 ? "" : "s"} in Print view first: export is blocked while anything is too thin to print` };
  const reg = buildRegions(doc);
  if (!reg.part.length) return { error: "No part to export: draw a closed profile for the outline" };
  const sets = printProfiles(doc);
  const name = safe(base);
  const files: OutFile[] = [];
  const box = reg.bounds;
  const used: string[] = [];
  sets.forEach(({ filament: f, profiles }, i) => {
    if (!profiles.length) return;
    const stem = `${name}-F${i + 1}-${safe(f.name)}`;
    used.push(`${i + 1}. ${f.name} (${f.color}): ${stem}.dxf, ${stem}.svg — ${components(reg.regions[i].area).length} area(s)`);
    files.push({ name: `${stem}.dxf`, text: dxf(profiles, `F${i + 1}_${safe(f.name)}`) });
    files.push({ name: `${stem}.svg`, text: svg(profiles, f.color, box) });
  });
  files.push({ name: `${name}-outline.dxf`, text: dxf(sets.outline!, "OUTLINE") });
  const p = pr.printer;
  const manual = p.colorSetup === "manual";
  const readme = [
    `${base}: print files from Sketchworx`,
    "",
    `Printer: ${p.preset === "custom" ? "custom" : p.preset}, nozzle ${p.nozzle} mm, line width ${p.lineWidth} mm, min feature ${p.minFeatureLines} lines (${minFeature(p)} mm)`,
    `Color changes: ${COLOR_SETUP_LABEL[p.colorSetup]}`,
    "",
    "All files are in mm with the sketch origin at 0,0: insert each at the origin of the same plane and they line up.",
    "Each DXF holds one color's closed profiles; neighbouring colors share the exact same edges.",
    `${name}-outline.dxf is the whole part (for a base plate or a cutting body).`,
    "",
    manual ? "Print order (one body per color; pause to swap filament between them):" : "Filaments (slot = PrusaSlicer extruder number, top to bottom is the print order within a layer):",
    ...used,
    "",
    manual
      ? `In PrusaSlicer: load the bodies as parts of one object, then print them in this order with a pause (M601) before each color after the first.`
      : "In PrusaSlicer: load the bodies as parts of one object and set each part's extruder to its slot number.",
    "",
  ].join("\n");
  files.push({ name: "README.txt", text: readme });
  return { files };
}

// ------------------------------------------------------------------ zip

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(b: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of text files (stored, not compressed). */
export function zip(files: OutFile[]): Uint8Array<ArrayBuffer> {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = enc.encode(f.text);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length);
    const v = new DataView(local.buffer);
    v.setUint32(0, 0x04034b50, true);
    v.setUint16(4, 20, true);
    v.setUint16(6, 0x0800, true); // UTF-8 names
    v.setUint16(8, 0, true); // stored
    v.setUint32(14, crc, true);
    v.setUint32(18, data.length, true);
    v.setUint32(22, data.length, true);
    v.setUint16(26, name.length, true);
    local.set(name, 30);
    const cen = new Uint8Array(46 + name.length);
    const w = new DataView(cen.buffer);
    w.setUint32(0, 0x02014b50, true);
    w.setUint16(4, 20, true);
    w.setUint16(6, 20, true);
    w.setUint16(8, 0x0800, true);
    w.setUint32(16, crc, true);
    w.setUint32(20, data.length, true);
    w.setUint32(24, data.length, true);
    w.setUint16(28, name.length, true);
    w.setUint32(42, offset, true);
    cen.set(name, 46);
    chunks.push(local, data);
    central.push(cen);
    offset += local.length + data.length;
  }
  const size = central.reduce((t, c) => t + c.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true);
  e.setUint16(8, files.length, true);
  e.setUint16(10, files.length, true);
  e.setUint32(12, size, true);
  e.setUint32(16, offset, true);
  const out = new Uint8Array(new ArrayBuffer(offset + size + 22));
  let at = 0;
  for (const c of [...chunks, ...central, end]) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}
