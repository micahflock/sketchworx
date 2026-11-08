import type { Vec2 } from "../geom/vec";
import { add, dist, sub } from "../geom/vec";
import { definingPoints, ptv } from "../model/sketch";
import type { Id } from "../model/types";
import { boxSelect } from "../render/hit";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import type { DragTarget } from "../solver/types";
import { DRAG_THRESHOLD_PX, screenDist } from "./common";
import type { PEvent, Tool, ToolHost } from "./tool";

type Pending =
  | { kind: "entity"; id: Id; startWorld: Vec2; startScreen: Vec2; additive: boolean; wasSelected: boolean }
  | { kind: "dimension"; id: Id; startWorld: Vec2; startScreen: Vec2; label: Vec2 }
  | { kind: "box"; startScreen: Vec2; startWorld: Vec2; additive: boolean };

/** Default tool: select, box select, and drag geometry through the solver. */
export class SelectTool implements Tool {
  readonly id = "select";
  readonly cursor = "default";
  private pending: Pending | null = null;
  private dragging: { base: { point?: Id; radiusOf?: Id; x: number; y: number; r?: number }[]; startWorld: Vec2 } | null = null;
  private dimDrag: { id: Id; offset: Vec2 } | null = null;
  private box: { a: Vec2; b: Vec2 } | null = null;

  constructor(private host: ToolHost) {}

  activate() {
    this.host.setPrompt("Select entities. Drag to move; drag on empty space to box select");
  }
  deactivate() {
    this.pending = null;
    this.box = null;
    if (this.dragging) this.host.dragEnd(false);
    this.dragging = null;
  }

  onDown(e: PEvent) {
    if (e.button !== 0) return;
    this.host.showContextBar(null);
    const additive = e.ctrl || e.shift;
    const ann = this.host.hitAnnotation(e.screen);
    if (ann) {
      const sel = this.host.selection();
      if (additive) this.host.select(sel.includes(ann.id) ? sel.filter((x) => x !== ann.id) : [...sel, ann.id]);
      else this.host.select([ann.id]);
      if (ann.kind === "dimension") {
        const d = this.host.sketch().dimensions[ann.id];
        if (d) this.pending = { kind: "dimension", id: ann.id, startWorld: e.world, startScreen: e.screen, label: { ...d.label } };
      }
      return;
    }
    const h = this.host.hit(e.world, e.pointerType);
    if (h) {
      const sel = this.host.selection();
      const wasSelected = sel.includes(h.id);
      if (additive) this.host.select(wasSelected ? sel.filter((x) => x !== h.id) : [...sel, h.id]);
      else if (!wasSelected) this.host.select([h.id]);
      this.pending = { kind: "entity", id: h.id, startWorld: e.world, startScreen: e.screen, additive, wasSelected };
    } else {
      this.pending = { kind: "box", startScreen: e.screen, startWorld: e.world, additive };
    }
  }

  onMove(e: PEvent) {
    const p = this.pending;
    if (!p) {
      if (this.dragging) return;
      const ann = this.host.hitAnnotation(e.screen);
      const h = ann ? null : this.host.hit(e.world, e.pointerType);
      this.host.setHover(ann?.id ?? h?.id ?? null);
      return;
    }
    if (p.kind === "entity") {
      if (!this.dragging && screenDist(e.screen, p.startScreen) > DRAG_THRESHOLD_PX) this.startDrag(p.id, p.startWorld);
      if (this.dragging) this.host.dragUpdate(this.targets(e.world));
    } else if (p.kind === "dimension") {
      if (screenDist(e.screen, p.startScreen) > DRAG_THRESHOLD_PX || this.dimDrag) {
        this.dimDrag = { id: p.id, offset: sub(e.world, p.startWorld) };
        this.host.requestRender();
      }
    } else {
      if (screenDist(e.screen, p.startScreen) > DRAG_THRESHOLD_PX) {
        this.box = { a: p.startWorld, b: e.world };
        this.host.requestRender();
      }
    }
  }

