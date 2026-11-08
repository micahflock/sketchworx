import type { Id } from "../model/types";
import type { PEvent, Tool, ToolHost } from "./tool";

/** Convert Entities as a pick tool: each click on earlier geometry converts it. */
export class ConvertTool implements Tool {
  readonly id = "convert";
  readonly cursor = "crosshair";
  constructor(private host: ToolHost & { convertIds(ids: Id[]): void }) {}
  activate() {
    this.host.setPrompt("Click lines, arcs, circles, splines or points of an earlier sketch to copy them into this one, linked. Esc to finish");
  }
  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const h = this.host.hit(e.world, e.pointerType);
    if (!h) return;
    this.host.convertIds([h.id]);
  }
  onMove(e: PEvent) {
    const h = this.host.hit(e.world, e.pointerType);
    this.host.setHover(h && this.host.sketch().ext?.[h.id] ? h.id : null);
  }
  onUp() {}
  cancel() {
    return false;
  }
}
