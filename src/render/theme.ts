import type { EntityState } from "../solver/types";

/** How geometry in one constraint state is drawn, beyond its color (HELL MODE draws everything in one red). */
export interface StateStyle {
  /** Dash pattern for curves (screen px). */
  dash?: number[];
  /** Points drawn hollow (outline on the canvas color). */
  hollow?: boolean;
  /** Spline control points filled with the curve color. */
  solidHandles?: boolean;
  /** Curves drawn as a zigzag. */
  jagged?: boolean;
  /** Points drawn as ✕ marks. */
  crossPoints?: boolean;
}

/**
 * Canvas colors and drawing traits. SolidWorks sketch colors: blue under defined, black (bone white on a
 * dark canvas) fully defined, red over defined. Selection uses the theme accent.
 */
export interface CanvasTheme {
  bg: string;
  /** Graticule lines, or a dot grid. */
  gridStyle: "lines" | "dots";
  /** Every grid step ("transparent" draws majors only). */
  gridMinor: string;
  /** Every fifth grid step. */
  gridMajor: string;
  gridAxis: string;
  /** Origin arrows. */
  origin: string;
  state: Record<EntityState, string>;
  selected: string;
  hover: string;
  preview: string;
  /** Faint preview (helper circle while drawing). */
  previewFaint: string;
  inference: string;
  inferGlyphBg: string;
  inferGlyphFg: string;
  inferGlyphBorder: string;
  relGlyphBg: string;
  relGlyphFg: string;
  relGlyphBorder: string;
  relGlyphConflict: string;
  relGlyphConflictFg: string;
  relGlyphConflictBorder: string;
  relGlyphHotBg: string;
  relGlyphHotFg: string;
  dim: string;
  dimDriven: string;
  dimConflict: string;
  dimLabelBg: string;
  dimLabelHotBg: string;
  /** Live measurements next to the cursor while drawing. */
  measure: string;
  construction: string;
  /** Geometry of earlier sketches (referenceable, locked). */
  reference: string;
  /** Sketches below the active one. */
  later: string;
  /** Derived curves (offsets) drawn quieter than the curves they follow. */
  derived: string;
  /** Inside of spline control-point squares. */
  handleFill: string;
  openEnd: string;
  fill: string;
  /** Tint of closed profiles in Sketch view. */
  profileTint: string;
  boxWindow: string;
  boxWindowLine: string;
  boxCrossing: string;
  boxCrossingLine: string;
  /** Freehand stroke of Trim's power trim. */
  trimStroke: string;
  /** Line between the sketch and art panes of Split view. */
  splitDivider: string;
  /** Curve width, and width when selected or hovered (screen px). */
  lineWidth: number;
  emphWidth: number;
  stateStyle: Record<EntityState, StateStyle>;
  /** Draw ✕ marks beside conflicting relations and dimensions. */
  conflictCross: boolean;
  /** Relation/inference tags. */
  glyphRadius: number;
  dimFont: string;
}

const plainStates: Record<EntityState, StateStyle> = { under: {}, full: {}, over: {}, failed: {} };

