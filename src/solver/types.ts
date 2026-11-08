/**
 * Solver interface. The solver works only with points, scalar parameters and a
 * few curve primitives; it knows nothing about the UI or about Bézier curves.
 */

export type SId = string;

export interface SolverPoint {
  id: SId;
  x: number;
  y: number;
  /** Locked (geometry of an earlier sketch): not a solver unknown. */
  fixed?: boolean;
}

export type SolverGeom =
  | { kind: "line"; id: SId; p1: SId; p2: SId }
  | { kind: "circle"; id: SId; c: SId; r: number; fixed?: boolean }
  /** Counter-clockwise from s to e. Radius is implied by |s - c|. `fixed`: locked with its points. */
  | { kind: "arc"; id: SId; c: SId; s: SId; e: SId; fixed?: boolean };

export interface SolverParams {
  points: SolverPoint[];
  geoms: SolverGeom[];
  /** Extra free scalars (e.g. the curve parameter of a point on a spline). */
  extras?: { id: SId; value: number }[];
}

/** Constraint vocabulary. `owner` is the relation or dimension id it came from. */
export type SolverConstraint = { id: SId; owner: SId } & (
  | { kind: "coincident"; a: SId; b: SId }
  | { kind: "horizontal"; a: SId; b: SId }
  | { kind: "vertical"; a: SId; b: SId }
  | { kind: "coordX"; p: SId; v: number }
  | { kind: "coordY"; p: SId; v: number }
  | { kind: "radius"; g: SId; v: number }
  | { kind: "parallel"; l1: SId; l2: SId }
  | { kind: "perpendicular"; l1: SId; l2: SId }
  /** Lines given by point pairs a→b and c→d are perpendicular. */
  | { kind: "perpPoints"; a: SId; b: SId; c: SId; d: SId }
  | { kind: "pointOnLine"; p: SId; a: SId; b: SId }
  | { kind: "pointOnCircle"; p: SId; g: SId }
  | { kind: "equalLength"; l1: SId; l2: SId }
  | { kind: "equalRadius"; g1: SId; g2: SId }
  | { kind: "tangentLineCircle"; l: SId; g: SId }
  | { kind: "tangentCircles"; g1: SId; g2: SId; internal: boolean }
  /** a and b symmetric about the line through l1→l2 points. */
  | { kind: "symmetricLine"; a: SId; b: SId; l: SId }
  /** a and b symmetric about point p (p is their midpoint). */
  | { kind: "symmetricPoint"; a: SId; b: SId; p: SId }
  | { kind: "distance"; a: SId; b: SId; v: number }
  /** b.x - a.x = v */
  | { kind: "distanceX"; a: SId; b: SId; v: number }
  /** b.y - a.y = v */
  | { kind: "distanceY"; a: SId; b: SId; v: number }
  | { kind: "pointLineDistance"; p: SId; l: SId; v: number }
  /** Angle from direction a→b to direction c→d, radians. */
  | { kind: "angle"; a: SId; b: SId; c: SId; d: SId; v: number }
  | { kind: "arcLength"; g: SId; v: number }
  /** radius(g2) - radius(g1) = v */
  | { kind: "radiusDiff"; g1: SId; g2: SId; v: number }
  /**
   * Equal curvature (G2) where two Béziers meet: each side is the joint, the next two control
   * points (leaving the joint) and the degree. Custom PlaneGCS constraint.
   */
  | { kind: "equalCurvatureBB"; ja: SId; a1: SId; a2: SId; na: number; jb: SId; b1: SId; b2: SId; nb: number }
  /** Equal curvature between a Bézier end and an arc; arcSign +1 when the arc runs CCW away from the joint. */
  | { kind: "equalCurvatureBA"; ja: SId; a1: SId; a2: SId; na: number; arc: SId; arcSign: number }
  /** Point lies on the Bézier with control points cps at parameter `t` (an extra). */
  | { kind: "pointOnBezier"; p: SId; cps: SId[]; t: SId }
);

export type ConstraintKind = SolverConstraint["kind"];

export interface DragTarget {
  /** Pull a point toward (x, y). */
  point?: SId;
  x: number;
  y: number;
  /** Or pull a circle/arc radius toward r. */
  radiusOf?: SId;
  r?: number;
}

export type EntityState = "under" | "full" | "over" | "failed";

export interface SolveResult {
  /** Solved parameters (same shape as the input). */
  params: SolverParams;
  ok: boolean;
  /** Per-geometry status (points and geoms by id). */
  entityStatus: Record<SId, EntityState>;
  /** Constraint owners (relations/dimensions) that are redundant or conflicting. */
  conflicts: SId[];
  redundant: SId[];
  dof: number;
  ms: number;
}

export interface Solver {
  solve(params: SolverParams, constraints: SolverConstraint[], drag?: DragTarget[]): Promise<SolveResult>;
  /** Start a drag session; subsequent dragMove calls reuse the built system. */
  dragStart(params: SolverParams, constraints: SolverConstraint[], targets: DragTarget[]): Promise<SolverParams>;
  dragMove(targets: DragTarget[]): Promise<SolverParams>;
  dragEnd(): void;
}

export type SketchState = "empty" | "under" | "full" | "over" | "failed";

/** What the UI shows: status per sketch entity id plus the bar summary. */
export interface SketchStatus {
  state: SketchState;
  dof: number;
  entity: Record<string, EntityState>;
  /** Relation/dimension ids flagged red. */
  conflicts: string[];
  /** Relations/dimensions whose referenced geometry no longer exists (shown, not solved). */
  dangling: string[];
  solving: boolean;
  ms: number;
}

export const emptyStatus = (): SketchStatus => ({ state: "empty", dof: 0, entity: {}, conflicts: [], dangling: [], solving: false, ms: 0 });
