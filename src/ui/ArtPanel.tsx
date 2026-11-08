import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import { artDefaults, chainStyle, docChains } from "../model/art";
import type { Chain, Overridable, ResolvedStyle } from "../model/art";
import type { ArtSide } from "../model/types";
import { fmt } from "../tools/line";
import { useApp, useUi } from "./hooks";
import { Section } from "./PropertyManager";
import css from "./ui.module.css";

/** Number input that commits on Enter/blur (negative values are refused). */
function NumInput({ value, onCommit, title }: { value: number; onCommit: (v: number) => void; title?: string }) {
  const [text, setText] = useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    setText(null);
    if (Number.isFinite(v) && v >= 0) onCommit(v);
  };
  return (
    <input
      value={text ?? fmt(value)}
      title={title}
      inputMode="decimal"
      onInput={(e) => setText((e.target as HTMLInputElement).value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setText(null);
          (e.target as HTMLInputElement).blur();
        }
      }}
    />
  );
}

function ColorInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  return <input type="color" value={value} onChange={(e) => onCommit((e.target as HTMLInputElement).value)} />;
}

/** A labelled value; `custom` shows a reset button back to the default, otherwise a "default" tag. */
function Row({ label, custom, onReset, children }: { label: string; custom?: boolean; onReset?: () => void; children: ComponentChildren }) {
  return (
    <div class={css.field}>
      <span>{label}</span>
      <span class={css.ovr}>
        {children}
        {onReset === undefined ? null : custom ? (
          <button class={css.ovrReset} title="Use the document default" onClick={onReset}>
            ↺
          </button>
        ) : (
          <span class={css.ovrTag} title="Uses the document default (change it under Defaults)">
            default
          </span>
        )}
      </span>
    </div>
  );
}

/** PropertyManager in Art view: the document defaults, and the style of the selected chains. */
export function ArtPanel() {
  const app = useApp();
  useUi();
  const doc = app.store.doc;
  const chains = docChains(doc);
  const sel = app.selectedChains();
  const profiles = chains.filter((c) => c.closed).length;
  const d = artDefaults(doc);
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>Art View</div>
      <Section title="Defaults">
        <Row label="Line weight">
          <NumInput value={d.weight} onCommit={(v) => app.setArtDefaults({ weight: v })} />
        </Row>
        <Row label="Color">
          <ColorInput value={d.color} onCommit={(v) => app.setArtDefaults({ color: v })} />
        </Row>
        <Row label="Corner radius">
          <NumInput value={d.corner} title="Rounds the outside of each corner of a stroke" onCommit={(v) => app.setArtDefaults({ corner: v })} />
        </Row>
        <Row label="End radius">
          <NumInput value={d.end} title="Rounds the ends of open lines; half the weight makes them fully round" onCommit={(v) => app.setArtDefaults({ end: v })} />
        </Row>
        <div class={css.info}>
          Used by every chain that does not set its own. {chains.length - profiles} open chain{chains.length - profiles === 1 ? "" : "s"} · {profiles} profile
          {profiles === 1 ? "" : "s"}. Construction geometry is not drawn.
        </div>
        <button class={css.small} onClick={() => app.selectAllChains()} disabled={!chains.length}>
          Select all
        </button>
      </Section>
      {sel.length ? (
        <ChainSection sel={sel} />
      ) : (
        <div class={css.info}>Click a line or profile to style it. Shift-click adds to the selection; drag to pan.</div>
      )}
    </div>
  );
}

function ChainSection({ sel }: { sel: Chain[] }) {
  const app = useApp();
  const doc = app.store.doc;
  const styles = sel.map((c) => chainStyle(doc, c));
  const closed = sel.filter((c) => c.closed);
  const anyOpen = closed.length < sel.length;
  const allClosed = !anyOpen;
  const custom = (k: Overridable) => styles.some((s: ResolvedStyle) => s.custom[k]);
  const reset = (k: Overridable) => () => app.setChainStyle(sel, { [k]: null });
  const side = styles.every((s) => s.side === styles[0].side) ? styles[0].side : null;
  const sides: [ArtSide, string, string][] = [
    ["center", "Centered", "The stroke is centered on the line"],
    ["left", allClosed ? "Inside" : "Left", allClosed ? "The stroke grows into the profile" : "The stroke grows to the left of the arrow (inside, for a profile)"],
    ["right", allClosed ? "Outside" : "Right", allClosed ? "The stroke grows out of the profile" : "The stroke grows to the right of the arrow (outside, for a profile)"],
  ];
  const title = sel.length === 1 ? (sel[0].closed ? "Profile" : "Chain") : `${sel.length} selected`;
  const s0 = styles[0];
  return (
    <Section title={title}>
      <Row label="Weight" custom={custom("weight")} onReset={reset("weight")}>
        <NumInput value={s0.weight} onCommit={(v) => app.setChainStyle(sel, { weight: v })} />
      </Row>
      <Row label="Color" custom={custom("color")} onReset={reset("color")}>
        <ColorInput value={s0.color} onCommit={(v) => app.setChainStyle(sel, { color: v })} />
      </Row>
      <Row label="Corner radius" custom={custom("corner")} onReset={reset("corner")}>
        <NumInput value={s0.corner} title="Rounds the outside of each corner of the stroke" onCommit={(v) => app.setChainStyle(sel, { corner: v })} />
      </Row>
      {anyOpen && (
        <Row label="End radius" custom={custom("end")} onReset={reset("end")}>
          <NumInput value={s0.end} title="Rounds the line's ends; half the weight makes them fully round" onCommit={(v) => app.setChainStyle(sel, { end: v })} />
        </Row>
      )}
      <div class={css.info}>Width direction</div>
      <div class={css.tabs}>
        {sides.map(([v, label, tip]) => (
          <button key={v} class={`${css.tab} ${side === v ? css.active : ""}`} title={tip} onClick={() => app.setChainStyle(sel, { side: v })}>
            {label}
          </button>
        ))}
      </div>
      {!allClosed && <div class={css.info}>Left and right are seen along the arrow on the selected chain.</div>}
      {closed.length > 0 && (
        <label class={css.check}>
          <input
            type="checkbox"
            checked={closed.every((c) => chainStyle(doc, c).fill)}
            onChange={(e) => app.setChainStyle(closed, { fill: (e.target as HTMLInputElement).checked })}
          />{" "}
          Filled{allClosed ? "" : " (profiles only)"} in the line color
        </label>
      )}
      <button class={css.small} onClick={() => app.setArtSelection([])}>
        Clear selection
      </button>
    </Section>
  );
}