/** Test bench: warm gray graticule, Braun orange selection. */
export const lightTheme: CanvasTheme = {
  bg: "#f4f2ed",
  gridStyle: "lines",
  gridMinor: "rgba(40,35,25,0.06)",
  gridMajor: "rgba(40,35,25,0.13)",
  gridAxis: "rgba(40,35,25,0.2)",
  origin: "#6b675f",
  state: {
    under: "#1f4fe0",
    full: "#141414",
    over: "#d21f1f",
    failed: "#c99a00",
  },
  selected: "#e8600f",
  hover: "rgba(232,96,15,0.55)",
  preview: "#1f4fe0",
  previewFaint: "rgba(31,79,224,0.35)",
  inference: "rgba(232,96,15,0.8)",
  inferGlyphBg: "#f6f4ef",
  inferGlyphFg: "#e8600f",
  inferGlyphBorder: "#e8600f",
  relGlyphBg: "#f6f4ef",
  relGlyphFg: "#1d1c1a",
  relGlyphBorder: "#8c867a",
  relGlyphConflict: "#f6f4ef",
  relGlyphConflictFg: "#d21f1f",
  relGlyphConflictBorder: "#d21f1f",
  relGlyphHotBg: "#f6f4ef",
  relGlyphHotFg: "#e8600f",
  dim: "#1d1c1a",
  dimDriven: "#8c867a",
  dimConflict: "#d21f1f",
  dimLabelBg: "rgba(244,242,237,0.92)",
  dimLabelHotBg: "#fbe9dc",
  measure: "#45423d",
  construction: "#1f4fe0",
  reference: "#9a958a",
  later: "rgba(107,103,95,0.35)",
  derived: "#7a746a",
  handleFill: "#f4f2ed",
  openEnd: "#e8600f",
  fill: "#141414",
  profileTint: "rgba(40,35,25,0.07)",
  boxWindow: "rgba(232,96,15,0.10)",
  boxWindowLine: "#e8600f",
  boxCrossing: "rgba(40,35,25,0.06)",
  boxCrossingLine: "#6b675f",
  trimStroke: "#e8600f",
  splitDivider: "#cbc5b8",
  lineWidth: 1.6,
  emphWidth: 2.5,
  stateStyle: plainStates,
  conflictCross: false,
  glyphRadius: 1,
  dimFont: "12px 'IBM Plex Mono', ui-monospace, monospace",
};

/** Sequencer: near-black canvas with a dot grid; fully defined turns bone white, amber selection. */
export const darkTheme: CanvasTheme = {
  bg: "#0c0c0c",
  gridStyle: "dots",
  gridMinor: "rgba(255,255,255,0.09)",
  gridMajor: "rgba(255,255,255,0.16)",
  gridAxis: "rgba(255,255,255,0.12)",
  origin: "#85817a",
  state: {
    under: "#6e95ff",
    full: "#f2f0ea",
    over: "#ff4a4a",
    failed: "#e6b800",
  },
  selected: "#f2b705",
  hover: "rgba(242,183,5,0.55)",
  preview: "#6e95ff",
  previewFaint: "rgba(110,149,255,0.40)",
  inference: "rgba(242,183,5,0.8)",
  inferGlyphBg: "#f2b705",
  inferGlyphFg: "#111111",
  inferGlyphBorder: "#f2b705",
  relGlyphBg: "#ece9e2",
  relGlyphFg: "#111111",
  relGlyphBorder: "#ece9e2",
  relGlyphConflict: "#0f0f0f",
  relGlyphConflictFg: "#ff4a4a",
  relGlyphConflictBorder: "#ff4a4a",
  relGlyphHotBg: "#f2b705",
  relGlyphHotFg: "#111111",
  dim: "#ece9e2",
  dimDriven: "#85817a",
  dimConflict: "#ff4a4a",
  dimLabelBg: "rgba(12,12,12,0.92)",
  dimLabelHotBg: "#2a2410",
  measure: "#b5b1a9",
  construction: "#6e95ff",
  reference: "#6e6a63",
  later: "rgba(236,233,226,0.22)",
  derived: "#9a958a",
  handleFill: "#0c0c0c",
  openEnd: "#f2b705",
  fill: "#141414",
  profileTint: "rgba(236,233,226,0.06)",
  boxWindow: "rgba(242,183,5,0.12)",
  boxWindowLine: "#f2b705",
  boxCrossing: "rgba(255,255,255,0.05)",
  boxCrossingLine: "#85817a",
  trimStroke: "#f2b705",
  splitDivider: "#2b2b2b",
  lineWidth: 1.6,
  emphWidth: 2.5,
  stateStyle: plainStates,
  conflictCross: false,
  glyphRadius: 0,
  dimFont: "12px 'JetBrains Mono', ui-monospace, monospace",
};

