/**
 * Print mode settings: the printer profile, the filament palette, stroke widths in whole nozzle lines
 * and the `w` / `nozzle` variables. Pure functions, no DOM. Lengths are in mm (1 sketch unit = 1 mm
 * while Print mode is on).
 */
import { refreshExpressions } from "./dimensions";
import type { ArtStyle, ColorSetup, Doc, Filament, Id, PrinterProfile, PrintSettings, Variable } from "./types";

export interface PrinterPreset {
  id: string;
  label: string;
  profile: Omit<PrinterProfile, "preset" | "colorSetup" | "sheetColor" | "minFeatureLines" | "squish">;
}

/**
 * Prusa MK4S nozzles. Line widths are close to PrusaSlicer's MK4S print profiles; the fields stay
 * editable so they can match the profile actually used.
 */
export const PRESETS: PrinterPreset[] = [
  { id: "mk4s-0.25", label: "MK4S · 0.25 mm nozzle", profile: { nozzle: 0.25, lineWidth: 0.27, firstLayerWidth: 0.3, layerHeight: 0.12 } },
  { id: "mk4s-0.4", label: "MK4S · 0.4 mm nozzle", profile: { nozzle: 0.4, lineWidth: 0.45, firstLayerWidth: 0.5, layerHeight: 0.2 } },
  { id: "mk4s-0.6", label: "MK4S · 0.6 mm nozzle", profile: { nozzle: 0.6, lineWidth: 0.68, firstLayerWidth: 0.7, layerHeight: 0.32 } },
  { id: "mk4s-0.8", label: "MK4S · 0.8 mm nozzle", profile: { nozzle: 0.8, lineWidth: 0.9, firstLayerWidth: 0.9, layerHeight: 0.4 } },
];

export const DEFAULT_PRESET = "mk4s-0.4";
export const MAX_FILAMENTS: Record<ColorSetup, number> = { mmu3: 5, manual: 8 };
export const COLOR_SETUP_LABEL: Record<ColorSetup, string> = { mmu3: "MMU3", manual: "Manual swap" };

export function defaultPrinter(): PrinterProfile {
  const p = PRESETS.find((x) => x.id === DEFAULT_PRESET)!;
  return { ...p.profile, preset: p.id, minFeatureLines: 2, squish: 0.05, colorSetup: "mmu3", sheetColor: "#8a6d3b" };
}

/** Line width `w`. */
export const lineW = (doc: Doc): number => doc.print?.printer.lineWidth ?? 0;
/** Narrowest feature in mm. */
export const minFeature = (p: PrinterProfile): number => p.minFeatureLines * p.lineWidth;

const HEX = /^#[0-9a-f]{6}$/i;
const pos = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;

// ------------------------------------------------------------------ filaments

export function filamentById(doc: Doc, id: string | undefined): Filament | undefined {
  return id ? doc.print?.filaments.find((f) => f.id === id) : undefined;
}

/** 1-based slot (and print position) of a filament. */
export function slotOf(doc: Doc, id: string): number {
  return (doc.print?.filaments.findIndex((f) => f.id === id) ?? -1) + 1;
}

/** Filament a chain prints in, from its stored style. */
export function chainFilament(doc: Doc, style: ArtStyle | undefined): Filament | undefined {
  const pr = doc.print;
  if (!pr) return undefined;
  return filamentById(doc, style?.filament) ?? filamentById(doc, pr.ink) ?? pr.filaments[0];
}

const COLOR_NAMES: [string, number, number, number][] = [
  ["White", 255, 255, 255],
  ["Black", 0, 0, 0],
  ["Red", 220, 40, 40],
  ["Orange", 240, 140, 30],
  ["Yellow", 245, 220, 40],
  ["Green", 40, 160, 70],
  ["Blue", 40, 90, 210],
  ["Purple", 130, 60, 170],
  ["Pink", 240, 130, 180],
  ["Gray", 128, 128, 128],
  ["Brown", 120, 80, 40],
];

/** A short name for a color ("Red"), for new filaments. */
export function colorName(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  let best = COLOR_NAMES[0][0];
  let bd = Infinity;
  for (const [name, R, G, B] of COLOR_NAMES) {
    const d = (r - R) ** 2 + (g - G) ** 2 + (b - B) ** 2;
    if (d < bd) [best, bd] = [name, d];
  }
  return best;
}

