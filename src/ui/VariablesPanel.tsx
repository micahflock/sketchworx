import { useState } from "preact/hooks";
import { evaluateVariables, isIdent } from "../model/expr";
import type { Variable } from "../model/types";
import { fmt } from "../tools/line";
import { useApp, useUi } from "./hooks";
import css from "./ui.module.css";

/** Global Variables (SolidWorks Equations, simplified). */
export function VariablesPanel() {
  const app = useApp();
  const ui = useUi();
  const doc = ui.history.present;
  const vars = doc.variables;
  const ev = evaluateVariables(vars);
  const [newName, setNewName] = useState("");
  const [newExpr, setNewExpr] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const update = (i: number, patch: Partial<Variable>) => {
    const next = vars.map((v, k) => (k === i ? { ...v, ...patch } : v));
    app.setVariables(next);
  };
  const add = () => {
    const name = newName.trim();
    if (!isIdent(name)) return setErr("Name must be a letter or _ followed by letters, digits or _");
    if (vars.some((v) => v.name === name)) return setErr(`${name} already exists`);
    const expr = newExpr.trim() || "0";
    app.setVariables([...vars, { name, expr, value: 0 }]);
    setNewName("");
    setNewExpr("");
    setErr(null);
  };
  const usage = (name: string) =>
    doc.features.flatMap((f) => Object.values(f.sketch.dimensions)).filter((d) => new RegExp(`\\b${name}\\b`).test(d.expr)).length;

  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>
        Global Variables{" "}
        <button class={css.small} style={{ float: "right" }} onClick={() => app.store.set({ panel: "auto" })}>
          Close
        </button>
      </div>
      <div class={css.info}>Use in dimensions as =name, e.g. =width*1.5. Functions: min, max, sqrt, sin, cos (degrees).</div>
      <div class={css.varRow} style={{ fontWeight: 600, fontSize: "12px" }}>
        <span>Name</span>
        <span>Value / expression</span>
        <span>=</span>
        <span />
      </div>
      {vars.map((v, i) => (
        <VarRow
          key={v.name}
          v={v}
          value={ev.values.get(v.name)}
          error={ev.errors.get(v.name)}
          uses={usage(v.name)}
          onExpr={(expr) => update(i, { expr })}
          onRename={(name) => {
            if (!isIdent(name) || vars.some((x, k) => k !== i && x.name === name)) return false;
            app.renameVariable(v.name, name);
            return true;
          }}
          onDelete={() => app.setVariables(vars.filter((_, k) => k !== i))}
        />
      ))}
      <div class={css.varRow}>
        <input placeholder="name" value={newName} onInput={(e) => setNewName((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <input placeholder="value" value={newExpr} onInput={(e) => setNewExpr((e.target as HTMLInputElement).value)} onKeyDown={(e) => e.key === "Enter" && add()} />
        <span />
        <button class={css.small} onClick={add}>
          Add
        </button>
      </div>
      {err && <div class={css.conflict}>{err}</div>}
    </div>
  );
}

function VarRow(props: {
  v: Variable;
  value: number | undefined;
  error: string | undefined;
  uses: number;
  onExpr(expr: string): void;
  onRename(name: string): boolean;
  onDelete(): void;
}) {
  const [expr, setExpr] = useState<string | null>(null);
  const [name, setName] = useState<string | null>(null);
  const commitExpr = () => {
    if (expr !== null && expr.trim() && expr !== props.v.expr) props.onExpr(expr.trim());
    setExpr(null);
  };
  if (props.v.locked)
    return (
      <div class={css.varRow} title="Follows the printer profile (Print view → Printer)">
        <input value={props.v.name} readOnly />
        <input value={props.v.expr} readOnly />
        <span class={css.varVal}>{props.value === undefined ? "?" : fmt(props.value)}</span>
        <span class={css.ovrTag}>printer</span>
      </div>
    );
  const commitName = () => {
    if (name !== null && name !== props.v.name && !props.onRename(name.trim())) {
      /* invalid rename: revert */
    }
    setName(null);
  };
  return (
    <div class={css.varRow} title={props.error ?? `${props.uses} dimension(s) use this`}>
      <input
        value={name ?? props.v.name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onBlur={commitName}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      <input
        class={props.error ? css.inputErr : ""}
        value={expr ?? props.v.expr}
        onInput={(e) => setExpr((e.target as HTMLInputElement).value)}
        onBlur={commitExpr}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            const cur = props.value ?? 0;
            if (/^\s*-?[\d.]+\s*$/.test(props.v.expr)) {
              e.preventDefault();
              props.onExpr(fmt(cur + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1)));
            }
          }
        }}
      />
      <span class={css.varVal}>{props.value === undefined ? "?" : fmt(props.value)}</span>
      <button class={css.small} title="Delete variable" onClick={props.onDelete}>
        ✕
      </button>
    </div>
  );
}
