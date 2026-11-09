import { createDoc } from "../model/sketch";
import { amend, commit, createHistory, redo, undo } from "../model/history";
import type { History } from "../model/history";
import type { Doc, Id } from "../model/types";
import type { SketchStatus } from "../solver/types";
import { emptyStatus } from "../solver/types";
import type { HellAccent, ThemeName } from "../render/theme";
import type { ThemePref } from "./themePref";
import type { Paths64 } from "@countertype/clipper2-ts";
import type { Vec2 } from "../geom/vec";
import type { RuleReport } from "../model/regions";

/** A refused or adjusted edit in Print mode, or other news about the print. */
export interface Notice {
  text: string;
  kind: "refused" | "adjusted" | "info";
  /** Where the problem is (mm, sketch coordinates). */
  area?: Paths64;
  at?: Vec2;
  time: number;
}

export type ViewMode = "sketch" | "art" | "split" | "print";

export interface UiState {
  history: History;
  selection: Id[];
  hover: Id | null;
  toolId: string;
  /** Short instruction for the status bar ("Click to set the end point"). */
  prompt: string;
  status: SketchStatus;
  /** Rebuild state of every sketch in the feature tree. */
  featureStatus: Record<Id, { state: SketchStatus["state"]; dangling: number }>;
  panel: "auto" | "relations" | "variables" | "keyboard" | "export";
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
  /** Centerline used by Dynamic Mirror, when active. */
  dynamicMirror: Id | null;
  /** Curvature combs on splines and arcs. */
  combs: boolean;
  /** Art view: selected chains, by a curve in each (the chain's key). */
  artSelection: Id[];
  artHover: Id | null;
  /** Light/dark choice, and the theme it resolves to. */
  themePref: ThemePref;
  theme: ThemeName;
  /** HELL MODE has been unlocked (a dimension was set to 666), so the theme toggle and command box offer it. */
  hellUnlocked: boolean;
  /** HELL MODE color. */
  hellAccent: HellAccent;
  /** A pen (Apple Pencil) has been used on the canvas. */
  penSeen: boolean;
  /** Only the pen draws and selects; fingers pan and zoom (palm rejection). On once a pen is seen. */
  pencilOnly: boolean;
  /** Print mode: rule breaks of the current document (null when Print mode is off). */
  printReport: RuleReport | null;
  /** The notice on screen, and the recent ones (newest first). */
  notice: Notice | null;
  notices: Notice[];
  /** Spot marked in red until the next edit (a refused edit's problem, or a drag held at the limit). */
  printMarker: Paths64 | null;
  /** Print mode is searching for the closest value that prints. */
  printBusy: boolean;
}

/** How the present document was reached. */
export type ChangeKind = "commit" | "undo" | "redo" | "reset";

type Listener = () => void;

/** Minimal observable store. UI panels subscribe; the canvas renders on demand. */
export class Store {
  state: UiState;
  private listeners = new Set<Listener>();
  /** Bumped on every change, so subscribers can cheaply detect updates. */
  version = 0;
  private transientBase: History | null = null;
  /** How the present document was reached (Print mode trusts undo, redo and opening files). */
  lastChange: ChangeKind = "reset";

  constructor(doc: Doc = createDoc()) {
    this.state = {
      history: createHistory(doc),
      selection: [],
      hover: null,
      toolId: "select",
      prompt: "",
      status: emptyStatus(),
      featureStatus: {},
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
      dynamicMirror: null,
      combs: false,
      artSelection: [],
      artHover: null,
      themePref: "system",
      theme: "light",
      hellUnlocked: false,
      hellAccent: "red",
      penSeen: false,
      pencilOnly: false,
      printReport: null,
      notice: null,
      notices: [],
      printMarker: null,
      printBusy: false,
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
    this.lastChange = "commit";
    this.set({ history: commit(this.state.history, doc, label) });
  }
  /**
   * Go back to `doc`, an earlier present of this history, dropping the steps after it (and redo):
   * the edit is refused rather than undone.
   */
  rollbackTo(doc: Doc) {
    const h = this.state.history;
    if (h.present === doc) return;
    const i = h.past.map((e) => e.doc).lastIndexOf(doc);
    if (i < 0) return this.set({ history: { ...h, present: doc, future: [] } });
    this.set({ history: { past: h.past.slice(0, i), present: doc, presentLabel: h.past[i].label, future: [] } });
  }
  amendDoc(doc: Doc) {
    this.set({ history: amend(this.state.history, doc) });
  }
  undo() {
    if (this.transientBase) return;
    this.lastChange = "undo";
    this.set({ history: undo(this.state.history) });
  }
  redo() {
    if (this.transientBase) return;
    this.lastChange = "redo";
    this.set({ history: redo(this.state.history) });
  }
  resetHistory(doc: Doc) {
    this.transientBase = null;
    this.lastChange = "reset";
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
    this.lastChange = "commit";
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