function nextFilamentId(fs: Filament[]): string {
  let i = 1;
  while (fs.some((f) => f.id === `f${i}`)) i++;
  return `f${i}`;
}

function withPrint(doc: Doc, patch: Partial<PrintSettings>): Doc {
  if (!doc.print) return doc;
  return { ...doc, print: { ...doc.print, ...patch } };
}

export type Result = { doc: Doc; error?: undefined } | { doc?: undefined; error: string };

export function addFilament(doc: Doc, color = "#2860d0"): Result {
  const pr = doc.print;
  if (!pr) return { error: "Print mode is off" };
  const max = MAX_FILAMENTS[pr.printer.colorSetup];
  if (pr.filaments.length >= max) return { error: `${COLOR_SETUP_LABEL[pr.printer.colorSetup]} takes at most ${max} filaments` };
  const f: Filament = { id: nextFilamentId(pr.filaments), name: colorName(color), color };
  return { doc: withPrint(doc, { filaments: [...pr.filaments, f] }) };
}

export function updateFilament(doc: Doc, id: string, patch: Partial<Pick<Filament, "name" | "color">>): Doc {
  const pr = doc.print;
  if (!pr) return doc;
  const filaments = pr.filaments.map((f) => {
    if (f.id !== id) return f;
    const next = { ...f };
    if (typeof patch.name === "string" && patch.name.trim()) next.name = patch.name.trim();
    if (typeof patch.color === "string" && HEX.test(patch.color)) next.color = patch.color.toLowerCase();
    return next;
  });
  return withPrint(doc, { filaments });
}

/** Move a filament up (-1) or down (+1) in slot / print order. */
export function moveFilament(doc: Doc, id: string, by: -1 | 1): Doc {
  const pr = doc.print;
  if (!pr) return doc;
  const i = pr.filaments.findIndex((f) => f.id === id);
  const j = i + by;
  if (i < 0 || j < 0 || j >= pr.filaments.length) return doc;
  const filaments = pr.filaments.slice();
  [filaments[i], filaments[j]] = [filaments[j], filaments[i]];
  return withPrint(doc, { filaments });
}

/** Remove a filament; chains that used it move to `into`. */
export function removeFilament(doc: Doc, id: string, into: string): Result {
  const pr = doc.print;
  if (!pr) return { error: "Print mode is off" };
  if (pr.filaments.length <= 1) return { error: "A print needs at least one filament" };
  if (id === into || !filamentById(doc, into)) return { error: "Pick another filament for its areas" };
  const styles: Record<Id, ArtStyle> = {};
  for (const [cid, st] of Object.entries(doc.art?.styles ?? {})) styles[cid] = st.filament === id ? { ...st, filament: into } : st;
  return {
    doc: {
      ...doc,
      art: doc.art ? { ...doc.art, styles } : doc.art,
      print: {
        ...pr,
        filaments: pr.filaments.filter((f) => f.id !== id),
        base: pr.base === id ? into : pr.base,
        ink: pr.ink === id ? into : pr.ink,
      },
    },
  };
}

export function setBaseFilament(doc: Doc, id: string): Doc {
  return filamentById(doc, id) ? withPrint(doc, { base: id }) : doc;
}
export function setInkFilament(doc: Doc, id: string): Doc {
  return filamentById(doc, id) ? withPrint(doc, { ink: id }) : doc;
}
export function setPartOutline(doc: Doc, key: Id | undefined): Doc {
  return withPrint(doc, { outline: key });
}
export function setPrintView(doc: Doc, patch: Pick<Partial<PrintSettings>, "preview" | "side">): Doc {
  return withPrint(doc, patch);
}

// ------------------------------------------------------------------ stroke widths

/** Whole lines for a width in mm: the nearest whole number, at least the minimum feature. */
export function linesFor(p: PrinterProfile, mm: number): number {
  return Math.max(p.minFeatureLines, Math.round(mm / p.lineWidth - 1e-9));
}

/** A stroke width snapped to whole lines (the document is not changed when Print mode is off). */
export function snapWeight(doc: Doc, mm: number): number {
  const pr = doc.print;
  if (!pr || mm <= 0) return mm;
  return linesFor(pr.printer, mm) * pr.printer.lineWidth;
}

