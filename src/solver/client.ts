import type { WorkerRequest, WorkerResponse } from "./protocol";
import type { DragTarget, SolveResult, Solver, SolverConstraint, SolverParams } from "./types";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void };
type Req = WorkerRequest extends infer T ? (T extends WorkerRequest ? Omit<T, "reqId"> : never) : never;

/** Main-thread proxy for the solver worker. */
export class WorkerSolver implements Solver {
  private worker: Worker;
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    this.worker.onmessage = (ev: MessageEvent<WorkerResponse>) => {
      const m = ev.data;
      const p = this.pending.get(m.reqId);
      if (!p) return;
      this.pending.delete(m.reqId);
      if (m.type === "error") p.reject(new Error(m.message));
      else if (m.type === "solve") p.resolve(m.result);
      else p.resolve(m.params);
    };
  }

  private call<T>(msg: Req): Promise<T> {
    const reqId = this.next++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(reqId, { resolve, reject });
      this.worker.postMessage({ ...msg, reqId } as WorkerRequest);
    });
  }

  solve(params: SolverParams, constraints: SolverConstraint[], drag?: DragTarget[]): Promise<SolveResult> {
    return this.call({ type: "solve", params, constraints, drag });
  }
  dragStart(params: SolverParams, constraints: SolverConstraint[], targets: DragTarget[]): Promise<SolverParams> {
    return this.call({ type: "dragStart", params, constraints, targets });
  }
  dragMove(targets: DragTarget[]): Promise<SolverParams> {
    return this.call({ type: "dragMove", targets });
  }
  dragEnd() {
    this.worker.postMessage({ type: "dragEnd", reqId: 0 } satisfies WorkerRequest);
  }
}
