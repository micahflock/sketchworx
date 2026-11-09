/** Keyboard shortcuts as shown in the interface (tooltips, toolbar keys, command box). */

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
const mod = isMac ? "⌘" : "Ctrl+";
const fixedKeys: Record<string, string> = {
  undo: `${mod}Z`,
  redo: isMac ? "⇧⌘Z" : "Ctrl+Y",
  save: `${mod}S`,
  open: `${mod}O`,
  delete: "Del",
};

/** The key that runs an action: the user's keymap first, then the fixed Ctrl shortcuts. */
export function keyFor(keymap: Record<string, string>, action: string): string | undefined {
  const k = Object.keys(keymap).find((x) => keymap[x] === action);
  return k ? k.toUpperCase() : fixedKeys[action];
}

/** The shortcut as printed on a toolbar key: "Ctrl+O" becomes "^O"; "Del" and "⌘O" stay as they are. */
export function keyLegend(key: string | undefined): string | undefined {
  return key?.replace(/^Ctrl\+/, "^");
}