/** Every stored stroke width snapped to whole lines. Returns how many changed. */
function snapAllWeights(doc: Doc): { doc: Doc; changed: number } {
  const art = doc.art;
  if (!doc.print || !art) return { doc, changed: 0 };
  let changed = 0;
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;
  const weight = snapWeight(doc, art.weight);
  if (!near(weight, art.weight)) changed++;
  const styles: Record<Id, ArtStyle> = {};
  const seen = new Map<ArtStyle, ArtStyle>();
  for (const [id, st] of Object.entries(art.styles)) {
    let out = seen.get(st);
    if (!out) {
      out = st;
      if (st.weight !== undefined) {
        const w = snapWeight(doc, st.weight);
        if (!near(w, st.weight)) {
          out = { ...st, weight: w };
          changed++;
        }
      }
      seen.set(st, out);
    }
    styles[id] = out;
  }
  return changed ? { doc: { ...doc, art: { ...art, weight, styles } }, changed } : { doc, changed: 0 };
}

// ------------------------------------------------------------------ variables

export const PRINT_VARIABLES = ["w", "nozzle"] as const;

/** `w` and `nozzle` as locked variables following the printer, then every expression re-evaluated. */
function syncVariables(doc: Doc): Doc {
  const pr = doc.print;
  if (!pr) return doc;
  const want: Record<string, number> = { w: pr.printer.lineWidth, nozzle: pr.printer.nozzle };
  const vars: Variable[] = doc.variables.filter((v) => !(v.locked && v.name in want));
  const locked = Object.entries(want).map(([name, value]): Variable => ({ name, expr: String(value), value, locked: true }));
  return refreshExpressions({ ...doc, variables: [...locked, ...vars] });
}

// ------------------------------------------------------------------ on / off, printer

export interface PrintChange {
  doc: Doc;
  /** What was adjusted, for a notice. */
  notes: string[];
}

/**
 * Turn Print mode on: printer profile, a filament per distinct Art color (background first, as the
 * base), `w` and `nozzle` variables, and stroke widths snapped to whole lines.
 */
export function enablePrint(doc: Doc, art: { background: string; colors: string[] }): PrintChange | { error: string } {
  if (doc.print) return { doc, notes: [] };
  const clash = doc.variables.find((v) => !v.locked && (PRINT_VARIABLES as readonly string[]).includes(v.name));
  if (clash) return { error: `Rename the variable "${clash.name}" first: Print mode uses ${PRINT_VARIABLES.join(" and ")} for the printer` };
  const printer = defaultPrinter();
  const colors = Array.from(new Set([art.background, ...art.colors].map((c) => c.toLowerCase())));
  const max = MAX_FILAMENTS[printer.colorSetup];
  const notes: string[] = [];
  if (colors.length > max) {
    notes.push(`The drawing has ${colors.length} colors; the ${COLOR_SETUP_LABEL[printer.colorSetup]} takes ${max}. The rest print in the last filament until you change them`);
    colors.length = max;
  }
  const filaments: Filament[] = colors.map((color, i) => ({ id: `f${i + 1}`, name: colorName(color), color }));
  if (filaments.length === 1) filaments.push({ id: "f2", name: colorName(filaments[0].color === "#000000" ? "#ffffff" : "#000000"), color: filaments[0].color === "#000000" ? "#ffffff" : "#000000" });
  const byColor = new Map(filaments.map((f) => [f.color, f.id]));
  const last = filaments[filaments.length - 1].id;
  // Every chain keeps its color as a filament.
  const styles: Record<Id, ArtStyle> = {};
  const defaultColor = (doc.art?.color ?? "#000000").toLowerCase();
  for (const [id, st] of Object.entries(doc.art?.styles ?? {})) styles[id] = st.color ? { ...st, filament: byColor.get(st.color.toLowerCase()) ?? last } : st;
  const ink = byColor.get(defaultColor) ?? (filaments[1] ?? filaments[0]).id;
  let next: Doc = {
    ...doc,
    art: doc.art ? { ...doc.art, styles } : doc.art,
    print: { printer, filaments, base: filaments[0].id, ink },
  };
  next = syncVariables(next);
  const snapped = snapAllWeights(next);
  if (snapped.changed) notes.push(`${snapped.changed} stroke width${snapped.changed === 1 ? "" : "s"} rounded to whole ${printer.lineWidth} mm lines`);
  return { doc: snapped.doc, notes };
}

/** Turn Print mode off. `w` and `nozzle` stay as ordinary variables so dimensions using them keep working. */
export function disablePrint(doc: Doc): Doc {
  if (!doc.print) return doc;
  const { print: _drop, ...rest } = doc;
  return { ...rest, variables: doc.variables.map(({ locked: _l, ...v }) => v) };
}

