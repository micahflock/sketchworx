import type { Vec2 } from "../geom/vec";
import { dist, sub, add, perp, norm, scale } from "../geom/vec";
import { ptv } from "../model/sketch";
import type { SnapResult } from "../inference/snap";
import type { Id } from "../model/types";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import { addArc, addLine, applyHV, applySnap, drawSnap, DRAG_THRESHOLD_PX, dragThreshold, MOUSE_SLOP_PX, screenDist } from "./common";
import type { PEvent, Tool, ToolHost, ToolOption } from "./tool";
import { tangentArcFrom } from "./arcmath";

export type LineMode = "line" | "centerline" | "midpoint";

/** Touch target around the chain's last end point (screen px): a drag starting inside it continues the chain. */
export const CHAIN_TARGET_PX = { touch: 34, pen: 22 };

/**
 * SolidWorks Line: click-click chains, double-click or Esc ends, click-drag places
 * a single line. Pressing A (or dragging back out of the last endpoint) switches
 * to a tangent arc for the next segment.
 *
 * Touch and pen only drag: each press-drag-lift draws one segment. A drag that starts on the last
 * end point (a generous target) continues the chain; one anywhere else starts a new line.
 */
export class LineTool implements Tool {
  readonly id: string;
  readonly cursor = "crosshair";
  private start: { pos: Vec2; snap?: SnapResult; prevEnd?: Id; prevLine?: Id; prevDir?: Vec2 } | null = null;
  private cur: SnapResult | undefined;
  private downScreen: Vec2 | null = null;
  private pressedFirst = false;
  private arcMode = false;
  /** Drag-back-out gesture: leave the endpoint, come back to it, leave again → tangent arc. */
  private gesture: "away" | "returned" | "idle" = "idle";
  /** Touch/pen press in progress, and the chain it replaced (restored if the press is cancelled). */
  private touchPress: { prev: LineTool["start"] } | null = null;
  /** The last input was touch or pen: no rubber band between presses, show the chain target. */
  private touchInput = false;
  construction: boolean;

  constructor(private host: ToolHost, public mode: LineMode = "line") {
    this.id = mode === "line" ? "line" : mode === "centerline" ? "centerline" : "midline";
    this.construction = mode === "centerline";
  }

  activate() {
    this.prompt();
  }
  deactivate() {
    this.start = null;
    this.cur = undefined;
    this.arcMode = false;
    this.touchPress = null;
  }

  private prompt() {
    if (this.touchInput) {
      if (this.mode === "midpoint") this.host.setPrompt("Drag out from the midpoint of the line");
      else if (!this.start) this.host.setPrompt("Drag to draw a line");
      else if (this.arcMode) this.host.setPrompt("Tangent arc: drag from the end point (A returns to lines)");
      else this.host.setPrompt("Drag from the end point to continue, or anywhere for a new line");
    } else if (!this.start) this.host.setPrompt(this.mode === "midpoint" ? "Click the midpoint of the line" : "Click to start the line");
    else if (this.arcMode) this.host.setPrompt("Tangent arc: click the end point (A returns to lines)");
    else this.host.setPrompt("Click the end point. Double-click or Esc ends the chain; A for a tangent arc");
  }

  private snapAt(e: PEvent): SnapResult {
    // The end never snaps back onto the point the segment starts from.
    const skip = new Set<Id>();
    const from = this.start?.prevEnd ?? this.start?.snap?.point;
    if (from) skip.add(from);
    return this.host.snap(e.world, { from: this.start?.pos, skip, suppress: e.ctrl || this.host.suppress(), dirRefs: this.dirRefs() });
  }

  private isTouch(e: PEvent) {
    return e.pointerType === "touch" || e.pointerType === "pen";
  }

  /** The press lands on the chain's last end point (within the enlarged touch target). */
  private onChainEnd(e: PEvent): boolean {
    const st = this.start;
    if (!st?.prevEnd) return false;
    const r = e.pointerType === "pen" ? CHAIN_TARGET_PX.pen : CHAIN_TARGET_PX.touch;
    return dist(this.host.view.toScreen(st.pos), e.screen) <= r;
  }

  private touchDown(e: PEvent) {
    this.touchPress = { prev: this.start };
    this.downScreen = e.screen;
    if (!this.onChainEnd(e)) {
      // A new line: snap the start on its own, not relative to the old chain.
      this.start = null;
      this.arcMode = false;
      const sn = this.snapAt(e);
      this.start = { pos: sn.pos, snap: sn };
    }
    this.gesture = "idle";
    this.cur = this.snapAt(e);
    this.host.requestRender();
  }

  private touchUp(e: PEvent) {
    const press = this.touchPress;
    this.touchPress = null;
    if (!press || !this.start || !this.downScreen) return;
    if (screenDist(e.screen, this.downScreen) > DRAG_THRESHOLD_PX) {
      this.place(this.snapAt(e));
      // A drag too short to draw leaves no half-started line behind.
      if (this.start && !this.start.prevEnd) this.start = press.prev;
    } else {
      // A tap draws nothing and ends the chain.
      this.start = null;
      this.arcMode = false;
    }
    this.cur = undefined;
    this.prompt();
    this.host.requestRender();
  }

