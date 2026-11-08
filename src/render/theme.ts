import type { EntityState } from "../solver/types";

/** Canvas colors. SolidWorks sketch colors: blue under defined, black fully defined, red over defined. */
export interface CanvasTheme {
  bg: string;
  gridDot: string;
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
}

export const lightTheme: CanvasTheme = {
  bg: "#f4f6f9",
  gridDot: "rgba(60,80,110,0.22)",
  gridAxis: "rgba(60,80,110,0.25)",
  origin: "#dd3333",
  state: {
    under: "#1f3fe0",
    full: "#111111",
    over: "#e01b1b",
    failed: "#c99a00",
  },
  selected: "#00a2ff",
  hover: "#ff8a00",
  preview: "#1f3fe0",
  previewFaint: "rgba(31,63,224,0.35)",
  inference: "#2f6bff",
  inferGlyphBg: "#ffe14a",
  inferGlyphFg: "#5a4500",
  inferGlyphBorder: "#c9a400",
  relGlyphBg: "#d9f5d9",
  relGlyphFg: "#127a12",
  relGlyphBorder: "#9fd19f",
  relGlyphConflict: "#ffd6d6",
  relGlyphConflictFg: "#bb0000",
  relGlyphConflictBorder: "#e08080",
  relGlyphHotBg: "#ffe2b8",
  relGlyphHotFg: "#a35200",
  dim: "#111111",
  dimDriven: "#7a7a7a",
  dimConflict: "#e01b1b",
  dimLabelBg: "rgba(244,246,249,0.92)",
  dimLabelHotBg: "#fff3df",
  measure: "#333333",
  construction: "#3f6fd8",
  reference: "#8b93a3",
  later: "rgba(110,120,140,0.35)",
  derived: "#6b6b8a",
  handleFill: "#ffffff",
  openEnd: "#ff7a00",
  fill: "#141414",
  profileTint: "rgba(30,40,70,0.10)",
  boxWindow: "rgba(0,120,255,0.12)",
  boxWindowLine: "#1a6ad8",
  boxCrossing: "rgba(0,180,80,0.12)",
  boxCrossingLine: "#1a9a4a",
  trimStroke: "#dd3333",
  splitDivider: "#b9c3d2",
};

/** Same meanings on a dark canvas: fully defined turns light, blues and reds are lifted to stay readable. */
export const darkTheme: CanvasTheme = {
  bg: "#1a1e26",
  gridDot: "rgba(170,185,210,0.20)",
  gridAxis: "rgba(170,185,210,0.24)",
  origin: "#ff5c5c",
  state: {
    under: "#6f8cff",
    full: "#e8ecf2",
    over: "#ff5252",
    failed: "#e6b800",
  },
  selected: "#38b6ff",
  hover: "#ffa035",
  preview: "#6f8cff",
  previewFaint: "rgba(111,140,255,0.40)",
  inference: "#6f9bff",
  inferGlyphBg: "#ffe14a",
  inferGlyphFg: "#4a3800",
  inferGlyphBorder: "#c9a400",
  relGlyphBg: "#1d3a23",
  relGlyphFg: "#86dc92",
  relGlyphBorder: "#3d7a48",
  relGlyphConflict: "#4b1f23",
  relGlyphConflictFg: "#ff9c9c",
  relGlyphConflictBorder: "#a04848",
  relGlyphHotBg: "#4a3418",
  relGlyphHotFg: "#ffc27a",
  dim: "#e8ecf2",
  dimDriven: "#8d95a5",
  dimConflict: "#ff5252",
  dimLabelBg: "rgba(26,30,38,0.92)",
  dimLabelHotBg: "#3a2e1d",
  measure: "#c9cfdb",
  construction: "#7f9ff2",
  reference: "#7d8596",
  later: "rgba(160,170,190,0.32)",
  derived: "#9a9ac2",
  handleFill: "#1a1e26",
  openEnd: "#ff8a1f",
  fill: "#141414",
  profileTint: "rgba(150,170,220,0.10)",
  boxWindow: "rgba(60,140,255,0.16)",
  boxWindowLine: "#5a9bff",
  boxCrossing: "rgba(40,200,110,0.14)",
  boxCrossingLine: "#3ccf7a",
  trimStroke: "#ff5c5c",
  splitDivider: "#3a4252",
};

export type ThemeName = "light" | "dark";

/** The active canvas colors. One shared object, so renderers read the current theme without re-importing. */
export const theme: CanvasTheme = structuredClone(lightTheme);

export function setCanvasTheme(name: ThemeName) {
  const src = name === "dark" ? darkTheme : lightTheme;
  Object.assign(theme, structuredClone(src));
}
