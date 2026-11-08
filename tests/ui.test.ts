import { describe, expect, it } from "vitest";
import { matchScore, searchCommands } from "../src/ui/commandSearch";
import type { Command } from "../src/ui/commandSearch";
import { resolveTheme } from "../src/app/themePref";
import { darkTheme, lightTheme, setCanvasTheme, theme } from "../src/render/theme";

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
