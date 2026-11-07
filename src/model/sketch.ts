import type { Vec2 } from "../geom/vec";
import { DOC_VERSION } from "./types";
import type { ArcEntity, CircleEntity, Doc, Entity, Id, LineEntity, PointEntity, Sketch, SplineEntity } from "./types";

export function createSketch(id: Id, name: string): Sketch {
  return { id, name, advance: 600, entities: {}, relations: {}, dimensions: {} };
}

export function createDoc(): Doc {
  return {
    version: DOC_VERSION,
    nextId: 2,
    variables: [],
    slots: [createSketch("s1", "Sketch1")],
    activeSlot: 0,
  };
}

export const activeSketch = (doc: Doc): Sketch => doc.slots[doc.activeSlot];

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
      return e.owner ? `Point (${n})` : `Point${n}`;
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
