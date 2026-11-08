import { applyCommand } from "../model/editor";
import { danglingOf } from "../model/features";
import { activeSketch, contextSketch, featureIndex } from "../model/sketch";
import type { Doc, Id, Sketch, SketchFeature } from "../model/types";
import { buildSolverInput } from "../solver/build";
import type { DragTarget, EntityState, SketchStatus, SolveResult, Solver, SolverParams } from "../solver/types";
import type { Store } from "./store";

/** Write solved parameters back into one sketch of a doc (no-op when nothing moved). */
export function applySolved(doc: Doc, params: SolverParams, featureId: Id = doc.active): Doc {
  return applyCommand(
    doc,
    (ed) => {
      for (const p of params.points) {
        if (p.fixed) continue;
        const cur = ed.s.entities[p.id];
        if (cur?.type === "point" && (Math.abs(cur.x - p.x) > 1e-12 || Math.abs(cur.y - p.y) > 1e-12)) ed.movePoint(p.id, p.x, p.y);
      }
      for (const g of params.geoms) {
        if (g.kind !== "circle" || g.fixed) continue;
        const cur = ed.s.entities[g.id];
        if (cur?.type === "circle" && Math.abs(cur.r - g.r) > 1e-12) ed.update(g.id, { r: g.r });
      }
    },
    featureId,
  );
}

/** Translate a solver result into what the UI shows (for the sketch's own geometry). */
export function toSketchStatus(s: Sketch, r: SolveResult, unsupported: string[], dangling: string[] = []): SketchStatus {
  const entity: Record<string, EntityState> = {};
  for (const e of Object.values(s.entities)) {
    if (s.ext?.[e.id]) continue;
    if (e.type === "spline") {
      const sts = e.cps.map((id) => r.entityStatus[id] ?? "under");
      entity[e.id] = sts.includes("over") ? "over" : sts.includes("failed") ? "failed" : sts.every((x) => x === "full") ? "full" : "under";
    } else entity[e.id] = r.entityStatus[e.id] ?? "under";
  }
  const dang = new Set(dangling);
  const conflicts = Array.from(new Set([...r.conflicts, ...r.redundant, ...unsupported])).filter((id) => !dang.has(id) && !id.startsWith("#"));
  const hasGeom = Object.keys(s.entities).some((id) => id !== "origin" && !s.ext?.[id]);
  let state: SketchStatus["state"];
  if (!hasGeom) state = "empty";
  else if (conflicts.length) state = "over";
  else if (!r.ok) state = "failed";
  else state = r.dof === 0 ? "full" : "under";
  return { state, dof: r.dof, entity, conflicts, dangling, solving: false, ms: r.ms };
}

/** Where the rebuild has to start: the first sketch that changed (later ones may depend on it). */
function firstStale(prev: Doc | null, doc: Doc): number {
  if (!prev || prev.variables !== doc.variables) return 0;
  for (let i = 0; i < doc.features.length; i++) {
    const a = prev.features[i];
    const b = doc.features[i];
    if (!a || a.id !== b.id || a.sketch !== b.sketch) return i;
  }
  return doc.features.length;
}

/**
 * Keeps the document solved. Sketches rebuild in tree order: each one solves with the geometry of
 * the sketches above it locked, so editing a sketch moves every sketch below that references it.
 * Results amend the present history entry (no extra undo step).
 */
export class SolverService {
  private inFlight = false;
  private dirty = false;
  private drag: {
    base: Doc;
    session: number;
    busy: boolean;
    pending: DragTarget[] | null;
    started: boolean;
    /** Latest solved sketches below the dragged one, and whether a rebuild of them is running. */
    below: SketchFeature[] | null;
    belowBusy: boolean;
  } | null = null;
  private session = 0;
  /** Post-process one solved sketch (recompute driven offsets). */
  postSolve: ((doc: Doc, featureId: Id) => Doc) | null = null;
  /** The last doc this service fully rebuilt, and the status of each sketch in it. */
  private solved: Doc | null = null;
  private statuses = new Map<Id, SketchStatus>();

  private waiters: (() => void)[] = [];

  constructor(private store: Store, private solver: Solver) {}

  /** Resolves once the current document has been solved. */
  settled(): Promise<void> {
    if (!this.inFlight && !this.dirty) return Promise.resolve();
    return new Promise((r) => this.waiters.push(r));
  }

  requestSolve() {
    this.dirty = true;
    if (!this.inFlight) void this.pump();
  }

