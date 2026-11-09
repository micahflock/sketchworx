/**
 * Feature tree: an ordered list of sketches. A sketch may reference (relate and dimension to)
 * geometry of the sketches above it, which is locked while it solves. Pure functions over a Doc.
 */
import { applyCommand } from "./editor";
import { createSketch, featureIndex, ORIGIN } from "./sketch";
import type { Doc, Id, Sketch, SketchFeature } from "./types";

/** Every id a sketch's relations, dimensions and driven offsets point at. */
export function referencedIds(s: Sketch): Set<Id> {
  const out = new Set<Id>();
  for (const r of Object.values(s.relations)) for (const id of r.refs) out.add(id);
  for (const d of Object.values(s.dimensions)) {
    for (const id of d.refs) out.add(id);
    for (const pair of d.align ?? []) for (const id of pair) out.add(id);
  }
  for (const e of Object.values(s.entities)) if (e.type === "spline" && e.derived) out.add(e.derived.source);
  return out;
}

/** Ids a sketch references that live in other sketches (the origin is shared, so it never counts). */
export function externalIds(s: Sketch): Set<Id> {
  const out = new Set<Id>();
  for (const id of referencedIds(s)) if (id !== ORIGIN && !s.entities[id]) out.add(id);
  return out;
}

/** Features (below `id`) that reference geometry of feature `id`. */
export function dependents(doc: Doc, id: Id): SketchFeature[] {
  const i = featureIndex(doc, id);
  const ents = doc.features[i].sketch.entities;
  return doc.features.filter((f, j) => {
    if (j === i) return false;
    for (const x of externalIds(f.sketch)) if (ents[x]) return true;
    return false;
  });
}

/** Features that `id` references. */
export function parents(doc: Doc, id: Id): SketchFeature[] {
  const ext = externalIds(doc.features[featureIndex(doc, id)].sketch);
  return doc.features.filter((f) => f.id !== id && Object.keys(f.sketch.entities).some((x) => ext.has(x)));
}

/** Relations and dimensions of a feature whose references no longer exist above it. */
export function danglingOf(doc: Doc, id: Id): Id[] {
  const i = featureIndex(doc, id);
  const s = doc.features[i].sketch;
  const known = (x: Id) => x === ORIGIN || !!s.entities[x] || doc.features.slice(0, i).some((f) => !!f.sketch.entities[x]);
  const out: Id[] = [];
  for (const r of Object.values(s.relations)) if (!r.refs.every(known)) out.push(r.id);
  for (const d of Object.values(s.dimensions)) if (!d.refs.every(known) || (d.align ?? []).some((p) => !p.every(known))) out.push(d.id);
  return out;
}

function nextName(doc: Doc): string {
  let n = doc.features.length + 1;
  const names = new Set(doc.features.map((f) => f.name));
  while (names.has(`Sketch${n}`)) n++;
  return `Sketch${n}`;
}

/** Add an empty sketch at the end of the tree and make it active. */
export function addFeature(doc: Doc): Doc {
  const id = `sk${doc.nextId}`;
  const f: SketchFeature = { id, name: nextName(doc), visible: true, sketch: createSketch() };
  return { ...doc, nextId: doc.nextId + 1, features: [...doc.features, f], active: id };
}

export function setActive(doc: Doc, id: Id): Doc {
  if (doc.active === id || !doc.features.some((f) => f.id === id)) return doc;
  return { ...doc, active: id };
}

function patchFeature(doc: Doc, id: Id, patch: Partial<SketchFeature>): Doc {
  return { ...doc, features: doc.features.map((f) => (f.id === id ? { ...f, ...patch } : f)) };
}

export function renameFeature(doc: Doc, id: Id, name: string): Doc {
  const f = doc.features.find((x) => x.id === id);
  const n = name.trim();
  if (!f || !n || f.name === n) return doc;
  return patchFeature(doc, id, { name: n });
}

export function setVisible(doc: Doc, id: Id, visible: boolean): Doc {
  const f = doc.features.find((x) => x.id === id);
  if (!f || f.visible === visible) return doc;
  return patchFeature(doc, id, { visible });
}

