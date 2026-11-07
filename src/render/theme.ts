import type { EntityState } from "../solver/types";

/** SolidWorks sketch colors. */
export const theme = {
  bg: "#f4f6f9",
  gridDot: "rgba(60,80,110,0.22)",
  gridAxis: "rgba(60,80,110,0.25)",
  state: {
    under: "#1f3fe0",
    full: "#111111",
    over: "#e01b1b",
    failed: "#c99a00",
  } as Record<EntityState, string>,
  selected: "#00a2ff",
  hover: "#ff8a00",
  preview: "#1f3fe0",
  inference: "#2f6bff",
  inferGlyphBg: "#ffe14a",
  relGlyphBg: "#d9f5d9",
  relGlyphFg: "#127a12",
  relGlyphConflict: "#ffd6d6",
  dim: "#111111",
  dimDriven: "#7a7a7a",
  dimConflict: "#e01b1b",
  construction: "#3f6fd8",
  openEnd: "#ff7a00",
  fill: "#141414",
  boxWindow: "rgba(0,120,255,0.12)",
  boxCrossing: "rgba(0,180,80,0.12)",
};
