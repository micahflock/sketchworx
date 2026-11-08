import { entityLabel } from "../model/sketch";
import type { Dimension, Id, Relation, Sketch } from "../model/types";
import { relationSupported } from "../solver/build";
import { dimensionConstraints } from "../solver/dimensions";
import type { PEvent, Tool, ToolHost } from "./tool";

/** References of a relation/dimension that no longer exist in the working view. */
export function missingRefs(s: Sketch, item: Relation | Dimension): Id[] {
  return item.refs.filter((id) => !s.entities[id]);
}

/** Point ids start with "p", curve ids with "e": that tells what kind of geometry went missing. */
export const missingKind = (id: Id): "point" | "curve" => (id.startsWith("p") ? "point" : "curve");

/**
 * Re-point one missing reference of a dangling relation or dimension to `pick`.
 * Returns the repaired item, or the reason the pick does not fit.
 */
export function repairWith(s: Sketch, item: Relation | Dimension, missing: Id, pick: Id): { relation?: Relation; dimension?: Dimension } | string {
  const e = s.entities[pick];
  if (!e || s.ext?.[pick]?.hidden) return "Pick visible geometry";
  if (item.refs.includes(pick)) return `${entityLabel(e)} is already part of it`;
  const want = missingKind(missing);
  if ((e.type === "point") !== (want === "point")) return want === "point" ? "Pick a point" : "Pick a line, arc, circle or spline";
  const refs = item.refs.map((x) => (x === missing ? pick : x));
  const isDim = "expr" in item;
  if (!isDim && refs.every((x) => s.ext?.[x] || x === "origin")) return "A relation needs geometry of this sketch too";
  const complete = refs.every((x) => s.entities[x]);
  if (isDim) {
    // Square-end pairs of an offset that point at removed geometry are dropped.
    const align = item.align?.filter((pair) => pair.every((x) => s.entities[x]));
    const d: Dimension = { ...item, refs, ...(item.align ? { align } : {}) };
    if (complete && dimensionConstraints(s, { ...d, driven: false }) === null) return "That does not fit this dimension";
    return { dimension: d };
  }
  const r: Relation = { ...item, refs };
  if (complete && !relationSupported(s, r)) return "That does not fit this relation";
  return { relation: r };
}

/** Pick replacement geometry for each missing reference of a dangling relation or dimension. */
export class RepairTool implements Tool {
  readonly id = "repair";
  readonly cursor = "crosshair";
  private item: Id | null = null;

  constructor(private host: ToolHost) {}

  /** Start repairing a relation or dimension of the active sketch. */
  start(itemId: Id) {
    this.item = itemId;
  }

  private current(): { item: Relation | Dimension; missing: Id } | null {
    const s = this.host.sketch();
    const item = this.item ? (s.relations[this.item] ?? s.dimensions[this.item]) : undefined;
    if (!item) return null;
    const missing = missingRefs(s, item);
    return missing.length ? { item, missing: missing[0] } : null;
  }

  activate() {
    this.prompt();
  }
  deactivate() {
    this.item = null;
  }

  private prompt() {
    const c = this.current();
    if (!c) return;
    const n = missingRefs(this.host.sketch(), c.item).length;
    const what = missingKind(c.missing) === "point" ? "a point" : "a line, arc, circle or spline";
    this.host.setPrompt(`Click ${what} to use instead of the deleted ${c.missing}${n > 1 ? ` (${n} missing)` : ""}. Esc cancels`);
  }

  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const c = this.current();
    if (!c) return this.host.setTool("select");
    const h = this.host.hit(e.world, e.pointerType, missingKind(c.missing) === "point" ? { curves: false } : { points: false });
    if (!h) return;
    const r = repairWith(this.host.sketch(), c.item, c.missing, h.id);
    if (typeof r === "string") return this.host.flash(r, "error");
    this.host.commit("Repair Reference", (ed) => {
      if (r.relation) ed.updateRelation(r.relation.id, { refs: r.relation.refs });
      if (r.dimension) ed.updateDimension(r.dimension.id, { refs: r.dimension.refs, ...(r.dimension.align ? { align: r.dimension.align } : {}) });
    });
    if (this.current()) this.prompt();
    else {
      this.host.flash("Reference repaired");
      this.host.setTool("select");
    }
  }

  onMove(e: PEvent) {
    const c = this.current();
    if (!c) return;
    const h = this.host.hit(e.world, e.pointerType, missingKind(c.missing) === "point" ? { curves: false } : { points: false });
    this.host.setHover(h && typeof repairWith(this.host.sketch(), c.item, c.missing, h.id) !== "string" ? h.id : null);
  }
  onUp() {}
  cancel() {
    return false;
  }
}
