import type { Vec2 } from "../geom/vec";
import { boxAdd, boxValid, emptyBox } from "../geom/vec";
import type { SnapOptions, SnapResult } from "../inference/snap";
import { snap } from "../inference/snap";
import { applyCommand } from "../model/editor";
import type { CommandFn } from "../model/editor";
import { activeSketch, featureIndex, ownSketch } from "../model/sketch";
import type { Doc, Id, Sketch } from "../model/types";
import { addFeature, deleteFeature, moveFeature, renameFeature, setActive, setVisible } from "../model/features";
import { docOutline } from "../model/outline";
import { loopsToPathData } from "../io/svg";
import { artBackground, artDefaults, artScene, chainsFor, chainStyle, docChains, hitChain, samplePolyline, setArtBackground, setArtDefaults, setChainStyle } from "../model/art";
import {
  addFilament,
  disablePrint,
  enablePrint,
  linesFor,
  moveFilament,
  removeFilament,
  setBaseFilament,
  setInkFilament,
  setPartOutline,
  setPrinter,
  setPrintView,
  snapWeight,
  updateFilament,
} from "../model/print";
import type { PrintChange } from "../model/print";
import type { Filament, PrinterProfile, PrintSettings } from "../model/types";
import { buildRegions, checkRules, components, boundsOf, firstLayer, pathData } from "../model/regions";
import { PrintGuard } from "./printGuard";
import { printFiles, zip } from "../io/printExport";
import type { Chain, StylePatch } from "../model/art";
import { paintArt } from "../render/artPaint";
import { ArtSelectTool } from "../tools/artSelect";
import type { ArtHost } from "../tools/artSelect";
import { entitySamples, hitTest } from "../render/hit";
import type { Hit } from "../render/hit";
import { Painter } from "../render/painter";
import { drawGrid, drawSketch, gridStep } from "../render/renderer";
import type { SceneOptions } from "../render/renderer";
import { hellShades, setCanvasTheme, theme } from "../render/theme";
import type { HellAccent } from "../render/theme";
import type { ThemeName } from "../render/theme";
import { View } from "../render/view";
import type { DragTarget } from "../solver/types";
import { LineTool } from "../tools/line";
import { DimensionTool } from "../tools/dimension";
import { TangentArcTool } from "../tools/tangentArc";
import { DynamicMirrorTool, ExtendTool, FilletTool, MirrorTool, OffsetTool, SplineTool, TrimTool } from "../tools/modify";
import { convertEntities, mirrorEntities, recomputeDerived } from "../tools/edits";
import { ConvertTool } from "../tools/convert";
import { RepairTool } from "../tools/repair";
import { loadKeymap } from "./keymap";
import { isHellNumber, isHellUnlocked, loadHellAccent, loadThemePref, nextTheme, resolveTheme, saveHellAccent, saveThemePref, unlockHell } from "./themePref";
import type { ThemePref } from "./themePref";
import { drawDimensions } from "../render/dimensions";
import { evaluateDimText, labelPos, measure, refreshExpressions } from "../model/dimensions";
import { fmt } from "../tools/line";
import type { ArtDefaults, Dimension, Variable } from "../model/types";
import { isExpression } from "../model/expr";
import { drawDiagnostics, fillOutline, outlineOf } from "../render/art";
import { exportSvg, exportPng } from "../io/svg";
import type { SvgOptions } from "../io/svg";
import { downloadBlob, pickFile } from "../io/storage";
import { PictureScaleTool } from "../tools/picture";
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

/** Browser chrome color (meta theme-color) per theme: the toolbar color. */
const chromeColor: Record<ThemeName, string> = { light: "#eeebe4", dark: "#141414", hell: "#000000" };

/** Commands whose new entities Dynamic Mirror copies. */
const DRAW_COMMANDS = new Set(["Line", "Centerline", "Arc", "Tangent Arc", "Circle", "Point", "Style Spline", "Rectangle"]);

