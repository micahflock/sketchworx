import { bezierClosest, bezierPolyline } from "../geom/bezier";
import type { Box, Vec2 } from "../geom/vec";
import { angleInSweep, dist, distToSegment, inBox, polar, segmentHitsBox } from "../geom/vec";
import { arcGeom, ptv, splinePts } from "../model/sketch";
import type { Entity, Id, Sketch } from "../model/types";

export interface Hit {
  id: Id;
  /** Distance in sketch units. */
  d: number;
  kind: "point" | "curve";
}

/** Distance from p to an entity (sketch units). */
export function distToEntity(s: Sketch, e: Entity, p: Vec2): number {
  switch (e.type) {
    case "point":
      return dist(p, e);
    case "line":
      return distToSegment(p, ptv(s, e.p1), ptv(s, e.p2));
    case "circle": {
      const c = ptv(s, e.c);
      return Math.abs(dist(p, c) - e.r);
    }
    case "arc": {
      const g = arcGeom(s, e);
      const ang = Math.atan2(p.y - g.c.y, p.x - g.c.x);
      if (angleInSweep(ang, g.a0, g.a1)) return Math.abs(dist(p, g.c) - g.r);
      return Math.min(dist(p, g.p0), dist(p, g.p1));
    }
    case "spline":
      return bezierClosest(splinePts(s, e), p).d;
  }
}

/**
 * Hit test with SolidWorks priority: points win over curves when both are in
 * tolerance. `skip` excludes ids (e.g. the point being placed).
 */
export function hitTest(s: Sketch, p: Vec2, tol: number, skip?: Set<Id>, filter?: (e: Entity) => boolean): Hit | null {
  let bestPoint: Hit | null = null;
  let bestCurve: Hit | null = null;
  for (const e of Object.values(s.entities)) {
    if (skip?.has(e.id) || s.ext?.[e.id]?.hidden) continue;
    if (filter && !filter(e)) continue;
    if (e.type === "point" && e.owner) {
      const o = s.entities[e.owner];
      if (o?.type === "spline" && o.derived) continue;
    }
    const raw = distToEntity(s, e, p);
    if (raw > tol) continue;
    // Geometry borrowed from other sketches counts as a little farther, so where it overlaps the
    // active sketch's own (collinear lines, shared points) the active sketch wins.
    const d = s.ext?.[e.id] ? raw + tol * 0.5 : raw;
    if (e.type === "point") {
      // Ties: standalone points first, the origin last.
      const rank = (id: Id, owner?: Id) => (id === "origin" ? 2 : owner ? 1 : 0);
      const better = !bestPoint || d < bestPoint.d - 1e-9 || (Math.abs(d - bestPoint.d) < 1e-9 && rank(e.id, e.owner) < rank(bestPoint.id, (s.entities[bestPoint.id] as { owner?: Id }).owner));
      if (better) bestPoint = { id: e.id, d, kind: "point" };
    } else if (!bestCurve || d < bestCurve.d) bestCurve = { id: e.id, d, kind: "curve" };
  }
  return bestPoint ?? bestCurve;
}

/** Sample points along a curve (for box selection and bounds). */
export function entitySamples(s: Sketch, e: Entity): Vec2[] {
  switch (e.type) {
    case "point":
      return [{ x: e.x, y: e.y }];
    case "line":
      return [ptv(s, e.p1), ptv(s, e.p2)];
    case "circle": {
      const c = ptv(s, e.c);
      return Array.from({ length: 33 }, (_, i) => polar(c, e.r, (i / 32) * Math.PI * 2));
    }
    case "arc": {
      const g = arcGeom(s, e);
      let sweep = g.a1 - g.a0;
      while (sweep <= 0) sweep += Math.PI * 2;
      return Array.from({ length: 25 }, (_, i) => polar(g.c, g.r, g.a0 + (sweep * i) / 24));
    }
    case "spline":
      return bezierPolyline(splinePts(s, e), 32);
  }
}

/** Window (fully enclosed) or crossing selection. */
export function boxSelect(s: Sketch, box: Box, crossing: boolean): Id[] {
  const out: Id[] = [];
  for (const e of Object.values(s.entities)) {
    if (e.id === "origin" || s.ext?.[e.id]) continue; // other sketches' geometry is picked one at a time
    const pts = entitySamples(s, e);
    if (e.type === "point") {
      if (inBox(pts[0], box)) out.push(e.id);
      continue;
    }
    if (!crossing) {
      if (pts.every((q) => inBox(q, box))) out.push(e.id);
    } else {
      let hit = false;
      for (let i = 0; i < pts.length - 1 && !hit; i++) hit = segmentHitsBox(pts[i], pts[i + 1], box);
      if (hit) out.push(e.id);
    }
  }
  return out;
}
