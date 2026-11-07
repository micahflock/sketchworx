import { actionLabels } from "../app/keymap";
import { useApp, useUi } from "./hooks";
import { Icon } from "./icons";
import css from "./ui.module.css";
import { ContextBar } from "./ContextBar";
import { ConfirmDialog, ModifyBox } from "./ModifyBox";

const shortcutItems: { action: string; icon: string }[] = [
  { action: "tool:line", icon: "line" },
  { action: "tool:rect", icon: "rect" },
  { action: "tool:circle", icon: "circle" },
  { action: "tool:arc", icon: "arc" },
  { action: "tool:spline", icon: "spline" },
  { action: "tool:point", icon: "point" },
  { action: "tool:dimension", icon: "dimension" },
  { action: "tool:trim", icon: "trim" },
  { action: "tool:offset", icon: "offset" },
  { action: "tool:mirror", icon: "mirror" },
  { action: "tool:fillet", icon: "fillet" },
  { action: "toggleConstruction", icon: "construction" },
  { action: "relationsPanel", icon: "relations" },
  { action: "zoomFit", icon: "fit" },
];

/** Floating UI over the canvas: shortcut bar, context toolbar, modify box. */
export function Overlays() {
  const app = useApp();
  const ui = useUi();
  return (
    <>
      {ui.showShortcutBar && (
        <div class={css.shortcutBar} style={{ left: ui.showShortcutBar.x - 110, top: ui.showShortcutBar.y - 50 }}>
          {shortcutItems.map((it) => (
            <button
              key={it.action}
              title={actionLabels[it.action] ?? it.action.replace("tool:", "")}
              disabled={it.action.startsWith("tool:") && !app.getTool(it.action.slice(5))}
              onClick={() => {
                app.store.set({ showShortcutBar: null });
                app.runAction(it.action);
              }}
            >
              <Icon name={it.icon} />
            </button>
          ))}
        </div>
      )}
      <ContextBar />
      <ModifyBox />
      <ConfirmDialog />
    </>
  );
}
