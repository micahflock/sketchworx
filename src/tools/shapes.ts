import type { Vec2 } from "../geom/vec";
import { add, circleFrom3, dist, normAngle, polar, scale, sub, perp, norm, dot } from "../geom/vec";
import type { SnapResult } from "../inference/snap";
import type { Editor } from "../model/editor";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import { arcFrom3 } from "./arcmath";
import { addArc, addCircle, addLine, applySnap, drawSnap, DRAG_THRESHOLD_PX, screenDist } from "./common";
import { fmt } from "./line";
import type { PEvent, Tool, ToolHost, ToolOption } from "./tool";

const previewStyle = (construction: boolean) => ({ color: theme.preview, width: 1.5, dash: construction ? [8, 3, 2, 3] : undefined });

/**
 * Base for tools that collect N clicks (click-click or press-drag-release for the
 * second point). Subclasses implement prompts, preview and commit.
 */
abstract class ClickTool implements Tool {
  abstract readonly id: string;
  readonly cursor = "crosshair";
  protected pts: { pos: Vec2; snap: SnapResult }[] = [];
  protected cur: SnapResult | undefined;
  private downScreen: Vec2 | null = null;
  construction = false;

  constructor(protected host: ToolHost) {}
  protected abstract need: number;
  protected abstract prompts: string[];
  protected abstract commitShape(pts: { pos: Vec2; snap: SnapResult }[]): void;
  protected abstract preview(p: Painter, pts: Vec2[], cur: Vec2): void;
  protected anchor(): Vec2 | undefined {
    return this.pts[this.pts.length - 1]?.pos;
  }

  activate() {
    this.pts = [];
    this.host.setPrompt(this.prompts[0]);
  }
  deactivate() {
    this.pts = [];
    this.cur = undefined;
  }

  protected snapAt(e: PEvent) {
    return this.host.snap(e.world, { from: this.anchor(), suppress: e.ctrl || this.host.suppress() });
  }

  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const sn = this.snapAt(e);
    this.downScreen = e.screen;
    this.push(sn);
  }
  private push(sn: SnapResult) {
    const last = this.pts[this.pts.length - 1];
    if (last && dist(last.pos, sn.pos) < this.host.view.px(2)) return;
    this.pts.push({ pos: sn.pos, snap: sn });
    if (this.pts.length >= this.need) {
      const pts = this.pts;
      this.pts = [];
      this.commitShape(pts);
    }
    this.host.setPrompt(this.prompts[this.pts.length] ?? this.prompts[0]);
    this.host.requestRender();
  }
  onMove(e: PEvent) {
    this.cur = this.snapAt(e);
    this.host.requestRender();
  }
  onUp(e: PEvent) {
    // Press-drag-release from the first point places the second.
    if (this.pts.length === 1 && this.downScreen && screenDist(e.screen, this.downScreen) > DRAG_THRESHOLD_PX) {
      this.push(this.snapAt(e));
    }
    this.downScreen = null;
  }
  cancel(): boolean {
    if (!this.pts.length) return false;
    this.pts = [];
    this.host.setPrompt(this.prompts[0]);
    this.host.requestRender();
    return true;
  }
  draw(p: Painter) {
    if (this.cur && this.pts.length) this.preview(p, this.pts.map((q) => q.pos), this.cur.pos);
    drawSnap(p, this.cur);
  }
  options(): ToolOption[] {
    return [{ kind: "check", key: "construction", label: "For construction", value: this.construction, set: (v) => (this.construction = v) }];
  }
}

export class PointTool extends ClickTool {
  readonly id = "point";
  protected need = 1;
  protected prompts = ["Click to place a point"];
  protected anchor() {
    return undefined;
  }
  protected commitShape(pts: { pos: Vec2; snap: SnapResult }[]) {
    const [a] = pts;
    if (a.snap.point) return; // a point on a point adds nothing
    this.host.commit("Point", (ed) => {
      const id = ed.addPoint(a.pos.x, a.pos.y);
      applySnap(ed, id, a.snap);
    });
  }
  protected preview() {}
}

