import { describe, expect, it } from "vitest";
import { applyCommand } from "../src/model/editor";
import type { CommandFn } from "../src/model/editor";
import { activeSketch, createDoc } from "../src/model/sketch";
import type { Doc } from "../src/model/types";
import { View } from "../src/render/view";
import { snap } from "../src/inference/snap";
import { CHAIN_TARGET_PX, LineTool } from "../src/tools/line";
import { CircleTool } from "../src/tools/shapes";
import { HELL_ACCENTS, hellPalette, lightTheme } from "../src/render/theme";

/** A host with a real document and snapping, viewed at 1 px per unit with the origin at the screen's center. */
function setup() {
  let doc: Doc = createDoc();
  const view = new View();
  const host = {
    view,
    sketch: () => activeSketch(doc),
    doc: () => doc,
    commit: (_label: string, fn: CommandFn) => (doc = applyCommand(doc, fn)),
    snap: (raw: { x: number; y: number }, o: object = {}) => snap(activeSketch(doc), raw, { tol: 8, ...o }),
    setPrompt: () => {},
    requestRender: () => {},
    suppress: () => false,
  };
  const ev = (sx: number, sy: number, pointerType = "touch") => {
    const screen = { x: sx, y: sy };
    return { world: view.toWorld(screen), screen, button: 0, shift: false, ctrl: false, alt: false, pointerType };
  };
  const count = (type: string) => Object.values(activeSketch(doc).entities).filter((e) => e.type === type).length;
  const relations = () => Object.values(activeSketch(doc).relations ?? {});
  return { host, ev, count, relations };
}

const drag = (tool: { onDown(e: unknown): void; onMove(e: unknown): void; onUp(e: unknown): void }, a: unknown, b: unknown) => {
  tool.onDown(a);
  tool.onMove(b);
  tool.onUp(b);
};

describe("Line tool by touch", () => {
  it("draws one segment per drag", () => {
    const { host, ev, count } = setup();
    const tool = new LineTool(host as never);
    drag(tool, ev(100, 100), ev(200, 130));
    expect(count("line")).toBe(1);
  });

  it("does not draw tap-to-tap lines", () => {
    const { host, ev, count } = setup();
    const tool = new LineTool(host as never);
    for (const p of [ev(100, 100), ev(200, 130), ev(250, 300)]) {
      tool.onDown(p);
      tool.onUp(p);
    }
    expect(count("line")).toBe(0);
  });

  it("continues the chain from a drag that starts near the last end point", () => {
    const { host, ev, count, relations } = setup();
    const tool = new LineTool(host as never);
    drag(tool, ev(100, 100), ev(200, 130));
    // Inside the enlarged target, but farther than the normal snap distance.
    const off = CHAIN_TARGET_PX.touch - 4;
    drag(tool, ev(200 + off, 130), ev(260, 260));
    expect(count("line")).toBe(2);
    expect(relations().filter((r) => r.type === "coincident")).toHaveLength(1);
  });

  it("starts a new line from a drag elsewhere", () => {
    const { host, ev, count, relations } = setup();
    const tool = new LineTool(host as never);
    drag(tool, ev(100, 100), ev(200, 130));
    drag(tool, ev(400, 400), ev(500, 470));
    expect(count("line")).toBe(2);
    expect(relations().filter((r) => r.type === "coincident")).toHaveLength(0);
  });

  it("keeps click-click chains for the mouse", () => {
    const { host, ev, count } = setup();
    const tool = new LineTool(host as never);
    for (const p of [ev(100, 100, "mouse"), ev(200, 130, "mouse"), ev(250, 300, "mouse")]) {
      tool.onDown(p);
      tool.onUp(p);
    }
    expect(count("line")).toBe(2);
  });
});

describe("shapes by touch", () => {
  it("draw a circle by dragging, not by two taps", () => {
    const { host, ev, count } = setup();
    const tool = new CircleTool(host as never);
    tool.activate();
    for (const p of [ev(100, 100), ev(160, 100)]) {
      tool.onDown(p);
      tool.onUp(p);
    }
    expect(count("circle")).toBe(0);
    drag(tool, ev(100, 100), ev(160, 100));
    expect(count("circle")).toBe(1);
  });
});

describe("HELL MODE colors", () => {
  it("offers eight accents, each a complete one-color palette", () => {
    expect(Object.keys(HELL_ACCENTS)).toEqual(["red", "green", "pink", "orange", "yellow", "blue", "purple", "white"]);
    for (const k of Object.keys(HELL_ACCENTS) as (keyof typeof HELL_ACCENTS)[]) {
      const t = hellPalette(k);
      expect(Object.keys(t).sort()).toEqual(Object.keys(lightTheme).sort());
      expect(new Set(Object.values(t.state))).toEqual(new Set([HELL_ACCENTS[k]]));
      expect(t.selected).toBe(HELL_ACCENTS[k]);
    }
  });
});

