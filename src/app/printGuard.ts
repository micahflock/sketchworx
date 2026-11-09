/**
 * Print mode never lets an edit make the print worse. Every solved document is checked against the
 * rules: a typed value that breaks one is pulled back to the closest value that prints, any other
 * edit is refused with a notice saying why, and a drag stops at the last position that prints.
 * Undo, redo, opening a file and printer changes are trusted: what they bring is listed, and from
 * then on edits may fix or keep those breaks but not add one.
 */
import type { Doc } from "../model/types";
import { checkRules, isWorse, matchBreak } from "../model/regions";
import type { Break, RuleReport } from "../model/regions";
import { filamentById, minFeature } from "../model/print";
import type { Notice, Store } from "./store";
import type { SolverService } from "./solverService";

/** A typed value: the guard may replace `to` with the closest value toward `from` that prints. */
export interface ValueIntent {
  from: number;
  to: number;
  /** Values come in whole steps of this size (stroke widths in lines); otherwise searched to 1 µm. */
  step?: number;
  /** The document with the value set, from the document before the edit (not yet solved). */
  apply: (v: number) => Doc;
  /** The value as shown to the user ("0.90 mm", "2 lines · 0.90 mm"). */
  show: (v: number) => string;
  /** Changing the value does not move geometry (stroke widths), so trials need no solve. */
  noSolve?: boolean;
}

const fmt = (v: number) => (Math.round(v * 1000) / 1000).toFixed(v < 10 ? 2 : 1);

/** "a 0.62 mm White strip", "a 0.50 mm Black neck". */
export function describeBreak(doc: Doc, b: Break): string {
  const name = filamentById(doc, b.filament)?.name ?? "filament";
  const what = b.kind === "neck" ? "neck" : "strip";
  return `a ${fmt(b.width)} mm ${name.toLowerCase()} ${what}`;
}

export function limitText(doc: Doc): string {
  const p = doc.print!.printer;
  return `min feature is ${p.minFeatureLines} lines (${fmt(minFeature(p))} mm)`;
}

/** The break in `after` that is new, or else the one that got narrower. */
export function newBreak(before: RuleReport, after: RuleReport): Break | null {
  return (
    after.breaks.find((b) => !matchBreak(b, before.breaks)) ??
    after.breaks.find((b) => b.width < (matchBreak(b, before.breaks)?.width ?? Infinity) - 0.002) ??
    after.breaks[0] ??
    null
  );
}

export class PrintGuard {
  /** The last document that passed (or was trusted). */
  accepted: Doc | null = null;
  private intent: ValueIntent | null = null;
  private trustNext = false;
  private busy = false;
  /** A document that settled while a value search was running: checked once the search ends. */
  private pending: Doc | null = null;
  /** Resolves when a value search finishes (tests). */
  private searching: Promise<void> = Promise.resolve();

  constructor(
    private store: Store,
    private solver: SolverService,
  ) {}

  /** The next change is a typed value (pull it back rather than refuse it). */
  expectValue(i: ValueIntent) {
    this.intent = i;
  }
  /** The next change is trusted (printer settings, turning Print mode on). */
  trust() {
    this.trustNext = true;
  }
  idle(): Promise<void> {
    return this.searching;
  }

  private report(doc: Doc): RuleReport | null {
    return doc.print ? checkRules(doc) : null;
  }

  private accept(doc: Doc) {
    this.accepted = doc;
    this.store.set({ printReport: this.report(doc) });
  }

  notify(n: Omit<Notice, "time">) {
    const notice = { ...n, time: Date.now() };
    this.store.set({ notice, notices: [notice, ...this.store.state.notices].slice(0, 20), printMarker: n.area ?? null });
    setTimeout(() => {
      if (this.store.state.notice === notice) this.store.set({ notice: null });
    }, 6000);
  }

  /** A solved document: accept it, pull a typed value back, or refuse the edit. */
  onSettled(doc: Doc) {
    if (this.busy) {
      this.pending = doc;
      return;
    }
    if (doc === this.accepted) return;
    const intent = this.intent;
    const trusted = this.trustNext || this.store.lastChange !== "commit" || !this.accepted?.print || !doc.print;
    this.intent = null;
    this.trustNext = false;
    if (this.store.state.printMarker && !trusted) this.store.set({ printMarker: null });
    if (trusted) return this.accept(doc);
    const base = checkRules(this.accepted!);
    const rep = checkRules(doc);
    if (!isWorse(base, rep)) return this.accept(doc);
    if (intent) {
      this.searching = this.pullBack(intent, doc, base, rep);
      return;
    }
    this.refuse(doc, base, rep);
  }

