import type { Vec2 } from "../geom/vec";
import { dist, segmentHitsBox } from "../geom/vec";
import { intersect } from "../geom/curves";
import type { SnapResult } from "../inference/snap";
import { ptv } from "../model/sketch";
import type { Id } from "../model/types";
import { entitySamples } from "../render/hit";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import { applySnap, drawSnap } from "./common";
import { addSpline, cornerAt, entityCurve, extendAt, extendTarget, filletCorner, findChain, mirrorEntities, offsetChain, sideOf, trimAt } from "./edits";
import { fmt } from "./line";
import type { PEvent, Tool, ToolHost, ToolOption } from "./tool";

export interface EditHost extends ToolHost {
  editBegin(): void;
  editApply(fn: Parameters<ToolHost["commit"]>[1]): void;
  editEnd(label: string): void;
  dynamicMirror: Id | null;
  setDynamicMirror(axis: Id | null): void;
}

// ------------------------------------------------------------------ Style spline

/** Style Spline: click control vertices; finishes at the vertex count (4 = cubic, up to 8). */
export class SplineTool implements Tool {
  readonly id = "spline";
  readonly cursor = "crosshair";
  private pts: { pos: Vec2; snap: SnapResult }[] = [];
  private cur: SnapResult | undefined;
  count = 4;
  construction = false;

  constructor(private host: ToolHost) {}
  activate() {
    this.pts = [];
    this.prompt();
  }
  deactivate() {
    this.pts = [];
  }
  private prompt() {
    const n = this.pts.length;
    this.host.setPrompt(
      n === 0 ? "Click the first control vertex" : `Click control vertex ${n + 1} of ${this.count} (double-click or Enter finishes early)`,
    );
  }
  private snapAt(e: PEvent) {
    return this.host.snap(e.world, { from: this.pts[this.pts.length - 1]?.pos, suppress: e.ctrl || this.host.suppress() });
  }
  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const sn = this.snapAt(e);
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last.pos, sn.pos) < this.host.view.px(2)) return;
    this.pts.push({ pos: sn.pos, snap: sn });
    if (this.pts.length >= this.count) this.finish();
    else this.prompt();
    this.host.requestRender();
  }
  onDoubleClick() {
    if (this.pts.length >= 3) this.finish();
  }
  onKey(k: KeyboardEvent) {
    if (k.key === "Enter" && this.pts.length >= 3) {
      this.finish();
      return true;
    }
    return false;
  }
  private finish() {
    const pts = this.pts;
    this.pts = [];
    this.host.commit("Style Spline", (ed) => {
      const r = addSpline(ed, pts.map((p) => p.pos), this.construction);
      applySnap(ed, r.cps[0], pts[0].snap);
      applySnap(ed, r.cps[r.cps.length - 1], pts[pts.length - 1].snap);
      // H/V inferred while placing a vertex applies to that polygon side.
      pts.forEach((p, i) => {
        if (i > 0 && p.snap.hv) ed.addRelation({ type: p.snap.hv, refs: [r.sides[i - 1]] });
        if (i > 0 && i < pts.length - 1 && (p.snap.point || p.snap.curve)) applySnap(ed, r.cps[i], p.snap);
      });
    });
    this.prompt();
  }
  onMove(e: PEvent) {
    this.cur = this.snapAt(e);
    this.host.requestRender();
  }
  onUp() {}
  cancel(): boolean {
    if (!this.pts.length) return false;
    this.pts = [];
    this.prompt();
    this.host.requestRender();
    return true;
  }
  draw(p: Painter) {
    if (this.pts.length && this.cur) {
      const all = [...this.pts.map((q) => q.pos), this.cur.pos];
      p.polyline(all, { color: theme.preview, width: 1, dash: [4, 3] });
      if (all.length >= 3) p.bezier(all, { color: theme.preview, width: 1.6 });
    }
    drawSnap(p, this.cur);
  }
  options(): ToolOption[] {
    return [
      {
        kind: "choice",
        key: "count",
        label: "Control vertices",
        value: String(this.count),
        choices: [3, 4, 5, 6, 7, 8].map((n) => ({ value: String(n), label: `${n} (degree ${n - 1})` })),
        set: (v) => (this.count = Number(v)),
      },
      { kind: "check", key: "construction", label: "For construction", value: this.construction, set: (v) => (this.construction = v) },
    ];
  }
}

// ------------------------------------------------------------------ Trim

/** Power Trim: drag a stroke across segments, or click a segment. */
export class TrimTool implements Tool {
  readonly id = "trim";
  readonly cursor = "crosshair";
  private stroke: Vec2[] | null = null;
  private trimmedAny = false;
  private hover: Id | null = null;

