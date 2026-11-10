import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { useApp, useUi } from "./hooks";
import { Icon } from "./icons";
import { searchCommands } from "./commandSearch";
import type { Command } from "./commandSearch";
import css from "./ui.module.css";
import { isMac, keyFor, keyLegend } from "./shortcuts";
import { nextTheme } from "../app/themePref";
import { HELL_ACCENTS } from "../render/theme";
import type { HellAccent, ThemeName } from "../render/theme";

const themeToggleLabel: Record<ThemeName, string> = {
  light: "Switch to light theme",
  dark: "Switch to dark theme",
  hell: "Switch to HELL MODE",
};

interface Btn {
  id: string;
  label: string;
  icon: string;
  action: string;
}
interface Group {
  title: string;
  items: (Btn | { flyout: string; items: Btn[] })[];
}

const t = (id: string, label: string, icon = id): Btn => ({ id, label, icon, action: `tool:${id}` });
const a = (id: string, label: string, icon: string, action: string): Btn => ({ id, label, icon, action });

export const groups: Group[] = [
  {
    title: "Draw",
    items: [
      { flyout: "line", items: [t("line", "Line"), t("centerline", "Centerline"), t("midline", "Midpoint Line")] },
      {
        flyout: "rect",
        items: [t("rect", "Corner Rectangle"), t("rectCenter", "Center Rectangle"), t("rect3", "3 Point Corner Rectangle"), t("rect3Center", "3 Point Center Rectangle"), t("parallelogram", "Parallelogram")],
      },
      { flyout: "circle", items: [t("circle", "Circle"), t("circle3", "Perimeter Circle")] },
      { flyout: "arc", items: [t("arc", "Centerpoint Arc"), t("tangentArc", "Tangent Arc"), t("arc3", "3 Point Arc")] },
      t("spline", "Style Spline"),
      t("point", "Point"),
    ],
  },
  {
    title: "Relations",
    items: [a("addRelation", "Add Relation", "addRelation", "panel:add"), a("relations", "Display/Delete Relations", "relations", "relationsPanel")],
  },
  {
    title: "Dimension",
    items: [t("dimension", "Smart Dimension"), a("variables", "Global Variables", "variables", "variablesPanel")],
  },
  {
    title: "Tools",
    items: [
      t("trim", "Trim Entities"),
      t("extend", "Extend Entities"),
      t("fillet", "Sketch Fillet"),
      a("convert", "Convert Entities", "convert", "convertEntities"),
      t("offset", "Offset Entities"),
      { flyout: "mirror", items: [t("mirror", "Mirror Entities"), t("dynamicMirror", "Dynamic Mirror")] },
      a("construction", "Construction Geometry", "construction", "toggleConstruction"),
    ],
  },
  {
    title: "View",
    items: [
      a("fit", "Zoom to Fit", "fit", "zoomFit"),
      a("sketchView", "Sketch View", "sketchView", "view:sketch"),
      a("artView", "Art View", "artView", "view:art"),
      a("splitView", "Split View", "splitView", "view:split"),
    ],
  },
  {
    title: "File",
    items: [
      a("open", "Open", "open", "open"),
      a("save", "Save", "save", "save"),
      a("export", "Export SVG", "export", "exportSvg"),
      a("undo", "Undo", "undo", "undo"),
      a("redo", "Redo", "redo", "redo"),
    ],
  },
];