export class CircleTool extends ClickTool {
  readonly id: string;
  protected need: number;
  protected prompts: string[];
  constructor(host: ToolHost, public mode: "center" | "perimeter" = "center") {
    super(host);
    this.id = mode === "center" ? "circle" : "circle3";
    this.need = mode === "center" ? 2 : 3;
    this.prompts =
      mode === "center"
        ? ["Click the circle center", "Click to set the radius"]
        : ["Click the first point on the circle", "Click the second point", "Click the third point"];
  }
  protected anchor() {
    return undefined;
  }
  protected commitShape(pts: { pos: Vec2; snap: SnapResult }[]) {
    if (this.mode === "center") {
      const [c, r] = pts;
      const rad = dist(c.pos, r.pos);
      this.host.commit("Circle", (ed) => {
        const res = addCircle(ed, c.pos, rad, this.construction);
        applySnap(ed, res.c, c.snap);
        if (r.snap.point) ed.addRelation({ type: "coincident", refs: [r.snap.point, res.circle] });
      });
    } else {
      const circ = circleFrom3(pts[0].pos, pts[1].pos, pts[2].pos);
      if (!circ) return this.host.flash("Points are collinear", "error");
      this.host.commit("Circle", (ed) => {
        const res = addCircle(ed, circ.c, circ.r, this.construction);
        for (const q of pts) if (q.snap.point) ed.addRelation({ type: "coincident", refs: [q.snap.point, res.circle] });
      });
    }
  }
  protected preview(p: Painter, pts: Vec2[], cur: Vec2) {
    const st = previewStyle(this.construction);
    if (this.mode === "center") {
      p.circle(pts[0], dist(pts[0], cur), st);
      p.line(pts[0], cur, { color: theme.preview, width: 1, dash: [3, 3] });
      const s = p.s(cur);
      p.textScreen("R " + fmt(dist(pts[0], cur)), s.x + 14, s.y - 14, "#333", "11px system-ui", "left");
    } else if (pts.length === 1) p.line(pts[0], cur, { color: theme.preview, width: 1, dash: [3, 3] });
    else {
      const circ = circleFrom3(pts[0], pts[1], cur);
      if (circ) p.circle(circ.c, circ.r, st);
    }
  }
}

/** Centerpoint arc: center, start, end (direction follows the mouse), or 3-point arc. */
export class ArcTool extends ClickTool {
  readonly id: string;
  protected need = 3;
  protected prompts: string[];
  /** Accumulated sweep while choosing the end of a centerpoint arc. */
  private sweep = 0;
  private lastAng: number | null = null;