  constructor(private host: EditHost) {}
  activate() {
    this.host.setPrompt("Drag across segments to trim them, or click a segment (Power Trim)");
  }
  deactivate() {
    this.finishStroke();
  }
  onDown(e: PEvent) {
    if (e.button !== 0) return;
    this.stroke = [e.world];
    this.trimmedAny = false;
    this.host.editBegin();
  }
  onMove(e: PEvent) {
    if (!this.stroke) {
      const h = this.host.hit(e.world, e.pointerType, { points: false, own: true });
      this.hover = h?.id ?? null;
      this.host.setHover(this.hover);
      return;
    }
    const prev = this.stroke[this.stroke.length - 1];
    this.stroke.push(e.world);
    // Trim every segment the stroke crosses in this step.
    const s = this.host.sketch();
    const seg = { kind: "line" as const, a: prev, b: e.world };
    const crossings: { id: Id; p: Vec2 }[] = [];
    for (const ent of Object.values(s.entities)) {
      if (ent.type === "point" || (ent.type === "line" && ent.owner) || (ent.type === "spline" && ent.derived) || s.ext?.[ent.id]) continue;
      const box = { minX: Math.min(prev.x, e.world.x), minY: Math.min(prev.y, e.world.y), maxX: Math.max(prev.x, e.world.x), maxY: Math.max(prev.y, e.world.y) };
      const samples = entitySamples(s, ent);
      let near = false;
      for (let i = 0; i < samples.length - 1 && !near; i++) near = segmentHitsBox(samples[i], samples[i + 1], box);
      if (!near) continue;
      const cv = entityCurve(s, ent);
      if (!cv) continue;
      const h = intersect(seg, cv);
      if (h.length) crossings.push({ id: ent.id, p: h[0].p });
    }
    if (crossings.length) {
      this.host.editApply((ed) => {
        for (const c of crossings) if (ed.s.entities[c.id]) trimAt(ed, c.id, c.p);
      });
      this.trimmedAny = true;
    }
    this.host.requestRender();
  }
  onUp(e: PEvent) {
    if (this.stroke && !this.trimmedAny && this.stroke.length <= 3) {
      // Click mode.
      const h = this.host.hit(e.world, e.pointerType, { points: false, own: true });
      if (h) {
        let msg: string | undefined;
        this.host.editApply((ed) => {
          msg = trimAt(ed, h.id, e.world).message;
        });
        this.trimmedAny = true;
        if (msg) this.host.flash(msg, "error");
      }
    }
    this.finishStroke();
  }
  private finishStroke() {
    if (!this.stroke) return;
    this.stroke = null;
    this.host.editEnd("Trim");
    this.host.requestRender();
  }
  cancel(): boolean {
    return false;
  }
  draw(p: Painter) {
    if (this.stroke && this.stroke.length > 1) p.polyline(this.stroke, { color: "#d33", width: 1.5, dash: [3, 3] });
  }
}

// ------------------------------------------------------------------ Extend

export class ExtendTool implements Tool {
  readonly id = "extend";
  readonly cursor = "crosshair";
  private preview: { from: Vec2; to: Vec2 } | null = null;
  constructor(private host: ToolHost) {}
  activate() {
    this.host.setPrompt("Click a line or arc near the end to extend it to the next entity");
  }
  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const h = this.host.hit(e.world, e.pointerType, { points: false, own: true });
    if (!h) return;
    let msg: string | undefined;
    this.host.commit("Extend", (ed) => {
      msg = extendAt(ed, h.id, e.world).message;
    });
    if (msg) this.host.flash(msg, "error");
    this.preview = null;
  }
  onMove(e: PEvent) {
    const h = this.host.hit(e.world, e.pointerType, { points: false, own: true });
    this.host.setHover(h?.id ?? null);
    this.preview = null;
    if (h) {
      const s = this.host.sketch();
      const t = extendTarget(s, h.id, e.world);
      if (t) this.preview = { from: ptv(s, t.pointId), to: t.to };
    }
    this.host.requestRender();
  }
  onUp() {}
  cancel() {
    return false;
  }
  draw(p: Painter) {
    if (this.preview) {
      p.line(this.preview.from, this.preview.to, { color: theme.hover, width: 2, dash: [5, 3] });
      p.ring(this.preview.to, 5, theme.hover, 2);
    }
  }
}

// ------------------------------------------------------------------ Fillet