/** Change the printer profile (a preset id fills the nozzle, widths and layer height). */
export function setPrinter(doc: Doc, patch: Partial<PrinterProfile>): PrintChange {
  const pr = doc.print;
  if (!pr) return { doc, notes: [] };
  let printer: PrinterProfile = { ...pr.printer };
  if (patch.preset && patch.preset !== pr.printer.preset) {
    const p = PRESETS.find((x) => x.id === patch.preset);
    if (p) printer = { ...printer, ...p.profile, preset: p.id };
  }
  for (const k of ["nozzle", "lineWidth", "firstLayerWidth", "layerHeight"] as const)
    if (pos(patch[k]) && patch[k] !== printer[k]) printer = { ...printer, [k]: patch[k], preset: "custom" };
  if (typeof patch.squish === "number" && Number.isFinite(patch.squish) && patch.squish >= 0) printer.squish = patch.squish;
  if (pos(patch.minFeatureLines)) printer.minFeatureLines = Math.max(1, Math.round(patch.minFeatureLines));
  if (typeof patch.sheetColor === "string" && HEX.test(patch.sheetColor)) printer.sheetColor = patch.sheetColor.toLowerCase();
  const notes: string[] = [];
  if (patch.colorSetup && patch.colorSetup !== printer.colorSetup) {
    const max = MAX_FILAMENTS[patch.colorSetup];
    if (pr.filaments.length > max) notes.push(`${COLOR_SETUP_LABEL[patch.colorSetup]} takes at most ${max} filaments; remove ${pr.filaments.length - max} first`);
    else printer.colorSetup = patch.colorSetup;
  }
  let next: Doc = { ...doc, print: { ...pr, printer } };
  if (printer.lineWidth !== pr.printer.lineWidth || printer.nozzle !== pr.printer.nozzle) next = syncVariables(next);
  const snapped = snapAllWeights(next);
  if (snapped.changed) notes.push(`${snapped.changed} stroke width${snapped.changed === 1 ? "" : "s"} rounded to whole ${printer.lineWidth} mm lines`);
  return { doc: snapped.doc, notes };
}

/** Print settings read from a file; anything malformed is dropped (Print mode off). */
export function readPrintSettings(raw: any): PrintSettings | undefined {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.filaments) || !raw.printer) return undefined;
  const d = defaultPrinter();
  const p = raw.printer;
  const printer: PrinterProfile = {
    preset: typeof p.preset === "string" ? p.preset : "custom",
    nozzle: pos(p.nozzle) ? p.nozzle : d.nozzle,
    lineWidth: pos(p.lineWidth) ? p.lineWidth : d.lineWidth,
    firstLayerWidth: pos(p.firstLayerWidth) ? p.firstLayerWidth : d.firstLayerWidth,
    squish: typeof p.squish === "number" && p.squish >= 0 ? p.squish : d.squish,
    minFeatureLines: pos(p.minFeatureLines) ? Math.round(p.minFeatureLines) : d.minFeatureLines,
    layerHeight: pos(p.layerHeight) ? p.layerHeight : d.layerHeight,
    colorSetup: p.colorSetup === "manual" ? "manual" : "mmu3",
    sheetColor: typeof p.sheetColor === "string" && HEX.test(p.sheetColor) ? p.sheetColor.toLowerCase() : d.sheetColor,
  };
  const filaments: Filament[] = raw.filaments
    .filter((f: any) => f && typeof f.id === "string" && typeof f.color === "string" && HEX.test(f.color))
    .map((f: any) => ({ id: f.id, name: typeof f.name === "string" && f.name ? f.name : colorName(f.color), color: f.color.toLowerCase() }));
  if (!filaments.length) return undefined;
  const has = (id: unknown) => typeof id === "string" && filaments.some((f) => f.id === id);
  const out: PrintSettings = { printer, filaments, base: has(raw.base) ? raw.base : filaments[0].id, ink: has(raw.ink) ? raw.ink : filaments[filaments.length - 1].id };
  if (typeof raw.outline === "string") out.outline = raw.outline;
  if (raw.preview === "drawn" || raw.preview === "printed") out.preview = raw.preview;
  if (raw.side === "bed" || raw.side === "top") out.side = raw.side;
  return out;
}
