/** Default keyboard map (SolidWorks-flavored). Keys are lower-case `KeyboardEvent.key`. */
export const defaultKeymap: Record<string, string> = {
  l: "tool:line",
  c: "tool:circle",
  a: "tool:arc",
  b: "tool:spline",
  p: "tool:point",
  d: "tool:dimension",
  r: "relationsPanel",
  t: "tool:trim",
  o: "tool:offset",
  m: "tool:mirror",
  q: "toggleConstruction",
  f: "zoomFit",
  s: "shortcutBar",
};

const STORAGE_KEY = "sketchworx.keymap";

/** Keymap with the user's overrides from localStorage (per browser). */
export function loadKeymap(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* storage unavailable */
  }
  return { ...defaultKeymap };
}

export function saveKeymap(map: Record<string, string>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* storage unavailable */
  }
}

/** Every bindable action. */
export const bindableActions = [
  "tool:line",
  "tool:centerline",
  "tool:rect",
  "tool:circle",
  "tool:arc",
  "tool:tangentArc",
  "tool:arc3",
  "tool:spline",
  "tool:point",
  "tool:dimension",
  "relationsPanel",
  "variablesPanel",
  "tool:trim",
  "tool:extend",
  "tool:fillet",
  "tool:offset",
  "tool:mirror",
  "toggleConstruction",
  "zoomFit",
  "shortcutBar",
  "view:sketch",
  "view:art",
];

export const actionLabels: Record<string, string> = {
  "tool:centerline": "Centerline",
  "tool:rect": "Corner Rectangle",
  "tool:tangentArc": "Tangent Arc",
  "tool:arc3": "3 Point Arc",
  variablesPanel: "Global Variables",
  "tool:extend": "Extend Entities",
  "tool:fillet": "Sketch Fillet",
  "view:sketch": "Sketch View",
  "view:art": "Art View",
  "view:print": "Print View",
  "tool:line": "Line",
  "tool:circle": "Circle",
  "tool:arc": "Centerpoint Arc",
  "tool:spline": "Style Spline",
  "tool:point": "Point",
  "tool:dimension": "Smart Dimension",
  relationsPanel: "Display/Delete Relations",
  "tool:trim": "Trim Entities",
  "tool:offset": "Offset Entities",
  "tool:mirror": "Mirror Entities",
  toggleConstruction: "Construction Geometry",
  zoomFit: "Zoom to Fit",
  shortcutBar: "Shortcut Bar",
};
