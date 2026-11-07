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
import { DynamicMirrorTool, ExtendTool, FilletTool, MirrorTool, OffsetTool, SplineTool, TrimTool } from "../tools/modify";
import { mirrorEntities, recomputeDerived } from "../tools/edits";
import { loadKeymap } from "./keymap";
import { drawDimensions } from "../render/dimensions";
import { evaluateDimText, labelPos, measure, refreshExpressions } from "../model/dimensions";
import { fmt } from "../tools/line";
import type { Dimension, Variable } from "../model/types";
import { isExpression } from "../model/expr";
import { drawDiagnostics, fillOutline, outlineOf } from "../render/art";
import { outlineBounds, exportSvg, exportPng, guideMetrics } from "../io/svg";
import type { SvgOptions } from "../io/svg";
import { downloadBlob, pickFile } from "../io/storage";
import { createSketch } from "../model/sketch";
import { buildSolverInput } from "../solver/build";
import { applySolved } from "./solverService";
import { PictureScaleTool } from "../tools/picture";
import { extremaWithoutPoints } from "../model/hygiene";
import { drawCurvatureCombs } from "../render/combs";
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

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Could not read the image"));
    img.src = url;
  });
}

/** Metric guide lines (and their variables if missing), per font conventions for 1000 units/em. */
function addGuides(ed: import("../model/editor").Editor) {
  const defaults: [string, number][] = [
    ["baseline", 0],
    ["xheight", 500],
    ["capheight", 700],
    ["ascender", 750],
    ["descender", -250],
  ];
  const vars = [...ed.d.variables];
  for (const [name, v] of defaults) if (!vars.some((x) => x.name === name)) vars.push({ name, expr: String(v), value: v });
  ed.setVariables(vars);
  for (const [name] of defaults) {
    const val = vars.find((x) => x.name === name)!.value;
    const line = ed.newId("e");
    const p1 = ed.addPoint(0, val, line);
    const p2 = ed.addPoint(ed.s.advance, val, line);
    ed.put({ id: line, type: "line", p1, p2, construction: true, guide: name });
  }
}

