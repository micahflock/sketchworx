import { useState } from "preact/hooks";
import { useApp, useUi } from "./hooks";
import { Icon } from "./icons";
import css from "./ui.module.css";

interface Btn {
  id: string;
  label: string;
  icon: string;
  action: string;
  key?: string;
}
interface Group {
  title: string;
  items: (Btn | { flyout: string; items: Btn[] })[];
}

const t = (id: string, label: string, icon = id, key?: string): Btn => ({ id, label, icon, action: `tool:${id}`, key });
const a = (id: string, label: string, icon: string, action: string, key?: string): Btn => ({ id, label, icon, action, key });

export const groups: Group[] = [
  {
    title: "Draw",
    items: [
      { flyout: "line", items: [t("line", "Line", "line", "L"), t("centerline", "Centerline"), t("midline", "Midpoint Line")] },
      {
        flyout: "rect",
        items: [t("rect", "Corner Rectangle"), t("rectCenter", "Center Rectangle"), t("rect3", "3 Point Corner Rectangle"), t("rect3Center", "3 Point Center Rectangle"), t("parallelogram", "Parallelogram")],
      },
      { flyout: "circle", items: [t("circle", "Circle", "circle", "C"), t("circle3", "Perimeter Circle")] },
      { flyout: "arc", items: [t("arc", "Centerpoint Arc", "arc", "A"), t("tangentArc", "Tangent Arc"), t("arc3", "3 Point Arc")] },
      t("spline", "Style Spline", "spline", "B"),
      t("point", "Point", "point", "P"),
    ],
  },
  {
    title: "Relations",
    items: [a("addRelation", "Add Relation", "addRelation", "panel:add"), a("relations", "Display/Delete Relations", "relations", "relationsPanel", "R")],
  },
  {
    title: "Dimension",
    items: [t("dimension", "Smart Dimension", "dimension", "D"), a("variables", "Global Variables", "variables", "variablesPanel")],
  },
  {
    title: "Tools",
    items: [
      t("trim", "Trim Entities", "trim", "T"),
      t("extend", "Extend Entities"),
      t("fillet", "Sketch Fillet"),
      t("offset", "Offset Entities", "offset", "O"),
      { flyout: "mirror", items: [t("mirror", "Mirror Entities", "mirror", "M"), t("dynamicMirror", "Dynamic Mirror")] },
      a("construction", "Construction Geometry", "construction", "toggleConstruction", "Q"),
    ],
  },
  {
    title: "View",
    items: [
      a("fit", "Zoom to Fit", "fit", "zoomFit", "F"),
      a("sketchView", "Sketch View", "sketchView", "view:sketch"),
      a("artView", "Art View", "artView", "view:art"),
      a("splitView", "Split View", "splitView", "view:split"),
      a("guides", "Metric Guides", "guides", "toggleGuides"),
      a("picture", "Sketch Picture", "picture", "picture"),
      a("grid", "Grid Snap", "grid", "toggleGridSnap"),
    ],
  },
  {
    title: "File",
    items: [
      a("open", "Open", "open", "open"),
      a("save", "Save", "save", "save"),
      a("export", "Export SVG", "export", "exportSvg"),
      a("keys", "Keyboard", "keys", "keyboardPanel"),
      a("undo", "Undo", "undo", "undo"),
      a("redo", "Redo", "redo", "redo"),
    ],
  },
];

function ToolButton({ b, active, onPick, caret }: { b: Btn; active: boolean; onPick: () => void; caret?: () => void }) {
  const app = useApp();
  const avail = !b.action.startsWith("tool:") || !!app.getTool(b.action.slice(5));
  return (
    <div class={css.btnWrap}>
      <button
        class={`${css.tbtn} ${active ? css.active : ""}`}
        title={`${b.label}${b.key ? ` (${b.key})` : ""}${avail ? "" : " (coming soon)"}`}
        disabled={!avail}
        onClick={onPick}
      >
        <Icon name={b.icon} />
        <span class={css.tlabel}>{b.label}</span>
      </button>
      {caret && (
        <button class={css.caret} title="More" onClick={caret}>
          ▾
        </button>
      )}
    </div>
  );
}

export function CommandManager() {
  const app = useApp();
  const ui = useUi();
  const [open, setOpen] = useState<string | null>(null);
  const isActive = (b: Btn) =>
    (b.action.startsWith("tool:") && ui.toolId === b.action.slice(5)) ||
    (b.action === "view:" + ui.viewMode) ||
    (b.action === "relationsPanel" && ui.panel === "relations") ||
    (b.action === "variablesPanel" && ui.panel === "variables") ||
    (b.action === "keyboardPanel" && ui.panel === "keyboard") ||
    (b.action === "toggleGridSnap" && ui.gridSnap) ||
    (b.id === "dynamicMirror" && !!ui.dynamicMirror);
  return (
    <div class={css.cmdmgr} onPointerLeave={() => setOpen(null)}>
      {groups.map((g) => (
        <div class={css.group} key={g.title}>
          <div class={css.groupItems}>
            {g.items.map((it) => {
              if ("flyout" in it) {
                const lastId = app.flyoutLast[it.flyout] ?? it.items[0].id;
                const cur = it.items.find((x) => x.id === lastId) ?? it.items[0];
                const anyActive = it.items.some(isActive);
                return (
                  <div class={css.flyoutHost} key={it.flyout}>
                    <ToolButton
                      b={cur}
                      active={anyActive}
                      onPick={() => {
                        app.runAction(cur.action);
                        setOpen(null);
                      }}
                      caret={() => setOpen(open === it.flyout ? null : it.flyout)}
                    />
                    {open === it.flyout && (
                      <div class={css.flyout}>
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
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              }
              return <ToolButton key={it.id} b={it} active={isActive(it)} onPick={() => app.runAction(it.action)} />;
            })}
          </div>
          <div class={css.groupTitle}>{g.title}</div>
        </div>
      ))}
    </div>
  );
}
