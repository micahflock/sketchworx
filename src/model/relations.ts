import type { Editor } from "./editor";
import { definingPoints, endPoints, entityLabel, ptv } from "./sketch";
import type { Entity, Id, Relation, RelationType, Sketch } from "./types";

export const relationNames: Record<RelationType, string> = {
  coincident: "Coincident",
  horizontal: "Horizontal",
  vertical: "Vertical",
  parallel: "Parallel",
  perpendicular: "Perpendicular",
  collinear: "Collinear",
  equal: "Equal",
  tangent: "Tangent",
  concentric: "Concentric",
  coradial: "Coradial",
  midpoint: "Midpoint",
  symmetric: "Symmetric",
  fix: "Fix",
  equalCurvature: "Equal Curvature",
};

/** Short glyph text drawn in the green relation badges. */
export const relationGlyphs: Record<RelationType, string> = {
  coincident: "◉",
  horizontal: "—",
  vertical: "|",
  parallel: "∥",
  perpendicular: "⊥",
  collinear: "≡",
  equal: "=",
  tangent: "◠",
  concentric: "◎",
  coradial: "⊚",
  midpoint: "M",
  symmetric: "⫼",
  fix: "⚓",
  equalCurvature: "κ",
};

/** Display order in Add Relations (most common first, as in SolidWorks). */
export const relationOrder: RelationType[] = [
  "horizontal",
  "vertical",
  "coincident",
  "tangent",
  "equalCurvature",
  "equal",
  "parallel",
  "perpendicular",
  "collinear",
  "midpoint",
  "concentric",
  "coradial",
  "symmetric",
  "fix",
];

/** Relations SolidWorks would offer for this selection (in selection order). */
export function validRelations(s: Sketch, ids: Id[]): RelationType[] {
  const ents = ids.map((id) => s.entities[id]).filter(Boolean) as Entity[];
  if (!ents.length || ents.length !== ids.length) return [];
  // Driven offset geometry cannot take relations.
  const derived = (e: Entity) =>
    (e.type === "spline" && !!e.derived) || (e.type === "point" && !!e.owner && s.entities[e.owner]?.type === "spline" && !!(s.entities[e.owner] as { derived?: unknown }).derived);
  if (ents.some(derived)) return [];
  const n = ents.length;
  const P = ents.filter((e) => e.type === "point");
  const L = ents.filter((e) => e.type === "line");
  const R = ents.filter((e) => e.type === "circle" || e.type === "arc");
  const S = ents.filter((e) => e.type === "spline");
  const out = new Set<RelationType>();
  if (!ids.includes("origin")) out.add("fix"); // the origin is already fixed
  if (P.length === n && n >= 2) {
    out.add("coincident");
    out.add("horizontal");
    out.add("vertical");
  }
  if (P.length === 1 && n === 2 && L.length + R.length + S.filter((e) => !e.derived).length === 1) {
    const curve = ents.find((e) => e.type !== "point")!;
    const own = definingPoints(curve).includes(P[0].id);
    if (!own) {
      out.add("coincident");
      if (L.length === 1) out.add("midpoint");
    }
  }
  if (L.length === n) {
    out.add("horizontal");
    out.add("vertical");
    if (n >= 2) {
      out.add("parallel");
      out.add("collinear");
      out.add("equal");
    }
    if (n === 2) out.add("perpendicular");
  }
  if (R.length === n && n >= 2) {
    out.add("equal");
    out.add("concentric");
    out.add("coradial");
  }
  if (n === 2) {
    const [a, b] = ents;
    const isRound = (e: Entity) => e.type === "circle" || e.type === "arc";
    if ((a.type === "line" && isRound(b)) || (b.type === "line" && isRound(a)) || (isRound(a) && isRound(b))) out.add("tangent");
    if (S.length >= 1 && (L.length + R.length + S.length === 2)) {
      // Spline tangency needs a shared endpoint.
      const sp = S[0];
      const other = ents.find((e) => e !== sp)!;
      if (other.type !== "circle" && sharesEndpoint(s, sp, other)) {
        out.add("tangent");
        // G2 needs curvature on the spline side (degree ≥ 2) and a curved partner.
        const deg = (e: Entity) => (e.type === "spline" ? e.cps.length - 1 : 0);
        if (deg(sp) >= 2 && (other.type === "arc" || deg(other) >= 2)) out.add("equalCurvature");
      }
    }
  }
  if (n === 3) {
    // Two like entities plus a centerline (construction line).
    const axis = [...ents].reverse().find((e) => e.type === "line" && e.construction);
    if (axis) {
      const [a, b] = ents.filter((e) => e !== axis);
      const round = (e: Entity) => e.type === "circle" || e.type === "arc";
      if (a.type === b.type || (round(a) && round(b))) out.add("symmetric");
    }
  }
  return relationOrder.filter((r) => out.has(r));
}

