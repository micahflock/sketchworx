import type { Doc } from "./types";

/** Unlimited undo/redo over immutable document snapshots. */
export interface History {
  past: { doc: Doc; label: string }[];
  present: Doc;
  presentLabel: string;
  future: { doc: Doc; label: string }[];
}

export const createHistory = (doc: Doc): History => ({ past: [], present: doc, presentLabel: "Open", future: [] });

export function commit(h: History, doc: Doc, label: string): History {
  if (doc === h.present) return h;
  return { past: [...h.past, { doc: h.present, label: h.presentLabel }], present: doc, presentLabel: label, future: [] };
}

/** Replace the present without creating an undo step (solver results, drag frames). */
export function amend(h: History, doc: Doc): History {
  return doc === h.present ? h : { ...h, present: doc };
}

export function undo(h: History): History {
  const prev = h.past[h.past.length - 1];
  if (!prev) return h;
  return {
    past: h.past.slice(0, -1),
    present: prev.doc,
    presentLabel: prev.label,
    future: [{ doc: h.present, label: h.presentLabel }, ...h.future],
  };
}

export function redo(h: History): History {
  const next = h.future[0];
  if (!next) return h;
  return {
    past: [...h.past, { doc: h.present, label: h.presentLabel }],
    present: next.doc,
    presentLabel: next.label,
    future: h.future.slice(1),
  };
}
