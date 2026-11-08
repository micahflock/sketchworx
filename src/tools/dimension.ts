import type { Vec2 } from "../geom/vec";
import { sub } from "../geom/vec";
import { dimAnchor, inferDimension, measure } from "../model/dimensions";
import type { DimProposal } from "../model/dimensions";
import type { Dimension, Id } from "../model/types";
import { drawDimension } from "../render/dimensions";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import { fmt } from "./line";
import type { PEvent, Tool, ToolHost } from "./tool";

/**
 * Smart Dimension: pick one to three items, the type is inferred from the
 * selection and where the label is dragged; click empty space to place.
 */
export class DimensionTool implements Tool {
  readonly id = "dimension";
  readonly cursor = "crosshair";
  private refs: Id[] = [];
  private cursorPos: Vec2 | null = null;
  /** What the next click would pick, if anything (then the click picks rather than places). */
  private pickable: Id | null = null;

  constructor(private host: ToolHost & { placeDimension(d: Omit<Dimension, "id">): void }) {}

  activate() {
    this.refs = [];
    this.prompt();
  }
  deactivate() {
    this.refs = [];
    this.pickable = null;
    this.host.setHover(null);
    this.host.select([]);
  }
  private prompt() {
    this.host.setPrompt(
      this.refs.length === 0
        ? "Select one or two items to dimension (lines, points, arcs, circles)"
        : "Select another item, or click to place the dimension",
    );
  }

  private proposal(): DimProposal | null {
    if (!this.refs.length || !this.cursorPos) return null;
    return inferDimension(this.host.sketch(), this.refs, this.cursorPos);
  }

  onDown(e: PEvent) {
    if (e.button !== 0) return;
    if (!this.refs.length) {
      const ann = this.host.hitAnnotation(e.screen);
      if (ann?.kind === "dimension") {
        this.host.openModify(ann.id, false);
        return;
      }
    }
    const h = this.host.hit(e.world, e.pointerType);
    if (h && !this.refs.includes(h.id) && this.refs.length < 3) {
      this.refs.push(h.id);
      this.host.select([...this.refs]);
      this.cursorPos = e.world;
      // Arc length completes on the third pick (arc + both endpoints).
      const p = this.proposal();
      if (p?.type === "arcLength") return this.place(e.world);
      this.prompt();
      this.host.requestRender();
      return;
    }
    if (this.refs.length) this.place(e.world);
  }

  private place(at: Vec2) {
    this.cursorPos = at;
    const p = this.proposal();
    if (!p) {
      this.host.flash("Cannot dimension this selection", "error");
      this.refs = [];
      this.host.select([]);
      this.prompt();
      return;
    }
    const draft = this.draft(p, at);
    this.refs = [];
    this.host.select([]);
    this.prompt();
    if (!Number.isFinite(draft.value)) return;
    this.host.placeDimension(draft);
  }

  private draft(p: DimProposal, at: Vec2): Omit<Dimension, "id"> {
    const s = this.host.sketch();
    const tmp: Dimension = { id: "#preview", type: p.type, refs: p.refs, quadrant: p.quadrant, expr: "", value: 0, driven: false, label: { x: 0, y: 0 } };
    const value = Math.abs(measure(s, tmp));
    tmp.value = value;
    tmp.expr = fmt(value);
    tmp.label = sub(at, dimAnchor(s, tmp));
    const { id: _, ...rest } = tmp;
    return rest;
  }

  onMove(e: PEvent) {
    this.cursorPos = e.world;
    // Keep highlighting what the next click would pick, also after the first pick.
    const h = this.refs.length < 3 ? this.host.hit(e.world, e.pointerType) : null;
    this.pickable = h && !this.refs.includes(h.id) ? h.id : null;
    this.host.setHover(this.pickable);
    this.host.requestRender();
  }
  onUp() {}

  cancel(): boolean {
    if (!this.refs.length) return false;
    this.refs = [];
    this.host.select([]);
    this.prompt();
    this.host.requestRender();
    return true;
  }

  draw(p: Painter) {
    // Over something pickable the click adds it, so the placement preview would mislead (and hide the highlight).
    if (this.pickable) return;
    const pr = this.proposal();
    if (!pr || !this.cursorPos) return;
    const d = { id: "#preview", ...this.draft(pr, this.cursorPos) };
    drawDimension(p, this.host.sketch(), d, theme.preview, false);
  }
}