  constructor(host: ToolHost, public mode: "center" | "threepoint" = "center") {
    super(host);
    this.id = mode === "center" ? "arc" : "arc3";
    this.prompts =
      mode === "center"
        ? ["Click the arc center", "Click the arc start point", "Click the arc end point"]
        : ["Click the arc start point", "Click the arc end point", "Click a point on the arc"];
  }
  protected anchor() {
    return this.mode === "center" && this.pts.length === 2 ? undefined : this.pts[this.pts.length - 1]?.pos;
  }
  onMove(e: PEvent) {
    super.onMove(e);
    if (this.mode === "center" && this.pts.length === 2 && this.cur) {
      const c = this.pts[0].pos;
      const a = Math.atan2(this.cur.pos.y - c.y, this.cur.pos.x - c.x);
      if (this.lastAng === null) {
        const s = this.pts[1].pos;
        this.lastAng = Math.atan2(s.y - c.y, s.x - c.x);
      }
      let d = a - this.lastAng;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      this.sweep += d;
      this.lastAng = a;
    }
  }
  onDown(e: PEvent) {
    if (this.pts.length < 2) {
      this.sweep = 0;
      this.lastAng = null;
    }
    super.onDown(e);
  }
  private centerArc(pts: Vec2[], cur: Vec2) {
    const [c, s] = pts;
    const r = dist(c, s);
    const a0 = Math.atan2(s.y - c.y, s.x - c.x);
    const a1 = Math.atan2(cur.y - c.y, cur.x - c.x);
    const end = polar(c, r, a1);
    return { c, r, a0, a1, end, ccw: this.sweep >= 0 };
  }
  protected commitShape(pts: { pos: Vec2; snap: SnapResult }[]) {
    if (this.mode === "center") {
      const g = this.centerArc([pts[0].pos, pts[1].pos], pts[2].pos);
      if (normAngle(g.a1 - g.a0) < 1e-6) return;
      const endPos = pts[2].snap.point ? pts[2].pos : g.end;
      this.host.commit("Arc", (ed) => {
        const r = g.ccw ? addArc(ed, g.c, pts[1].pos, endPos, this.construction) : addArc(ed, g.c, endPos, pts[1].pos, this.construction);
        applySnap(ed, r.c, pts[0].snap);
        applySnap(ed, g.ccw ? r.s : r.e, pts[1].snap);
        applySnap(ed, g.ccw ? r.e : r.s, pts[2].snap);
      });
    } else {
      const arc = arcFrom3(pts[0].pos, pts[1].pos, pts[2].pos);
      if (!arc) return this.host.flash("Points are collinear", "error");
      this.host.commit("Arc", (ed) => {
        const r = arc.ccw ? addArc(ed, arc.c, pts[0].pos, pts[1].pos, this.construction) : addArc(ed, arc.c, pts[1].pos, pts[0].pos, this.construction);
        applySnap(ed, arc.ccw ? r.s : r.e, pts[0].snap);
        applySnap(ed, arc.ccw ? r.e : r.s, pts[1].snap);
      });
    }
  }
  protected preview(p: Painter, pts: Vec2[], cur: Vec2) {
    const st = previewStyle(this.construction);
    const thin = { color: theme.preview, width: 1, dash: [3, 3] };
    if (this.mode === "center") {
      if (pts.length === 1) {
        p.line(pts[0], cur, thin);
        p.circle(pts[0], dist(pts[0], cur), { ...thin, color: "rgba(31,63,224,0.35)" });
      } else {
        const g = this.centerArc(pts, cur);
        p.line(g.c, pts[1], thin);
        p.line(g.c, g.end, thin);
        if (g.ccw) p.arc(g.c, g.r, g.a0, g.a1, st);
        else p.arc(g.c, g.r, g.a1, g.a0, st);
      }
    } else if (pts.length === 1) p.line(pts[0], cur, thin);
    else {
      const arc = arcFrom3(pts[0], pts[1], cur);
      if (!arc) p.line(pts[0], pts[1], st);
      else if (arc.ccw) p.arc(arc.c, arc.r, arc.a0, arc.a1, st);
      else p.arc(arc.c, arc.r, arc.a1, arc.a0, st);
    }
  }
}

export type RectMode = "corner" | "center" | "3corner" | "3center" | "parallelogram";

/** Rectangle family; each variant adds the SolidWorks relations. */
export class RectTool extends ClickTool {
  readonly id: string;
  protected need: number;
  protected prompts: string[];
  constructor(host: ToolHost, public mode: RectMode = "corner") {
    super(host);
    this.id = { corner: "rect", center: "rectCenter", "3corner": "rect3", "3center": "rect3Center", parallelogram: "parallelogram" }[mode];
    this.need = mode === "corner" || mode === "center" ? 2 : 3;
    this.prompts = {
      corner: ["Click the first corner", "Click the opposite corner"],
      center: ["Click the rectangle center", "Click a corner"],
      "3corner": ["Click the first corner", "Click the second corner (sets width and angle)", "Click to set the height"],
      "3center": ["Click the rectangle center", "Click the midpoint of a side (sets angle)", "Click a corner"],
      parallelogram: ["Click the first corner", "Click the second corner", "Click the third corner"],
    }[mode];
  }
  protected anchor() {
    return this.mode === "corner" || this.mode === "center" ? undefined : super.anchor();
  }