describe("relations added while drawing", () => {
  const click = (tool: LineTool, p: Parameters<LineTool["onDown"]>[0]) => {
    tool.onMove(p);
    tool.onDown(p);
    tool.onUp(p);
  };
  const types = (rels: { type: string }[]) => rels.map((r) => r.type).sort();

  it("adds horizontal and the chain's coincident joint", () => {
    const { host, ev, relations } = setup();
    const tool = new LineTool(host as never);
    click(tool, ev(100, 100, "mouse"));
    click(tool, ev(300, 101, "mouse")); // snaps level
    click(tool, ev(300, 300, "mouse")); // snaps plumb
    expect(types(relations())).toEqual(["coincident", "horizontal", "vertical"]);
  });

  it("snaps perpendicular to the previous segment without adding a perpendicular relation", () => {
    const { host, ev, relations } = setup();
    const tool = new LineTool(host as never);
    click(tool, ev(100, 100, "mouse"));
    click(tool, ev(200, 150, "mouse"));
    click(tool, ev(152, 247, "mouse")); // near the perpendicular from (200,150)
    const s = host.sketch();
    const lines = Object.values(s.entities).filter((e) => e.type === "line") as { p1: string; p2: string }[];
    const v = (l: { p1: string; p2: string }) => {
      const a = s.entities[l.p1] as { x: number; y: number };
      const b = s.entities[l.p2] as { x: number; y: number };
      return { x: b.x - a.x, y: b.y - a.y };
    };
    const [d1, d2] = lines.map(v);
    expect(Math.abs(d1.x * d2.x + d1.y * d2.y)).toBeLessThan(1e-6); // placed exactly perpendicular
    expect(types(relations())).toEqual(["coincident"]);
  });

  it("snaps to a midpoint without adding a midpoint relation", () => {
    const { host, ev, relations } = setup();
    const tool = new LineTool(host as never);
    click(tool, ev(100, 100, "mouse"));
    click(tool, ev(300, 100, "mouse"));
    tool.cancel();
    click(tool, ev(201, 103, "mouse")); // near the midpoint (200, 100)
    click(tool, ev(260, 300, "mouse"));
    const s = host.sketch();
    const starts = Object.values(s.entities).filter((e) => e.type === "point" && Math.hypot((e as { x: number }).x - 200 + 400, (e as { y: number }).y - 300 + 100) < 1e-6);
    expect(starts.length).toBeGreaterThan(0);
    expect(types(relations())).toEqual(["horizontal"]);
  });
});

describe("Snap: horizontal/vertical onto a curve", () => {
  it("lands on the crossing and infers both H and coincident", () => {
    const { host, ev, relations } = setup();
    const tool = new LineTool(host as never);
    // A vertical edge at x = 200 whose ends and midpoint are far from y = 50.
    drag(tool, ev(200, -300, "mouse"), ev(200, 300, "mouse"));
    const before = relations().length;
    // A horizontal line ending just short of the edge, slightly off level.
    const sn = host.snap(host.view.toWorld({ x: 196, y: 53 }), { from: host.view.toWorld({ x: 0, y: 50 }) });
    expect(sn.hv).toBe("horizontal");
    expect(sn.curve).toBeTruthy();
    expect(sn.glyphs).toEqual(["H", "on"]);
    expect(sn.pos.x).toBeCloseTo(host.view.toWorld({ x: 200, y: 0 }).x);
    drag(tool, ev(0, 50, "mouse"), ev(196, 53, "mouse"));
    const added = relations().slice(before).map((r) => r.type).sort();
    expect(added).toEqual(["coincident", "horizontal"]);
  });
});

describe("Line tool by mouse: wobbly clicks", () => {
  const click = (tool: LineTool, down: object, up: object = down) => {
    type E = Parameters<LineTool["onDown"]>[0];
    tool.onDown(down as E);
    tool.onMove(up as E);
    tool.onUp(up as E);
  };

  it("treats a small wobble on the first click as a click, not a tiny drag-line", () => {
    const { host, ev, count } = setup();
    const tool = new LineTool(host as never);
    click(tool, ev(0, 0, "mouse"), ev(7, 2, "mouse"));
    expect(count("line")).toBe(0);
    click(tool, ev(150, 0, "mouse"));
    click(tool, ev(150, 120, "mouse"));
    expect(count("line")).toBe(2);
  });

  it("still places a single line from a real click-drag", () => {
    const { host, ev, count } = setup();
    const tool = new LineTool(host as never);
    click(tool, ev(0, 0, "mouse"), ev(80, 30, "mouse"));
    expect(count("line")).toBe(1);
  });

  it("ignores a click just off the last end point, even with snapping off", () => {
    const { host, ev, count } = setup();
    const tool = new LineTool(host as never);
    click(tool, ev(0, 0, "mouse"));
    click(tool, ev(150, 40, "mouse"));
    const nudge = { ...ev(156, 44, "mouse"), ctrl: true };
    click(tool, nudge);
    expect(count("line")).toBe(1);
    click(tool, ev(150, 200, "mouse"));
    expect(count("line")).toBe(2);
  });
});