/** Sketches that use `id`'s geometry, each with what it would lose if `id` were deleted. */
export function deleteConflict(doc: Doc, id: Id): { feature: SketchFeature; refs: CrossRefs }[] {
  const target = doc.features.find((f) => f.id === id);
  if (!target) return [];
  return doc.features
    .filter((f) => f.id !== id)
    .map((f) => ({ feature: f, refs: crossRefs(f.sketch, target.sketch) }))
    .filter((x) => crossRefCount(x.refs) > 0);
}

/**
 * Delete a sketch. Refused for the last sketch, and (with the reason) while other sketches reference
 * it unless `removeRefs` is set: then their references to it are removed first, in the same step.
 */
export function deleteFeature(doc: Doc, id: Id, removeRefs = false): Doc | string {
  const i = doc.features.findIndex((f) => f.id === id);
  if (i < 0) return doc;
  if (doc.features.length === 1) return "A document needs at least one sketch";
  const deps = deleteConflict(doc, id);
  if (deps.length && !removeRefs) return `${doc.features[i].name} is referenced by ${deps.map((d) => d.feature.name).join(", ")}. Delete those references first`;
  let next = doc;
  for (const d of deps) next = removeCrossRefs(next, d.feature.id, d.refs);
  const features = next.features.filter((f) => f.id !== id);
  const active = next.active === id ? features[Math.max(0, i - 1)].id : next.active;
  return { ...next, features, active };
}

/** What `lower` uses of `upper`'s geometry: relations and dimensions, and offsets linked to it. */
export interface CrossRefs {
  relations: Id[];
  dimensions: Id[];
  offsets: Id[];
}

export function crossRefs(lower: Sketch, upper: Sketch): CrossRefs {
  const theirs = (x: Id) => x !== ORIGIN && !!upper.entities[x] && !lower.entities[x];
  return {
    relations: Object.values(lower.relations).filter((r) => r.refs.some(theirs)).map((r) => r.id),
    dimensions: Object.values(lower.dimensions)
      .filter((d) => d.refs.some(theirs) || (d.align ?? []).some((p) => p.some(theirs)))
      .map((d) => d.id),
    offsets: Object.values(lower.entities)
      .filter((e) => e.type === "spline" && !!e.derived && theirs(e.derived.source))
      .map((e) => e.id),
  };
}

export const crossRefCount = (c: CrossRefs) => c.relations.length + c.dimensions.length + c.offsets.length;

/** Delete a sketch's relations and dimensions listed in `refs` and unlink its offsets (they keep their shape). */
function removeCrossRefs(doc: Doc, featureId: Id, refs: CrossRefs): Doc {
  return applyCommand(
    doc,
    (ed) => {
      for (const r of refs.relations) ed.deleteRelation(r);
      for (const d of refs.dimensions) ed.deleteDimension(d);
      for (const o of refs.offsets) {
        const e = ed.s.entities[o];
        if (e?.type !== "spline") continue;
        const { derived: _, ...free } = e;
        ed.put(free);
      }
    },
    featureId,
  );
}

/** The two sketches a move would swap, and what the lower one would lose by ending up on top. */
export function moveConflict(doc: Doc, id: Id, dir: -1 | 1): { upper: SketchFeature; lower: SketchFeature; refs: CrossRefs } | null {
  const i = doc.features.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.features.length) return null;
  const [upper, lower] = dir < 0 ? [doc.features[j], doc.features[i]] : [doc.features[i], doc.features[j]];
  const refs = crossRefs(lower.sketch, upper.sketch);
  return crossRefCount(refs) ? { upper, lower, refs } : null;
}

/**
 * Move a sketch one place up or down. A sketch may only reference sketches above it, so a move that
 * would put it above geometry it uses is refused (with the reason), unless `removeRefs` is set: then
 * those relations and dimensions are deleted and linked offsets become free curves, in the same step.
 */
export function moveFeature(doc: Doc, id: Id, dir: -1 | 1, removeRefs = false): Doc | string {
  const i = doc.features.findIndex((f) => f.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= doc.features.length) return doc;
  const conflict = moveConflict(doc, id, dir);
  if (conflict && !removeRefs) return `${conflict.lower.name} references ${conflict.upper.name}, so it has to stay below it`;
  const next = conflict ? removeCrossRefs(doc, conflict.lower.id, conflict.refs) : doc;
  const features = [...next.features];
  [features[i], features[j]] = [features[j], features[i]];
  return { ...next, features };
}
