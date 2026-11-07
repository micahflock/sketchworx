import type { Vec2 } from "../geom/vec";
import { boxAdd, boxValid, emptyBox } from "../geom/vec";
import type { SnapOptions, SnapResult } from "../inference/snap";
import { snap } from "../inference/snap";
import { applyCommand } from "../model/editor";
import type { CommandFn } from "../model/editor";
import { activeSketch } from "../model/sketch";
import type { Doc, Id, Sketch } from "../model/types";
import { entitySamples, hitTest } from "../render/hit";
import type { Hit } from "../render/hit";
import { Painter } from "../render/painter";
import { drawGrid, drawSketch, gridStep } from "../render/renderer";
import type { SceneOptions } from "../render/renderer";
import { theme } from "../render/theme";
import { View } from "../render/view";
import type { DragTarget } from "../solver/types";
import { LineTool } from "../tools/line";
import { DimensionTool } from "../tools/dimension";
import { TangentArcTool } from "../tools/tangentArc";
import { loadKeymap } from "./keymap";
import { drawDimensions } from "../render/dimensions";
import { evaluateDimText, labelPos, measure, refreshExpressions } from "../model/dimensions";
import { fmt } from "../tools/line";
import type { Dimension, Variable } from "../model/types";
import { isExpression } from "../model/expr";
import { SelectTool } from "../tools/select";
import { ArcTool, CircleTool, PointTool, RectTool } from "../tools/shapes";
import type { PEvent, Tool, ToolHost } from "../tools/tool";
import { Store } from "./store";
import { serializeDoc, parseDoc, FILE_EXT } from "../io/native";
import { autosaveRead, autosaveWrite, openText, saveText } from "../io/storage";
import { SolverService } from "./solverService";
import { WorkerSolver } from "../solver/client";
import type { Solver } from "../solver/types";
import { drawRelationGlyphs, hitAnnotations } from "../render/annotations";
import type { AnnotationHit } from "../render/annotations";
import { addRelationCmd, validRelations } from "../model/relations";
import type { RelationType } from "../model/types";

export class App implements ToolHost {
  readonly store = new Store();
  readonly view = new View();
  canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private tools = new Map<string, Tool>();
  tool: Tool;
  private renderQueued = false;
  private panning: { last: Vec2 } | null = null;
  private lastPointer: PEvent | null = null;
  readonly solver: SolverService;
  /** Hit rectangles of glyphs/dimensions from the last frame (screen space). */
  annotationHits: AnnotationHit[] = [];
  keymap: Record<string, string> = loadKeymap();
  /** Remembered variant per flyout group. */
  flyoutLast: Record<string, string> = {};
  private autosaveTimer: number | undefined;
  /** Status bar cursor readout hook. */
  onCursor: ((p: Vec2) => void) | null = null;

  constructor(solver: Solver = new WorkerSolver()) {
    this.solver = new SolverService(this.store, solver);
    const reg = (t: Tool) => this.tools.set(t.id, t);
    reg(new SelectTool(this));
    reg(new LineTool(this, "line"));
    reg(new LineTool(this, "centerline"));
    reg(new LineTool(this, "midpoint"));
    reg(new PointTool(this));
    reg(new CircleTool(this, "center"));
    reg(new CircleTool(this, "perimeter"));
    reg(new ArcTool(this, "center"));
    reg(new ArcTool(this, "threepoint"));
    for (const m of ["corner", "center", "3corner", "3center", "parallelogram"] as const) reg(new RectTool(this, m));
    reg(new DimensionTool(this));
    reg(new TangentArcTool(this));
    this.tool = this.tools.get("select")!;
    this.store.subscribe(() => this.requestRender());
  }

  registerTool(t: Tool) {
    this.tools.set(t.id, t);
  }
  getTool(id: string) {
    return this.tools.get(id);
  }

  // ------------------------------------------------------------------ setup
  attach(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    const ro = new ResizeObserver(() => this.resize());
    ro.observe(canvas);
    this.resize();
    this.view.scale = 1;
    this.view.cx = 200;
    this.view.cy = 150;
    this.bindInput(canvas);
    this.tool.activate?.();
    this.requestRender();
  }

  private resize() {
    const c = this.canvas!;
    const r = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.view.width = r.width;
    this.view.height = r.height;
    this.view.dpr = dpr;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    this.requestRender();
  }

  async restoreAutosave() {
    try {
      const text = await autosaveRead();
      if (text) {
        const doc = parseDoc(text);
        this.store.resetHistory(doc);
        this.afterDocReplaced();
      }
    } catch (e) {
      console.warn("autosave restore failed", e);
    }
  }

