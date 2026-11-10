import { useLayoutEffect, useRef } from "preact/hooks";
import { relationNames } from "../model/relations";
import { useApp, usePhone, useUi } from "./hooks";
import { Icon } from "./icons";
import { Glyph } from "./RelationsUi";
import css from "./ui.module.css";

/**
 * Bar offering the most likely relations for the selection. It floats near the cursor; on a phone with the
 * touch keys it is docked just above them instead (rendered by TouchKeys with `docked`), so it never runs
 * off the screen.
 */
export function ContextBar({ docked = false }: { docked?: boolean }) {
  const app = useApp();
  const ui = useUi();
  const phone = usePhone();
  const ref = useRef<HTMLDivElement>(null);
  // Keep the floating bar inside the canvas: flip it to the other side of the cursor when it would run off.
  useLayoutEffect(() => {
    const el = ref.current;
    const at = ui.contextBar;
    if (!el || docked || !at || !el.parentElement) return;
    const W = el.parentElement.clientWidth;
    const H = el.parentElement.clientHeight;
    let x = at.x + 14;
    let y = at.y + 14;
    if (x + el.offsetWidth > W - 8) x = Math.max(8, Math.min(at.x - 14 - el.offsetWidth, W - 8 - el.offsetWidth));
    if (y + el.offsetHeight > H - 8) y = Math.max(8, at.y - 14 - el.offsetHeight);
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
  });
  if (!ui.contextBar || app.tool.id !== "select") return null;
  if (docked !== (phone && ui.touchUi)) return null;
  const valid = app.validRelations().filter((t) => t !== "fix").slice(0, 5);
  const s = app.sketch();
  const hasCurves = ui.selection.some((id) => s.entities[id] && s.entities[id].type !== "point" && !s.ext?.[id]);
  const canConvert = ui.selection.some((id) => s.ext?.[id]);
  if (!valid.length && !hasCurves && !canConvert) return null;
  return (
    <div
      ref={ref}
      class={`${css.contextBar} ${docked ? css.contextDock : ""}`}
      style={docked ? undefined : { left: `${ui.contextBar.x + 14}px`, top: `${ui.contextBar.y + 14}px` }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      {valid.map((t) => (
        <button key={t} title={`Make ${relationNames[t]}`} onClick={() => app.addRelation(t)}>
          <Glyph type={t} />
        </button>
      ))}
      {canConvert && (
        <button title="Convert Entities (copy into this sketch, linked)" onClick={() => app.convertCommand()}>
          <span class={css.glyph} style={{ background: "var(--sw-glyph-plain-bg)", color: "var(--sw-glyph-plain-fg)", borderColor: "var(--sw-glyph-plain-border)" }}>
            ⊡
          </span>
        </button>
      )}
      {hasCurves && (
        <button title="Construction Geometry" onClick={() => app.toggleConstruction()}>
          <span class={`${css.glyph} ${css.glyphIcon}`} style={{ background: "var(--sw-glyph-plain-bg)", color: "var(--sw-glyph-plain-fg)", borderColor: "var(--sw-glyph-plain-border)" }}>
            <Icon name="construction" />
          </span>
        </button>
      )}
    </div>
  );
}
