import { useEffect, useRef } from "preact/hooks";
import { fmt } from "../tools/line";
import { useApp, useUi } from "./hooks";
import css from "./ui.module.css";

const stateText = {
  empty: "",
  under: "Under Defined",
  full: "Fully Defined",
  over: "Over Defined",
  failed: "Solve Failed",
};

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
  return (
    <div class={css.status}>
      <span class={css.statusPrompt}>{ui.message ? <b class={ui.message.kind === "error" ? css.err : ""}>{ui.message.text}</b> : ui.viewMode === "art" ? "Click a line or profile to style it (Shift adds). Drag or wheel to pan and zoom" : ui.prompt}</span>
      <span class={css.coord} ref={coordRef} />
      {ui.ctrl || ui.touchCtrl ? <span class={css.badge}>Ctrl: no auto relations</span> : null}
      {ui.dynamicMirror ? <span class={css.badge}>Dynamic Mirror</span> : null}
      {st.state !== "empty" && (
        <span
          class={`${css.state} ${css["st_" + st.state]}`}
          style={{ cursor: st.state === "over" ? "pointer" : undefined }}
          title={st.state === "over" ? "Show conflicting relations" : `Solved in ${st.ms.toFixed(1)} ms`}
          onClick={() => st.state === "over" && app.store.set({ panel: "relations" })}
        >
          {stateText[st.state]}
          {st.state === "under" ? ` · ${st.dof} DOF` : ""}
          {st.solving ? " …" : ""}
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