  private refuse(doc: Doc, base: RuleReport, rep: RuleReport) {
    const label = this.store.state.history.presentLabel;
    const b = newBreak(base, rep);
    this.store.rollbackTo(this.accepted!);
    this.solver.requestSolve();
    this.notify({
      kind: "refused",
      text: b ? `${label} not done: it would leave ${describeBreak(doc, b)}; ${limitText(doc)}` : `${label} not done: it would not print`,
      area: b?.area,
      at: b?.at,
    });
  }

  /** Search between the old value (prints) and the typed one (does not) for the closest that prints. */
  private async pullBack(intent: ValueIntent, bad: Doc, base: RuleReport, badRep: RuleReport) {
    this.busy = true;
    this.store.set({ printBusy: true });
    const label = this.store.state.history.presentLabel;
    const try_ = async (v: number) => {
      let d = intent.apply(v);
      if (!intent.noSolve) d = await this.solver.solveDoc(d);
      return { d, ok: !!d.print && !isWorse(base, checkRules(d)) };
    };
    let best: { v: number; d: Doc } | null = null;
    try {
      const dir = Math.sign(intent.to - intent.from);
      if (intent.step) {
        // Whole steps back from the typed value.
        const n = Math.round(Math.abs(intent.to - intent.from) / intent.step);
        for (let k = n - 1; k >= 1; k--) {
          const v = intent.from + dir * k * intent.step;
          const r = await try_(v);
          if (r.ok) {
            best = { v, d: r.d };
            break;
          }
        }
      } else {
        let lo = intent.from;
        let hi = intent.to;
        for (let k = 0; k < 24 && Math.abs(hi - lo) > 0.0005; k++) {
          const m = (lo + hi) / 2;
          const r = await try_(m);
          if (r.ok) {
            lo = m;
            best = { v: m, d: r.d };
          } else hi = m;
        }
        // Show a tidy value: round toward the old one, to 0.001.
        if (best) {
          const q = dir > 0 ? Math.floor(lo * 1000 + 1e-6) / 1000 : Math.ceil(lo * 1000 - 1e-6) / 1000;
          if (Math.abs(q - lo) > 1e-9 && (q - intent.from) * dir > 0) {
            const r = await try_(q);
            if (r.ok) best = { v: q, d: r.d };
          }
        }
      }
    } finally {
      this.busy = false;
      this.store.set({ printBusy: false });
    }
    const pending = this.pending;
    this.pending = null;
    // The user moved on meanwhile: check where they are now, as an ordinary edit.
    if (this.store.doc !== bad) {
      if (pending && pending === this.store.doc) this.onSettled(pending);
      return;
    }
    const b = newBreak(base, badRep);
    const why = b ? `${intent.show(intent.to)} would leave ${describeBreak(bad, b)}; ${limitText(bad)}` : `${intent.show(intent.to)} would not print`;
    if (!best) {
      this.store.rollbackTo(this.accepted!);
      this.solver.requestSolve();
      return this.notify({ kind: "refused", text: `${label}: kept at ${intent.show(intent.from)}. ${why}`, area: b?.area, at: b?.at });
    }
    this.store.amendDoc(best.d);
    this.accept(best.d);
    this.solver.requestSolve();
    this.notify({ kind: "adjusted", text: `Set to ${intent.show(best.v)}: ${why}`, area: b?.area, at: b?.at });
  }

  /** Drag frames that would break a rule are not shown; the geometry stays at the last one that prints. */
  filterDrag(next: Doc): Doc | null {
    if (!next.print || !this.accepted?.print) return next;
    const base = checkRules(this.accepted);
    const rep = checkRules(next);
    if (!isWorse(base, rep)) {
      if (this.store.state.printMarker) this.store.set({ printMarker: null });
      return next;
    }
    const b = newBreak(base, rep);
    this.store.set({ printMarker: b?.area ?? null });
    return null;
  }
}
