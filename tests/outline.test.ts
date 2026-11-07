import { describe, expect, it } from "vitest";
import { exportSvg, arcToCubics } from "../src/io/svg";
import { applyCommand } from "../src/model/editor";
import { buildOutline } from "../src/model/outline";
import { activeSketch, createDoc } from "../src/model/sketch";
import { addCircle, addLine } from "../src/tools/common";
import { buildLoop } from "../src/tools/shapes";
import { slotSample } from "../src/io/samples";

describe("outline", () => {
  it("finds a closed rectangle loop, CCW", () => {
    const d = applyCommand(createDoc(), (ed) =>
      buildLoop(ed, [
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 20, y: 10 },
        { x: 20, y: 0 },
      ], false),
    );
    const o = buildOutline(activeSketch(d));
    expect(o.loops).toHaveLength(1);
    expect(o.loops[0].area).toBeCloseTo(200, 6);
    expect(o.openEnds).toHaveLength(0);
  });

  it("orients a nested loop as a hole and ignores construction", () => {
    const d = applyCommand(createDoc(), (ed) => {
      addCircle(ed, { x: 0, y: 0 }, 10);
      addCircle(ed, { x: 0, y: 0 }, 5);
      addCircle(ed, { x: 50, y: 0 }, 5, true);
    });
    const o = buildOutline(activeSketch(d));
    expect(o.loops).toHaveLength(2);
    const [a, b] = [...o.loops].sort((x, y) => Math.abs(y.area) - Math.abs(x.area));
    expect(a.area).toBeGreaterThan(0);
    expect(b.area).toBeLessThan(0);
  });

  it("reports open ends and self-intersections", () => {
    const d = applyCommand(createDoc(), (ed) => {
      addLine(ed, { x: 0, y: 0 }, { x: 10, y: 0 });
      // bow-tie
      buildLoop(ed, [
        { x: 20, y: 0 },
        { x: 30, y: 10 },
        { x: 30, y: 0 },
        { x: 20, y: 10 },
      ], false);
    });
    const o = buildOutline(activeSketch(d));
    expect(o.openEnds).toHaveLength(2);
    expect(o.selfIntersections.length).toBeGreaterThanOrEqual(1);
  });
});

describe("svg", () => {
  it("exports one path with arcs or cubics", () => {
    const doc = slotSample();
    const a = exportSvg(doc, { arcs: "arc", construction: false });
    const c = exportSvg(doc, { arcs: "cubic", construction: false });
    expect((a.match(/<path/g) ?? []).length).toBe(1);
    expect(a).toMatch(/A\d/);
    expect(c).not.toMatch(/A\d/);
    expect(c).toMatch(/C/);
  });
  it("cubic arc approximation is accurate", () => {
    const parts = arcToCubics({ x: 0, y: 0 }, 100, 0, Math.PI / 2);
    const [p0, p1, p2, p3] = parts[0];
    const t = 0.5;
    const u = 1 - t;
    const x = u ** 3 * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t ** 3 * p3.x;
    const y = u ** 3 * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t ** 3 * p3.y;
    expect(Math.abs(Math.hypot(x, y) - 100)).toBeLessThan(0.03);
  });
});
