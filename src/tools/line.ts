import type { Vec2 } from "../geom/vec";
import { dist, sub, add, perp, norm, scale } from "../geom/vec";
import { ptv } from "../model/sketch";
import type { SnapResult } from "../inference/snap";
import type { Id } from "../model/types";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import { addArc, addLine, applyHV, applySnap, drawSnap, DRAG_THRESHOLD_PX, screenDist } from "./common";
import type { PEvent, Tool, ToolHost, ToolOption } from "./tool";
import { tangentArcFrom } from "./arcmath";

export type LineMode = "line" | "centerline" | "midpoint";

/**
 * SolidWorks Line: click-click chains, double-click or Esc ends, click-drag places
 * a single line. Pressing A (or dragging back out of the last endpoint) switches
 * to a tangent arc for the next segment.
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
  }

  private prompt() {
    if (!this.start) this.host.setPrompt(this.mode === "midpoint" ? "Click the midpoint of the line" : "Click to start the line");
    else if (this.arcMode) this.host.setPrompt("Tangent arc: click the end point (A returns to lines)");
    else this.host.setPrompt("Click the end point. Double-click or Esc ends the chain; A for a tangent arc");
  }

  private snapAt(e: PEvent): SnapResult {
    const skip = new Set<Id>();
    return this.host.snap(e.world, { from: this.start?.pos, skip, suppress: e.ctrl || this.host.suppress(), dirRefs: this.dirRefs() });
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
    this.place(sn);
  }

  onMove(e: PEvent) {
    this.cur = this.snapAt(e);
    this.trackGesture(e);
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
    if (!this.start || !this.pressedFirst || !this.downScreen) return;
    this.pressedFirst = false;
    // Click-drag-release: place a single line and end.
    if (screenDist(e.screen, this.downScreen) > DRAG_THRESHOLD_PX) {
      const sn = this.snapAt(e);
      this.place(sn);
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

  /** Commit a segment from start to sn. */
  private place(sn: SnapResult) {
    const st = this.start!;
    if (dist(st.pos, sn.pos) < this.host.view.px(2)) return;
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
      applyHV(ed, r.line, sn);
      if (sn.dirRel && ed.s.entities[sn.dirRel.ref]) ed.addRelation({ type: sn.dirRel.type, refs: [sn.dirRel.ref, r.line] });
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
      p.textScreen(fmt(len), s.x + 14, s.y - 14, "#333", "11px system-ui", "left");
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
