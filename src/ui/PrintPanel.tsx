import { useState } from "preact/hooks";
import { chainStyle } from "../model/art";
import type { Chain } from "../model/art";
import { COLOR_SETUP_LABEL, filamentById, linesFor, MAX_FILAMENTS, minFeature, PRESETS } from "../model/print";
import { buildRegions, firstLayer } from "../model/regions";
import { describeBreak } from "../app/printGuard";
import type { Doc } from "../model/types";
import { fmt } from "../tools/line";
import { useApp, useUi } from "./hooks";
import { NumField, Section } from "./PropertyManager";
import css from "./ui.module.css";

/** PropertyManager in Print view. */
export function PrintPanel() {
  const app = useApp();
  const ui = useUi();
  const doc = ui.history.present;
  if (!doc.print)
    return (
      <div class={css.pm}>
        <div class={css.pmTitle}>Print View</div>
        <div class={css.info}>
          Print mode draws within your printer's limits: stroke widths in whole nozzle lines, every feature at least two lines wide, sizes in mm. It
          shows the first layer as it will print and exports one profile file per filament for CAD.
        </div>
        <div class={css.info}>Each Art color becomes a filament; the background becomes the base. 1 sketch unit is 1 mm.</div>
        <button class={css.small} onClick={() => app.enablePrint()}>
          Turn on Print mode
        </button>
      </div>
    );
  const sel = app.selectedChains();
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>Print View</div>
      <PreviewSection doc={doc} />
      {sel.length ? <SelectionSection doc={doc} sel={sel} /> : <div class={css.info}>Click an area to choose its filament and width.</div>}
      <IssuesSection doc={doc} />
      <FilamentsSection doc={doc} />
      <PrinterSection doc={doc} />
      <Section title="Print mode" open={false}>
        <div class={css.info}>Turning Print mode off keeps the drawing; w and nozzle stay as ordinary variables.</div>
        <button class={css.small} onClick={() => app.disablePrint()}>
          Turn off Print mode
        </button>
      </Section>
    </div>
  );
}

