import type { Vec2 } from "../geom/vec";
import type { InferGlyph, SnapResult } from "../inference/snap";
import type { Editor } from "../model/editor";
import { relationIcons, type RelationIcon } from "../model/relations";
import type { Id } from "../model/types";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";

/**
 * Add the relations a snap implies for a newly created point. Drawing only adds coincident (on a point or
 * a curve) here, and horizontal/vertical in applyHV. Other snaps (midpoint, tangent, perpendicular) place
 * the geometry exactly but add no relation.
 */
export function applySnap(ed: Editor, pointId: Id, sn: SnapResult | undefined) {
  if (!sn) return;
  if (sn.point && sn.point !== pointId && ed.s.entities[sn.point]) ed.addRelation({ type: "coincident", refs: [pointId, sn.point] });
  else if (sn.curve && ed.s.entities[sn.curve]) ed.addRelation({ type: "coincident", refs: [pointId, sn.curve] });
}

/** Add H/V to a line created from a snap that inferred it (dropped later if it over-defines the sketch). */
export function applyHV(ed: Editor, lineId: Id, sn: SnapResult | undefined) {
  if (sn?.hv) ed.tentative.push(ed.addRelation({ type: sn.hv, refs: [lineId] }));
}

export function addLine(ed: Editor, a: Vec2, b: Vec2, construction = false): { line: Id; p1: Id; p2: Id } {
  const line = ed.newId("e");
  const p1 = ed.addPoint(a.x, a.y, line);
  const p2 = ed.addPoint(b.x, b.y, line);
  ed.put({ id: line, type: "line", p1, p2, ...(construction ? { construction } : {}) });
  return { line, p1, p2 };
}

export function addCircle(ed: Editor, c: Vec2, r: number, construction = false): { circle: Id; c: Id } {
  const circle = ed.newId("e");
  const cp = ed.addPoint(c.x, c.y, circle);
  ed.put({ id: circle, type: "circle", c: cp, r, ...(construction ? { construction } : {}) });
  return { circle, c: cp };
}

/** Arc CCW from a to b around c. */
export function addArc(ed: Editor, c: Vec2, a: Vec2, b: Vec2, construction = false): { arc: Id; c: Id; s: Id; e: Id } {
  const arc = ed.newId("e");
  const cp = ed.addPoint(c.x, c.y, arc);
  const sp = ed.addPoint(a.x, a.y, arc);
  const ep = ed.addPoint(b.x, b.y, arc);
  ed.put({ id: arc, type: "arc", c: cp, s: sp, e: ep, ...(construction ? { construction } : {}) });
  return { arc, c: cp, s: sp, e: ep };
}

/** Inference previews use the icon of the relation they will create. */
const glyphIcon: Record<InferGlyph, RelationIcon> = {
  coincident: relationIcons.coincident,
  midpoint: relationIcons.midpoint,
  on: relationIcons.coincident,
  H: relationIcons.horizontal,
  V: relationIcons.vertical,
  tangent: relationIcons.tangent,
  perpendicular: relationIcons.perpendicular,
  grid: { stroke: "M3.5 1.5V8.5M6.5 1.5V8.5M1.5 3.5H8.5M1.5 6.5H8.5" },
};

/** Dotted inference lines and the yellow relation-preview glyphs near the cursor. */
export function drawSnap(p: Painter, sn: SnapResult | undefined, extra: InferGlyph[] = []) {
  if (!sn) return;
  for (const g of sn.guides) p.line(g.a, g.b, { color: theme.inference, width: 1, dash: [2, 4] });
  if (sn.point) p.ring(sn.pos, 7, theme.hover, 2);
  if (sn.curve) p.ring(sn.pos, 5, theme.hover, 1.5);
  if (sn.midpointOf) p.ring(sn.pos, 6, theme.hover, 2);
  const glyphs = [...sn.glyphs.filter((g) => g !== "grid"), ...extra];
  const s = p.s(sn.pos);
  glyphs.forEach((g, i) => p.badge(glyphIcon[g], s.x + 18 + i * 18, s.y + 18, theme.inferGlyphBg, theme.inferGlyphFg, theme.inferGlyphBorder));
}

export function screenDist(a: Vec2, b: Vec2) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export const DRAG_THRESHOLD_PX = 5;

/**
 * Mouse clicks wobble: a press and release closer than this is a click, not a drag, and a clicked
 * segment shorter than this is ignored (unless it ends on an existing point).
 */
export const MOUSE_SLOP_PX = 10;

/** Movement that turns a press into a drag for this pointer. */
export const dragThreshold = (pointerType?: string) => (pointerType === "mouse" ? MOUSE_SLOP_PX : DRAG_THRESHOLD_PX);