/** Sketch Fillet: click a corner (or two lines). Adds tangent relations; extra fillets are Equal to the first. */
export class FilletTool implements Tool {
  readonly id = "fillet";
  readonly cursor = "crosshair";
  radius = 10;
  private firstArc: Id | null = null;
  private pendingLine: Id | null = null;
  constructor(private host: ToolHost) {}
  activate() {
    this.firstArc = null;
    this.pendingLine = null;
    this.host.setPrompt("Click a corner where two lines meet (or click two lines) to fillet it");
  }
  deactivate() {
    this.firstArc = null;
  }
  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const s = this.host.sketch();
    const h = this.host.hit(e.world, e.pointerType, { own: true });
    if (!h) return;
    let corner = h.kind === "point" ? cornerAt(s, h.id) : null;
    if (!corner && h.kind === "curve" && s.entities[h.id]?.type === "line") {
      if (!this.pendingLine || this.pendingLine === h.id) {
        this.pendingLine = h.id;
        this.host.select([h.id]);
        return;
      }
      corner = sharedCorner(s, this.pendingLine, h.id);
      this.pendingLine = null;
      this.host.select([]);
      if (!corner) return this.host.flash("Those lines do not meet at a corner", "error");
    }
    if (!corner) return this.host.flash("Click a corner shared by two lines", "error");
    const c = corner;
    let msg: string | undefined;
    this.host.commit("Sketch Fillet", (ed) => {
      const r = filletCorner(ed, c, this.radius);
      msg = r.message;
      if (!r.arc) return;
      if (this.firstArc && ed.s.entities[this.firstArc]) ed.addRelation({ type: "equal", refs: [this.firstArc, r.arc] });
      else {
        this.firstArc = r.arc;
        ed.addDimension({ type: "radius", refs: [r.arc], expr: fmt(this.radius), value: this.radius, driven: false, label: { x: this.radius, y: this.radius } });
      }
    });
    if (msg) this.host.flash(msg, "error");
  }
  onMove(e: PEvent) {
    const h = this.host.hit(e.world, e.pointerType, { own: true });
    this.host.setHover(h?.id ?? null);
  }
  onUp() {}
  cancel() {
    if (!this.pendingLine) return false;
    this.pendingLine = null;
    this.host.select([]);
    return true;
  }
  options(): ToolOption[] {
    return [
      { kind: "number", key: "r", label: "Fillet radius", value: this.radius, set: (v) => v > 0 && (this.radius = v) },
      { kind: "info", key: "i", label: "Fillets made in one go are linked by Equal relations; the first gets a radius dimension." },
    ];
  }
}

function sharedCorner(s: ReturnType<ToolHost["sketch"]>, a: Id, b: Id) {
  const A = s.entities[a];
  const B = s.entities[b];
  if (A?.type !== "line" || B?.type !== "line") return null;
  for (const pa of [A.p1, A.p2])
    for (const pb of [B.p1, B.p2]) if (dist(ptv(s, pa), ptv(s, pb)) < 1e-6 * Math.max(1, Math.hypot(ptv(s, pa).x, ptv(s, pa).y))) return { l1: a, e1: pa, l2: b, e2: pb };
  return null;
}

// ------------------------------------------------------------------ Offset

export class OffsetTool implements Tool {
  readonly id = "offset";
  readonly cursor = "crosshair";
  distance = 10;
  both = false;
  cap: "none" | "arcs" | "lines" = "arcs";
  chain = true;
  baseConstruction = false;
  private hover: { id: Id; side: 1 | -1 } | null = null;
  constructor(private host: ToolHost) {}
  activate() {
    this.host.setPrompt("Hover a line, arc or spline chain; click on the side to offset toward");
  }
  onDown(e: PEvent) {
    if (e.button !== 0 || !this.hover) return;
    const { id, side } = this.hover;
    const doc = this.host.doc();
    let n = 1;
    while (doc.variables.some((v) => v.name === `offset${n}`)) n++;
    let msg: string | undefined;
    this.host.commit("Offset Entities", (ed) => {
      msg = offsetChain(ed, id, { distance: this.distance, side, both: this.both, cap: this.both ? this.cap : "none", link: `offset${n}`, baseConstruction: this.baseConstruction }).message;
    });
    if (msg) this.host.flash(msg, "error");
    else this.host.flash(`Offset linked to variable offset${n} (edit it in Global Variables or double-click the dimension)`);
  }
  onMove(e: PEvent) {
    const h = this.host.hit(e.world, e.pointerType, { points: false });
    const s = this.host.sketch();
    const ent = h ? s.entities[h.id] : undefined;
    if (ent && (ent.type === "line" ? !ent.owner : ent.type === "arc" || (ent.type === "spline" && !ent.derived))) {
      const chain = findChain(s, h!.id);
      const seg = chain.segs.find((x) => x.id === h!.id)!;
      this.hover = { id: h!.id, side: sideOf(s, seg, e.world) };
    } else this.hover = null;
    this.host.setHover(this.hover?.id ?? null);
    this.host.requestRender();
  }
  onUp() {}
  cancel() {
    return false;
  }
  draw(p: Painter) {
    if (!this.hover) return;
    const s = this.host.sketch();
    const chain = findChain(s, this.hover.id);
    for (const seg of chain.segs) {
      const ent = s.entities[seg.id];
      const samples = entitySamples(s, ent);
      p.polyline(samples, { color: theme.hover, width: 2.5 });
    }
    // Light preview of the side.
    const ent = s.entities[this.hover.id];
    const samples = entitySamples(s, ent);
    const m = samples[Math.floor(samples.length / 2)];
    const S = p.s(m);
    p.textScreen(`${this.hover.side > 0 ? "◀" : "▶"} offset ${fmt(this.distance)}${this.both ? " both ways" : ""}`, S.x, S.y - 18, theme.hover, "12px system-ui");
  }
  options(): ToolOption[] {
    return [
      { kind: "number", key: "d", label: "Offset distance", value: this.distance, set: (v) => v > 0 && (this.distance = v) },
      { kind: "check", key: "both", label: "Bi-directional", value: this.both, set: (v) => (this.both = v) },
      { kind: "check", key: "base", label: "Base geometry → construction", value: this.baseConstruction, set: (v) => (this.baseConstruction = v) },
      {
        kind: "choice",
        key: "cap",
        label: "Cap ends",
        value: this.cap,
        choices: [
          { value: "arcs", label: "Arcs" },
          { value: "lines", label: "Lines" },
          { value: "none", label: "None" },
        ],
        set: (v) => (this.cap = v as "arcs" | "lines" | "none"),
      },
      { kind: "info", key: "i", label: "Connected entities are offset as a chain. Splines get a driven cubic approximation." },
    ];
  }
}

