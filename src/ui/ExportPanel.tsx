import { useState } from "preact/hooks";
import { defaultSvgOptions } from "../io/svg";
import type { SvgOptions } from "../io/svg";
import { useApp } from "./hooks";
import { Section } from "./PropertyManager";
import css from "./ui.module.css";

export function ExportPanel() {
  const app = useApp();
  const [o, setO] = useState<SvgOptions>({ ...defaultSvgOptions });
  const [png, setPng] = useState(1024);
  const set = (p: Partial<SvgOptions>) => setO({ ...o, ...p });
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>
        Export{" "}
        <button class={css.small} style={{ float: "right" }} onClick={() => app.store.set({ panel: "auto" })}>
          Close
        </button>
      </div>
      <Section title="SVG">
        <label class={css.check}>
          <input type="checkbox" checked={!!o.art} onChange={(e) => set({ art: (e.target as HTMLInputElement).checked })} /> As in Art view (line weights, filled profiles)
        </label>
        <div class={css.info}>
          {o.art ? "Each chain is a stroked path, filled profiles are filled paths, and a background other than white is a rectangle behind them." : "Every closed loop filled (construction excluded), nonzero fill, one path."}
        </div>
        <label class={css.field}>
          <span>Arcs as</span>
          <select value={o.arcs} onChange={(e) => set({ arcs: (e.target as HTMLSelectElement).value as SvgOptions["arcs"] })}>
            <option value="arc">SVG arcs (A)</option>
            <option value="cubic">Cubic Béziers</option>
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