/** Extra words that should find a command. */
const keywords: Record<string, string[]> = {
  line: ["segment", "straight"],
  centerline: ["axis", "symmetry"],
  rect: ["box", "square"],
  rectCenter: ["box", "square"],
  circle: ["round"],
  circle3: ["round"],
  arc: ["curve"],
  tangentArc: ["curve"],
  arc3: ["curve"],
  spline: ["curve", "bezier", "freeform"],
  point: ["vertex"],
  addRelation: ["constraint", "parallel", "perpendicular", "tangent", "coincident", "horizontal", "vertical", "equal", "symmetric", "fix"],
  relations: ["constraint", "conflict"],
  dimension: ["measure", "length", "distance", "angle", "radius", "diameter", "size"],
  variables: ["parameter", "equation", "expression"],
  trim: ["cut", "split", "remove"],
  extend: ["lengthen"],
  fillet: ["round", "corner", "radius"],
  convert: ["reference", "copy", "project", "link"],
  offset: ["outline", "parallel", "inset", "outset"],
  mirror: ["symmetric", "flip", "reflect"],
  dynamicMirror: ["symmetric", "flip", "reflect"],
  construction: ["reference", "helper", "guide"],
  fit: ["zoom", "frame", "all"],
  artView: ["preview", "stroke", "fill", "weight"],
  splitView: ["side by side"],
  picture: ["image", "trace", "background", "photo"],
  combs: ["curvature", "smoothness"],
  grid: ["snap"],
  open: ["load", "file"],
  save: ["download", "file"],
  export: ["svg", "png", "download", "image"],
  keys: ["shortcuts", "hotkeys", "keymap"],
  newSketch: ["add", "feature", "layer"],
  themeDark: ["night", "appearance", "colors"],
  themeLight: ["day", "appearance", "colors"],
  themeSystem: ["auto", "appearance", "colors", "os"],
  themeHell: ["666", "red", "appearance", "colors"],
  delete: ["remove", "erase"],
  shortcutBar: ["menu", "tools"],
};

/** Commands that only live in the command box (less used, so kept off the toolbar). */
const extraCommands: Command[] = [
  { id: "picture", label: "Sketch Picture", action: "picture", icon: "picture", group: "View" },
  { id: "combs", label: "Curvature Combs", action: "combs", icon: "combs", group: "View" },
  { id: "grid", label: "Grid Snap", action: "toggleGridSnap", icon: "grid", group: "View" },
  { id: "keys", label: "Keyboard Shortcuts", action: "keyboardPanel", icon: "keys", group: "Help" },
  { id: "newSketch", label: "New Sketch", action: "newSketch", icon: "newSketch", group: "Sketches" },
  { id: "delete", label: "Delete Selection", action: "delete", icon: "trim", group: "Edit" },
  { id: "shortcutBar", label: "Shortcut Bar", action: "shortcutBar", icon: "keys", group: "Edit" },
  { id: "themeLight", label: "Light Theme", action: "theme:light", icon: "sun", group: "Appearance" },
  { id: "themeDark", label: "Dark Theme", action: "theme:dark", icon: "moon", group: "Appearance" },
  { id: "themeSystem", label: "Match System Theme", action: "theme:system", icon: "sun", group: "Appearance" },
  // Listed only once unlocked (see App.setDimensionText).
  { id: "themeHell", label: "666 HELL MODE", action: "theme:hell", icon: "hell", group: "Appearance" },
];

export function allCommands(): Command[] {
  const out: Command[] = [];
  for (const g of groups)
    for (const it of g.items)
      for (const b of "flyout" in it ? it.items : [it]) out.push({ id: b.id, label: b.label, action: b.action, icon: b.icon, group: g.title, keywords: keywords[b.id] });
  for (const c of extraCommands) out.push({ ...c, keywords: keywords[c.id] });
  return out;
}

function ToolButton({ b, active, onPick, caret, keyHint }: { b: Btn; active: boolean; onPick: () => void; caret?: (e: MouseEvent) => void; keyHint?: string }) {
  const app = useApp();
  const avail = !b.action.startsWith("tool:") || !!app.getTool(b.action.slice(5));
  return (
    <div class={css.btnWrap}>
      <button
        class={`${css.tbtn} ${active ? css.active : ""}`}
        title={`${b.label}${keyHint ? ` (${keyHint})` : ""}${avail ? "" : " (coming soon)"}`}
        aria-label={b.label}
        aria-pressed={active}
        disabled={!avail}
        onClick={onPick}
      >
        {keyHint && (
          <span class={css.keyHint} aria-hidden="true">
            {keyLegend(keyHint)}
          </span>
        )}
        <Icon name={b.icon} />
      </button>
      {caret && (
        <button class={css.caret} title={`More ${b.label.toLowerCase()} tools`} aria-label={`More ${b.label.toLowerCase()} tools`} onClick={caret}>
          <svg viewBox="0 0 8 8" width="8" height="8" aria-hidden="true">
            <path d="M1 2.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.3" />
          </svg>
        </button>
      )}
    </div>
  );
}