  /** Solve one sketch of `doc` against the (already solved) sketches above it. */
  private async solveFeature(doc: Doc, id: Id): Promise<{ doc: Doc; status: SketchStatus }> {
    const s = contextSketch(doc, id);
    const inp = buildSolverInput(s);
    const r = await this.solver.solve(inp.params, inp.constraints);
    let next = r.ok ? applySolved(doc, r.params, id) : doc;
    if (this.postSolve) next = this.postSolve(next, id);
    return { doc: next, status: toSketchStatus(contextSketch(next, id), r, inp.unsupported, danglingOf(next, id)) };
  }

  /** Rebuild sketches `from`..end in order. */
  private async rebuild(doc: Doc, from: number, statuses: Map<Id, SketchStatus>): Promise<Doc> {
    let cur = doc;
    for (let i = from; i < cur.features.length; i++) {
      const id = cur.features[i].id;
      const res = await this.solveFeature(cur, id);
      cur = res.doc;
      statuses.set(id, res.status);
    }
    return cur;
  }

  private publish(doc: Doc) {
    const status = this.statuses.get(doc.active);
    const featureStatus: Record<Id, { state: SketchStatus["state"]; dangling: number }> = {};
    for (const f of doc.features) {
      const st = this.statuses.get(f.id);
      if (st) featureStatus[f.id] = { state: st.state, dangling: st.dangling.length };
    }
    this.store.set({ ...(status ? { status } : {}), featureStatus });
  }

  private async pump() {
    while (this.dirty && !this.drag) {
      this.dirty = false;
      this.inFlight = true;
      const doc = this.store.doc;
      let from = firstStale(this.solved, doc);
      // A sketch with no status yet (new or reloaded) is rebuilt too.
      const missing = doc.features.findIndex((f) => !this.statuses.has(f.id));
      if (missing >= 0) from = Math.min(from, missing);
      if (from >= doc.features.length) {
        this.inFlight = false;
        this.publish(doc);
        continue;
      }
      this.store.set({ status: { ...this.store.state.status, solving: true } });
      try {
        const statuses = new Map(this.statuses);
        const next = await this.rebuild(doc, from, statuses);
        if (this.store.doc !== doc || this.drag) {
          if (!this.drag) this.dirty = true; // the doc changed meanwhile: solve the new one
          continue;
        }
        this.statuses = statuses;
        for (const id of [...this.statuses.keys()]) if (!next.features.some((f) => f.id === id)) this.statuses.delete(id);
        if (next !== doc) this.store.amendDoc(next);
        this.solved = next;
        this.publish(next);
      } catch (e) {
        console.error("solve failed", e);
        this.store.set({ status: { ...this.store.state.status, solving: false, state: "failed" } });
      } finally {
        this.inFlight = false;
      }
    }
    if (!this.dirty && !this.inFlight) {
      const w = this.waiters;
      this.waiters = [];
      for (const f of w) f();
    }
  }

  /** Solve arbitrary input without touching the store. */
  solveRaw(params: SolverParams, constraints: Parameters<Solver["solve"]>[1]): Promise<SolveResult> {
    return this.solver.solve(params, constraints);
  }

  /** One-shot solve of the active sketch pulling points toward targets (PropertyManager edits). */
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
    this.drag = { base, session, busy: true, pending: null, started: false, below: null, belowBusy: false };
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
    let next = applySolved(d.base, p);
    if (this.postSolve) next = this.postSolve(next, next.active);
    if (d.below) next = withBelow(next, d.below);
    this.store.updateTransient(next);
    this.rebuildBelow(d);
    if (d.pending) {
      const t = d.pending;
      d.pending = null;
      this.dragUpdate(t);
    }
  }

  /** Live update of the sketches below the dragged one (latest frame wins). */
  private rebuildBelow(d: NonNullable<SolverService["drag"]>) {
    const doc = this.store.doc;
    const ai = featureIndex(doc);
    if (d.belowBusy || ai >= doc.features.length - 1) return;
    d.belowBusy = true;
    const scratch = new Map<Id, SketchStatus>();
    this.rebuild(doc, ai + 1, scratch)
      .then((solved) => {
        d.belowBusy = false;
        if (this.drag !== d) return;
        d.below = solved.features.slice(ai + 1);
        const cur = this.store.doc;
        this.store.updateTransient(withBelow(cur, d.below));
        if (cur.features[ai].sketch !== doc.features[ai].sketch) this.rebuildBelow(d); // moved again meanwhile
      })
      .catch((e) => {
        d.belowBusy = false;
        console.error(e);
      });
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

/** Replace the sketches below the active one with solved copies (same ids, same order). */
function withBelow(doc: Doc, below: SketchFeature[]): Doc {
  const ai = featureIndex(doc);
  const features = doc.features.map((f, i) => {
    if (i <= ai) return f;
    const b = below[i - ai - 1];
    return b && b.id === f.id ? { ...f, sketch: b.sketch } : f;
  });
  return { ...doc, features };
}
