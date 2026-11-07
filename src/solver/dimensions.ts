import type { Dimension, Sketch } from "../model/types";
import type { SolverConstraint } from "./types";

/** Driving dimension → solver constraints (milestone 3). */
export function dimensionConstraints(_s: Sketch, _d: Dimension): SolverConstraint[] | null {
  return null;
}