export function CommandManager() {
  const app = useApp();
  const ui = useUi();
  // The open flyout and where it sits (it is position: fixed so the scrolling toolbar can't clip it).
  const [open, setOpen] = useState<{ id: string; top: number; left: number } | null>(null);
  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(null);
    // A press anywhere but this flyout (or its button) closes it. Leaving it with the pointer does not.
    const down = (e: PointerEvent) => {
      const host = (e.target as Element | null)?.closest?.("[data-flyout]");
      if (host?.getAttribute("data-flyout") !== open.id) close();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open?.id]);
  const toggleFlyout = (id: string, e: MouseEvent) => {
    if (open?.id === id) return setOpen(null);
    // Below the button pair (the CSS margin adds the gap).
    const r = ((e.currentTarget as HTMLElement).parentElement ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    setOpen({ id, top: r.bottom, left: r.left });
  };
  const isActive = (b: Btn) =>
    (b.action.startsWith("tool:") && ui.toolId === b.action.slice(5)) ||
    (b.action === "view:" + ui.viewMode) ||
    (b.action === "relationsPanel" && ui.panel === "relations") ||
    (b.action === "variablesPanel" && ui.panel === "variables") ||
    (b.action === "keyboardPanel" && ui.panel === "keyboard") ||
    (b.action === "toggleGridSnap" && ui.gridSnap) ||
    (b.id === "dynamicMirror" && !!ui.dynamicMirror) ||
    (b.action === "combs" && ui.combs) ||
    (b.action === "convertEntities" && ui.toolId === "convert") ||
    (b.action === "exportSvg" && ui.panel === "export");
  const next = nextTheme(ui.theme, ui.hellUnlocked);
  return (
    <div class={`${css.toolbar} ${ui.touchUi ? css.touchBar : ""}`}>
      <div class={css.cmdmgr}>
        {groups.map((g) => (
          <div class={css.group} key={g.title} role="group" aria-label={g.title}>
            <span class={css.groupLegend} aria-hidden="true">
              {g.title}
            </span>
            <div class={css.groupKeys}>
            {g.items.map((it) => {
              if ("flyout" in it) {
                const lastId = app.flyoutLast[it.flyout] ?? it.items[0].id;
                const cur = it.items.find((x) => x.id === lastId) ?? it.items[0];
                const anyActive = it.items.some(isActive);
                return (
                  <div class={css.flyoutHost} key={it.flyout} data-flyout={it.flyout}>
                    <ToolButton
                      b={cur}
                      active={anyActive}
                      keyHint={keyFor(app.keymap, cur.action)}
                      onPick={() => {
                        app.runAction(cur.action);
                        setOpen(null);
                      }}
                      caret={(e) => toggleFlyout(it.flyout, e)}
                    />
                    {open?.id === it.flyout && (
                      <div class={css.flyout} style={{ top: `${open.top}px`, left: `${open.left}px` }}>
                        {it.items.map((b) => (
                          <button
                            key={b.id}
                            class={`${css.flyItem} ${isActive(b) ? css.active : ""}`}
                            disabled={b.action.startsWith("tool:") && !app.getTool(b.action.slice(5))}
                            onClick={() => {
                              app.flyoutLast[it.flyout] = b.id;
                              app.runAction(b.action);
                              setOpen(null);
                            }}
                          >
                            <Icon name={b.icon} /> {b.label}
                            {keyFor(app.keymap, b.action) && <kbd class={css.kbd}>{keyFor(app.keymap, b.action)}</kbd>}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              return <ToolButton key={it.id} b={it} active={isActive(it)} keyHint={keyFor(app.keymap, it.action)} onPick={() => app.runAction(it.action)} />;
            })}
            </div>
          </div>
        ))}
      </div>
      <div class={css.toolbarEnd}>
        <CommandBox />
        {ui.theme === "hell" && <HellPalette />}
        <button class={css.tbtn} title={themeToggleLabel[next]} aria-label={themeToggleLabel[next]} onClick={() => app.runAction("toggleTheme")}>
          <Icon name={next === "light" ? "sun" : next === "dark" ? "moon" : "hell"} />
        </button>
      </div>
    </div>
  );
}

/** HELL MODE color picker: a swatch of the current color that opens the eight choices. */
function HellPalette() {
  const app = useApp();
  const ui = useUi();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close, true);
    return () => window.removeEventListener("pointerdown", close, true);
  }, [open]);
  return (
    <div class={css.flyoutHost} ref={ref}>
      <button class={css.tbtn} title="HELL MODE color" aria-label="HELL MODE color" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class={css.swatch} style={{ background: HELL_ACCENTS[ui.hellAccent] }} />
      </button>
      {open && (
        <div class={css.palette} role="listbox" aria-label="HELL MODE color">
          {(Object.keys(HELL_ACCENTS) as HellAccent[]).map((k) => (
            <button
              key={k}
              role="option"
              aria-selected={k === ui.hellAccent}
              title={k}
              aria-label={k}
              class={`${css.paletteItem} ${k === ui.hellAccent ? css.active : ""}`}
              onClick={() => {
                app.setHellAccent(k);
                setOpen(false);
              }}
            >
              <span class={css.swatch} style={{ background: HELL_ACCENTS[k] }} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** Type to find and run any command. Ctrl/⌘+K or / focuses it. */
function CommandBox() {
  const app = useApp();
  const ui = useUi();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);
  const cmds = useMemo(allCommands, []);
  const results = open
    ? searchCommands(cmds, q).filter((c) => (!c.action.startsWith("tool:") || !!app.getTool(c.action.slice(5))) && (c.action !== "theme:hell" || ui.hellUnlocked))
    : [];
  const sel = Math.min(hi, Math.max(results.length - 1, 0));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
      const k = e.key.toLowerCase();
      if (((e.ctrlKey || e.metaKey) && k === "k") || (k === "/" && !typing && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        e.stopImmediatePropagation();
        input.current?.focus();
        input.current?.select();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  useEffect(() => {
    list.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel, open]);

  const close = () => {
    setOpen(false);
    setQ("");
    setHi(0);
    input.current?.blur();
  };
  const run = (c: Command | undefined) => {
    if (!c) return;
    close();
    app.runAction(c.action);
  };
  /** Shown after a name: the theme in use, or a toggle that is on. */
  const note = (c: Command) =>
    c.action === `theme:${ui.themePref}`
      ? "current"
      : (c.action === "combs" && ui.combs) || (c.action === "toggleGridSnap" && ui.gridSnap) || (c.action === "keyboardPanel" && ui.panel === "keyboard")
        ? "on"
        : null;

  return (
    <div class={`${css.cmdBox} ${open ? css.cmdBoxOpen : ""}`}>
      <span class={css.cmdIcon} aria-hidden="true">
        <Icon name="search" />
      </span>
      <input
        ref={input}
        class={css.cmdInput}
        type="text"
        value={q}
        placeholder="Search commands"
        aria-label="Search commands"
        aria-expanded={open}
        aria-controls="sw-cmd-results"
        aria-activedescendant={results.length ? `sw-cmd-${sel}` : undefined}
        role="combobox"
        autocomplete="off"
        spellcheck={false}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        onInput={(e) => {
          setQ((e.target as HTMLInputElement).value);
          setHi(0);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") setHi((sel + 1) % Math.max(results.length, 1));
          else if (e.key === "ArrowUp") setHi((sel - 1 + results.length) % Math.max(results.length, 1));
          else if (e.key === "Enter") run(results[sel]);
          else if (e.key === "Escape") close();
          else return;
          e.preventDefault();
        }}
      />
      {!open && <kbd class={`${css.kbd} ${css.cmdHint}`}>{isMac ? "⌘K" : "Ctrl K"}</kbd>}
      {open && (
        <ul class={css.cmdList} id="sw-cmd-results" role="listbox" ref={list}>
          {results.length === 0 && <li class={css.cmdEmpty}>No command matches “{q}”</li>}
          {results.map((c, i) => {
            const key = keyFor(app.keymap, c.action);
            return (
              <li
                key={c.id}
                id={`sw-cmd-${i}`}
                data-i={i}
                role="option"
                aria-selected={i === sel}
                class={`${css.cmdItem} ${i === sel ? css.cmdItemHi : ""}`}
                onPointerDown={(e) => e.preventDefault()}
                onPointerMove={() => i !== sel && setHi(i)}
                onClick={() => run(c)}
              >
                <Icon name={c.icon} />
                <span class={css.cmdLabel}>
                  {c.label}
                  {note(c) && <span class={css.cmdCurrent}> · {note(c)}</span>}
                </span>
                <span class={css.cmdGroup}>{c.group}</span>
                {key && <kbd class={css.kbd}>{key}</kbd>}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