/** HELL MODE accent colors: one bold color on black. */
export const HELL_ACCENTS = {
  red: "#ff1f1f",
  green: "#1fff3c",
  pink: "#ff2fb4",
  orange: "#ff7a0f",
  yellow: "#ffe81f",
  blue: "#2f7dff",
  purple: "#a53fff",
  white: "#ffffff",
} as const;
export type HellAccent = keyof typeof HELL_ACCENTS;

export function isHellAccent(v: unknown): v is HellAccent {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(HELL_ACCENTS, v);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
/** The accent at alpha a over the canvas. */
const rgba = (hex: string, a: number) => `rgba(${rgb(hex).join(",")},${a})`;
/** The accent darkened toward black (k = 1 is the accent itself). */
export function shade(hex: string, k: number): string {
  return "#" + rgb(hex).map((c) => Math.round(c * k).toString(16).padStart(2, "0")).join("");
}

/** Shades of the HELL MODE accent shared by the canvas and the interface (global.css). */
export function hellShades(accent: HellAccent) {
  const c = HELL_ACCENTS[accent];
  return { main: c, dim: shade(c, 0.64), edge: shade(c, 0.29), edgeSoft: shade(c, 0.23), deep: shade(c, 0.125), deeper: shade(c, 0.08) };
}

/** HELL MODE: black and one color, so constraint state is shown by line shape instead of hue. */
export function hellPalette(accent: HellAccent = "red"): CanvasTheme {
  const { main: C, dim: DIM, edge, edgeSoft } = hellShades(accent);
  return {
    bg: "#000000",
    gridStyle: "lines",
    gridMinor: "transparent",
    gridMajor: rgba(C, 0.16),
    gridAxis: rgba(C, 0.25),
    origin: C,
    state: { under: C, full: C, over: C, failed: C },
    selected: C,
    hover: rgba(C, 0.6),
    preview: C,
    previewFaint: rgba(C, 0.35),
    inference: DIM,
    inferGlyphBg: "#000000",
    inferGlyphFg: C,
    inferGlyphBorder: C,
    relGlyphBg: "#000000",
    relGlyphFg: C,
    relGlyphBorder: C,
    relGlyphConflict: C,
    relGlyphConflictFg: "#000000",
    relGlyphConflictBorder: C,
    relGlyphHotBg: C,
    relGlyphHotFg: "#000000",
    dim: C,
    dimDriven: DIM,
    dimConflict: C,
    dimLabelBg: "rgba(0,0,0,0.92)",
    dimLabelHotBg: edgeSoft,
    measure: C,
    construction: C,
    reference: DIM,
    later: rgba(C, 0.3),
    derived: DIM,
    handleFill: "#000000",
    openEnd: C,
    fill: "#141414",
    profileTint: rgba(C, 0.06),
    boxWindow: rgba(C, 0.1),
    boxWindowLine: C,
    boxCrossing: rgba(C, 0.05),
    boxCrossingLine: DIM,
    trimStroke: C,
    splitDivider: edge,
    lineWidth: 2.4,
    emphWidth: 4.5,
    stateStyle: {
      under: { dash: [10, 6], hollow: true },
      full: { solidHandles: true },
      over: { jagged: true, solidHandles: true, crossPoints: true },
      failed: { jagged: true, solidHandles: true, crossPoints: true },
    },
    conflictCross: true,
    glyphRadius: 0,
    dimFont: "12px 'IBM Plex Mono', ui-monospace, monospace",
  };
}

export const hellTheme: CanvasTheme = hellPalette("red");

export type ThemeName = "light" | "dark" | "hell";

const palettes: Record<ThemeName, CanvasTheme> = { light: lightTheme, dark: darkTheme, hell: hellTheme };

/** The active canvas colors. One shared object, so renderers read the current theme without re-importing. */
export const theme: CanvasTheme = structuredClone(lightTheme);

export function setCanvasTheme(name: ThemeName, hellAccent: HellAccent = "red") {
  Object.assign(theme, name === "hell" ? hellPalette(hellAccent) : structuredClone(palettes[name]));
}
