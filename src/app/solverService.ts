import { applyCommand } from "../model/editor";
import { activeSketch } from "../model/sketch";
import type { Doc, Sketch } from "../model/types";
import { buildSolverInput } from "../solver/build";
import type { DragTarget, EntityState, SketchStatus, SolveResult, Solver, SolverParams } from "../solver/types";
import type { Store } from "./store";

/** Write solved parameters back into a doc (no-op when nothing moved). */
export function applySolved(doc: Doc, params: SolverParams): Doc {
  return applyCommand(doc, (ed) => {
    for (const p of params.points) {
      const cur = ed.s.entities[p.id];
      if (cur?.type === "point" && (Math.abs(cur.x - p.x) > 1e-12 || Math.abs(cur.y - p.y) > 1e-12)) ed.movePoint(p.id, p.x, p.y);
    }
    for (const g of params.geoms) {
      if (g.kind !== "circle") continue;
      const cur = ed.s.entities[g.id];
      if (cur?.type === "circle" && Math.abs(cur.r - g.r) > 1e-12) ed.update(g.id, { r: g.r });
    }
  });
}

/** Translate a solver result into what the UI shows. */
export function toSketchStatus(s: Sketch, r: SolveResult, unsupported: string[]): SketchStatus {
  const entity: Record<string, EntityState> = {};
  for (const e of Object.values(s.entities)) {
    if (e.type === "spline") {
      const sts = e.cps.map((id) => r.entityStatus[id] ?? "under");
      entity[e.id] = sts.includes("over") ? "over" : sts.includes("failed") ? "failed" : sts.every((x) => x === "full") ? "full" : "under";
    } else entity[e.id] = r.entityStatus[e.id] ?? "under";
  }
  const conflicts = Array.from(new Set([...r.conflicts, ...r.redundant, ...unsupported]));
  const hasGeom = Object.values(s.entities).some((e) => e.type !== "point") || Object.keys(s.entities).length > 0;
  let state: SketchStatus["state"];
  if (!hasGeom) state = "empty";
  else if (conflicts.length) state = "over";
  else if (!r.ok) state = "failed";
  else state = r.dof === 0 ? "full" : "under";
  return { state, dof: r.dof, entity, conflicts, solving: false, ms: r.ms };
}

/**
 * Keeps the document solved. After every change the current sketch is sent to the
 * worker; the result amends the present history entry (no extra undo step).
 */
export class SolverService {
  private inFlight = false;
  private dirty = false;
  private drag: { base: Doc; session: number; busy: boolean; pending: DragTarget[] | null; started: boolean } | null = null;
  private session = 0;
  /** Extra hook so later milestones can post-process a solved doc (driven dimensions). */
  postSolve: ((doc: Doc) => Doc) | null = null;

  constructor(private store: Store, private solver: Solver) {}

  requestSolve() {
    this.dirty = true;
    if (!this.inFlight) void this.pump();
  }

  private async pump() {
    while (this.dirty && !this.drag) {
      this.dirty = false;
      this.inFlight = true;
      const doc = this.store.doc;
      const s = activeSketch(doc);
      const inp = buildSolverInput(s);
      this.store.set({ status: { ...this.store.state.status, solving: true } });
      try {
        const r = await this.solver.solve(inp.params, inp.constraints);
        if (this.store.doc !== doc || this.drag) continue; // superseded
        let next = r.ok ? applySolved(doc, r.params) : doc;
        if (this.postSolve) next = this.postSolve(next);
        if (next !== doc) this.store.amendDoc(next);
        this.store.set({ status: toSketchStatus(activeSketch(next), r, inp.unsupported) });
      } catch (e) {
        console.error("solve failed", e);
        this.store.set({ status: { ...this.store.state.status, solving: false, state: "failed" } });
      } finally {
        this.inFlight = false;
      }
    }
  }

  /** One-shot solve pulling points toward targets (PropertyManager edits). */
  async solveToward(targets: DragTarget[]): Promise<Doc | null> {
    const doc = this.store.doc;
    const inp = buildSolverInput(activeSketch(doc));
    const r = await this.solver.solve(inp.params, inp.constraints, targets);
    if (!r.ok) return null;
    return applySolved(doc, r.params);
  }

  // ---- dragging
  dragBegin(targets: DragTarget[]) {
    const base = this.store.doc;
    this.store.beginTransient();
    const session = ++this.session;
    this.drag = { base, session, busy: true, pending: null, started: false };
    const inp = buildSolverInput(activeSketch(base));
    this.solver
      .dragStart(inp.params, inp.constraints, targets)
      .then((p) => this.onDragResult(session, p))
      .catch((e) => console.error(e));
  }

  dragUpdate(targets: DragTarget[]) {
    const d = this.drag;
    if (!d) return;
    if (d.busy) {
      d.pending = targets; // latest wins
      return;
    }
    d.busy = true;
    this.solver
      .dragMove(targets)
      .then((p) => this.onDragResult(d.session, p))
      .catch((e) => console.error(e));
  }

  private onDragResult(session: number, p: SolverParams) {
    const d = this.drag;
    if (!d || d.session !== session) return;
    d.started = true;
    d.busy = false;
    this.store.updateTransient(applySolved(d.base, p));
    if (d.pending) {
      const t = d.pending;
      d.pending = null;
      this.dragUpdate(t);
    }
  }

  dragEnd(commit: boolean, label: string) {
    if (!this.drag) return;
    this.drag = null;
    this.solver.dragEnd();
    if (commit) this.store.endTransient(label);
    else this.store.cancelTransient();
    this.requestSolve();
  }

  get dragging() {
    return this.drag !== null;
  }
}