  // ------------------------------------------------------------------ ToolHost
  sketch(): Sketch {
    return activeSketch(this.store.doc);
  }
  doc(): Doc {
    return this.store.doc;
  }
  commit(label: string, fn: CommandFn): Doc {
    const next = applyCommand(this.store.doc, fn);
    if (next !== this.store.doc) {
      this.store.commitDoc(next, label);
      this.afterChange();
    }
    return next;
  }
  /** Commit a fully built doc (from UI panels). */
  commitDoc(doc: Doc, label: string) {
    if (doc === this.store.doc) return;
    this.store.commitDoc(doc, label);
    this.afterChange();
  }
  tol(pointerType?: string): number {
    const px = pointerType === "touch" ? 22 : pointerType === "pen" ? 12 : 8;
    return this.view.px(px);
  }
  snap(raw: Vec2, opts?: Partial<SnapOptions>): SnapResult {
    return snap(this.sketch(), raw, {
      tol: this.tol(this.lastPointer?.pointerType),
      gridStep: this.store.state.gridSnap ? gridStep(this.view) : undefined,
      ...opts,
    });
  }
  hit(world: Vec2, pointerType?: string, opts?: { skip?: Set<Id>; points?: boolean; curves?: boolean }): Hit | null {
    return hitTest(this.sketch(), world, this.tol(pointerType), opts?.skip, (e) =>
      e.type === "point" ? opts?.points !== false : opts?.curves !== false,
    );
  }
  hitAnnotation(screen: Vec2): { id: Id; kind: "dimension" | "relation" } | null {
    const h = hitAnnotations(this.annotationHits, screen);
    return h ? { id: h.id, kind: h.kind } : null;
  }
  selection(): Id[] {
    return this.store.state.selection;
  }
  select(ids: Id[]) {
    this.store.select(ids);
  }
  setHover(id: Id | null) {
    if (this.store.state.hover !== id) this.store.set({ hover: id });
  }
  setPrompt(text: string) {
    if (this.store.state.prompt !== text) this.store.set({ prompt: text });
  }
  setTool(id: string) {
    const t = this.tools.get(id);
    if (!t) return;
    this.tool.deactivate?.();
    this.tool = t;
    t.activate?.();
    this.store.set({ toolId: id, showShortcutBar: null, contextBar: null });
    if (this.canvas) this.canvas.style.cursor = t.cursor ?? "default";
  }
  suppress(): boolean {
    return this.store.state.ctrl || this.store.state.touchCtrl;
  }
  flash(text: string, kind: "info" | "error" = "info") {
    this.store.flash(text, kind);
  }
  showContextBar(screen: Vec2 | null) {
    this.store.set({ contextBar: screen && this.store.state.selection.length ? screen : null });
  }
  openModify(dimId: Id, isNew: boolean) {
    const d = this.sketch().dimensions[dimId];
    if (!d) return;
    const at = this.view.toScreen(labelPos(this.sketch(), d));
    this.store.set({ modify: { dimId, x: at.x, y: at.y, isNew }, selection: [dimId] });
  }

  /** Place a new dimension; prompt for driven if it would over-define the sketch. */
  async placeDimension(draft: Omit<Dimension, "id">) {
    let id = "";
    this.commit("Smart Dimension", (ed) => (id = ed.addDimension(draft)));
    await this.solver.settled();
    const s = this.sketch();
    if (!s.dimensions[id]) return;
    if (this.store.state.status.conflicts.includes(id)) {
      this.store.set({
        confirm: {
          title: "Make Dimension Driven?",
          message: "Adding this dimension will make the sketch over defined or unable to solve. Do you want to add it as a driven dimension instead?",
          buttons: [
            { label: "Make this dimension driven", run: () => this.setDimensionDriven(id, true) },
            { label: "Leave this dimension driving", run: () => this.openModify(id, true) },
          ],
        },
      });
      return;
    }
    this.openModify(id, true);
  }

