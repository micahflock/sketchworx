import { describe, expect, it } from "vitest";
import { matchScore, searchCommands } from "../src/ui/commandSearch";
import type { Command } from "../src/ui/commandSearch";
import { loadThemePref, resolveTheme } from "../src/app/themePref";
import { darkTheme, lightTheme, setCanvasTheme, theme } from "../src/render/theme";
import { applyCommand } from "../src/model/editor";
import { activeSketch, createDoc } from "../src/model/sketch";
import { addLine } from "../src/tools/common";
import { DimensionTool } from "../src/tools/dimension";

const cmd = (label: string, keywords?: string[], group = "Tools"): Command => ({ id: label, label, action: label, icon: "line", group, keywords });

const cmds = [
  cmd("Line"),
  cmd("Centerline"),
  cmd("Smart Dimension", ["measure", "radius"], "Dimension"),
  cmd("Sketch Fillet", ["round", "corner"]),
  cmd("Trim Entities", ["cut"]),
  cmd("Style Spline", ["curve"]),
  cmd("Dark Theme", [], "Appearance"),
];

describe("command search", () => {
  it("ranks a name that starts with the query first", () => {
    // "Centerline" and "Spline" only contain it, so they come after.
    expect(searchCommands(cmds, "li").map((c) => c.label)).toEqual(["Line", "Centerline", "Style Spline"]);
  });

  it("matches the start of any word in the name", () => {
    expect(searchCommands(cmds, "dim")[0].label).toBe("Smart Dimension");
    expect(searchCommands(cmds, "sm di")[0].label).toBe("Smart Dimension");
  });

  it("matches initials", () => {
    expect(matchScore(cmds[2], "sd")).toBe(2);
    expect(searchCommands(cmds, "sf")[0].label).toBe("Sketch Fillet");
  });

  it("finds commands by their extra words and group", () => {
    expect(searchCommands(cmds, "measure").map((c) => c.label)).toEqual(["Smart Dimension"]);
    expect(searchCommands(cmds, "round")[0].label).toBe("Sketch Fillet");
    expect(searchCommands(cmds, "appearance")[0].label).toBe("Dark Theme");
  });

  it("lists everything for an empty query, in order", () => {
    expect(searchCommands(cmds, "  ").length).toBe(cmds.length);
    expect(searchCommands(cmds, "")[0].label).toBe("Line");
  });

  it("returns nothing when no command matches", () => {
    expect(searchCommands(cmds, "zzz")).toEqual([]);
  });
});

describe("themes", () => {
  it("follows the system setting until the user picks one", () => {
    expect(loadThemePref()).toBe("system");
  });

  it("resolves the system choice from the OS setting", () => {
    expect(resolveTheme("system", true)).toBe("dark");
    expect(resolveTheme("system", false)).toBe("light");
    expect(resolveTheme("dark", false)).toBe("dark");
  });

  it("swaps the shared canvas palette in place and keeps the SolidWorks meanings", () => {
    setCanvasTheme("dark");
    expect(theme.bg).toBe(darkTheme.bg);
    expect(theme.state.full).toBe(darkTheme.state.full);
    setCanvasTheme("light");
    expect(theme).toEqual(lightTheme);
    expect(theme.state).not.toBe(lightTheme.state); // a copy, so edits never leak into the palette
  });

  it("defines every canvas color in both palettes", () => {
    expect(Object.keys(darkTheme).sort()).toEqual(Object.keys(lightTheme).sort());
  });
});

describe("Smart Dimension hover", () => {
  // Two horizontal lines; the stand-in host hits whichever line is nearest the cursor's y.
  let a = "";
  let b = "";
  const doc = applyCommand(createDoc(), (ed) => {
    a = addLine(ed, { x: 0, y: 0 }, { x: 100, y: 0 }).line;
    b = addLine(ed, { x: 0, y: 50 }, { x: 100, y: 50 }).line;
  });
  const setup = () => {
    let hover: string | null = null;
    const host = {
      sketch: () => activeSketch(doc),
      hit: (_w: { x: number; y: number }): { id: string } | null => null,
      hitAnnotation: () => null,
      setHover: (id: string | null) => (hover = id),
      select: () => {},
      setPrompt: () => {},
      requestRender: () => {},
      flash: () => {},
      placeDimension: () => {},
    };
    host.hit = ((w: { x: number; y: number }) => {
      const id = Math.abs(w.y) < 5 ? a : Math.abs(w.y - 50) < 5 ? b : null;
      return id ? { id } : null;
    }) as typeof host.hit;
    const tool = new DimensionTool(host as never);
    tool.activate();
    const ev = (x: number, y: number) => ({ world: { x, y }, screen: { x, y }, button: 0, shift: false, ctrl: false, alt: false, pointerType: "mouse" });
    return { tool, ev, hover: () => hover };
  };

  it("highlights the next line after the first is picked", () => {
    const { tool, ev, hover } = setup();
    tool.onMove(ev(50, 0));
    expect(hover()).toBe(a);
    tool.onDown(ev(50, 0));
    tool.onMove(ev(50, 50));
    expect(hover()).toBe(b);
  });

  it("does not highlight a line that is already picked", () => {
    const { tool, ev, hover } = setup();
    tool.onDown(ev(50, 0));
    tool.onMove(ev(60, 0));
    expect(hover()).toBe(null);
  });
});