function Tabs<T extends string>({ value, options, onPick }: { value: T; options: [T, string, string?][]; onPick: (v: T) => void }) {
  return (
    <div class={css.tabs}>
      {options.map(([v, label, tip]) => (
        <button key={v} class={`${css.tab} ${value === v ? css.active : ""}`} title={tip} onClick={() => onPick(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

function PreviewSection({ doc }: { doc: Doc }) {
  const app = useApp();
  const pr = doc.print!;
  const preview = pr.preview ?? "printed";
  const side = pr.side ?? "bed";
  const fl = preview === "printed" ? firstLayer(doc) : null;
  const reg = buildRegions(doc);
  return (
    <Section title="Preview">
      <Tabs
        value={preview}
        options={[
          ["printed", "As printed", "The first layer as the nozzle lays it down, color by color in print order"],
          ["drawn", "Drawn", "The areas as drawn: what is exported"],
        ]}
        onPick={(v) => app.setPrintView({ preview: v })}
      />
      {preview === "printed" && (
        <Tabs
          value={side}
          options={[
            ["bed", "Bed side", "Mirrored: the face that was on the sheet, as seen when the part is turned over"],
            ["top", "Top", "From above, as PrusaSlicer shows it"],
          ]}
          onPick={(v) => app.setPrintView({ side: v })}
        />
      )}
      {!reg.part.length && <div class={css.conflict}>No part yet: draw a closed profile for the part's outline.</div>}
      {fl && (
        <div class={css.info}>
          {fl.count ? `${fl.count} pinhole${fl.count === 1 ? "" : "s"} (bare bed), largest ${fmt(fl.largest)} mm across. Every outside corner makes some; they are not rule breaks.` : "No pinholes."}
        </div>
      )}
    </Section>
  );
}

function Swatch({ color }: { color: string }) {
  return <span class={css.swatch} style={{ background: color }} />;
}

function SelectionSection({ doc, sel }: { doc: Doc; sel: Chain[] }) {
  const app = useApp();
  const pr = doc.print!;
  const p = pr.printer;
  const styles = sel.map((c) => chainStyle(doc, c));
  const stored = (c: Chain) => c.ids.map((id) => doc.art?.styles[id]?.filament).find((f) => f);
  const fil = sel.map((c) => filamentById(doc, stored(c))?.id ?? pr.ink);
  const same = fil.every((f) => f === fil[0]) ? fil[0] : null;
  const closed = sel.filter((c) => c.closed);
  const lines = linesFor(p, styles[0].weight);
  const outlineKey = buildRegions(doc).outline;
  const title = sel.length === 1 ? (sel[0].closed ? "Profile" : "Line") : `${sel.length} selected`;
  return (
    <Section title={title}>
      <div class={css.info}>Filament</div>
      <div class={css.tabs}>
        {pr.filaments.map((f, i) => (
          <button key={f.id} class={`${css.tab} ${same === f.id ? css.active : ""}`} onClick={() => app.setChainStyle(sel, { filament: f.id })}>
            <Swatch color={f.color} /> {i + 1} {f.name}
          </button>
        ))}
      </div>
      {styles[0].weight > 0 ? (
        <NumField label={`Width (lines of ${fmt(p.lineWidth)})`} value={lines} onCommit={(v) => app.setChainStyle(sel, { weight: Math.round(v) * p.lineWidth })} />
      ) : (
        <div class={css.info}>No stroke.</div>
      )}
      <div class={css.info}>
        {styles[0].weight > 0 ? `${fmt(styles[0].weight)} mm. ` : ""}At least {p.minFeatureLines} lines ({fmt(minFeature(p))} mm).
      </div>
      <div class={css.tabs}>
        {styles[0].weight > 0 ? (
          <button class={css.tab} title="No stroke: only the fill prints" onClick={() => app.setChainStyle(sel, { weight: 0 })}>
            No stroke
          </button>
        ) : (
          <button class={css.tab} onClick={() => app.setChainStyle(sel, { weight: minFeature(p) })}>
            Add stroke
          </button>
        )}
      </div>
      {closed.length > 0 && (
        <label class={css.check}>
          <input
            type="checkbox"
            checked={closed.every((c) => chainStyle(doc, c).fill)}
            onChange={(e) => app.setChainStyle(closed, { fill: (e.target as HTMLInputElement).checked })}
          />{" "}
          Filled
        </label>
      )}
      {sel.length === 1 && sel[0].closed && (
        <div class={css.tabs}>
          {outlineKey === sel[0].key ? (
            <span class={css.info}>This is the part outline.</span>
          ) : (
            <button class={css.tab} title="Nothing outside this profile (and its own stroke) is printed" onClick={() => app.setPartOutline(sel[0].key)}>
              Set as part outline
            </button>
          )}
        </div>
      )}
      <button class={css.small} onClick={() => app.setArtSelection([])}>
        Clear selection
      </button>
    </Section>
  );
}

function IssuesSection({ doc }: { doc: Doc }) {
  const app = useApp();
  const ui = useUi();
  const breaks = ui.printReport?.breaks ?? [];
  return (
    <Section title={breaks.length ? `Issues (${breaks.length})` : "Issues"}>
      {breaks.length ? (
        <>
          <div class={css.conflict}>Export is blocked until these are fixed. Edits may fix them but not add more.</div>
          {breaks.map((b, i) => (
            <div class={css.issueRow} key={i}>
              <span>{describeBreak(doc, b).replace(/^a /, "")}</span>
              <button class={css.small} onClick={() => app.showSpot(b.at)}>
                Show
              </button>
            </div>
          ))}
        </>
      ) : (
        <div class={css.info}>Everything prints: no part is narrower than {doc.print!.printer.minFeatureLines} lines.</div>
      )}
      {ui.notices.length > 0 && (
        <>
          <div class={css.info}>Recent</div>
          {ui.notices.slice(0, 20).map((n) => (
            <div class={css.issueRow} key={n.time}>
              <span class={css.info}>{n.text}</span>
              {n.at && (
                <button class={css.small} onClick={() => app.showSpot(n.at!)}>
                  Show
                </button>
              )}
            </div>
          ))}
        </>
      )}
    </Section>
  );
}

function FilamentsSection({ doc }: { doc: Doc }) {
  const app = useApp();
  const pr = doc.print!;
  const max = MAX_FILAMENTS[pr.printer.colorSetup];
  const manual = pr.printer.colorSetup === "manual";
  return (
    <Section title={`Filaments (${pr.filaments.length} of ${max})`}>
      <div class={css.info}>
        {manual
          ? `Top to bottom is the print order: ${pr.filaments.length - 1} filament swap${pr.filaments.length === 2 ? "" : "s"}.`
          : "Slot numbers match PrusaSlicer's extruders. Top to bottom is the print order of each layer."}
      </div>
      {pr.filaments.map((f, i) => (
        <FilamentRow key={f.id} doc={doc} id={f.id} index={i} />
      ))}
      <button class={css.small} disabled={pr.filaments.length >= max} onClick={() => app.addFilament()}>
        Add filament
      </button>
    </Section>
  );
}

function FilamentRow({ doc, id, index }: { doc: Doc; id: string; index: number }) {
  const app = useApp();
  const pr = doc.print!;
  const f = filamentById(doc, id)!;
  const [name, setName] = useState<string | null>(null);
  const other = pr.filaments.find((x) => x.id !== id && x.id === pr.base) ?? pr.filaments.find((x) => x.id !== id);
  return (
    <div class={css.filRow}>
      <span class={css.filSlot}>{index + 1}</span>
      <input type="color" value={f.color} onChange={(e) => app.updateFilament(id, { color: (e.target as HTMLInputElement).value })} />
      <input
        class={css.filName}
        value={name ?? f.name}
        onInput={(e) => setName((e.target as HTMLInputElement).value)}
        onBlur={() => {
          if (name !== null) app.updateFilament(id, { name });
          setName(null);
        }}
        onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
      />
      {pr.base === id ? (
        <span class={css.ovrTag} title="Everything inside the part that nothing else covers">
          base
        </span>
      ) : (
        <button class={css.small} title="Use as the base: everything inside the part that nothing else covers" onClick={() => app.setBaseFilament(id)}>
          base
        </button>
      )}
      <button class={css.small} title="Earlier in the print order" disabled={index === 0} onClick={() => app.moveFilament(id, -1)}>
        ↑
      </button>
      <button class={css.small} title="Later in the print order" disabled={index === pr.filaments.length - 1} onClick={() => app.moveFilament(id, 1)}>
        ↓
      </button>
      <button
        class={css.small}
        title={other ? `Remove; its areas print in ${other.name}` : "A print needs at least one filament"}
        disabled={!other}
        onClick={() => other && app.removeFilament(id, other.id)}
      >
        ✕
      </button>
    </div>
  );
}

function PrinterSection({ doc }: { doc: Doc }) {
  const app = useApp();
  const p = doc.print!.printer;
  return (
    <Section title="Printer" open={false}>
      <label class={css.field}>
        <span>Preset</span>
        <select value={p.preset} onChange={(e) => app.setPrinter({ preset: (e.target as HTMLSelectElement).value })}>
          {PRESETS.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
          {p.preset === "custom" && <option value="custom">Custom</option>}
        </select>
      </label>
      <div class={css.info}>Color changes</div>
      <Tabs
        value={p.colorSetup}
        options={[
          ["mmu3", COLOR_SETUP_LABEL.mmu3, "Up to 5 filaments, changed automatically within a layer"],
          ["manual", COLOR_SETUP_LABEL.manual, "Each color its own body, printed in order with a pause to swap filament (up to 8)"],
        ]}
        onPick={(v) => app.setPrinter({ colorSetup: v })}
      />
      <NumField label="Nozzle (mm)" value={p.nozzle} onCommit={(v) => app.setPrinter({ nozzle: v })} />
      <NumField label="Line width w (mm)" value={p.lineWidth} onCommit={(v) => app.setPrinter({ lineWidth: v })} />
      <NumField label="Min feature (lines)" value={p.minFeatureLines} onCommit={(v) => app.setPrinter({ minFeatureLines: v })} />
      <NumField label="First layer width (mm)" value={p.firstLayerWidth} onCommit={(v) => app.setPrinter({ firstLayerWidth: v })} />
      <NumField label="Squish (mm per side)" value={p.squish} onCommit={(v) => app.setPrinter({ squish: v })} />
      <NumField label="Layer height (mm)" value={p.layerHeight} onCommit={(v) => app.setPrinter({ layerHeight: v })} />
      <label class={css.field}>
        <span>Sheet color</span>
        <input type="color" value={p.sheetColor} onChange={(e) => app.setPrinter({ sheetColor: (e.target as HTMLInputElement).value })} />
      </label>
      <div class={css.info}>
        Widths follow PrusaSlicer's MK4S profiles closely; match them to your print settings. Squish is an estimate. Changing the printer may
        create issues: they are listed and block export, and edits may fix them but not add more.
      </div>
    </Section>
  );
}