  /** Corner positions in order for the current input. */
  corners(pts: Vec2[]): Vec2[] | null {
    const m = this.mode;
    if (m === "corner") {
      const [a, b] = pts;
      return [a, { x: b.x, y: a.y }, b, { x: a.x, y: b.y }];
    }
    if (m === "center") {
      const [c, k] = pts;
      const d = sub(k, c);
      return [sub(c, d), { x: c.x + d.x, y: c.y - d.y }, add(c, d), { x: c.x - d.x, y: c.y + d.y }];
    }
    if (pts.length < 3) return null;
    if (m === "3corner") {
      const [a, b, h] = pts;
      const n = perp(norm(sub(b, a)));
      const t = dot(sub(h, b), n);
      const off = scale(n, t);
      return [a, b, add(b, off), add(a, off)];
    }
    if (m === "3center") {
      const [c, mside, k] = pts;
      const u = norm(sub(mside, c));
      const n = perp(u);
      const hu = dot(sub(k, c), u);
      const hn = dot(sub(k, c), n);
      const P = (su: number, sn: number) => add(c, add(scale(u, su * hu), scale(n, sn * hn)));
      return [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)];
    }
    const [a, b, c] = pts;
    return [a, b, c, add(a, sub(c, b))];
  }

  protected commitShape(pts: { pos: Vec2; snap: SnapResult }[]) {
    const cs = this.corners(pts.map((q) => q.pos));
    if (!cs) return;
    if (dist(cs[0], cs[2]) < this.host.view.px(3)) return;
    this.host.commit("Rectangle", (ed) => {
      const lines = buildLoop(ed, cs, this.construction);
      const m = this.mode;
      const [l0, l1, l2, l3] = lines.map((l) => l.line);
      if (m === "corner" || m === "center") {
        for (const l of [l0, l2]) ed.addRelation({ type: "horizontal", refs: [l] });
        for (const l of [l1, l3]) ed.addRelation({ type: "vertical", refs: [l] });
      } else if (m === "3corner" || m === "3center") {
        ed.addRelation({ type: "parallel", refs: [l0, l2] });
        ed.addRelation({ type: "parallel", refs: [l1, l3] });
        ed.addRelation({ type: "perpendicular", refs: [l0, l1] });
      } else {
        ed.addRelation({ type: "parallel", refs: [l0, l2] });
        ed.addRelation({ type: "parallel", refs: [l1, l3] });
      }
      if (m === "center" || m === "3center") {
        // Construction diagonals with the center point at their intersection.
        const d1 = addLine(ed, cs[0], cs[2], true);
        const d2 = addLine(ed, cs[1], cs[3], true);
        ed.addRelation({ type: "coincident", refs: [d1.p1, lines[0].p1] });
        ed.addRelation({ type: "coincident", refs: [d1.p2, lines[2].p1] });
        ed.addRelation({ type: "coincident", refs: [d2.p1, lines[1].p1] });
        ed.addRelation({ type: "coincident", refs: [d2.p2, lines[3].p1] });
        const c = ed.addPoint(pts[0].pos.x, pts[0].pos.y);
        ed.addRelation({ type: "midpoint", refs: [c, d1.line] });
        ed.addRelation({ type: "midpoint", refs: [c, d2.line] });
        applySnap(ed, c, pts[0].snap);
      } else {
        applySnap(ed, lines[0].p1, pts[0].snap);
        if (m === "corner") applySnap(ed, lines[2].p1, pts[1].snap);
        else applySnap(ed, lines[1].p1, pts[1].snap);
      }
    });
  }
  protected preview(p: Painter, pts: Vec2[], cur: Vec2) {
    const all = [...pts, cur];
    const st = previewStyle(this.construction);
    if (all.length === 2 && (this.mode === "3corner" || this.mode === "parallelogram" || this.mode === "3center")) {
      p.line(all[0], all[1], st);
      return;
    }
    const cs = this.corners(all);
    if (!cs) return;
    p.polyline(cs, st, true);
    if (this.mode === "center" || this.mode === "3center") {
      p.line(cs[0], cs[2], { color: theme.preview, width: 1, dash: [6, 3] });
      p.line(cs[1], cs[3], { color: theme.preview, width: 1, dash: [6, 3] });
    }
    const s = p.s(cur);
    p.textScreen(`${fmt(dist(cs[0], cs[1]))} × ${fmt(dist(cs[1], cs[2]))}`, s.x + 14, s.y - 14, "#333", "11px system-ui", "left");
  }
  options(): ToolOption[] {
    return [...super.options(), { kind: "info", key: "m", label: midLabel(this.mode) }];
  }
}

const midLabel = (m: RectMode) =>
  ({ corner: "Corner Rectangle", center: "Center Rectangle", "3corner": "3 Point Corner Rectangle", "3center": "3 Point Center Rectangle", parallelogram: "Parallelogram" })[m];

/** Closed loop of lines through the corners, with coincident relations. */
export function buildLoop(ed: Editor, cs: Vec2[], construction: boolean) {
  const lines = cs.map((a, i) => addLine(ed, a, cs[(i + 1) % cs.length], construction));
  for (let i = 0; i < lines.length; i++) ed.addRelation({ type: "coincident", refs: [lines[i].p2, lines[(i + 1) % lines.length].p1] });
  return lines;
}



