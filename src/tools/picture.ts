import type { Vec2 } from "../geom/vec";
import { dist } from "../geom/vec";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import { fmt } from "./line";
import type { PEvent, Tool, ToolHost } from "./tool";

/** Calibrate a Sketch Picture: draw a line over a feature of known size, then enter its length. */
export class PictureScaleTool implements Tool {
  readonly id = "pictureScale";
  readonly cursor = "crosshair";
  private a: Vec2 | null = null;
  private cur: Vec2 | null = null;
  constructor(private host: ToolHost & { setPicture(p: Record<string, number>): void }) {}
  activate() {
    this.a = null;
    this.host.setPrompt("Click both ends of a feature of known size on the picture");
  }
  onDown(e: PEvent) {
    if (e.button !== 0) return;
    if (!this.a) {
      this.a = e.world;
      this.host.setPrompt("Click the other end");
      return;
    }
    const a = this.a;
    const b = e.world;
    this.a = null;
    const measured = dist(a, b);
    const pic = this.host.sketch().picture;
    if (!pic || measured <= 0) return this.host.setTool("select");
    const text = window.prompt(`Length of this feature (currently ${fmt(measured)}):`, fmt(measured));
    const real = Number(text);
    if (text !== null && real > 0) {
      const k = real / measured;
      // Keep the first clicked point fixed on the picture.
      this.host.setPicture({ scale: pic.scale * k, x: a.x - (a.x - pic.x) * k, y: a.y - (a.y - pic.y) * k });
    }
    this.host.setTool("select");
  }
  onMove(e: PEvent) {
    this.cur = e.world;
    if (this.a) this.host.requestRender();
  }
  onUp() {}
  cancel() {
    if (!this.a) return false;
    this.a = null;
    return true;
  }
  draw(p: Painter) {
    if (this.a && this.cur) {
      p.line(this.a, this.cur, { color: theme.hover, width: 2 });
      const s = p.s(this.cur);
      p.textScreen(fmt(dist(this.a, this.cur)), s.x + 12, s.y - 12, "#333", "11px system-ui", "left");
    }
  }
}
