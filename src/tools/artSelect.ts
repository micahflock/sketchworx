import type { Vec2 } from "../geom/vec";
import type { Id } from "../model/types";
import type { PEvent, Tool } from "./tool";

export interface ArtHost {
  /** Key of the chain under the pointer. */
  artPick(e: PEvent): Id | null;
  artSelection(): Id[];
  setArtSelection(ids: Id[]): void;
  setArtHover(id: Id | null): void;
  /** Pan the view under the pointer by a screen offset (no-op where the view is fitted automatically). */
  artPan(e: PEvent, dx: number, dy: number): void;
}

/**
 * Art view pointer handling: click a chain or profile to select it (Shift or Ctrl adds/removes),
 * click empty space to clear, drag to pan.
 */
export class ArtSelectTool implements Tool {
  readonly id = "artSelect";
  readonly cursor = "default";
  private press: { start: Vec2; last: Vec2; moved: boolean } | null = null;

  constructor(private host: ArtHost) {}

  onDown(e: PEvent) {
    if (e.button !== 0) return;
    this.press = { start: e.screen, last: e.screen, moved: false };
  }

  onMove(e: PEvent) {
    const p = this.press;
    if (!p) return this.host.setArtHover(this.host.artPick(e));
    if (!p.moved && Math.hypot(e.screen.x - p.start.x, e.screen.y - p.start.y) > (e.pointerType === "mouse" ? 4 : 10)) p.moved = true;
    if (p.moved) {
      this.host.artPan(e, e.screen.x - p.last.x, e.screen.y - p.last.y);
      this.host.setArtHover(null);
    }
    p.last = e.screen;
  }

  onUp(e: PEvent) {
    const p = this.press;
    this.press = null;
    if (!p || p.moved) return;
    const key = this.host.artPick(e);
    const sel = this.host.artSelection();
    if (e.shift || e.ctrl) {
      if (!key) return;
      this.host.setArtSelection(sel.includes(key) ? sel.filter((k) => k !== key) : [...sel, key]);
    } else this.host.setArtSelection(key ? [key] : []);
  }

  cancel(): boolean {
    if (!this.press) return false;
    this.press = null;
    return true;
  }
}