/** Commands whose new entities Dynamic Mirror copies. */
const DRAW_COMMANDS = new Set(["Line", "Centerline", "Arc", "Tangent Arc", "Circle", "Point", "Style Spline", "Rectangle"]);

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
  /** Canvas size in CSS px (the view may use half of it in split mode). */
  private canvasW = 800;
  private canvasH = 600;
  private images = new Map<string, HTMLImageElement>();
  private touches = new Map<number, { start: Vec2; last: Vec2; t0: number }>();
  private pinch: { dist: number; mid: Vec2; moved: number; t0: number } | null = null;
  private longPress: number | undefined;
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
    reg(new SplineTool(this));
    reg(new TrimTool(this));
    reg(new ExtendTool(this));
    reg(new FilletTool(this));
    reg(new OffsetTool(this));
    reg(new MirrorTool(this));
    reg(new DynamicMirrorTool(this));
    reg(new PictureScaleTool(this));
    this.solver.postSolve = (doc) => applyCommand(doc, recomputeDerived);
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
    this.canvasW = r.width;
    this.canvasH = r.height;
    this.view.dpr = dpr;
    c.width = Math.round(r.width * dpr);
    c.height = Math.round(r.height * dpr);
    this.layoutViews();
    this.requestRender();
  }

  /** In split view the editable sketch uses the left half; the art preview the right. */
  layoutViews() {
    const split = this.store.state.viewMode === "split";
    this.view.width = split ? this.canvasW / 2 : this.canvasW;
    this.view.height = this.canvasH;
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
    const axis = this.store.state.dynamicMirror;
    if (axis && DRAW_COMMANDS.has(label)) {
      const inner = fn;
      fn = (ed) => {
        const before = new Set(Object.keys(ed.s.entities));
        inner(ed);
        if (!ed.s.entities[axis]) return;
        const fresh = Object.values(ed.s.entities)
          .filter((e) => !before.has(e.id) && !(e.type === "point" && e.owner) && !(e.type === "line" && e.owner))
          .map((e) => e.id);
        mirrorEntities(ed, fresh, axis);
      };
    }
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
    void this.solveOtherSlots();
  }

  /** Variables are shared: re-solve every other slot in the background so all glyphs update. */
  async solveOtherSlots() {
    const doc = this.store.doc;
    const results = await Promise.all(
      doc.slots.map(async (s, i) => {
        if (i === doc.activeSlot || Object.keys(s.entities).length <= 1) return null;
        const inp = buildSolverInput(s);
        const r = await this.solver.solveRaw(inp.params, inp.constraints);
        return r.ok ? { i, params: r.params } : null;
      }),
    );
    if (this.store.doc !== doc) return; // superseded by a newer edit
    let next = doc;
    for (const r of results) {
      if (!r) continue;
      const tmp = applySolved({ ...next, activeSlot: r.i }, r.params);
      next = this.solver.postSolve ? { ...this.solver.postSolve(tmp), activeSlot: doc.activeSlot } : { ...tmp, activeSlot: doc.activeSlot };
    }
    if (next !== doc) this.store.amendDoc(next);
  }

  // ---- glyph slots
  setActiveSlot(i: number) {
    const doc = this.store.doc;
    if (i === doc.activeSlot || i < 0 || i >= doc.slots.length) return;
    this.tool.cancel();
    this.store.amendDoc({ ...doc, activeSlot: i });
    this.store.set({ selection: [], hover: null, contextBar: null });
    this.afterChange();
    this.zoomToFit();
  }
  addSlot() {
    const doc = this.store.doc;
    const id = `s${doc.nextId}`;
    const s = createSketch(id, `Glyph${doc.slots.length + 1}`);
    s.advance = doc.slots[doc.activeSlot]?.advance ?? 600;
    // New slots get the metric guides when the current one has them.
    let next: Doc = { ...doc, nextId: doc.nextId + 1, slots: [...doc.slots, s], activeSlot: doc.slots.length };
    if (Object.values(doc.slots[doc.activeSlot].entities).some((e) => e.type === "line" && e.guide)) next = applyCommand(next, (ed) => addGuides(ed));
    this.commitDoc(refreshExpressions(next), "Add Glyph");
    this.store.set({ selection: [] });
  }
  renameSlot(i: number, name: string) {
    const doc = this.store.doc;
    if (!name.trim() || doc.slots[i]?.name === name) return;
    this.commitDoc({ ...doc, slots: doc.slots.map((s, k) => (k === i ? { ...s, name: name.trim() } : s)) }, "Rename Glyph");
  }
  deleteSlot(i: number) {
    const doc = this.store.doc;
    if (doc.slots.length <= 1) return this.flash("A file needs at least one sketch", "error");
    const slots = doc.slots.filter((_, k) => k !== i);
    this.commitDoc({ ...doc, slots, activeSlot: Math.min(doc.activeSlot >= i ? Math.max(0, doc.activeSlot - 1) : doc.activeSlot, slots.length - 1) }, "Delete Glyph");
  }
  setAdvance(v: number) {
    if (!(v > 0)) return;
    this.commit("Advance Width", (ed) => ed.setSketchField("advance", v));
    const refreshed = refreshExpressions(this.store.doc);
    if (refreshed !== this.store.doc) {
      this.store.amendDoc(refreshed);
      this.afterChange();
    }
  }

  // ---- metric guides
  hasGuides(): boolean {
    return Object.values(this.sketch().entities).some((e) => e.type === "line" && e.guide);
  }
  toggleGuides() {
    if (this.hasGuides()) {
      const ids = Object.values(this.sketch().entities)
        .filter((e) => e.type === "line" && e.guide)
        .map((e) => e.id);
      this.commit("Hide Metric Guides", (ed) => ed.deleteEntities(ids));
      return;
    }
    this.commit("Metric Guides", (ed) => addGuides(ed));
    const refreshed = refreshExpressions(this.store.doc);
    if (refreshed !== this.store.doc) {
      this.store.amendDoc(refreshed);
      this.afterChange();
    }
    this.flash("Metric guides are driven by the baseline, xheight, capheight, ascender and descender variables");
  }

  // ---- sketch picture
  async importPicture() {
    const f = await pickFile("image/png,image/jpeg");
    if (!f) return;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error);
      r.readAsDataURL(f);
    });
    const img = await loadImage(dataUrl);
    // Start at roughly the size of the current view.
    const b = this.view.visibleBox();
    const scale = ((b.maxX - b.minX) * 0.6) / img.naturalWidth;
    this.commit("Sketch Picture", (ed) =>
      ed.setSketchField("picture", { dataUrl, x: b.minX + (b.maxX - b.minX) * 0.2, y: b.minY + (b.maxY - b.minY) * 0.2, scale, opacity: 0.5 }),
    );
    this.flash("Picture added. Use Calibrate scale in the PropertyManager to set its size from a known feature");
  }
  setPicture(patch: Partial<NonNullable<Sketch["picture"]>> | null) {
    const pic = this.sketch().picture;
    if (patch === null) return void this.commit("Remove Picture", (ed) => ed.setSketchField("picture", undefined));
    if (!pic) return;
    this.commit("Edit Picture", (ed) => ed.setSketchField("picture", { ...pic, ...patch }));
  }
  private imageFor(url: string): HTMLImageElement | null {
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.onload = () => this.requestRender();
      img.src = url;
      this.images.set(url, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  // ---- export
  async exportSvgFile(opts: SvgOptions) {
    const svg = exportSvg(this.store.doc, opts);
    const base = opts.slots === "all" ? (this.store.state.fileName ?? "glyphs").replace(/(\.sketch)?\.json$/, "") : this.sketch().name;
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${base}.svg`);
  }
  async exportPngFile(size: number) {
    const blob = await exportPng(this.store.doc, size);
    downloadBlob(blob, `${this.sketch().name}.png`);
  }

  // ---- multi-step edits (Power Trim strokes): one undo step
  editBegin() {
    this.store.beginTransient();
  }
  editApply(fn: CommandFn) {
    const next = applyCommand(this.store.doc, fn);
    if (next !== this.store.doc) {
      this.store.updateTransient(next);
      this.solver.requestSolve();
    }
  }
  editEnd(label: string) {
    this.store.endTransient(label);
    this.afterChange();
  }
  get dynamicMirror(): Id | null {
    return this.store.state.dynamicMirror;
  }
  setDynamicMirror(axis: Id | null) {
    this.store.set({ dynamicMirror: axis });
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
    for (const e of Object.values(s.entities)) {
      if (e.id === "origin" || (e.type === "line" && e.guide)) continue;
      if (e.type === "point" && e.owner && (s.entities[e.owner] as { guide?: string } | undefined)?.guide) continue;
      for (const p of entitySamples(s, e)) boxAdd(b, p);
    }
    if (!boxValid(b)) {
      const m = guideMetrics(this.store.doc);
      if (m) {
        this.view.fit({ minX: 0, minY: m.bottom, maxX: s.advance, maxY: m.top });
        return this.requestRender();
      }
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
      if (pe.pointerType !== "mouse" && !this.store.state.touchUi) this.store.set({ touchUi: true });
      if (this.store.state.viewMode === "split" && pe.screen.x > this.view.width) return;
      if (pe.pointerType === "touch") return this.touchDown(e, pe);
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
      if (pe.pointerType === "touch") return this.touchMove(e, pe);
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
      if (pe.pointerType === "touch") return this.touchUp(e, pe);
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

  // ---- touch: one finger pans, two fingers pinch-zoom, two-finger tap undoes, long-press opens the menu
  private touchDown(e: PointerEvent, pe: PEvent) {
    this.touches.set(e.pointerId, { start: pe.screen, last: pe.screen, t0: performance.now() });
    clearTimeout(this.longPress);
    if (this.touches.size === 1) {
      this.longPress = window.setTimeout(() => {
        const t = this.touches.get(e.pointerId);
        if (!t || this.touches.size !== 1 || Math.hypot(t.last.x - t.start.x, t.last.y - t.start.y) > 10) return;
        const w = this.view.toWorld(t.last);
        const h = this.hit(w, "touch");
        if (h) {
          if (!this.store.state.selection.includes(h.id)) this.select([...this.store.state.selection, h.id]);
          this.showContextBar(t.last);
        } else this.store.set({ showShortcutBar: t.last });
      }, 500);
    } else if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinch = { dist: Math.hypot(a.last.x - b.last.x, a.last.y - b.last.y), mid: { x: (a.last.x + b.last.x) / 2, y: (a.last.y + b.last.y) / 2 }, moved: 0, t0: performance.now() };
    }
  }
  private touchMove(e: PointerEvent, pe: PEvent) {
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    const dx = pe.screen.x - t.last.x;
    const dy = pe.screen.y - t.last.y;
    t.last = pe.screen;
    if (this.touches.size === 1) {
      this.view.panBy(dx, dy);
      this.requestRender();
    } else if (this.touches.size === 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.last.x - b.last.x, a.last.y - b.last.y);
      const mid = { x: (a.last.x + b.last.x) / 2, y: (a.last.y + b.last.y) / 2 };
      this.view.panBy(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      if (this.pinch.dist > 0) this.view.zoomAt(mid, d / this.pinch.dist);
      this.pinch.moved += Math.abs(d - this.pinch.dist) + Math.hypot(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      this.pinch.dist = d;
      this.pinch.mid = mid;
      this.requestRender();
    }
  }
  private touchUp(e: PointerEvent, _pe: PEvent) {
    clearTimeout(this.longPress);
    this.touches.delete(e.pointerId);
    if (this.pinch && this.touches.size < 2) {
      const tap = performance.now() - this.pinch.t0 < 300 && this.pinch.moved < 12;
      this.pinch = null;
      if (tap) this.undo();
    }
  }

  onKeyDown(e: KeyboardEvent) {
    if (this.store.state.touchUi && e.key.length === 1) this.store.set({ touchUi: false }); // a keyboard is attached
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
      case "view:split": {
        this.store.set({ viewMode: action.slice(5) as "sketch" | "art" | "split" });
        this.layoutViews();
        return this.requestRender();
      }
      case "toggleGridSnap":
        return this.store.set({ gridSnap: !this.store.state.gridSnap });
      case "open":
        return void this.openFile();
      case "toggleGuides":
        return this.toggleGuides();
      case "combs":
        return this.store.set({ combs: !this.store.state.combs });
      case "toggleSlots":
        return this.store.set({ showSlots: !this.store.state.showSlots });
      case "hygiene": {
        const on = !this.store.state.hygiene;
        this.store.set({ hygiene: on });
        if (on) {
          const n = extremaWithoutPoints(this.sketch()).length;
          this.flash(n ? `${n} extrema without on-curve points (orange diamonds)` : "All curve extrema sit on on-curve points");
        }
        return;
      }
      case "picture":
        return void this.importPicture();
      case "exportSvg":
        return this.store.set({ panel: this.store.state.panel === "export" ? "auto" : "export" });
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
    const mode = this.store.state.viewMode;
    const s = this.sketch();
    ctx.setTransform(v.dpr, 0, 0, v.dpr, 0, 0);
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, v.width, v.height);
    ctx.clip();
    if (mode === "art") this.drawArt(ctx, v, s);
    else {
      ctx.fillStyle = theme.bg;
      ctx.fillRect(0, 0, v.width, v.height);
      const p = new Painter(ctx, v);
      const opts = this.sceneOptions();
      this.drawPicture(ctx, v, s);
      if (opts.showGrid) drawGrid(p);
      this.drawLayers(p, s, opts);
      this.tool.draw?.(p);
    }
    ctx.restore();
    if (mode === "split") {
      // Art preview on the right, fitted to the glyph.
      const art = new View();
      art.width = this.canvasW - v.width;
      art.height = v.height;
      art.dpr = v.dpr;
      const { o } = outlineOf(s, false);
      const b = outlineBounds(o);
      const m = guideMetrics(this.store.doc);
      if (m) art.fit({ minX: Math.min(0, boxValid(b) ? b.minX : 0), minY: m.bottom, maxX: Math.max(s.advance, boxValid(b) ? b.maxX : 0), maxY: m.top }, 30);
      else if (boxValid(b)) art.fit(b, 30);
      ctx.save();
      ctx.translate(v.width, 0);
      ctx.beginPath();
      ctx.rect(0, 0, art.width, art.height);
      ctx.clip();
      this.drawArt(ctx, art, s, v.width);
      ctx.restore();
      ctx.fillStyle = "#b9c3d2";
      ctx.fillRect(v.width - 0.5, 0, 1, v.height);
    }
  }

  /** Art view: black nonzero fills on white, no chrome. */
  private drawArt(ctx: CanvasRenderingContext2D, v: View, s: Sketch, offsetX = 0) {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, v.width, v.height);
    const { path } = outlineOf(s, false);
    ctx.save();
    const k = v.dpr;
    ctx.setTransform(k * v.scale, 0, 0, k * v.scale, k * (offsetX + v.width / 2 - v.cx * v.scale), k * (v.height / 2 + v.cy * v.scale));
    ctx.fillStyle = theme.fill;
    ctx.fill(path, "nonzero");
    ctx.restore();
  }

  private drawPicture(ctx: CanvasRenderingContext2D, v: View, s: Sketch) {
    const pic = s.picture;
    if (!pic) return;
    const img = this.imageFor(pic.dataUrl);
    if (!img) return;
    const tl = v.toScreen({ x: pic.x, y: pic.y + img.naturalHeight * pic.scale });
    ctx.save();
    ctx.globalAlpha = pic.opacity;
    ctx.drawImage(img, tl.x, tl.y, img.naturalWidth * pic.scale * v.scale, img.naturalHeight * pic.scale * v.scale);
    ctx.restore();
  }

  /** Overridable layer drawing (relations, dimensions, fills are added later). */
  drawLayers(p: Painter, s: Sketch, opts: SceneOptions) {
    // Fill preview and loop diagnostics (diagnostics are skipped while dragging to stay fast).
    const live = this.store.inTransient;
    const { o, path } = outlineOf(s, !live);
    fillOutline(p.ctx, p.view, path, "rgba(30,40,70,0.10)");
    if (this.store.state.combs) drawCurvatureCombs(p, s);
    drawSketch(p, s, opts);
    if (!live) drawDiagnostics(p, o);
    if (this.store.state.hygiene)
      for (const x of extremaWithoutPoints(s)) {
        const S = p.s(x.at);
        const c = p.ctx;
        c.fillStyle = theme.openEnd;
        c.beginPath();
        c.moveTo(S.x, S.y - 6);
        c.lineTo(S.x + 6, S.y);
        c.lineTo(S.x, S.y + 6);
        c.lineTo(S.x - 6, S.y);
        c.closePath();
        c.fill();
      }
    const conflicts = new Set(this.store.state.status.conflicts);
    const glyphs = drawRelationGlyphs(p, s, conflicts, this.store.state.hover, opts.selection);
    const sel = this.tools.get("select") as SelectTool;
    const dims = drawDimensions(p, s, { conflicts, hover: this.store.state.hover, selection: opts.selection, labelOffset: (id) => sel.dimOffset(id) });
    this.annotationHits = [...glyphs, ...dims];
  }
}
