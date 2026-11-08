import { useEffect, useRef, useState } from "preact/hooks";
import { measure } from "../model/dimensions";
import { fmt } from "../tools/line";
import { useApp, useUi } from "./hooks";
import css from "./ui.module.css";

/** SolidWorks Modify box: value/expression, spin arrows, ✓ applies, ✕ / Esc cancels. */
export function ModifyBox() {
  const app = useApp();
  const ui = useUi();
  const m = ui.modify;
  const d = m ? app.sketch().dimensions[m.dimId] : undefined;
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const key = m ? `${m.dimId}:${m.isNew}` : "";
  useEffect(() => {
    if (!m || !d) return;
    setText(d.driven ? fmt(Math.abs(measure(app.sketch(), d))) : d.expr);
    setErr(null);
    setTimeout(() => {
      ref.current?.focus();
      ref.current?.select();
    }, 0);
  }, [key]);
  if (!m || !d) return null;
  const close = () => app.store.set({ modify: null });
  const apply = (t = text) => {
    if (d.driven) return close();
    const e = app.setDimensionText(d.id, t);
    if (e) setErr(e);
    else close();
  };
  const spin = (dir: number, big = false) => {
    if (d.driven) return;
    const step = (big ? 10 : 1) * (d.type === "angle" ? 1 : Math.abs(d.value) < 2 ? 0.1 : 1);
    const next = fmt(Math.max(d.type === "angle" ? -360 : 1e-6, d.value + dir * step));
    setText(next);
    const e = app.setDimensionText(d.id, next);
    setErr(e);
  };
  const x = Math.max(4, Math.min(m.x - 80, app.view.width - 250));
  const y = Math.max(4, Math.min(m.y + 16, app.view.height - 50));
  return (
    <div class={css.modify} style={{ left: `${x}px`, top: `${y}px` }} onPointerDown={(e) => e.stopPropagation()} title={err ?? (d.driven ? "Driven dimension (read only)" : "Enter a value or =expression")}>
      <button title="Apply (Enter)" onClick={() => apply()}>
        ✓
      </button>
      <button title="Cancel (Esc)" onClick={close}>
        ✕
      </button>
      <input
        ref={ref}
        value={text}
        readOnly={d.driven}
        class={err ? css.inputErr : ""}
        onInput={(e) => {
          setText((e.target as HTMLInputElement).value);
          setErr(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            apply();
          } else if (e.key === "Escape") {
            e.preventDefault();
            close();
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            spin(1, e.shiftKey);
          } else if (e.key === "ArrowDown") {
            e.preventDefault();
            spin(-1, e.shiftKey);
          }
        }}
        onWheel={(e) => {
          e.preventDefault();
          spin(e.deltaY < 0 ? 1 : -1, e.shiftKey);
        }}
      />
      <div class={css.spin}>
        <button title="Increase" onClick={(e) => spin(1, e.shiftKey)}>
          ▲
        </button>
        <button title="Decrease" onClick={(e) => spin(-1, e.shiftKey)}>
          ▼
        </button>
      </div>
      {err && <span style={{ color: "var(--sw-error)", fontSize: "11px", maxWidth: "160px" }}>{err}</span>}
    </div>
  );
}

export function ConfirmDialog() {
  const app = useApp();
  const ui = useUi();
  const c = ui.confirm;
  if (!c) return null;
  return (
    <div style={{ position: "absolute", inset: "0px", background: "var(--sw-scrim)", zIndex: 40, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ background: "var(--sw-surface)", color: "var(--sw-text)", borderRadius: "8px", boxShadow: "0 10px 30px var(--sw-shadow)", padding: "16px", maxWidth: "380px", border: "1px solid var(--sw-border-strong)" }}>
        <div style={{ fontWeight: 600, marginBottom: "8px" }}>{c.title}</div>
        <div style={{ marginBottom: "14px", color: "var(--sw-text-2)" }}>{c.message}</div>
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          {c.buttons.map((b) => (
            <button
              key={b.label}
              class={css.relBtn}
              onClick={() => {
                app.store.set({ confirm: null });
                b.run();
              }}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