// ------------------------------------------------------------------ Mirror

/** Mirror Entities: select entities, then a centerline. Copies are linked by Symmetric relations. */
export class MirrorTool implements Tool {
  readonly id = "mirror";
  readonly cursor = "default";
  copy = true;
  constructor(private host: ToolHost) {}
  activate() {
    if (this.tryMirror()) return;
    this.host.setPrompt("Select entities to mirror, then click the centerline to mirror about");
  }
  private tryMirror(): boolean {
    const s = this.host.sketch();
    const sel = this.host.selection().filter((id) => s.entities[id]);
    const axis = [...sel].reverse().find((id) => {
      const e = s.entities[id];
      return e.type === "line" && e.construction && !e.owner;
    });
    const rest = sel.filter((id) => id !== axis);
    if (!axis || !rest.length) return false;
    this.host.commit("Mirror Entities", (ed) => {
      mirrorEntities(ed, rest, axis);
      if (!this.copy) ed.deleteEntities(rest);
    });
    this.host.select([]);
    this.host.setTool("select");
    return true;
  }
  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const h = this.host.hit(e.world, e.pointerType);
    if (!h) return;
    const sel = this.host.selection();
    this.host.select(sel.includes(h.id) ? sel.filter((x) => x !== h.id) : [...sel, h.id]);
    const s = this.host.sketch();
    const ent = s.entities[h.id];
    if (ent.type === "line" && ent.construction && sel.length) this.tryMirror();
  }
  onMove(e: PEvent) {
    const h = this.host.hit(e.world, e.pointerType);
    this.host.setHover(h?.id ?? null);
  }
  onUp() {}
  cancel() {
    return false;
  }
  options(): ToolOption[] {
    return [
      { kind: "check", key: "copy", label: "Copy (keep originals)", value: this.copy, set: (v) => (this.copy = v) },
      { kind: "info", key: "i", label: "The centerline must be construction geometry (a Centerline)." },
    ];
  }
}

/** Dynamic Mirror: pick a centerline; until turned off, new entities are mirrored as you draw. */
export class DynamicMirrorTool implements Tool {
  readonly id = "dynamicMirror";
  readonly cursor = "default";
  constructor(private host: EditHost) {}
  activate() {
    if (this.host.dynamicMirror) {
      this.host.setDynamicMirror(null);
      this.host.flash("Dynamic Mirror off");
      this.host.setTool("select");
      return;
    }
    const s = this.host.sketch();
    const axis = this.host.selection().find((id) => {
      const e = s.entities[id];
      return e?.type === "line" && e.construction;
    });
    if (axis) return this.start(axis);
    this.host.setPrompt("Click the centerline to mirror about");
  }
  private start(axis: Id) {
    this.host.setDynamicMirror(axis);
    this.host.flash("Dynamic Mirror on: new sketch entities are mirrored. Click Dynamic Mirror again to stop.");
    this.host.setTool("line");
  }
  onDown(e: PEvent) {
    const h = this.host.hit(e.world, e.pointerType, { points: false });
    const ent = h ? this.host.sketch().entities[h.id] : undefined;
    if (ent?.type === "line" && ent.construction) this.start(ent.id);
    else this.host.flash("Pick a centerline (construction line)", "error");
  }
  onMove(e: PEvent) {
    const h = this.host.hit(e.world, e.pointerType, { points: false });
    this.host.setHover(h?.id ?? null);
  }
  onUp() {}
  cancel() {
    return false;
  }
}
