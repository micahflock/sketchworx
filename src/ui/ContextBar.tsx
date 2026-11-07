import { relationNames } from "../model/relations";
import { useApp, useUi } from "./hooks";
import { Glyph } from "./RelationsUi";
import css from "./ui.module.css";

/** Floating bar near the cursor offering the most likely relations for the selection. */
export function ContextBar() {
  const app = useApp();
  const ui = useUi();
  if (!ui.contextBar || app.tool.id !== "select") return null;
  const valid = app.validRelations().filter((t) => t !== "fix").slice(0, 5);
  const s = app.sketch();
  const hasCurves = ui.selection.some((id) => s.entities[id] && s.entities[id].type !== "point");
  if (!valid.length && !hasCurves) return null;
  return (
    <div class={css.contextBar} style={{ left: `${ui.contextBar.x + 14}px`, top: `${ui.contextBar.y + 14}px` }} onPointerDown={(e) => e.stopPropagation()}>
      {valid.map((t) => (
        <button key={t} title={`Make ${relationNames[t]}`} onClick={() => app.addRelation(t)}>
          <Glyph type={t} />
        </button>
      ))}
      {hasCurves && (
        <button title="Construction Geometry" onClick={() => app.toggleConstruction()}>
          <span class={css.glyph} style={{ background: "#eef", color: "#335", borderColor: "#aac" }}>
            ┄
          </span>
        </button>
      )}
    </div>
  );
}