  onUp(e: PEvent) {
    const p = this.pending;
    this.pending = null;
    if (!p) return;
    if (p.kind === "entity") {
      if (this.dragging) {
        this.host.dragEnd(true, "Drag");
        this.dragging = null;
      } else {
        if (!p.additive && p.wasSelected) this.host.select([p.id]);
        this.host.showContextBar(e.screen);
      }
    } else if (p.kind === "dimension") {
      if (this.dimDrag) {
        const off = this.dimDrag.offset;
        this.dimDrag = null;
        this.host.commit("Move Dimension", (ed) => ed.updateDimension(p.id, { label: add(p.label, off) }));
      }
    } else if (this.box) {
      const { a, b } = this.box;
      this.box = null;
      const crossing = b.x < a.x; // right-to-left = crossing
      const ids = boxSelect(this.host.sketch(), { minX: Math.min(a.x, b.x), minY: Math.min(a.y, b.y), maxX: Math.max(a.x, b.x), maxY: Math.max(a.y, b.y) }, crossing);
      const sel = p.additive ? Array.from(new Set([...this.host.selection(), ...ids])) : ids;
      this.host.select(sel);
      if (sel.length) this.host.showContextBar(e.screen);
      this.host.requestRender();
    } else if (!p.additive) {
      this.host.select([]);
    }
  }

  onDoubleClick(e: PEvent) {
    const ann = this.host.hitAnnotation(e.screen);
    if (ann?.kind === "dimension") this.host.openModify(ann.id, false);
  }

  /** Dimension label being dragged (renderer previews it). */
  dimOffset(id: Id): Vec2 | null {
    return this.dimDrag?.id === id ? this.dimDrag.offset : null;
  }

  private startDrag(id: Id, startWorld: Vec2) {
    const s = this.host.sketch();
    const e = s.entities[id];
    if (!e) return;
    if (s.ext?.[id]) {
      // Geometry of an earlier sketch is locked here.
      this.host.flash("That belongs to an earlier sketch. Edit that sketch in the feature tree to change it");
      this.pending = null;
      return;
    }
    const base: { point?: Id; radiusOf?: Id; x: number; y: number; r?: number }[] = [];
    if (e.type === "point") base.push({ point: id, ...ptv(s, id) });
    else if (e.type === "circle") {
      const c = ptv(s, e.c);
      base.push({ radiusOf: id, x: c.x, y: c.y, r: e.r });
    } else if (e.type === "arc") {
      const c = ptv(s, e.c);
      const r = dist(c, ptv(s, e.s));
      base.push({ radiusOf: id, x: c.x, y: c.y, r });
    } else for (const pid of definingPoints(e)) base.push({ point: pid, ...ptv(s, pid) });
    this.dragging = { base, startWorld };
    this.host.dragBegin(this.targets(startWorld));
  }

  private targets(w: Vec2): DragTarget[] {
    const d = this.dragging!;
    const delta = sub(w, d.startWorld);
    const s = this.host.sketch();
    return d.base.map((b) => {
      if (b.radiusOf) {
        const e = s.entities[b.radiusOf];
        let c: Vec2 = { x: b.x, y: b.y };
        if (e && (e.type === "circle" || e.type === "arc")) c = ptv(s, e.c);
        return { radiusOf: b.radiusOf, r: Math.max(1e-6, dist(w, c)), x: 0, y: 0 };
      }
      return { point: b.point, x: b.x + delta.x, y: b.y + delta.y };
    });
  }

  cancel(): boolean {
    if (this.dragging) {
      this.host.dragEnd(false);
      this.dragging = null;
      this.pending = null;
      return true;
    }
    if (this.box) {
      this.box = null;
      this.pending = null;
      this.host.requestRender();
      return true;
    }
    return false;
  }

  draw(p: Painter) {
    if (!this.box) return;
    const a = p.s(this.box.a);
    const b = p.s(this.box.b);
    const crossing = this.box.b.x < this.box.a.x;
    const c = p.ctx;
    c.fillStyle = crossing ? theme.boxCrossing : theme.boxWindow;
    c.strokeStyle = crossing ? "#1a9a4a" : "#1a6ad8";
    c.lineWidth = 1;
    c.setLineDash(crossing ? [5, 3] : []);
    c.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    c.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  }
}
