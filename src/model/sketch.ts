import type { Vec2 } from "../geom/vec";
import { DOC_VERSION } from "./types";
import type { ArcEntity, CircleEntity, Doc, Entity, ExtRef, Id, LineEntity, PointEntity, Sketch, SketchFeature, SplineEntity } from "./types";

/** Every sketch has a fixed origin point that can be related and dimensioned to. */
export const ORIGIN = "origin";
export const originPoint = (): PointEntity => ({ id: ORIGIN, type: "point", x: 0, y: 0 });

export function createSketch(): Sketch {
  return { entities: { [ORIGIN]: originPoint() }, relations: {}, dimensions: {} };
}

export const FIRST_FEATURE = "sk1";

export function createDoc(): Doc {
  return {
    version: DOC_VERSION,
    nextId: 2,
    variables: [],
    features: [{ id: FIRST_FEATURE, name: "Sketch1", visible: true, sketch: createSketch() }],
    active: FIRST_FEATURE,
  };
}

/** Index of a feature (falls back to the first one). */
export function featureIndex(doc: Doc, id: Id = doc.active): number {
  const i = doc.features.findIndex((f) => f.id === id);
  return i < 0 ? 0 : i;
}

export const activeFeature = (doc: Doc): SketchFeature => doc.features[featureIndex(doc)];

/** The stored geometry of a sketch (its own entities only). */
export const ownSketch = (doc: Doc, id: Id = doc.active): Sketch => doc.features[featureIndex(doc, id)].sketch;

/** Merged entities of the sketches above a feature, memoized on their identities. */
interface Upstream {
  keys: unknown[];
  entities: Record<Id, Entity>;
  ext: Record<Id, ExtRef>;
}
let upstreamCache: Upstream | null = null;
function upstreamOf(doc: Doc, i: number): Upstream {
  const keys: unknown[] = [];
  for (let j = 0; j < i; j++) keys.push(doc.features[j].id, doc.features[j].sketch, doc.features[j].visible);
  const c = upstreamCache;
  if (c && c.keys.length === keys.length && c.keys.every((k, j) => k === keys[j])) return c;
  const entities: Record<Id, Entity> = {};
  const ext: Record<Id, ExtRef> = {};
  for (let j = 0; j < i; j++) {
    const f = doc.features[j];
    for (const e of Object.values(f.sketch.entities)) {
      if (e.id === ORIGIN) continue; // every sketch shares the one origin
      entities[e.id] = e;
      ext[e.id] = { feature: f.id, hidden: !f.visible };
    }
  }
  upstreamCache = { keys, entities, ext };
  return upstreamCache;
}

const contextCache = new WeakMap<Sketch, { up: Upstream; picture: Doc["picture"]; ctx: Sketch }>();

/**
 * The working view of a sketch: its own geometry, relations and dimensions plus every entity of the
 * sketches above it (listed in `ext`) and the document picture. With a single sketch and no picture
 * this is the stored sketch itself.
 */
export function contextSketch(doc: Doc, id: Id = doc.active): Sketch {
  const i = featureIndex(doc, id);
  const own = doc.features[i].sketch;
  if (i === 0 && !doc.picture) return own;
  const up = upstreamOf(doc, i);
  const hit = contextCache.get(own);
  if (hit && hit.up === up && hit.picture === doc.picture) return hit.ctx;
  const ctx: Sketch = {
    entities: i === 0 ? own.entities : { ...up.entities, ...own.entities },
    relations: own.relations,
    dimensions: own.dimensions,
    ...(doc.picture ? { picture: doc.picture } : {}),
    ...(i === 0 ? {} : { ext: up.ext }),
  };
  contextCache.set(own, { up, picture: doc.picture, ctx });
  return ctx;
}

/** The active sketch's working view (see contextSketch). */
export const activeSketch = (doc: Doc): Sketch => contextSketch(doc);

/** Entity borrowed from an earlier sketch (read-only here). */
export const isExt = (s: Sketch, id: Id): boolean => !!s.ext?.[id];
/** Borrowed from a hidden sketch: not drawn or pickable. */
export const isHiddenExt = (s: Sketch, id: Id): boolean => !!s.ext?.[id]?.hidden;

export function pt(s: Sketch, id: Id): PointEntity {
  const e = s.entities[id];
  if (!e || e.type !== "point") throw new Error(`point ${id} missing`);
  return e;
}

export const ptv = (s: Sketch, id: Id): Vec2 => {
  const p = pt(s, id);
  return { x: p.x, y: p.y };
};

/** Point ids that define an entity (for points: itself). */
export function definingPoints(e: Entity): Id[] {
  switch (e.type) {
    case "point":
      return [e.id];
    case "line":
      return [e.p1, e.p2];
    case "circle":
      return [e.c];
    case "arc":
      return [e.c, e.s, e.e];
    case "spline":
      return e.cps;
  }
}

/** Points that are curve endpoints (for chaining, coincidence, loop detection). */
export function endPoints(e: Entity): Id[] {
  switch (e.type) {
    case "line":
      return [e.p1, e.p2];
    case "arc":
      return [e.s, e.e];
    case "spline":
      return [e.cps[0], e.cps[e.cps.length - 1]];
    default:
      return [];
  }
}

export const isCurve = (e: Entity | undefined): e is LineEntity | CircleEntity | ArcEntity | SplineEntity =>
  !!e && e.type !== "point";

export function arcGeom(s: Sketch, a: ArcEntity) {
  const c = ptv(s, a.c);
  const p0 = ptv(s, a.s);
  const p1 = ptv(s, a.e);
  const r = Math.hypot(p0.x - c.x, p0.y - c.y);
  const a0 = Math.atan2(p0.y - c.y, p0.x - c.x);
  const a1 = Math.atan2(p1.y - c.y, p1.x - c.x);
  return { c, r, a0, a1, p0, p1 };
}

export function lineGeom(s: Sketch, l: LineEntity) {
  return { a: ptv(s, l.p1), b: ptv(s, l.p2) };
}

export function splinePts(s: Sketch, sp: SplineEntity): Vec2[] {
  return sp.cps.map((id) => ptv(s, id));
}

/** Curves that own or reference a point. */
export function curvesUsingPoint(s: Sketch, pid: Id): Entity[] {
  const out: Entity[] = [];
  for (const e of Object.values(s.entities)) {
    if (e.type !== "point" && definingPoints(e).includes(pid)) out.push(e);
  }
  return out;
}

export function entityLabel(e: Entity): string {
  const n = e.id;
  switch (e.type) {
    case "point":
      return e.id === ORIGIN ? "Origin" : e.owner ? `Point (${n})` : `Point${n}`;
    case "line":
      return e.construction ? `Centerline ${n}` : `Line ${n}`;
    case "circle":
      return `Circle ${n}`;
    case "arc":
      return `Arc ${n}`;
    case "spline":
      return `Spline ${n}`;
  }
}