function sharesEndpoint(s: Sketch, a: Entity, b: Entity): boolean {
  const ea = endPoints(a);
  const eb = endPoints(b);
  const coinc = new Set<string>();
  for (const r of Object.values(s.relations)) {
    if (r.type !== "coincident" || r.refs.length < 2) continue;
    for (const x of r.refs) for (const y of r.refs) if (x !== y) coinc.add(`${x}|${y}`);
  }
  for (const pa of ea) for (const pb of eb) if (pa === pb || coinc.has(`${pa}|${pb}`)) return true;
  return false;
}

/** Add a relation for the selection (Fix: one relation per entity, values snapshotted). */
export function addRelationCmd(ed: Editor, type: RelationType, ids: Id[]): Id[] {
  const s = ed.s;
  if (type === "fix") {
    return ids.map((id) => {
      const e = s.entities[id];
      const pts = e.type === "point" ? [e.id] : definingPoints(e);
      const values: number[] = [];
      for (const p of pts) {
        const q = ptv(s, p);
        values.push(q.x, q.y);
      }
      if (e.type === "circle") values.push(e.r);
      return ed.addRelation({ type, refs: [id], values });
    });
  }
  // Equal Curvature includes tangency: it replaces a Tangent relation between the same pair.
  if (type === "equalCurvature")
    for (const r of Object.values(s.relations))
      if (r.type === "tangent" && r.refs.length === 2 && ids.every((id) => r.refs.includes(id))) ed.deleteRelation(r.id);
  // Horizontal/Vertical on lines is a single-entity relation: one per line, as in SolidWorks.
  if ((type === "horizontal" || type === "vertical") && ids.every((id) => s.entities[id]?.type === "line"))
    return ids.map((id) => ed.addRelation({ type, refs: [id] }));
  let refs = ids;
  if (type === "symmetric") {
    const axis = [...ids].reverse().find((id) => {
      const e = s.entities[id];
      return e.type === "line" && e.construction;
    })!;
    refs = [...ids.filter((x) => x !== axis), axis];
  }
  if (type === "midpoint" || type === "coincident") {
    // Point first for point-curve relations.
    refs = [...ids].sort((a, b) => Number(s.entities[b].type === "point") - Number(s.entities[a].type === "point"));
  }
  return [ed.addRelation({ type, refs })];
}

/** Relations that reference any of the given ids (or their defining points). */
export function relationsOf(s: Sketch, ids: Id[]): Relation[] {
  const set = new Set(ids);
  for (const id of ids) {
    const e = s.entities[id];
    if (e && e.type !== "point") for (const p of definingPoints(e)) set.add(p);
  }
  return Object.values(s.relations).filter((r) => r.refs.some((x) => set.has(x)));
}

export function describeRelation(s: Sketch, r: Relation): string {
  return r.refs.map((id) => (s.entities[id] ? entityLabel(s.entities[id]) : `${id} (missing)`)).join(", ");
}

/** Hide point-point coincident glyphs (chain joints) to avoid clutter, as SolidWorks does. */
export function relationHasGlyph(s: Sketch, r: Relation): boolean {
  if (r.type === "coincident") return r.refs.some((id) => s.entities[id]?.type !== "point");
  return true;
}
