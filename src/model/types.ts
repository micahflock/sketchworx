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
  /** Set for a style spline's control-polygon side (always construction). */
  owner?: Id;
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
  /**
   * Driven geometry: a cubic approximating the offset of `source` over [t0, t1].
   * Recomputed after every solve; not seen by the solver.
   */
  derived?: { source: Id; side: 1 | -1; link: string; t0: number; t1: number };
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
  | "fix"
  /** G2: tangent plus equal curvature where a style spline meets a spline or arc. */
  | "equalCurvature"
  /** Convert Entities: [source, copy]. The copy coincides with the source (made by Convert Entities only). */
  | "onEdge";

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
  | "arcLength"
  /** Offset Entities link: [source, offset] (lines: parallel + distance; arcs/circles: concentric + radius difference). */
  | "offset";

export interface Dimension {
  id: Id;
  type: DimensionType;
  refs: Id[];
  /** Value or expression as typed ("88", "=width*1.5"). */
  expr: string;
  /** Evaluated value (driving) or measured value (driven). */
  value: number;
  driven: boolean;
  /** Label anchor in sketch coordinates. */
  label: { x: number; y: number };
  /** Angle dimensions: which of the four quadrants (bit 0: flip line 1, bit 1: flip line 2). */
  quadrant?: number;
  /** Not drawn (secondary members of an offset group). */
  hidden?: boolean;
  /** Variable this dimension is linked to: typing a number in its Modify box sets the variable. */
  link?: string;
  /** Offset: open-chain ends kept square to the source, as [source point, offset point] pairs. */
  align?: [Id, Id][];
}

export interface Variable {
  name: string;
  expr: string;
  value: number;
  /** Set by the app (Print mode's `w` and `nozzle`): shown read-only, follows the printer profile. */
  locked?: boolean;
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
  entities: Record<Id, Entity>;
  relations: Record<Id, Relation>;
  dimensions: Record<Id, Dimension>;
  /** Document background picture (copied into the working view; stored on the Doc). */
  picture?: Picture;
  /**
   * Working view only (never stored): entities borrowed from earlier sketches, by id → source sketch.
   * They can be referenced by relations and dimensions but not changed from this sketch.
   */
  ext?: Record<Id, ExtRef>;
}

export interface ExtRef {
  /** Sketch feature the entity belongs to. */
  feature: Id;
  /** That sketch is hidden: the entity still drives this sketch but is not drawn or pickable. */
  hidden: boolean;
}

/** One sketch in the feature tree. */
export interface SketchFeature {
  id: Id;
  name: string;
  visible: boolean;
  sketch: Sketch;
}

/** Which side of a chain its stroke grows on (left of the chain's direction; for a profile, left is inside). */
export type ArtSide = "center" | "left" | "right";

/** Art view style of one chain, stored on each of its curves. Unset fields use the document defaults. */
export interface ArtStyle {
  /** Stroke weight in sketch units. */
  weight?: number;
  /** Stroke and fill color, "#rrggbb". */
  color?: string;
  /**
   * Radius of the stroke's outer corners, in sketch units (0: sharp). Strokes cannot round tighter
   * than half the weight, so smaller non-zero values draw as half the weight.
   */
  corner?: number;
  /** Round the ends of an open chain (a half circle within the line's length); otherwise square. */
  roundEnds?: boolean;
  side?: ArtSide;
  /** Fill a closed profile. */
  fill?: boolean;
  /** Print mode: the filament (by id) the chain prints in. Unset: the document's ink filament. */
  filament?: string;
}

/** Document defaults for the overridable style fields. */
export interface ArtDefaults {
  weight: number;
  color: string;
  corner: number;
  roundEnds: boolean;
}

export interface ArtSettings extends Partial<Omit<ArtDefaults, "weight">> {
  /** Art view background, "#rrggbb" (unset: white). */
  background?: string;
  /** Default stroke weight in sketch units. */
  weight: number;
  /** Per-curve styles by entity id. */
  styles: Record<Id, ArtStyle>;
}

export interface Doc {
  version: number;
  nextId: number;
  variables: Variable[];
  /** Feature tree, in rebuild order: a sketch may reference geometry of the sketches above it. */
  features: SketchFeature[];
  /** The sketch being edited. */
  active: Id;
  picture?: Picture;
  /** Art view styling (unset: defaults everywhere). */
  art?: ArtSettings;
  /** Print mode (unset: off). */
  print?: PrintSettings;
}

/** How colors are changed within a layer. */
export type ColorSetup = "mmu3" | "manual";

/** The printer as Print mode needs it. Lengths in mm. */
export interface PrinterProfile {
  /** Preset the values came from ("mk4s-0.4"), or "custom" once edited. */
  preset: string;
  nozzle: number;
  /** Perimeter line width `w`: stroke widths and rules are whole multiples of it. */
  lineWidth: number;
  /** First-layer line width, for the As printed preview. */
  firstLayerWidth: number;
  /** How far a first-layer bead spreads past its path, per side (As printed preview). */
  squish: number;
  /** Narrowest feature, in lines. */
  minFeatureLines: number;
  layerHeight: number;
  colorSetup: ColorSetup;
  /** Bare bed in the As printed preview, "#rrggbb". */
  sheetColor: string;
}

export interface Filament {
  /** Stable id ("f1"); the slot number is the position in the list. */
  id: string;
  name: string;
  color: string;
}

export interface PrintSettings {
  printer: PrinterProfile;
  /** In slot and print order. */
  filaments: Filament[];
  /** Filament of everything inside the part outline that nothing else covers. */
  base: string;
  /** Filament of chains that do not pick one. */
  ink: string;
  /** Chain key of the part outline (unset: the largest filled profile). */
  outline?: Id;
  /** Print view: the regions as drawn, or the first layer as printed. */
  preview?: "drawn" | "printed";
  /** As printed preview side (unset: bed side, mirrored). */
  side?: "bed" | "top";
}

export const DOC_VERSION = 3;
