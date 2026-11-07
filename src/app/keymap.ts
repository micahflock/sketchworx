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

export const actionLabels: Record<string, string> = {
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