  /** Directions from the chain start that infer tangent/perpendicular relations. */
  private dirRefs() {
    const st = this.start;
    if (!st || this.arcMode || this.mode === "midpoint") return [];
    const out: { dir: Vec2; type: "tangent" | "perpendicular"; ref: Id }[] = [];
    const s = this.host.sketch();
    const fromEntity = (id: Id | undefined, pointId: Id | undefined, travel?: Vec2) => {
      const e = id ? s.entities[id] : undefined;
      if (!e) return;
      if (e.type === "line") {
        const d = travel ?? sub(ptv(s, e.p2), ptv(s, e.p1));
        out.push({ dir: perp(d), type: "perpendicular", ref: e.id }, { dir: scale(perp(d), -1), type: "perpendicular", ref: e.id });
      } else if (e.type === "arc" && pointId) {
        const c = ptv(s, e.c);
        const p = ptv(s, pointId);
        const t = norm(perp(sub(p, c))); // CCW tangent
        out.push({ dir: travel ?? (pointId === e.s ? scale(t, -1) : t), type: "tangent", ref: e.id });
      }
    };
    if (st.prevLine) fromEntity(st.prevLine, st.prevEnd, s.entities[st.prevLine]?.type === "arc" ? st.prevDir : undefined);
    else if (st.snap?.point) {
      const pe = s.entities[st.snap.point];
      if (pe?.type === "point" && pe.owner) fromEntity(pe.owner, pe.id);
    }
    return out;
  }

  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const touch = this.isTouch(e);
    if (touch !== this.touchInput) {
      this.touchInput = touch;
      this.prompt();
    }
    if (touch) return this.touchDown(e);
    const sn = this.snapAt(e);
    this.cur = sn;
    this.downScreen = e.screen;
    if (!this.start) {
      this.start = { pos: sn.pos, snap: sn };
      this.pressedFirst = true;
      this.prompt();
      return;
    }
    this.pressedFirst = false;
    this.place(sn, MOUSE_SLOP_PX);
  }

  onMove(e: PEvent) {
    if (this.touchInput && e.pointerType === "mouse") {
      this.touchInput = false;
      this.prompt();
    }
    if (this.isTouch(e) && !this.touchPress) {
      // Pen hovering between strokes: show what a press would snap to, with no rubber band.
      this.cur = this.onChainEnd(e) ? undefined : this.host.snap(e.world, { suppress: e.ctrl || this.host.suppress() });
      this.host.requestRender();
      return;
    }
    this.cur = this.snapAt(e);
    if (!this.touchPress) this.trackGesture(e);
    this.host.requestRender();
  }

  private trackGesture(e: PEvent) {
    const st = this.start;
    if (!st?.prevEnd || this.mode === "midpoint") return;
    const d = dist(this.host.view.toScreen(st.pos), e.screen);
    if (this.gesture === "idle" && d > 24) this.gesture = "away";
    else if (this.gesture === "away" && d < 6) this.gesture = "returned";
    else if (this.gesture === "returned" && d > 12) {
      this.gesture = "away";
      this.arcMode = !this.arcMode;
      this.prompt();
    }
  }

  onUp(e: PEvent) {
    if (this.touchPress) return this.touchUp(e);
    if (!this.start || !this.pressedFirst || !this.downScreen) return;
    this.pressedFirst = false;
    // Click-drag-release: place a single line and end. A smaller wobble is still a click.
    if (screenDist(e.screen, this.downScreen) > dragThreshold(e.pointerType)) {
      const sn = this.snapAt(e);
      this.place(sn, MOUSE_SLOP_PX);
      this.endChain();
    }
  }

  onDoubleClick() {
    this.endChain();
  }

  onKey(k: KeyboardEvent): boolean {
    if (k.key.toLowerCase() === "a" && this.start?.prevEnd) {
      this.arcMode = !this.arcMode;
      this.prompt();
      this.host.requestRender();
      return true;
    }
    return false;
  }

  cancel(): boolean {
    if (this.touchPress) {
      // A second finger arrived mid-drag: drop this segment, keep the chain.
      this.start = this.touchPress.prev;
      this.touchPress = null;
      this.cur = undefined;
      this.prompt();
      this.host.requestRender();
      return true;
    }
    if (!this.start) return false;
    this.endChain();
    return true;
  }

  private endChain() {
    this.start = null;
    this.arcMode = false;
    this.gesture = "idle";
    this.prompt();
    this.host.requestRender();
  }

  /**
   * Commit a segment from start to sn. Segments shorter than `minPx` on screen are ignored (a wobbly
   * click), unless they end on an existing point.
   */
  private place(sn: SnapResult, minPx = 2) {
    const st = this.start!;
    const d = dist(st.pos, sn.pos);
    if (d < this.host.view.px(2)) return;
    if (d < this.host.view.px(minPx) && !sn.point) return;
    if (this.arcMode && st.prevDir) {
      const arc = tangentArcFrom(st.pos, st.prevDir, sn.pos);
      if (!arc) return;
      let created: { endId: Id; arcId: Id } | null = null;
      this.host.commit("Tangent Arc", (ed) => {
        const r = arc.ccw ? addArc(ed, arc.c, st.pos, sn.pos, this.construction) : addArc(ed, arc.c, sn.pos, st.pos, this.construction);
        const startPt = arc.ccw ? r.s : r.e;
        const endPt = arc.ccw ? r.e : r.s;
        if (st.prevEnd) ed.addRelation({ type: "coincident", refs: [startPt, st.prevEnd] });
        if (st.prevLine) ed.addRelation({ type: "tangent", refs: [st.prevLine, r.arc] });
        applySnap(ed, endPt, sn);
        created = { endId: endPt, arcId: r.arc };
      });
      const c = created as { endId: Id; arcId: Id } | null;
      this.arcMode = false;
      if (sn.point || !c) return this.endChain();
      const tangentDir = arc.endDir;
      this.start = { pos: sn.pos, prevEnd: c.endId, prevLine: c.arcId, prevDir: tangentDir };
      this.gesture = "idle";
      this.prompt();
      return;
    }
    let a = st.pos;
    let b = sn.pos;
    if (this.mode === "midpoint") {
      const d = sub(sn.pos, st.pos);
      a = sub(st.pos, d);
      b = add(st.pos, d);
    }
    let made: { line: Id; p2: Id } | null = null;
    this.host.commit(this.construction ? "Centerline" : "Line", (ed) => {
      const r = addLine(ed, a, b, this.construction);
      if (this.mode === "midpoint") {
        const m = ed.addPoint(st.pos.x, st.pos.y);
        ed.addRelation({ type: "midpoint", refs: [m, r.line] });
        applySnap(ed, m, st.snap);
      } else {
        if (st.prevEnd && ed.s.entities[st.prevEnd]) ed.addRelation({ type: "coincident", refs: [r.p1, st.prevEnd] });
        else applySnap(ed, r.p1, st.snap);
        applySnap(ed, r.p2, sn);
      }
      applyHV(ed, r.line, sn); // a tangent/perpendicular snap only sets the direction
      made = r;
    });
    const m = made as { line: Id; p2: Id } | null;
    // Closing onto an existing point (or a midpoint line) ends the chain.
    if (this.mode === "midpoint" || sn.point || !m) return this.endChain();
    this.start = { pos: sn.pos, prevEnd: m.p2, prevLine: m.line, prevDir: sub(sn.pos, st.pos) };
    this.gesture = "idle";
    this.prompt();
  }

  draw(p: Painter) {
    const sn = this.cur;
    if (this.touchInput && !this.touchPress) {
      // Between touch strokes: mark the enlarged target that continues the chain.
      if (this.start?.prevEnd) {
        p.ring(this.start.pos, CHAIN_TARGET_PX.touch, theme.previewFaint, 1.5);
        p.dot(this.start.pos, 4, theme.preview);
      }
      drawSnap(p, sn);
      return;
    }
    if (this.start && sn) {
      const st = { color: theme.preview, width: 1.5, dash: this.construction ? [8, 3, 2, 3] : undefined };
      if (this.arcMode && this.start.prevDir) {
        const arc = tangentArcFrom(this.start.pos, this.start.prevDir, sn.pos);
        if (arc) {
          if (arc.ccw) p.arc(arc.c, arc.r, arc.a0, arc.a1, st);
          else p.arc(arc.c, arc.r, arc.a1, arc.a0, st);
        } else p.line(this.start.pos, sn.pos, st);
      } else if (this.mode === "midpoint") {
        const d = sub(sn.pos, this.start.pos);
        p.line(sub(this.start.pos, d), add(this.start.pos, d), st);
      } else p.line(this.start.pos, sn.pos, st);
      const s = p.s(sn.pos);
      const len = this.mode === "midpoint" ? dist(this.start.pos, sn.pos) * 2 : dist(this.start.pos, sn.pos);
      p.textScreen(fmt(len), s.x + 14, s.y - 14, theme.measure, "11px system-ui", "left");
    }
    drawSnap(p, sn);
  }

  options(): ToolOption[] {
    return [
      { kind: "check", key: "construction", label: "For construction", value: this.construction, set: (v) => (this.construction = v) },
      { kind: "info", key: "help", label: "A: toggle tangent arc · Ctrl: no auto relations" },
    ];
  }
}

export const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toFixed(1) : Math.abs(n) >= 10 ? n.toFixed(2) : n.toFixed(3)).replace(/\.?0+$/, "");
