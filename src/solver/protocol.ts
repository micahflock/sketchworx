import type { DragTarget, SolveResult, SolverConstraint, SolverParams } from "./types";

export type WorkerRequest =
  | { reqId: number; type: "solve"; params: SolverParams; constraints: SolverConstraint[]; drag?: DragTarget[] }
  | { reqId: number; type: "dragStart"; params: SolverParams; constraints: SolverConstraint[]; targets: DragTarget[] }
  | { reqId: number; type: "dragMove"; targets: DragTarget[] }
  | { reqId: number; type: "dragEnd" };

export type WorkerResponse =
  | { reqId: number; type: "solve"; result: SolveResult }
  | { reqId: number; type: "params"; params: SolverParams }
  | { reqId: number; type: "error"; message: string };