export class App implements ToolHost, ArtHost {
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
  /** Print mode: keeps every edit printable. */
  readonly guard: PrintGuard;
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
  private longPressFired = false;
  private pendingTouch: { id: number; pe: PEvent } | null = null;
  private pendingTimer: number | undefined;
  private drawingTouch: number | null = null;
  private afterPinch = false;
  private lastTap: { t: number; at: Vec2 } | null = null;
  /** The Apple Pencil (or other pen) currently pressed, and when a pen was last seen (pressed or hovering). */
  private penDown: number | null = null;
  private penSeenAt = -Infinity;
  /** Touches dropped as a resting palm; they stay ignored until lifted. */
  private ignoredTouches = new Set<number>();
  /** Last tool other than Select, resumed by the on-screen Draw toggle. */
  private lastDrawTool = "line";
  /** Status bar cursor readout hook. */
  onCursor: ((p: Vec2) => void) | null = null;
  /** Pointer handling over the Art view (full canvas, or the right pane in split view). */
  private artTool = new ArtSelectTool(this);
  /** The split view's art pane as last drawn (it is fitted to the drawing every frame). */
  private artPane: View | null = null;
  /** Whichever of the active tool or the art tool took the current press. */
  private pressInput: Tool | null = null;

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
    reg(new ConvertTool(this));
    reg(new RepairTool(this));
    this.solver.postSolve = (doc, featureId) => applyCommand(doc, recomputeDerived, featureId);
    this.guard = new PrintGuard(this.store, this.solver);
    this.solver.onSettled = (doc) => this.guard.onSettled(doc);
    this.solver.dragFilter = (doc) => this.guard.filterDrag(doc);
    this.tool = this.tools.get("select")!;
    this.store.subscribe(() => this.requestRender());
    this.darkQuery?.addEventListener?.("change", () => this.setThemePref(this.store.state.themePref, false));
    this.store.set({ hellUnlocked: isHellUnlocked(), hellAccent: loadHellAccent() });
    this.setThemePref(loadThemePref(), false);
    // Canvas text uses the theme fonts; draw again once they arrive.
    if (typeof document !== "undefined") document.fonts?.addEventListener?.("loadingdone", () => this.requestRender());
  }

  // ------------------------------------------------------------------ theme
  private darkQuery = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;

  /** Apply a light/dark choice to the interface (data-theme on <html>) and the canvas palette. */
  setThemePref(pref: ThemePref, save = true) {
    if (save) saveThemePref(pref);
    const name = resolveTheme(pref, !!this.darkQuery?.matches);
    setCanvasTheme(name, this.store.state.hellAccent);
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = name;
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", chromeColor[name]);
      this.applyHellAccentCss();
    }
    this.store.set({ themePref: pref, theme: name });
  }

  /** Pick the HELL MODE color (red, green, pink, ...). */
  setHellAccent(accent: HellAccent) {
    saveHellAccent(accent);
    this.store.set({ hellAccent: accent });
    setCanvasTheme(this.store.state.theme, accent);
    this.applyHellAccentCss();
    this.requestRender();
  }
  /** The interface reads the accent through --hell* variables (global.css). */
  private applyHellAccentCss() {
    if (typeof document === "undefined") return;
    const sh = hellShades(this.store.state.hellAccent);
    const st = document.documentElement.style;
    const vars: Record<string, string> = { "--hell": sh.main, "--hell-dim": sh.dim, "--hell-edge": sh.edge, "--hell-edge-soft": sh.edgeSoft, "--hell-deep": sh.deep, "--hell-deeper": sh.deeper };
    for (const [k, v] of Object.entries(vars)) st.setProperty(k, v);
  }

  /** Setting a dimension to 666 the first time unlocks HELL MODE and switches to it. */
  private maybeUnlockHell(value: number) {
    if (!isHellNumber(value) || this.store.state.hellUnlocked) return;
    unlockHell();
    this.store.set({ hellUnlocked: true });
    this.setThemePref("hell");
    this.flash("HELL MODE. Leave it with the theme button or the command box");
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
  /** Snap distance to existing points: bigger than tol for a finger or pen, so end points are easy to hit. */
  pointTol(pointerType?: string): number {
    const px = pointerType === "touch" ? 36 : pointerType === "pen" ? 16 : 8;
    return this.view.px(px);
  }
  snap(raw: Vec2, opts?: Partial<SnapOptions>): SnapResult {
    return snap(this.sketch(), raw, {
      tol: this.tol(this.lastPointer?.pointerType),
      pointTol: this.pointTol(this.lastPointer?.pointerType),
      gridStep: this.store.state.gridSnap ? gridStep(this.view) : undefined,
      ...opts,
    });
  }
  hit(world: Vec2, pointerType?: string, opts?: { skip?: Set<Id>; points?: boolean; curves?: boolean; own?: boolean }): Hit | null {
    const s = this.sketch();
    return hitTest(s, world, this.tol(pointerType), opts?.skip, (e) =>
      opts?.own && s.ext?.[e.id] ? false : e.type === "point" ? opts?.points !== false : opts?.curves !== false,
    );
  }
  /** Name of the sketch an entity of the working view belongs to, when it is borrowed. */
  extFeatureName(id: Id): string | null {
    const ref = this.sketch().ext?.[id];
    return ref ? (this.store.doc.features.find((f) => f.id === ref.feature)?.name ?? null) : null;
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
    if (id !== "select") this.lastDrawTool = id;
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
    // Between earlier sketches' geometry only: it can measure, not drive.
    const ext = this.sketch().ext;
    if (ext && draft.refs.every((r) => ext[r] || r === "origin")) draft = { ...draft, driven: true };
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
      const before = this.store.doc;
      if (before.print && Math.abs(d.value - value) > 1e-12) {
        const unit = d.type === "angle" ? "°" : " mm";
        this.guard.expectValue({
          from: d.value,
          to: value,
          apply: (v) => applyCommand(before, (ed) => ed.updateDimension(id, { expr: fmt(v), value: v })),
          show: (v) => `${fmt(v)}${unit}`,
        });
      }
      this.commit("Edit Dimension", (ed) => ed.updateDimension(id, { expr, value }));
      this.maybeUnlockHell(value);
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }

  setDimensionDriven(id: Id, driven: boolean) {
    const s = this.sketch();
    const d = s.dimensions[id];
    if (!d || d.driven === driven) return;
    if (!driven && d.refs.every((r) => s.ext?.[r] || r === "origin"))
      return this.flash("This dimension only measures other sketches' geometry, so it cannot drive it", "error");
    const value = Math.abs(measure(s, d));
    this.commit(driven ? "Make Driven" : "Make Driving", (ed) =>
      ed.updateDimension(id, driven ? { driven } : { driven, value, expr: isExpression(d.expr) ? d.expr : fmt(value) }),
    );
  }

  /** Rename a variable and every reference to it (dimensions and other variables). */
  renameVariable(from: string, to: string) {
    if (this.store.doc.variables.some((v) => v.locked && v.name === from)) return this.flash(`${from} follows the printer profile and cannot be renamed`, "error");
    const re = new RegExp(`\\b${from}\\b`, "g");
    const doc = this.store.doc;
    const features = doc.features.map((f) => {
      const dims = { ...f.sketch.dimensions };
      let hit = false;
      for (const d of Object.values(dims)) {
        re.lastIndex = 0;
        if (re.test(d.expr)) {
          re.lastIndex = 0;
          dims[d.id] = { ...d, expr: d.expr.replace(re, to) };
          hit = true;
        }
      }
      return hit ? { ...f, sketch: { ...f.sketch, dimensions: dims } } : f;
    });
    const next: Doc = {
      ...doc,
      variables: doc.variables.map((v) => ({ ...v, name: v.name === from ? to : v.name, expr: v.expr.replace(re, to) })),
      features,
    };
    this.commitDoc(refreshExpressions(next), "Rename Variable");
  }

  /** Replace the global variables and re-evaluate every expression that uses them. */
  setVariables(vars: Variable[]) {
    const before = this.store.doc;
    // Print mode's own variables follow the printer; they cannot be edited or deleted here.
    const locked = before.variables.filter((v) => v.locked);
    vars = [...locked, ...vars.filter((v) => !locked.some((l) => l.name === v.name))];
    if (before.print) {
      const changed = vars.filter((v) => before.variables.some((o) => o.name === v.name && o.expr !== v.expr));
      const old = changed.length === 1 && vars.length === before.variables.length ? before.variables.find((o) => o.name === changed[0].name)! : null;
      const to = old && !isExpression(changed[0].expr) ? Number(changed[0].expr) : NaN;
      if (old && Number.isFinite(to) && Math.abs(to - old.value) > 1e-12) {
        const name = old.name;
        this.guard.expectValue({
          from: old.value,
          to,
          apply: (v) => refreshExpressions({ ...before, variables: before.variables.map((x) => (x.name === name ? { ...x, expr: fmt(v), value: v } : x)) }),
          show: (v) => `${name} = ${fmt(v)}`,
        });
      }
    }
    this.commit("Edit Variables", (ed) => ed.setVariables(vars));
    const refreshed = refreshExpressions(this.store.doc);
    if (refreshed !== this.store.doc) {
      this.store.amendDoc(refreshed);
      this.afterChange();
    }
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
      ed.setPicture({ dataUrl, x: b.minX + (b.maxX - b.minX) * 0.2, y: b.minY + (b.maxY - b.minY) * 0.2, scale, opacity: 0.5 }),
    );
    this.flash("Picture added. Use Calibrate scale in the PropertyManager to set its size from a known feature");
  }
  setPicture(patch: Partial<NonNullable<Sketch["picture"]>> | null) {
    const pic = this.sketch().picture;
    if (patch === null) return void this.commit("Remove Picture", (ed) => ed.setPicture(undefined));
    if (!pic) return;
    this.commit("Edit Picture", (ed) => ed.setPicture({ ...pic, ...patch }));
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
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), `${this.baseName()}.svg`);
  }
  async exportPngFile(size: number) {
    const blob = await exportPng(this.store.doc, size);
    downloadBlob(blob, `${this.baseName()}.png`);
  }
  private baseName() {
    return (this.store.state.fileName ?? "sketch").replace(/(\.sketch)?\.json$/, "");
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
    const sel = this.store.state.selection.filter((id) => (s.entities[id] && !s.ext?.[id]?.hidden) || s.relations[id] || s.dimensions[id]);
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
    // Art view hides the sketch, so a sketch selection there is not what the user is looking at.
    if (!sel.length || this.store.state.viewMode === "art") return;
    const s = this.sketch();
    if (sel.every((id) => s.ext?.[id])) return this.flash(`That belongs to ${this.extFeatureName(sel[0])}. Edit that sketch to change it`, "error");
    this.commit("Delete", (ed) => ed.deleteAny(sel));
    this.store.set({ selection: [], hover: null, contextBar: null });
  }

  toggleConstruction() {
    const s = this.sketch();
    const ids = this.store.state.selection.filter((id) => s.entities[id] && s.entities[id].type !== "point" && !s.ext?.[id]);
    if (!ids.length) return this.flash("Select sketch entities to toggle construction");
    const on = !ids.every((id) => s.entities[id].construction);
    this.commit("For construction", (ed) => {
      for (const id of ids) ed.update(id, { construction: on || undefined });
    });
  }

  zoomToFit() {
    const b = emptyBox();
    const doc = this.store.doc;
    for (const f of doc.features) {
      if (!f.visible && f.id !== doc.active) continue;
      const s = f.sketch;
      for (const e of Object.values(s.entities)) {
        if (e.id === "origin") continue;
        for (const p of entitySamples(s, e)) boxAdd(b, p);
      }
    }
    if (!boxValid(b)) {
      this.view.cx = 0;
      this.view.cy = 0;
      this.view.scale = 1;
    } else this.view.fit(b);
    this.requestRender();
  }

  // ---- Convert Entities and dangling-reference repair
  /** Convert Entities: copy earlier sketches' geometry into this sketch, linked (On Edge). */
  convertIds(ids: Id[]) {
    const s = this.sketch();
    // A picked endpoint or control vertex stands for its curve.
    const targets = Array.from(
      new Set(
        ids.map((id) => {
          const e = s.entities[id];
          return e?.type === "point" && e.owner && s.entities[e.owner] ? e.owner : id;
        }),
      ),
    ).filter((id) => s.ext?.[id]);
    if (!targets.length) return this.flash("Pick geometry of an earlier sketch to convert", "error");
    let res: { created: Id[]; message?: string } = { created: [] };
    this.commit("Convert Entities", (ed) => (res = convertEntities(ed, targets)));
    if (res.message) this.flash(res.message, res.created.length ? "info" : "error");
    else {
      const n = res.created.length;
      this.flash(`Converted ${n === 1 ? "1 entity. It follows" : `${n} entities. They follow`} ${this.extFeatureName(targets[0])} (On Edge)`);
    }
    this.store.set({ selection: res.created, contextBar: null });
  }
  /** Convert the selected earlier geometry, or start picking it. */
  convertCommand() {
    const s = this.sketch();
    const sel = this.store.state.selection.filter((id) => s.ext?.[id]);
    if (sel.length) return this.convertIds(sel);
    if (!s.ext || !Object.values(s.ext).some((x) => !x.hidden)) return this.flash("Convert Entities copies geometry of an earlier sketch. Add a sketch below this one first", "error");
    this.setTool("convert");
  }
  /** Pick replacement geometry for the missing references of a dangling relation or dimension. */
  startRepair(itemId: Id) {
    const t = this.tools.get("repair") as RepairTool;
    this.setTool("select");
    t.start(itemId);
    this.setTool("repair");
  }

  // ------------------------------------------------------------------ feature tree
  /** Leave the current sketch cleanly (tool, selection, open boxes) before switching. */
  private leaveSketch() {
    this.tool.cancel();
    if (this.tool.id !== "select") this.setTool("select");
    this.store.set({ selection: [], hover: null, contextBar: null, modify: null, showShortcutBar: null, dynamicMirror: null });
  }
  /** Add a sketch at the end of the tree and start editing it. */
  newSketch() {
    this.leaveSketch();
    const next = addFeature(this.store.doc);
    this.commitDoc(next, "New Sketch");
    this.flash(`Editing ${next.features[next.features.length - 1].name}. Earlier sketches can be referenced but not changed from here`);
  }
  /** Edit another sketch. Not an undo step of its own: undo returns to the sketch a change was made in. */
  activateSketch(id: Id) {
    const doc = this.store.doc;
    if (doc.active === id || this.store.inTransient) return;
    this.leaveSketch();
    this.store.amendDoc(setActive(doc, id));
    this.afterChange();
  }
  renameSketch(id: Id, name: string) {
    this.commitDoc(renameFeature(this.store.doc, id, name), "Rename Sketch");
  }
  setSketchVisible(id: Id, visible: boolean) {
    this.commitDoc(setVisible(this.store.doc, id, visible), visible ? "Show Sketch" : "Hide Sketch");
    if (!visible) this.pruneSelection();
  }
  /** Delete a sketch. With `removeRefs`, other sketches' references to it are removed in the same step. */
  deleteSketch(id: Id, removeRefs = false) {
    const r = deleteFeature(this.store.doc, id, removeRefs);
    if (typeof r === "string") return this.flash(r, "error");
    if (r.active !== this.store.doc.active) this.leaveSketch();
    this.commitDoc(r, "Delete Sketch");
  }
  /** Move a sketch up or down. With `removeRefs`, references the move would break are removed in the same step. */
  moveSketch(id: Id, dir: -1 | 1, removeRefs = false) {
    const r = moveFeature(this.store.doc, id, dir, removeRefs);
    if (typeof r === "string") return this.flash(r, "error");
    this.leaveSketch();
    this.commitDoc(r, "Reorder Sketches");
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
      try {
        c.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone */
      }
      const pe = this.toEvent(e);
      this.lastPointer = pe;
      if (pe.pointerType !== "mouse" && !this.store.state.touchUi) this.store.set({ touchUi: true });
      if (pe.pointerType === "touch") return this.touchDown(e, pe);
      if (pe.pointerType === "pen") this.penPressed(e.pointerId);
      if (e.button === 1 || (e.button === 0 && e.altKey && pe.pointerType === "mouse")) {
        this.panning = { last: pe.screen };
        e.preventDefault();
        return;
      }
      if (e.button === 2) return;
      this.store.set({ showShortcutBar: null });
      this.pressDown(pe);
    });
    c.addEventListener("pointermove", (e) => {
      const pe = this.toEvent(e);
      this.lastPointer = pe;
      if (pe.pointerType === "touch") return this.touchMove(e, pe);
      if (pe.pointerType === "pen") this.penSeenAt = performance.now();
      if (this.panning) {
        this.view.panBy(pe.screen.x - this.panning.last.x, pe.screen.y - this.panning.last.y);
        this.panning.last = pe.screen;
        this.requestRender();
        return;
      }
      this.onCursor?.(pe.world);
      this.pressMove(pe);
    });
    const up = (e: PointerEvent) => {
      const pe = this.toEvent(e);
      if (pe.pointerType === "touch") return this.touchUp(e, pe);
      if (pe.pointerType === "pen" && this.penDown === e.pointerId) {
        this.penDown = null;
        this.penSeenAt = performance.now();
      }
      if (this.panning) {
        this.panning = null;
        return;
      }
      if (e.button === 2) return;
      this.pressUp(pe);
    };
    c.addEventListener("pointerup", up);
    c.addEventListener("pointercancel", up);
    c.addEventListener("dblclick", (e) => {
      const pe = this.toEvent(e);
      if (!this.overArt(pe)) this.tool.onDoubleClick?.(pe);
    });
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
    c.addEventListener("pointerleave", () => {
      this.setHover(null);
      this.setArtHover(null);
    });
    window.addEventListener("keydown", (e) => this.onKeyDown(e));
    window.addEventListener("keyup", (e) => {
      if (e.key === "Control" || e.key === "Meta") this.store.set({ ctrl: false });
    });
    window.addEventListener("blur", () => this.store.set({ ctrl: false }));
  }

  // ---- routing between the sketch tools and the Art view
  /** The pointer is over Art view (the whole canvas, or the right pane of split view). */
  private overArt(pe: PEvent): boolean {
    const mode = this.store.state.viewMode;
    return mode === "art" || mode === "print" || (mode === "split" && pe.screen.x > this.view.width);
  }
  private pressDown(pe: PEvent) {
    const art = this.overArt(pe);
    // Working in the sketch pane of split view drops the art selection, so the PropertyManager follows.
    if (!art && this.store.state.artSelection.length) this.store.set({ artSelection: [] });
    this.pressInput = art ? this.artTool : this.tool;
    this.pressInput.onDown(pe);
  }
  private pressMove(pe: PEvent) {
    const art = this.overArt(pe);
    if (!this.pressInput && !art) this.setArtHover(null);
    (this.pressInput ?? (art ? this.artTool : this.tool)).onMove(pe);
  }
  private pressUp(pe: PEvent) {
    const t = this.pressInput ?? (this.overArt(pe) ? this.artTool : this.tool);
    this.pressInput = null;
    t.onUp(pe);
  }
  private pressCancel() {
    (this.pressInput ?? this.tool).cancel();
    this.pressInput = null;
  }

  // ---- Art view (ArtHost)
  /** The view and local screen point for a pointer over Art view. */
  private artViewAt(pe: PEvent): { v: View; screen: Vec2 } {
    if (this.store.state.viewMode === "split" && this.artPane) return { v: this.artPane, screen: { x: pe.screen.x - this.view.width, y: pe.screen.y } };
    return { v: this.view, screen: pe.screen };
  }
  artPick(pe: PEvent): Id | null {
    const { v, screen } = this.artViewAt(pe);
    const doc = this.store.doc;
    const scene = artScene(doc, v.px(0.3));
    const world = v.toWorld(screen);
    const m = this.store.state.viewMode === "print" ? this.printMirror(doc) : undefined;
    if (m !== undefined) world.x = 2 * m - world.x;
    return hitChain(scene, world, this.tol(pe.pointerType) * (this.view.scale / v.scale))?.key ?? null;
  }
  artSelection(): Id[] {
    return this.store.state.artSelection;
  }
  setArtSelection(ids: Id[]) {
    this.store.set({ artSelection: ids });
  }
  setArtHover(id: Id | null) {
    if (this.store.state.artHover !== id) this.store.set({ artHover: id });
  }
  artPan(_pe: PEvent, dx: number, dy: number) {
    if (this.store.state.viewMode !== "art" && this.store.state.viewMode !== "print") return; // the split pane is fitted automatically
    this.view.panBy(dx, dy);
    this.requestRender();
  }
  /** Chains selected in Art view. */
  selectedChains(): Chain[] {
    return chainsFor(docChains(this.store.doc), this.store.state.artSelection);
  }
  selectAllChains() {
    this.setArtSelection(docChains(this.store.doc).map((c) => c.key));
  }
  setArtDefaults(patch: Partial<ArtDefaults>) {
    const doc = this.store.doc;
    if (doc.print && typeof patch.weight === "number") this.expectWeight(artDefaults(doc).weight, patch.weight, (v) => setArtDefaults(doc, { ...patch, weight: v }));
    this.commitDoc(setArtDefaults(doc, patch), "Art Defaults");
  }
  /** Print mode: a typed stroke width is rounded to whole lines and may be pulled back to one that prints. */
  private expectWeight(from: number, typed: number, apply: (v: number) => Doc) {
    const doc = this.store.doc;
    const p = doc.print!.printer;
    const to = snapWeight(doc, typed);
    const show = (v: number) => `${linesFor(p, v)} lines (${fmt(v)} mm)`;
    if (Math.abs(to - typed) > 1e-9) this.guard.notify({ kind: "adjusted", text: `Width set to ${show(to)}: widths are whole ${p.lineWidth} mm lines, at least ${p.minFeatureLines}` });
    if (Math.abs(to - from) > 1e-9) this.guard.expectValue({ from, to, step: p.lineWidth, apply, show, noSolve: true });
  }
  setArtBackground(color: string) {
    this.commitDoc(setArtBackground(this.store.doc, color), "Art Background");
  }
  setArtWeight(weight: number) {
    this.setArtDefaults({ weight });
  }
  setChainStyle(chains: Chain[], patch: StylePatch) {
    const doc = this.store.doc;
    if (doc.print && typeof patch.weight === "number" && chains.length)
      this.expectWeight(chainStyle(doc, chains[0]).weight, patch.weight, (v) => setChainStyle(doc, chains, { ...patch, weight: v }));
    const label =
      patch.filament !== undefined ? "Filament"
      : patch.fill !== undefined ? (patch.fill ? "Fill Profile" : "Unfill Profile")
      : patch.side ? "Line Side"
      : patch.color !== undefined ? "Line Color"
      : patch.corner !== undefined ? "Corner Radius"
      : patch.roundEnds !== undefined ? "Line Ends"
      : "Line Weight";
    this.commitDoc(setChainStyle(doc, chains, patch), label);
  }

  // ------------------------------------------------------------------ Print mode
  private printNotes(r: PrintChange) {
    if (r.notes.length) this.guard.notify({ kind: "info", text: r.notes.join(". ") });
  }
  enablePrint() {
    const doc = this.store.doc;
    const colors = docChains(doc).map((c) => chainStyle(doc, c).color);
    const r = enablePrint(doc, { background: artBackground(doc), colors });
    if ("error" in r) return this.flash(r.error, "error");
    this.guard.trust();
    this.commitDoc(r.doc, "Print Mode On");
    this.printNotes(r);
    if (this.store.state.viewMode !== "print") this.runAction("view:print");
  }
  disablePrint() {
    this.guard.trust();
    this.commitDoc(disablePrint(this.store.doc), "Print Mode Off");
  }
  setPrinter(patch: Partial<PrinterProfile>) {
    const r = setPrinter(this.store.doc, patch);
    this.guard.trust();
    this.commitDoc(r.doc, "Printer");
    this.printNotes(r);
  }
  addFilament(color?: string) {
    const r = addFilament(this.store.doc, color);
    if (r.error) return this.flash(r.error, "error");
    this.commitDoc(r.doc!, "Add Filament");
  }
  updateFilament(id: string, patch: Partial<Pick<Filament, "name" | "color">>) {
    this.commitDoc(updateFilament(this.store.doc, id, patch), "Filament");
  }
  moveFilament(id: string, by: -1 | 1) {
    this.commitDoc(moveFilament(this.store.doc, id, by), "Print Order");
  }
  removeFilament(id: string, into: string) {
    const r = removeFilament(this.store.doc, id, into);
    if (r.error) return this.flash(r.error, "error");
    this.commitDoc(r.doc!, "Remove Filament");
  }
  setBaseFilament(id: string) {
    this.commitDoc(setBaseFilament(this.store.doc, id), "Base Filament");
  }
  setInkFilament(id: string) {
    this.commitDoc(setInkFilament(this.store.doc, id), "Default Filament");
  }
  setPartOutline(key: Id | undefined) {
    this.commitDoc(setPartOutline(this.store.doc, key), "Part Outline");
  }
  /** Preview choices are not undo steps. */
  setPrintView(patch: Pick<Partial<PrintSettings>, "preview" | "side">) {
    this.store.amendDoc(setPrintView(this.store.doc, patch));
    this.scheduleAutosave();
  }
  /**
   * Export one DXF and SVG per filament, the outline and a README: into a folder you pick where the
   * browser allows it, otherwise as one zip download.
   */
  async exportPrint() {
    const base = this.baseName();
    const r = printFiles(this.store.doc, base);
    if ("error" in r) return this.flash(r.error, "error");
    const picker = (window as any).showDirectoryPicker as undefined | ((o?: object) => Promise<any>);
    if (picker) {
      try {
        const dir = await picker({ mode: "readwrite", id: "sketchworx-print" });
        for (const f of r.files) {
          const h = await dir.getFileHandle(f.name, { create: true });
          const w = await h.createWritable();
          await w.write(f.text);
          await w.close();
        }
        return this.flash(`Saved ${r.files.length} files to ${dir.name}`);
      } catch (e: any) {
        if (e?.name === "AbortError") return;
        // Folder access refused: fall back to the zip.
      }
    }
    downloadBlob(new Blob([zip(r.files)], { type: "application/zip" }), `${base}-print.zip`);
    this.flash(`Downloaded ${base}-print.zip (${r.files.length} files)`);
  }
  /** Zoom to a notice's spot. */
  showSpot(at: Vec2) {
    const doc = this.store.doc;
    const m = this.printMirror(doc);
    const x = m === undefined || this.store.state.viewMode !== "print" ? at.x : 2 * m - at.x;
    this.view.cx = x;
    this.view.cy = at.y;
    this.view.scale = Math.max(this.view.scale, 40);
    this.requestRender();
  }
  /** Print view: x about which the As printed preview is mirrored (bed side), if it is. */
  printMirror(doc: Doc): number | undefined {
    const pr = doc.print;
    if (!pr || pr.preview === "drawn" || pr.side === "top") return undefined;
    const b = buildRegions(doc).bounds;
    return boxValid(b) ? (b.minX + b.maxX) / 2 : undefined;
  }

  // ---- pen
  // Once a pen has been used, fingers no longer draw or select (the palm rests on the screen while
  // writing): two fingers still pan, pinch-zoom and tap-undo. While the pen is down, or just lifted
  // or hovering, every touch is treated as the palm and ignored. The status bar flag switches to
  // Pencil + fingers: the pencil only draws and one finger only selects.
  private penPressed(id: number) {
    // Pencil + fingers: the pencil only draws, so it picks the drawing tool back up.
    if (this.fingersSelect() && this.tool.id === "select") this.setTool(this.lastDrawTool);
    this.penDown = id;
    this.penSeenAt = performance.now();
    if (!this.store.state.penSeen) this.store.set({ penSeen: true, pencilOnly: true });
    // A palm that landed first may already be pinching or drawing: drop it.
    clearTimeout(this.longPress);
    clearTimeout(this.pendingTimer);
    this.pendingTouch = null;
    if (this.drawingTouch !== null) {
      this.pressCancel();
      this.drawingTouch = null;
    }
    this.pinch = null;
    for (const t of this.touches.keys()) this.ignoredTouches.add(t);
    this.touches.clear();
  }
  /** A touch that is a palm next to the pen, rather than a finger gesture. */
  private isPalm(e: PointerEvent): boolean {
    if (!this.store.state.pencilOnly) return false;
    if (this.penDown !== null || performance.now() - this.penSeenAt < 500) return true;
    return Math.max(e.width || 0, e.height || 0) > 60; // a broad contact patch
  }
  togglePencilOnly() {
    const on = !this.store.state.pencilOnly;
    this.store.set({ pencilOnly: on });
    this.flash(on ? "Pencil draws and selects; fingers pan and zoom" : "Pencil draws; finger selects");
  }
  /** Pencil + fingers mode: the pencil only draws and one finger only selects. */
  private fingersSelect(): boolean {
    return this.store.state.penSeen && !this.store.state.pencilOnly;
  }
  /** A single finger is about to act: in Pencil + fingers mode it always selects. */
  private fingerToSelect() {
    if (this.fingersSelect() && this.tool.id !== "select") this.setTool("select");
  }

  // ---- touch
  // One finger always drives the active tool: Select (tap selects, drag moves or box-selects) or a
  // drawing tool. It never pans; two fingers pan + pinch-zoom, and a quick two-finger tap undoes.
  // Long-press (Select only) opens the context toolbar or shortcut bar.
  private touchDown(e: PointerEvent, pe: PEvent) {
    if (this.isPalm(e)) {
      this.ignoredTouches.add(e.pointerId);
      return;
    }
    this.touches.set(e.pointerId, { start: pe.screen, last: pe.screen, t0: performance.now() });
    clearTimeout(this.longPress);
    clearTimeout(this.pendingTimer);
    if (this.touches.size === 1) {
      this.afterPinch = false;
      this.longPressFired = false;
      if (this.store.state.pencilOnly) return; // one finger does nothing: wait for a second one
      // Hold the touch back briefly: a second finger turns it into a pinch instead.
      this.pendingTouch = { id: e.pointerId, pe };
      this.pendingTimer = window.setTimeout(() => this.flushPendingTouch(), 150);
      if ((this.tool.id === "select" || this.fingersSelect()) && !this.overArt(pe)) {
        this.longPress = window.setTimeout(() => {
          const t = this.touches.get(e.pointerId);
          if (!t || this.touches.size !== 1 || Math.hypot(t.last.x - t.start.x, t.last.y - t.start.y) > 10) return;
          this.longPressFired = true;
          if (this.drawingTouch !== null) {
            this.pressCancel();
            this.drawingTouch = null;
          }
          this.pendingTouch = null;
          this.fingerToSelect();
          const h = this.hit(this.view.toWorld(t.last), "touch");
          if (h) {
            if (!this.store.state.selection.includes(h.id)) this.select([...this.store.state.selection, h.id]);
            this.showContextBar(t.last);
          } else this.store.set({ showShortcutBar: t.last });
        }, 500);
      }
    } else if (this.touches.size === 2) {
      // Second finger: abandon any single-finger action and start pinch/pan.
      this.pendingTouch = null;
      if (this.drawingTouch !== null) {
        this.pressCancel();
        this.drawingTouch = null;
      }
      const [a, b] = [...this.touches.values()];
      this.pinch = { dist: Math.hypot(a.last.x - b.last.x, a.last.y - b.last.y), mid: { x: (a.last.x + b.last.x) / 2, y: (a.last.y + b.last.y) / 2 }, moved: 0, t0: performance.now() };
      this.afterPinch = true;
    }
  }

  /** Send a held-back finger touch to the active tool. */
  private flushPendingTouch() {
    const p = this.pendingTouch;
    if (!p || this.touches.size !== 1) return;
    this.pendingTouch = null;
    this.drawingTouch = p.id;
    this.store.set({ showShortcutBar: null });
    this.fingerToSelect();
    this.pressDown(p.pe);
  }

  private touchMove(e: PointerEvent, pe: PEvent) {
    if (this.ignoredTouches.has(e.pointerId)) return;
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    t.last = pe.screen;
    if (this.touches.size === 2 && this.pinch) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a.last.x - b.last.x, a.last.y - b.last.y);
      const mid = { x: (a.last.x + b.last.x) / 2, y: (a.last.y + b.last.y) / 2 };
      this.view.panBy(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      if (this.pinch.dist > 0) this.view.zoomAt(mid, d / this.pinch.dist);
      this.pinch.moved += Math.abs(d - this.pinch.dist) + Math.hypot(mid.x - this.pinch.mid.x, mid.y - this.pinch.mid.y);
      this.pinch.dist = d;
      this.pinch.mid = mid;
      this.requestRender();
      return;
    }
    if (this.touches.size !== 1 || this.afterPinch || this.longPressFired) return;
    if (this.pendingTouch?.id === e.pointerId && Math.hypot(pe.screen.x - t.start.x, pe.screen.y - t.start.y) > 8) {
      clearTimeout(this.pendingTimer);
      this.flushPendingTouch();
    }
    if (this.drawingTouch === e.pointerId) {
      this.onCursor?.(pe.world);
      this.pressMove(pe);
    }
  }

  private touchUp(e: PointerEvent, pe: PEvent) {
    if (this.ignoredTouches.delete(e.pointerId)) return;
    clearTimeout(this.longPress);
    clearTimeout(this.pendingTimer);
    this.touches.delete(e.pointerId);
    if (this.pinch && this.touches.size < 2) {
      const tap = performance.now() - this.pinch.t0 < 300 && this.pinch.moved < 12;
      this.pinch = null;
      if (tap) this.undo();
    }
    if (this.touches.size === 0) this.afterPinch = false;
    if (this.longPressFired) return;
    // A quick tap: deliver down + up together.
    if (this.pendingTouch?.id === e.pointerId) {
      const down = this.pendingTouch.pe;
      this.pendingTouch = null;
      this.store.set({ showShortcutBar: null });
      this.fingerToSelect();
      this.pressDown(down);
      this.pressUp(pe);
      this.checkDoubleTap(pe);
      return;
    }
    if (this.drawingTouch === e.pointerId) {
      this.drawingTouch = null;
      this.pressUp(pe);
      this.checkDoubleTap(pe);
    }
  }

  /** Two taps close together in time and space act as a double-click (e.g. ends a line chain). */
  private checkDoubleTap(pe: PEvent) {
    const now = performance.now();
    const last = this.lastTap;
    if (last && now - last.t < 350 && Math.hypot(pe.screen.x - last.at.x, pe.screen.y - last.at.y) < 24) {
      this.lastTap = null;
      if (!this.overArt(pe)) this.tool.onDoubleClick?.(pe);
    } else this.lastTap = { t: now, at: pe.screen };
  }

  /** On-screen Select/Draw toggle: Select, or back to the last drawing tool. */
  setFingerMode(mode: "select" | "draw") {
    if (mode === "select") {
      if (this.tool.id !== "select") this.setTool("select");
    } else if (this.tool.id === "select") this.setTool(this.lastDrawTool);
  }
  /** Tool the Draw toggle resumes. */
  drawToolId(): string {
    return this.tool.id === "select" ? this.lastDrawTool : this.tool.id;
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
      else if (k === "a") {
        if (this.store.state.viewMode === "art") this.selectAllChains();
        else this.select(Object.keys(ownSketch(this.store.doc).entities));
      }
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
    if (this.artTool.cancel()) return;
    if (st.viewMode !== "sketch" && st.artSelection.length) return this.setArtSelection([]);
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
        // Relations work on a selection, so pick with the Select tool.
        if (this.tool.id !== "select") this.setTool("select");
        return this.store.set({ panel: "auto" });
      case "view:sketch":
      case "view:art":
      case "view:split":
      case "view:print": {
        const mode = action.slice(5) as "sketch" | "art" | "split" | "print";
        // Art and Print view hide the sketch: abandon a half-drawn entity rather than leave it waiting unseen.
        if (mode === "art" || mode === "print") this.tool.cancel();
        this.store.set({ viewMode: mode, artHover: null });
        this.layoutViews();
        return this.requestRender();
      }
      case "toggleGridSnap":
        return this.store.set({ gridSnap: !this.store.state.gridSnap });
      case "open":
        return void this.openFile();
      case "combs":
        return this.store.set({ combs: !this.store.state.combs });
      case "picture":
        return void this.importPicture();
      case "convertEntities":
        return this.convertCommand();
      case "exportSvg":
        return this.store.set({ panel: this.store.state.panel === "export" ? "auto" : "export" });
      case "save":
        return void this.saveFile();
      case "keyboardPanel":
        return this.store.set({ panel: this.store.state.panel === "keyboard" ? "auto" : "keyboard" });
      case "variablesPanel":
        return this.store.set({ panel: this.store.state.panel === "variables" ? "auto" : "variables" });
      case "theme:light":
      case "theme:dark":
      case "theme:system":
        return this.setThemePref(action.slice(6) as ThemePref);
      case "theme:hell":
        return this.store.state.hellUnlocked ? this.setThemePref("hell") : undefined;
      case "newSketch":
        return this.newSketch();
      case "toggleTheme":
        return this.setThemePref(nextTheme(this.store.state.theme, this.store.state.hellUnlocked));
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
    if (mode === "art") this.drawArt(ctx, v);
    else if (mode === "print") this.drawPrint(ctx, v);
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
      const b = artScene(this.store.doc, this.artPane ? this.artPane.px(0.3) : 1).bounds;
      if (boxValid(b)) art.fit(b, 30);
      this.artPane = art;
      ctx.save();
      ctx.translate(v.width, 0);
      ctx.beginPath();
      ctx.rect(0, 0, art.width, art.height);
      ctx.clip();
      this.drawArt(ctx, art, v.width);
      ctx.restore();
      ctx.fillStyle = theme.splitDivider;
      ctx.fillRect(v.width - 0.5, 0, 1, v.height);
    }
  }

  /** Art view: every non-construction chain stroked in black on white, filled profiles, no sketch chrome. */
  private drawArt(ctx: CanvasRenderingContext2D, v: View, offsetX = 0) {
    ctx.fillStyle = artBackground(this.store.doc);
    ctx.fillRect(0, 0, v.width, v.height);
    const st = this.store.state;
    const k = v.dpr;
    const selected = new Set(this.selectedChains().map((c) => c.key));
    // The hover key may be any curve of its chain after an edit; highlight the chain it belongs to.
    const hover = st.artHover ? (chainsFor(docChains(this.store.doc), [st.artHover])[0]?.key ?? null) : null;
    paintArt(
      ctx,
      artScene(this.store.doc, v.px(0.3)),
      { k: k * v.scale, ox: k * (offsetX + v.width / 2 - v.cx * v.scale), oy: k * (v.height / 2 + v.cy * v.scale), unit: v.px(1) },
      { selected, hover },
    );
  }

  /**
   * Print view: the regions in filament colors as drawn, or the first layer as printed (on the
   * sheet, mirrored for the bed side). Rule breaks are hatched red; a refused edit's spot is outlined.
   */
  private drawPrint(ctx: CanvasRenderingContext2D, v: View) {
    const doc = this.store.doc;
    ctx.fillStyle = theme.printBackdrop;
    ctx.fillRect(0, 0, v.width, v.height);
    const pr = doc.print;
    if (!pr) return;
    const reg = buildRegions(doc);
    const printed = pr.preview !== "drawn";
    const m = this.printMirror(doc);
    const color = (id: string) => pr.filaments.find((f) => f.id === id)?.color ?? "#ff00ff";
    const k = v.dpr;
    ctx.save();
    ctx.setTransform(k * v.scale, 0, 0, k * v.scale, k * (v.width / 2 - v.cx * v.scale), k * (v.height / 2 + v.cy * v.scale));
    const fill = (a: Parameters<typeof pathData>[0], c: string) => {
      if (!a.length) return;
      ctx.fillStyle = c;
      ctx.fill(new Path2D(pathData(a, m)), "nonzero");
    };
    if (printed) {
      const fl = firstLayer(doc);
      fill(reg.part, pr.printer.sheetColor);
      for (const l of fl.laid) fill(l.area, color(l.filament));
    } else {
      for (const r of reg.regions) fill(r.area, color(r.filament));
      ctx.globalAlpha = 0.25;
      fill(reg.outside, theme.printOutside);
      ctx.globalAlpha = 1;
    }
    // Part edge, so a white part shows on a light backdrop.
    if (reg.part.length) {
      ctx.strokeStyle = theme.printEdge;
      ctx.lineWidth = v.px(1);
      ctx.stroke(new Path2D(pathData(reg.part, m)));
    }
    const red = theme.printBreak;
    const report = checkRules(doc);
    for (const b of report.breaks) {
      const p = new Path2D(pathData(b.area, m));
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = red;
      ctx.fill(p, "nonzero");
      ctx.globalAlpha = 1;
      ctx.strokeStyle = red;
      ctx.lineWidth = v.px(1.5);
      ctx.stroke(p);
    }
    const marker = this.store.state.printMarker;
    if (marker?.length) {
      ctx.strokeStyle = red;
      ctx.lineWidth = v.px(2.5);
      ctx.setLineDash([v.px(4), v.px(3)]);
      ctx.stroke(new Path2D(pathData(marker, m)));
      ctx.setLineDash([]);
    }
    // Selected chains: their line in blue.
    const sel = this.selectedChains();
    if (sel.length) {
      ctx.strokeStyle = theme.selected;
      ctx.lineWidth = v.px(2);
      for (const c of sel) {
        const pts = samplePolyline(c.segs, c.closed, v.px(0.3)).pts;
        const path = new Path2D();
        pts.forEach((q, i) => (i ? path.lineTo(m === undefined ? q.x : 2 * m - q.x, -q.y) : path.moveTo(m === undefined ? q.x : 2 * m - q.x, -q.y)));
        if (c.closed) path.closePath();
        ctx.stroke(path);
      }
    }
    ctx.restore();
    // Pinholes: a ring around each so they are easy to find.
    if (printed) {
      const p = new Painter(ctx, v);
      for (const h of components(firstLayer(doc).pinholes)) {
        const b = boundsOf(h);
        const c = { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
        p.ring({ x: m === undefined ? c.x : 2 * m - c.x, y: c.y }, 6, theme.printPinhole, 1.5);
      }
    }
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

  /** Filled outline of every visible sketch (Art view, export). */
  private pathCache: { doc: Doc; path: Path2D } | null = null;
  private docPath(): Path2D {
    const doc = this.store.doc;
    if (this.pathCache?.doc !== doc) this.pathCache = { doc, path: new Path2D(loopsToPathData(docOutline(doc, false).loops, "arc")) };
    return this.pathCache.path;
  }

  /** Overridable layer drawing (relations, dimensions, fills are added later). */
  drawLayers(p: Painter, s: Sketch, opts: SceneOptions) {
    const doc = this.store.doc;
    const ai = featureIndex(doc);
    // Fill preview of every visible sketch, each chained on its own; diagnostics only for the
    // sketch being edited (and skipped while dragging to stay fast).
    const live = this.store.inTransient;
    fillOutline(p.ctx, p.view, this.docPath(), theme.profileTint);
    const own = doc.features[ai].sketch;
    const o = live ? null : outlineOf(own, true).o;
    // Sketches below the active one: faded, not pickable.
    for (let i = ai + 1; i < doc.features.length; i++) {
      const f = doc.features[i];
      if (f.visible) drawSketch(p, f.sketch, { ...opts, muted: true, selection: new Set(), hover: null, related: undefined });
    }
    if (this.store.state.combs) drawCurvatureCombs(p, own);
    drawSketch(p, s, opts);
    if (o) drawDiagnostics(p, o);
    const conflicts = new Set(this.store.state.status.conflicts);
    const glyphs = drawRelationGlyphs(p, s, conflicts, this.store.state.hover, opts.selection);
    const sel = this.tools.get("select") as SelectTool;
    const dims = drawDimensions(p, s, { conflicts, hover: this.store.state.hover, selection: opts.selection, labelOffset: (id) => sel.dimOffset(id) });
    this.annotationHits = [...glyphs, ...dims];
    this.drawPrintMarker(p);
  }

  /** Print mode: the spot a refused edit or a held drag would have made too thin, in red. */
  private drawPrintMarker(p: Painter) {
    const marker = this.store.state.printMarker;
    if (!marker?.length) return;
    const ctx = p.ctx;
    const v = p.view;
    const k = v.dpr;
    ctx.save();
    ctx.setTransform(k * v.scale, 0, 0, k * v.scale, k * (v.width / 2 - v.cx * v.scale), k * (v.height / 2 + v.cy * v.scale));
    const path = new Path2D(pathData(marker));
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = theme.printBreak;
    ctx.fill(path, "nonzero");
    ctx.globalAlpha = 1;
    ctx.strokeStyle = theme.printBreak;
    ctx.lineWidth = v.px(2);
    ctx.setLineDash([v.px(4), v.px(3)]);
    ctx.stroke(path);
    ctx.restore();
  }
}
