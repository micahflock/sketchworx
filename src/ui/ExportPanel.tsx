import { useState } from "preact/hooks";
import { defaultSvgOptions } from "../io/svg";
import type { SvgOptions } from "../io/svg";
import { useApp, useUi } from "./hooks";
import { Section } from "./PropertyManager";
import css from "./ui.module.css";

export function ExportPanel() {
  const app = useApp();
  const ui = useUi();
  const [o, setO] = useState<SvgOptions>({ ...defaultSvgOptions, viewBox: app.hasGuides() ? "guides" : "bounds" });
  const [png, setPng] = useState(1024);
  const set = (p: Partial<SvgOptions>) => setO({ ...o, ...p });
  const multi = ui.history.present.slots.length > 1;
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>
        Export{" "}
        <button class={css.small} style={{ float: "right" }} onClick={() => app.store.set({ panel: "auto" })}>
          Close
        </button>
      </div>
      <Section title="SVG">
        <div class={css.info}>Filled outlines only (construction excluded), nonzero fill, one path per glyph.</div>
        {multi && (
          <label class={css.field}>
            <span>Glyphs</span>
            <select value={o.slots} onChange={(e) => set({ slots: (e.target as HTMLSelectElement).value as SvgOptions["slots"] })}>
              <option value="active">Current glyph</option>
              <option value="all">All glyphs in a row</option>
            </select>
          </label>
        )}
        <label class={css.field}>
          <span>Arcs as</span>
          <select value={o.arcs} onChange={(e) => set({ arcs: (e.target as HTMLSelectElement).value as SvgOptions["arcs"] })}>
            <option value="arc">SVG arcs (A)</option>
            <option value="cubic">Cubic Béziers</option>
          </select>
        </label>
        <label class={css.field}>
          <span>viewBox</span>
          <select value={o.viewBox} onChange={(e) => set({ viewBox: (e.target as HTMLSelectElement).value as SvgOptions["viewBox"] })}>
            <option value="bounds">Geometry bounds</option>
            <option value="guides">Metric guides + advance</option>
          </select>
        </label>
        <label class={css.check}>
          <input type="checkbox" checked={o.construction} onChange={(e) => set({ construction: (e.target as HTMLInputElement).checked })} /> Include construction
          (presentation)
        </label>
        <button class={css.relBtn} onClick={() => app.exportSvgFile(o)}>
          Export SVG
        </button>
      </Section>
      <Section title="PNG (Art view)">
        <label class={css.field}>
          <span>Size (px)</span>
          <input value={png} inputMode="numeric" onInput={(e) => setPng(Number((e.target as HTMLInputElement).value) || 1024)} />
        </label>
        <button class={css.relBtn} onClick={() => app.exportPngFile(Math.max(16, Math.min(8192, png)))}>
          Export PNG
        </button>
      </Section>
      <Section title="Native file">
        <button class={css.relBtn} onClick={() => app.saveFile(true)}>
          Save As .sketch.json…
        </button>
      </Section>
    </div>
  );
}
