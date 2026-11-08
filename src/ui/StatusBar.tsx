import { useEffect, useRef } from "preact/hooks";
import { fmt } from "../tools/line";
import { useApp, useUi } from "./hooks";
import type { SketchStatus } from "../solver/types";
import css from "./ui.module.css";

const stateText = {
  empty: "",
  under: "Under defined",
  full: "Fully defined",
  over: "Over defined",
  failed: "Solve failed",
};

/** The boxed count beside the state: degrees of freedom left, or the number of conflicts. */
function readoutCount(st: SketchStatus): { n: number; unit: string } | null {
  if (st.state === "under" || st.state === "full") return { n: st.state === "full" ? 0 : st.dof, unit: "DOF" };
  if (st.state === "over") return { n: st.conflicts.length, unit: st.conflicts.length === 1 ? "conflict" : "conflicts" };
  return null;
}

export function StatusBar() {
  const app = useApp();
  const ui = useUi();
  const coordRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    app.onCursor = (p) => {
      if (coordRef.current) coordRef.current.textContent = `${fmt(p.x)}, ${fmt(p.y)}`;
    };
    return () => (app.onCursor = null);
  }, [app]);
  const st = ui.status;
  const count = readoutCount(st);
  return (
    <div class={css.status}>
      <span class={css.statusPrompt}>{ui.message ? <b class={ui.message.kind === "error" ? css.err : ""}>{ui.message.text}</b> : ui.viewMode === "art" ? "Click a line or profile to style it (Shift adds). Drag or wheel to pan and zoom" : ui.prompt}</span>
      <span class={css.coord} ref={coordRef} />
      {ui.ctrl || ui.touchCtrl ? <span class={css.badge}>Ctrl: no auto relations</span> : null}
      {ui.dynamicMirror ? <span class={css.badge}>Dynamic Mirror</span> : null}
      {st.state !== "empty" && (
        <span
          class={`${css.readout} ${css["st_" + st.state]}`}
          style={{ cursor: st.state === "over" ? "pointer" : undefined }}
          title={st.state === "over" ? "Show conflicting relations" : `Solved in ${st.ms.toFixed(1)} ms`}
          onClick={() => st.state === "over" && app.store.set({ panel: "relations" })}
        >
          <span class={css.readoutLabel}>
            {stateText[st.state]}
            {st.solving ? " …" : ""}
          </span>
          {count && (
            <>
              <span class={css.dof}>
                <span>{count.n}</span>
              </span>
              <span class={css.readoutUnit}>{count.unit}</span>
            </>
          )}
        </span>
      )}
      <span class={css.fname}>{ui.fileName ?? "untitled"}</span>
      <span class={css.version} title={`Sketchworx ${__APP_VERSION__}, built ${__APP_BUILT__} from commit ${__APP_COMMIT__}`}>
        <span class={css.versionNum}>v{__APP_VERSION__} · </span>
        {__APP_COMMIT__}
      </span>
    </div>
  );
}
