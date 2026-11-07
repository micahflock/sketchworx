import { beforeAll, describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import type { Editor } from "../src/model/editor";
import { activeSketch, createDoc } from "../src/model/sketch";
import type { Doc, Id } from "../src/model/types";
import { buildSolverInput } from "../src/solver/build";
import { GcsCore } from "../src/solver/gcs";
import { addArc, addLine } from "../src/tools/common";
import { buildLoop } from "../src/tools/shapes";

let core: GcsCore;
beforeAll(async () => {
  core = await GcsCore.create();
});

/** Slightly skewed rectangle with 2 H + 2 V, like drawing one by eye. */
function rect(extra?: (ed: Editor, lines: { line: Id; p1: Id; p2: Id }[]) => void): Doc {
  return applyCommand(createDoc(), (ed) => {
    const lines = buildLoop(ed, [
      { x: 0, y: 0 },
      { x: 100, y: 3 },
      { x: 104, y: 60 },
      { x: -2, y: 62 },
    ], false);
    ed.addRelation({ type: "horizontal", refs: [lines[0].line, lines[2].line] });
    ed.addRelation({ type: "vertical", refs: [lines[1].line, lines[3].line] });
    extra?.(ed, lines);
  });
}

function solve(doc: Doc, drag?: Parameters<GcsCore["solve"]>[2]) {
  const s = activeSketch(doc);
  const inp = buildSolverInput(s);
  expect(inp.unsupported).toEqual([]);
  return { s, ...core.solve(inp.params, inp.constraints, drag) };
}

const fixFirstCorner = (ed: Editor, lines: { p1: Id }[]) => {
  const p = ed.s.entities[lines[0].p1] as { x: number; y: number };
  ed.addRelation({ type: "fix", refs: [lines[0].p1], values: [p.x, p.y] });
};

describe("solver fixtures", () => {
  it("rectangle with 2H 2V and a fixed corner has 2 DOF", () => {
    const r = solve(rect(fixFirstCorner));
    expect(r.ok).toBe(true);
    expect(r.dof).toBe(2);
    expect(r.conflicts).toEqual([]);
    expect(r.redundant).toEqual([]);
    // The fixed corner (and its coincident partner) are fully defined; the lines are not.
    const pts = r.params.points;
    const p0 = pts.find((p) => p.x === 0 && p.y === 0);
    expect(p0).toBeDefined();
    expect(r.entityStatus[p0!.id]).toBe("full");
    const lines = Object.values(r.s.entities).filter((e) => e.type === "line");
    for (const l of lines) expect(r.entityStatus[l.id]).toBe("under");
  });

  it("solves to an exact rectangle", () => {
    const r = solve(rect(fixFirstCorner));
    const s = r.s;
    const byId = new Map(r.params.points.map((p) => [p.id, p]));
    for (const l of Object.values(s.entities)) {
      if (l.type !== "line") continue;
      const a = byId.get(l.p1)!;
      const b = byId.get(l.p2)!;
      const horiz = Math.abs(a.y - b.y) < 1e-8;
      const vert = Math.abs(a.x - b.x) < 1e-8;
      expect(horiz || vert).toBe(true);
    }
  });

  it("reports a redundant parallel relation as over-defining", () => {
    const r = solve(
      rect((ed, lines) => {
        fixFirstCorner(ed, lines);
        ed.addRelation({ type: "parallel", refs: [lines[0].line, lines[2].line] });
      }),
    );
    expect(r.redundant.length + r.conflicts.length).toBeGreaterThan(0);
    const rel = Object.values(r.s.relations).find((x) => x.type === "parallel")!;
    expect([...r.redundant, ...r.conflicts]).toContain(rel.id);
    expect(Object.values(r.entityStatus)).toContain("over");
  });

  it("dragging a corner keeps every relation", () => {
    const doc = rect(fixFirstCorner);
    const s = activeSketch(doc);
    const corner = (Object.values(s.entities).find((e) => e.type === "line")! as { p2: Id }).p2;
    const inp = buildSolverInput(s);
    const p = core.dragStart(inp.params, inp.constraints, [{ point: corner, x: 150, y: -40 }]);
    let last = p;
    for (let i = 0; i < 20; i++) last = core.dragMove([{ point: corner, x: 150 + i * 5, y: -40 + i * 3 }]);
    core.dragEnd();
    const byId = new Map(last.points.map((q) => [q.id, q]));
    expect(byId.get(corner)!.x).toBeCloseTo(245, 4);
    for (const l of Object.values(s.entities)) {
      if (l.type !== "line") continue;
      const a = byId.get(l.p1)!;
      const b = byId.get(l.p2)!;
      expect(Math.abs(a.y - b.y) < 1e-6 || Math.abs(a.x - b.x) < 1e-6).toBe(true);
    }
    // Fixed corner did not move.
    expect(last.points.some((q) => Math.abs(q.x) < 1e-9 && Math.abs(q.y) < 1e-9)).toBe(true);
  });

  it("fully defined geometry is black", () => {
    // Fix two opposite corners of the H/V rectangle.
    const r = solve(
      rect((ed, lines) => {
        fixFirstCorner(ed, lines);
        const p = ed.s.entities[lines[2].p1] as { x: number; y: number };
        ed.addRelation({ type: "fix", refs: [lines[2].p1], values: [p.x, p.y] });
      }),
    );
    expect(r.dof).toBe(0);
    for (const e of Object.values(r.s.entities)) if (e.type === "line") expect(r.entityStatus[e.id]).toBe("full");
  });

  it("line tangent to an arc at a shared endpoint", () => {
    const doc = applyCommand(createDoc(), (ed) => {
      const l = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 5 });
      const a = addArc(ed, { x: 100, y: 50 }, { x: 100, y: 0 }, { x: 150, y: 50 });
      ed.addRelation({ type: "coincident", refs: [l.p2, a.s] });
      ed.addRelation({ type: "tangent", refs: [l.line, a.arc] });
    });
    const r = solve(doc);
    expect(r.ok).toBe(true);
    const s = r.s;
    const byId = new Map(r.params.points.map((q) => [q.id, q]));
    const line = Object.values(s.entities).find((e) => e.type === "line")! as { p1: Id; p2: Id };
    const arc = Object.values(s.entities).find((e) => e.type === "arc")! as { c: Id };
    const A = byId.get(line.p1)!;
    const B = byId.get(line.p2)!;
    const C = byId.get(arc.c)!;
    const dot = (B.x - A.x) * (B.x - C.x) + (B.y - A.y) * (B.y - C.y);
    expect(Math.abs(dot)).toBeLessThan(1e-6);
    // line (4) + arc (5) - coincident (2) - tangent (1) = 6
    expect(r.dof).toBe(6);
  });

  it("conflicting relations are reported", () => {
    const doc = rect((ed, lines) => {
      fixFirstCorner(ed, lines);
      // Vertical on a horizontal edge whose ends are pinned apart by a second fix.
      const p = ed.s.entities[lines[0].p2] as { x: number; y: number };
      ed.addRelation({ type: "fix", refs: [lines[0].p2], values: [p.x, p.y] });
      ed.addRelation({ type: "vertical", refs: [lines[0].line] });
    });
    const r = solve(doc);
    expect(r.ok).toBe(false);
    expect(r.conflicts.length).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const a = solve(rect(fixFirstCorner));
    const b = solve(rect(fixFirstCorner));
    expect(a.params).toEqual(b.params);
  });
});
