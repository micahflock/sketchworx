import { artWeight, chainStyle, docChains } from "../model/art";
import type { Chain } from "../model/art";
import type { ArtSide } from "../model/types";
import { useApp, useUi } from "./hooks";
import { NumField, Section } from "./PropertyManager";
import css from "./ui.module.css";

/** PropertyManager in Art view: the default line weight, and the style of the selected chains. */
export function ArtPanel() {
  const app = useApp();
  useUi();
  const doc = app.store.doc;
  const chains = docChains(doc);
  const sel = app.selectedChains();
  const profiles = chains.filter((c) => c.closed).length;
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>Art View</div>
      <Section title="Defaults">
        <NumField label="Line weight" value={artWeight(doc)} onCommit={(v) => v >= 0 && app.setArtWeight(v)} />
        <div class={css.info}>
          Used by every chain without its own weight. {chains.length - profiles} open chain{chains.length - profiles === 1 ? "" : "s"} · {profiles} profile
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
  const allClosed = closed.length === sel.length;
  const custom = styles.some((s) => s.customWeight);
  const side = styles.every((s) => s.side === styles[0].side) ? styles[0].side : null;
  const sides: [ArtSide, string, string][] = [
    ["center", "Centered", "The stroke is centered on the line"],
    ["left", allClosed ? "Inside" : "Left", allClosed ? "The stroke grows into the profile" : "The stroke grows to the left of the arrow (inside, for a profile)"],
    ["right", allClosed ? "Outside" : "Right", allClosed ? "The stroke grows out of the profile" : "The stroke grows to the right of the arrow (outside, for a profile)"],
  ];
  const title = sel.length === 1 ? (sel[0].closed ? "Profile" : "Chain") : `${sel.length} selected`;
  return (
    <Section title={title}>
      <NumField label="Weight" value={styles[0].weight} onCommit={(v) => v >= 0 && app.setChainStyle(sel, { weight: v })} />
      <label class={css.check}>
        <input
          type="checkbox"
          checked={!custom}
          onChange={(e) => app.setChainStyle(sel, { weight: (e.target as HTMLInputElement).checked ? null : styles[0].weight })}
        />{" "}
        Use default weight
      </label>
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
          Filled{allClosed ? "" : " (profiles only)"}
        </label>
      )}
      <button class={css.small} onClick={() => app.setArtSelection([])}>
        Clear selection
      </button>
    </Section>
  );
}
