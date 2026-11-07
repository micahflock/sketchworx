import { createDoc } from "../model/sketch";
import { amend, commit, createHistory, redo, undo } from "../model/history";
import type { History } from "../model/history";
import type { Doc, Id } from "../model/types";
import type { SketchStatus } from "../solver/types";
import { emptyStatus } from "../solver/types";

export type ViewMode = "sketch" | "art" | "split";

export interface UiState {
  history: History;
  selection: Id[];
  hover: Id | null;
  toolId: string;
  /** Short instruction for the status bar ("Click to set the end point"). */
  prompt: string;
  status: SketchStatus;
  panel: "auto" | "relations" | "variables";
  viewMode: ViewMode;
  showShortcutBar: { x: number; y: number } | null;
  contextBar: { x: number; y: number } | null;
  /** Modify box for a dimension being edited. */
  modify: { dimId: Id; x: number; y: number; isNew: boolean } | null;
  message: { text: string; kind: "info" | "error" } | null;
  /** Modal question (SolidWorks-style prompts such as "Make this dimension driven?"). */
  confirm: { title: string; message: string; buttons: { label: string; run: () => void }[] } | null;
  fileName: string | null;
  /** True while Ctrl is held (suppresses auto relations), or the on-screen Ctrl is latched. */
  ctrl: boolean;
  touchCtrl: boolean;
  gridSnap: boolean;
  showGrid: boolean;
  /** Show on-screen modifier keys (touch device without keyboard). */
  touchUi: boolean;
}

type Listener = () => void;

/** Minimal observable store. UI panels subscribe; the canvas renders on demand. */
export class Store {
  state: UiState;
  private listeners = new Set<Listener>();
  /** Bumped on every change, so subscribers can cheaply detect updates. */
  version = 0;
  private transientBase: History | null = null;

  constructor(doc: Doc = createDoc()) {
    this.state = {
      history: createHistory(doc),
      selection: [],
      hover: null,
      toolId: "select",
      prompt: "",
      status: emptyStatus(),
      panel: "auto",
      viewMode: "sketch",
      showShortcutBar: null,
      contextBar: null,
      modify: null,
      message: null,
      confirm: null,
      fileName: null,
      ctrl: false,
      touchCtrl: false,
      gridSnap: false,
      showGrid: true,
      touchUi: false,
    };
  }

  get doc(): Doc {
    return this.state.history.present;
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<UiState>) {
    this.state = { ...this.state, ...patch };
    this.version++;
    for (const l of this.listeners) l();
  }

  // ---- history
  commitDoc(doc: Doc, label: string) {
    if (this.transientBase) this.endTransient(label);
    this.set({ history: commit(this.state.history, doc, label) });
  }
  amendDoc(doc: Doc) {
    this.set({ history: amend(this.state.history, doc) });
  }
  undo() {
    if (this.transientBase) return;
    this.set({ history: undo(this.state.history) });
  }
  redo() {
    if (this.transientBase) return;
    this.set({ history: redo(this.state.history) });
  }
  resetHistory(doc: Doc) {
    this.transientBase = null;
    this.set({ history: createHistory(doc), selection: [], hover: null });
  }

  /** Begin a transient edit (dragging): frames amend, the end commits one undo step. */
  beginTransient() {
    this.transientBase = this.state.history;
  }
  get inTransient() {
    return this.transientBase !== null;
  }
  updateTransient(doc: Doc) {
    if (!this.transientBase) return;
    this.set({ history: amend(this.state.history, doc) });
  }
  endTransient(label: string) {
    const base = this.transientBase;
    if (!base) return;
    this.transientBase = null;
    const final = this.state.history.present;
    this.set({ history: final === base.present ? base : commit(base, final, label) });
  }
  cancelTransient() {
    const base = this.transientBase;
    if (!base) return;
    this.transientBase = null;
    this.set({ history: base });
  }

  select(ids: Id[]) {
    this.set({ selection: ids });
  }

  flash(text: string, kind: "info" | "error" = "info") {
    this.set({ message: { text, kind } });
    const v = this.state.message;
    setTimeout(() => {
      if (this.state.message === v) this.set({ message: null });
    }, 3500);
  }
}
