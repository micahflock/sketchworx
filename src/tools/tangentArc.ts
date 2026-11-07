import type { Vec2 } from "../geom/vec";
import { norm, perp, scale, sub } from "../geom/vec";
import type { SnapResult } from "../inference/snap";
import { ptv } from "../model/sketch";
import type { Id } from "../model/types";
import type { Painter } from "../render/painter";
import { theme } from "../render/theme";
import { tangentArcFrom } from "./arcmath";
import { addArc, applySnap, drawSnap } from "./common";
import type { PEvent, Tool, ToolHost, ToolOption } from "./tool";

/** SolidWorks Tangent Arc: start on the endpoint of a line or arc, click the end. */
export class TangentArcTool implements Tool {
  readonly id = "tangentArc";
  readonly cursor = "crosshair";
  private start: { pos: Vec2; point: Id; owner: Id; dir: Vec2 } | null = null;
  private cur: SnapResult | undefined;
  construction = false;

  constructor(private host: ToolHost) {}

  activate() {
    this.start = null;
    this.host.setPrompt("Click the endpoint of a line or arc to start the tangent arc");
  }
  deactivate() {
    this.start = null;
  }

  /** Direction leaving an endpoint, continuing the curve it ends. */
  private leaveDir(pointId: Id): { owner: Id; dir: Vec2 } | null {
    const s = this.host.sketch();
    const p = s.entities[pointId];
    if (p?.type !== "point" || !p.owner) return null;
    const e = s.entities[p.owner];
    if (e?.type === "line") {
      const other = e.p1 === pointId ? e.p2 : e.p1;
      return { owner: e.id, dir: sub(ptv(s, pointId), ptv(s, other)) };
    }
    if (e?.type === "arc" && pointId !== e.c) {
      const t = norm(perp(sub(ptv(s, pointId), ptv(s, e.c))));
      return { owner: e.id, dir: pointId === e.s ? scale(t, -1) : t };
    }
    return null;
  }

  onDown(e: PEvent) {
    if (e.button !== 0) return;
    const sn = this.host.snap(e.world, { suppress: false });
    if (!this.start) {
      const ld = sn.point ? this.leaveDir(sn.point) : null;
      if (!ld) return this.host.flash("Start the tangent arc on the endpoint of a line or arc", "error");
      this.start = { pos: sn.pos, point: sn.point!, ...ld };
      this.host.setPrompt("Click the end point of the tangent arc");
      return;
    }
    const st = this.start;
    const arc = tangentArcFrom(st.pos, st.dir, sn.pos);
    if (!arc) return;
    this.host.commit("Tangent Arc", (ed) => {
      const r = arc.ccw ? addArc(ed, arc.c, st.pos, sn.pos, this.construction) : addArc(ed, arc.c, sn.pos, st.pos, this.construction);
      const startPt = arc.ccw ? r.s : r.e;
      ed.addRelation({ type: "coincident", refs: [startPt, st.point] });
      ed.addRelation({ type: "tangent", refs: [st.owner, r.arc] });
      applySnap(ed, arc.ccw ? r.e : r.s, sn);
    });
    this.start = null;
    this.activate();
  }
  onMove(e: PEvent) {
    this.cur = this.host.snap(e.world, { suppress: e.ctrl || this.host.suppress() });
    this.host.requestRender();
  }
  onUp() {}
  cancel(): boolean {
    if (!this.start) return false;
    this.activate();
    this.host.requestRender();
    return true;
  }
  draw(p: Painter) {
    if (this.start && this.cur) {
      const arc = tangentArcFrom(this.start.pos, this.start.dir, this.cur.pos);
      const st = { color: theme.preview, width: 1.5 };
      if (arc) {
        if (arc.ccw) p.arc(arc.c, arc.r, arc.a0, arc.a1, st);
        else p.arc(arc.c, arc.r, arc.a1, arc.a0, st);
      }
    }
    drawSnap(p, this.cur);
  }
  options(): ToolOption[] {
    return [{ kind: "check", key: "construction", label: "For construction", value: this.construction, set: (v) => (this.construction = v) }];
  }
}