  /** Apply Modify-box text (number or expression). Returns an error message or null. */
  setDimensionText(id: Id, text: string): string | null {
    try {
      const { value, expr } = evaluateDimText(this.store.doc, text);
      const d = this.sketch().dimensions[id];
      if (!d) return null;
      if (d.type !== "angle" && value <= 0 && d.type !== "distanceX" && d.type !== "distanceY") return "Value must be positive";
      if (d.expr === expr && d.value === value) return null;
      this.commit("Edit Dimension", (ed) => ed.updateDimension(id, { expr, value }));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  setDimensionDriven(id: Id, driven: boolean) {
    const s = this.sketch();
    const d = s.dimensions[id];
    if (!d || d.driven === driven) return;
    const value = Math.abs(measure(s, d));
    this.commit(driven ? "Make Driven" : "Make Driving", (ed) =>
      ed.updateDimension(id, driven ? { driven } : { driven, value, expr: isExpression(d.expr) ? d.expr : fmt(value) }),
    );
  }

  /** Rename a variable and every reference to it (dimensions in all slots, other variables). */
  renameVariable(from: string, to: string) {
    const re = new RegExp(`\\b${from}\\b`, "g");
    const doc = this.store.doc;
    const next: Doc = {
      ...doc,
      variables: doc.variables.map((v) => ({ ...v, name: v.name === from ? to : v.name, expr: v.expr.replace(re, to) })),
      slots: doc.slots.map((s) => {
        const dims = { ...s.dimensions };
        let changed = false;
        for (const d of Object.values(dims))
          if (re.test(d.expr)) {
            re.lastIndex = 0;
            dims[d.id] = { ...d, expr: d.expr.replace(re, to) };
            changed = true;
          }
        return changed ? { ...s, dimensions: dims } : s;
      }),
    };
    this.commitDoc(refreshExpressions(next), "Rename Variable");
  }

  /** Replace the global variables and re-evaluate every expression that uses them. */
  setVariables(vars: Variable[]) {
    this.commit("Edit Variables", (ed) => ed.setVariables(vars));
    const refreshed = refreshExpressions(this.store.doc);
    if (refreshed !== this.store.doc) {
      this.store.amendDoc(refreshed);
      this.afterChange();
    }
  }

  // ---- dragging through the solver
  dragBegin(targets: DragTarget[]) {
    this.solver.dragBegin(targets);
  }
  dragUpdate(targets: DragTarget[]) {
    this.solver.dragUpdate(targets);
  }
  dragEnd(commit: boolean, label = "Drag") {
    this.solver.dragEnd(commit, label);
    if (commit) this.scheduleAutosave();
  }

  // ------------------------------------------------------------------ changes
  /** Called after every committed change. */
  afterChange() {
    this.solver.requestSolve();
    this.scheduleAutosave();
  }
  afterDocReplaced() {
    this.afterChange();
  }
  scheduleAutosave() {
    clearTimeout(this.autosaveTimer);
    this.autosaveTimer = window.setTimeout(() => {
      autosaveWrite(serializeDoc(this.store.doc)).catch((e) => console.warn("autosave failed", e));
    }, 300);
  }

  undo() {
    this.tool.cancel();
    this.store.undo();
    this.pruneSelection();
    this.afterChange();
  }
  redo() {
    this.store.redo();
    this.pruneSelection();
    this.afterChange();
  }
  private pruneSelection() {
    const s = this.sketch();
    const sel = this.store.state.selection.filter((id) => s.entities[id] || s.relations[id] || s.dimensions[id]);
    if (sel.length !== this.store.state.selection.length) this.store.select(sel);
  }

  /** PropertyManager edits go through the solver so relations stay satisfied. */
  async setPointPosition(id: Id, x: number, y: number) {
    const doc = await this.solver.solveToward([{ point: id, x, y }]);
    if (doc) this.commitDoc(doc, "Edit Point");
    else this.flash("That position conflicts with existing relations", "error");
  }
  async setRadius(id: Id, r: number) {
    const doc = await this.solver.solveToward([{ radiusOf: id, r, x: 0, y: 0 }]);
    if (doc) this.commitDoc(doc, "Edit Radius");
  }

  /** Relations valid for the current selection. */
  validRelations(): RelationType[] {
    return validRelations(this.sketch(), this.store.state.selection);
  }
  addRelation(type: RelationType, ids = this.store.state.selection) {
    if (!validRelations(this.sketch(), ids).includes(type)) return this.flash(`${type} is not valid for this selection`, "error");
    this.commit(`Add ${type}`, (ed) => addRelationCmd(ed, type, ids));
    this.store.set({ contextBar: null });
  }
  deleteRelation(id: Id) {
    this.commit("Delete Relation", (ed) => ed.deleteAny([id]));
    this.store.select(this.store.state.selection.filter((x) => x !== id));
  }

  deleteSelection() {
    const sel = this.store.state.selection;
    if (!sel.length) return;
    this.commit("Delete", (ed) => ed.deleteAny(sel));
    this.store.set({ selection: [], hover: null, contextBar: null });
  }

  toggleConstruction() {
    const s = this.sketch();
    const ids = this.store.state.selection.filter((id) => s.entities[id] && s.entities[id].type !== "point");
    if (!ids.length) return this.flash("Select sketch entities to toggle construction");
    const on = !ids.every((id) => s.entities[id].construction);
    this.commit("For construction", (ed) => {
      for (const id of ids) ed.update(id, { construction: on || undefined });
    });
  }

  zoomToFit() {
    const s = this.sketch();
    const b = emptyBox();
    for (const e of Object.values(s.entities)) for (const p of entitySamples(s, e)) boxAdd(b, p);
    if (!boxValid(b)) {
      this.view.cx = 0;
      this.view.cy = 0;
      this.view.scale = 1;
    } else this.view.fit(b);
    this.requestRender();
  }

  // ------------------------------------------------------------------ files
  async saveFile(saveAs = false) {
    const name = (this.store.state.fileName ?? "untitled").replace(/(\.sketch)?\.json$/, "") + FILE_EXT;
    try {
      const saved = await saveText(serializeDoc(this.store.doc), name, "application/json", ".json", saveAs);
      if (saved) {
        this.store.set({ fileName: saved });
        this.flash(`Saved ${saved}`);
      }
    } catch (e: any) {
      this.flash(`Save failed: ${e?.message ?? e}`, "error");
    }
  }
  async openFile() {
    try {
      const f = await openText(".json,application/json");
      if (!f) return;
      const doc = parseDoc(f.text);
      this.tool.cancel();
      this.store.resetHistory(doc);
      this.store.set({ fileName: f.name });
      this.afterDocReplaced();
      this.zoomToFit();
      this.flash(`Opened ${f.name}`);
    } catch (e: any) {
      this.flash(`Open failed: ${e?.message ?? e}`, "error");
    }
  }
  loadDoc(doc: Doc, name: string | null = null) {
    this.tool.cancel();
    this.store.resetHistory(doc);
    this.store.set({ fileName: name });
    this.afterDocReplaced();
  }

  // ------------------------------------------------------------------ input
  private toEvent(e: PointerEvent | MouseEvent): PEvent {
    const r = this.canvas!.getBoundingClientRect();
    const screen = { x: e.clientX - r.left, y: e.clientY - r.top };
    return {
      screen,
      world: this.view.toWorld(screen),
      button: e.button,
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey || this.store.state.touchCtrl,
      alt: e.altKey,
      pointerType: (e as PointerEvent).pointerType ?? "mouse",
    };
  }

  private bindInput(c: HTMLCanvasElement) {
    c.addEventListener("contextmenu", (e) => e.preventDefault());
    c.addEventListener("pointerdown", (e) => {
      c.setPointerCapture(e.pointerId);
      const pe = this.toEvent(e);
      this.lastPointer = pe;
      if (e.button === 1 || (e.button === 0 && e.altKey && pe.pointerType === "mouse")) {
        this.panning = { last: pe.screen };
        e.preventDefault();
        return;
      }
      if (e.button === 2) return;
      this.store.set({ showShortcutBar: null });
      this.tool.onDown(pe);
    });
    c.addEventListener("pointermove", (e) => {
      const pe = this.toEvent(e);
      this.lastPointer = pe;
      if (this.panning) {
        this.view.panBy(pe.screen.x - this.panning.last.x, pe.screen.y - this.panning.last.y);
        this.panning.last = pe.screen;
        this.requestRender();
        return;
      }
      this.onCursor?.(pe.world);
      this.tool.onMove(pe);
    });
    const up = (e: PointerEvent) => {
      const pe = this.toEvent(e);
      if (this.panning) {
        this.panning = null;
        return;
      }
      if (e.button === 2) return;
      this.tool.onUp(pe);
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("dblclick", (e) => this.tool.onDoubleClick?.(this.toEvent(e)));
    c.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        const pe = this.toEvent(e);
        const factor = Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015));
        this.view.zoomAt(pe.screen, factor);
        this.requestRender();
      },
      { passive: false },
    );
    c.addEventListener("pointerleave", () => this.setHover(null));
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => {
      if (e.key === "Control" || e.key === "Meta") this.store.set({ ctrl: false });
    });
    window.addEventListener("blur", () => this.store.set({ ctrl: false }));
  }

  onKeyDown(e: KeyboardEvent) {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) return;
    if (e.key === "Control" || e.key === "Meta") {
      if (!this.store.state.ctrl) this.store.set({ ctrl: true });
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod) {
      if (k === "z" && !e.shiftKey) this.undo();
      else if (k === "y" || (k === "z" && e.shiftKey)) this.redo();
      else if (k === "s") this.saveFile(e.shiftKey);
      else if (k === "o") this.openFile();
      else if (k === "a") this.select(Object.keys(this.sketch().entities));
      else return;
      e.preventDefault();
      return;
    }
    if (this.tool.onKey?.(e)) {
      e.preventDefault();
      return;
    }
    if (e.key === "Escape") {
      this.escape();
      e.preventDefault();
      return;
    }
    if (e.key === "Delete" || e.key === "Backspace") {
      this.deleteSelection();
      e.preventDefault();
      return;
    }
    const action = this.keymap[k];
    if (action) {
      this.runAction(action);
      e.preventDefault();
    }
  }

  escape() {
    const st = this.store.state;
    if (st.confirm) return;
    if (st.showShortcutBar || st.contextBar || st.modify) {
      this.store.set({ showShortcutBar: null, contextBar: null, modify: null });
      return;
    }
    if (this.tool.cancel()) return;
    if (this.tool.id !== "select") return this.setTool("select");
    if (st.selection.length) this.select([]);
  }

  /** Named actions shared by the keyboard map, toolbar and shortcut bar. */
  runAction(action: string) {
    switch (action) {
      case "zoomFit":
        return this.zoomToFit();
      case "toggleConstruction":
        return this.toggleConstruction();
      case "undo":
        return this.undo();
      case "redo":
        return this.redo();
      case "delete":
        return this.deleteSelection();
      case "escape":
        return this.escape();
      case "shortcutBar": {
        const p = this.lastPointer?.screen ?? { x: this.view.width / 2, y: this.view.height / 2 };
        return this.store.set({ showShortcutBar: p });
      }
      case "relationsPanel":
        return this.store.set({ panel: this.store.state.panel === "relations" ? "auto" : "relations" });
      case "panel:add":
        return this.store.set({ panel: "auto" });
      case "view:sketch":
      case "view:art":
      case "view:split":
        return this.store.set({ viewMode: action.slice(5) as any });
      case "toggleGridSnap":
        return this.store.set({ gridSnap: !this.store.state.gridSnap });
      case "open":
        return void this.openFile();
      case "save":
        return void this.saveFile();
      case "keyboardPanel":
        return this.store.set({ panel: this.store.state.panel === "keyboard" ? "auto" : "keyboard" });
      case "variablesPanel":
        return this.store.set({ panel: this.store.state.panel === "variables" ? "auto" : "variables" });
      default:
        if (action.startsWith("tool:")) {
          const id = action.slice(5);
          if (this.tools.has(id)) this.setTool(id);
          else this.flash(`${id} is not available yet`);
        }
    }
  }

  // ------------------------------------------------------------------ render
  requestRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  sceneOptions(): SceneOptions {
    const st = this.store.state;
    const s = this.sketch();
    const related = new Set<Id>();
    // Hovering a relation (glyph or list row) highlights its entities.
    const hovered = st.hover ? s.relations[st.hover] : undefined;
    if (hovered) for (const id of hovered.refs) related.add(id);
    for (const id of st.selection) {
      const r = s.relations[id];
      if (r) for (const x of r.refs) related.add(x);
    }
    return { selection: new Set(st.selection), hover: st.hover, status: st.status, showGrid: st.showGrid, related };
  }

  render() {
    const ctx = this.ctx;
    if (!ctx) return;
    const v = this.view;
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, v.width, v.height);
    const p = new Painter(ctx, v);
    const s = this.sketch();
    const opts = this.sceneOptions();
    if (opts.showGrid) drawGrid(p);
    this.drawLayers(p, s, opts);
    this.tool.draw?.(p);
  }

  /** Overridable layer drawing (relations, dimensions, fills are added later). */
  drawLayers(p: Painter, s: Sketch, opts: SceneOptions) {
    drawSketch(p, s, opts);
    const conflicts = new Set(this.store.state.status.conflicts);
    const glyphs = drawRelationGlyphs(p, s, conflicts, this.store.state.hover, opts.selection);
    const sel = this.tools.get("select") as SelectTool;
    const dims = drawDimensions(p, s, { conflicts, hover: this.store.state.hover, selection: opts.selection, labelOffset: (id) => sel.dimOffset(id) });
    this.annotationHits = [...glyphs, ...dims];
  }
}
