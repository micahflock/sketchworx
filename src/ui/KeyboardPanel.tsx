import { actionLabels, bindableActions, defaultKeymap, saveKeymap } from "../app/keymap";
import { useApp, useUi } from "./hooks";
import css from "./ui.module.css";

/** Rebind single-key shortcuts. Saved in this browser. */
export function KeyboardPanel() {
  const app = useApp();
  useUi();
  const map = app.keymap;
  const keyFor = (action: string) => Object.entries(map).find(([, a]) => a === action)?.[0] ?? "";
  const bind = (action: string, key: string) => {
    const k = key.toLowerCase().slice(-1);
    const next: Record<string, string> = {};
    for (const [kk, a] of Object.entries(map)) if (a !== action && kk !== k) next[kk] = a;
    if (k && /^[a-z0-9]$/.test(k)) next[k] = action;
    app.keymap = next;
    saveKeymap(next);
    app.store.set({});
  };
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>
        Keyboard{" "}
        <button class={css.small} style={{ float: "right" }} onClick={() => app.store.set({ panel: "auto" })}>
          Close
        </button>
      </div>
      <div class={css.info}>Click a box and press a letter or digit. Ctrl+Z/Y/S/O, Delete and Esc are fixed.</div>
      {bindableActions.map((a) => (
        <label class={css.field} key={a}>
          <span>{actionLabels[a] ?? a}</span>
          <input
            style={{ width: "48px", textAlign: "center", textTransform: "uppercase" }}
            value={keyFor(a)}
            onKeyDown={(e) => {
              if (e.key === "Tab") return;
              e.preventDefault();
              if (e.key === "Backspace" || e.key === "Delete") bind(a, "");
              else if (e.key.length === 1) bind(a, e.key);
            }}
          />
        </label>
      ))}
      <button
        class={css.small}
        style={{ marginTop: "8px" }}
        onClick={() => {
          app.keymap = { ...defaultKeymap };
          saveKeymap(app.keymap);
          app.store.set({});
        }}
      >
        Reset to SolidWorks defaults
      </button>
    </div>
  );
}
