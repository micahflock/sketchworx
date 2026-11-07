/** Pure document data. Serializable, no DOM. */

export type Id = string;

interface EntityBase {
  id: Id;
  /** SolidWorks "For construction": dashed, excluded from export and fills. */
  construction?: boolean;
}

/** A sketch point. Endpoints/centers of curves are points with an `owner`. */
export interface PointEntity extends EntityBase {
  type: "point";
  x: number;
  y: number;
  owner?: Id;
}

export interface LineEntity extends EntityBase {
  type: "line";
  p1: Id;
  p2: Id;
}

export interface CircleEntity extends EntityBase {
  type: "circle";
  c: Id;
  r: number;
}

/** Circular arc running counter-clockwise from s to e around c. */
export interface ArcEntity extends EntityBase {
  type: "arc";
  c: Id;
  s: Id;
  e: Id;
}

/** SolidWorks style spline: one Bézier span, degree = cps.length - 1. */
export interface SplineEntity extends EntityBase {
  type: "spline";
  cps: Id[];
}

export type Entity = PointEntity | LineEntity | CircleEntity | ArcEntity | SplineEntity;
export type CurveEntity = LineEntity | CircleEntity | ArcEntity | SplineEntity;
export type EntityType = Entity["type"];

export type RelationType =
  | "coincident"
  | "horizontal"
  | "vertical"
  | "parallel"
  | "perpendicular"
  | "collinear"
  | "equal"
  | "tangent"
  | "concentric"
  | "coradial"
  | "midpoint"
  | "symmetric"
  | "fix";

export interface Relation {
  id: Id;
  type: RelationType;
  /** Entity ids, in selection order. Symmetric: [a, b, centerline]. Midpoint: [point, line]. */
  refs: Id[];
  /** Fix: snapshot of the fixed parameter values. */
  values?: number[];
}

export type DimensionType =
  | "distance" // aligned point-point / line length
  | "distanceX"
  | "distanceY"
  | "pointLine" // point to line distance
  | "angle"
  | "radius"
  | "diameter"
  | "arcLength";

export interface Dimension {
  id: Id;
  type: DimensionType;
  refs: Id[];
  /** Value or expression as typed ("88", "=stem*1.5"). */
  expr: string;
  /** Evaluated value (driving) or measured value (driven). */
  value: number;
  driven: boolean;
  /** Label anchor in sketch coordinates. */
  label: { x: number; y: number };
  /** Angle dimensions: which of the four quadrants (bit 0: flip line 1, bit 1: flip line 2). */
  quadrant?: number;
}

export interface Variable {
  name: string;
  expr: string;
  value: number;
}

export interface Picture {
  dataUrl: string;
  x: number;
  y: number;
  /** Sketch units per image pixel. */
  scale: number;
  opacity: number;
}

export interface Sketch {
  id: Id;
  name: string;
  advance: number;
  entities: Record<Id, Entity>;
  relations: Record<Id, Relation>;
  dimensions: Record<Id, Dimension>;
  picture?: Picture;
}

export interface Doc {
  version: number;
  nextId: number;
  unitsPerEm?: number;
  variables: Variable[];
  slots: Sketch[];
  activeSlot: number;
}

export const DOC_VERSION = 1;
