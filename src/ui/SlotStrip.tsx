import { useEffect, useRef, useState } from "preact/hooks";
import { boxValid } from "../geom/vec";
import { outlineBounds } from "../io/svg";
import type { Sketch } from "../model/types";
import { outlineOf } from "../render/art";
import { useApp, useUi } from "./hooks";
import css from "./ui.module.css";

/** Thumbnail of a slot's filled outline. Redraws when the sketch object changes. */
function Thumb({ s }: { s: Sketch }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = 68 * dpr;
    c.height = 56 * dpr;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const { o, path } = outlineOf(s, false);
    const b = outlineBounds(o);
    if (!boxValid(b)) return;
    const w = Math.max(b.maxX - b.minX, 1e-9);
    const h = Math.max(b.maxY - b.minY, 1e-9);
    const k = Math.min((c.width * 0.85) / w, (c.height * 0.85) / h);
    ctx.setTransform(k, 0, 0, k, (c.width - w * k) / 2 - b.minX * k, (c.height - h * k) / 2 + b.maxY * k);
    ctx.fillStyle = "#141414";
    ctx.fill(path, "nonzero");
  }, [s]);
  return <canvas ref={ref} />;
}

/** Glyph slots: one sketch per glyph, sharing variables. */
export function SlotStrip() {
  const app = useApp();
  const ui = useUi();
  const doc = ui.history.present;
  const [renaming, setRenaming] = useState<number | null>(null);
  if (doc.slots.length <= 1 && !ui.showSlots) return null;
  return (
    <div class={css.slots}>
      {doc.slots.map((s, i) => (
        <div
          key={s.id}
          class={`${css.slot} ${i === doc.activeSlot ? css.active : ""}`}
          onClick={() => app.setActiveSlot(i)}
          onDblClick={() => setRenaming(i)}
          title="Click to edit; double-click to rename"
        >
          <Thumb s={s} />
          {renaming === i ? (
            <input
              style={{ width: "64px", fontSize: "11px" }}
              value={s.name}
              ref={(el) => el?.focus()}
              onBlur={(e) => {
                app.renameSlot(i, (e.target as HTMLInputElement).value);
                setRenaming(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") (e.target as HTMLInputElement).blur();
                if (e.key === "Escape") setRenaming(null);
              }}
            />
          ) : (
            <span>{s.name}</span>
          )}
        </div>
      ))}
      <button class={css.slotAdd} title="Add a glyph slot" onClick={() => app.addSlot()}>
        +
      </button>
    </div>
  );
}
