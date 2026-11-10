import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { artBackground, artDefaults, chainStyle, docChains, effectiveCorner } from "../model/art";
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

/**
 * Color swatch that opens a picker with Apply / Cancel. Nothing changes until Apply (or Enter); a press
 * anywhere else, Esc, scrolling or resizing cancels.
 */
function ColorInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [open, setOpen] = useState<{ top: number; left: number } | null>(null);
  const [draft, setDraft] = useState(value);
  const pop = useRef<HTMLDivElement>(null);
  const swatch = useRef<HTMLButtonElement>(null);
  const cancel = () => setOpen(null);
  const apply = () => {
    setOpen(null);
    if (draft.toLowerCase() !== value.toLowerCase()) onCommit(draft);
  };
  useEffect(() => {
    if (!open) return;
    const down = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!pop.current?.contains(t) && !swatch.current?.contains(t)) cancel();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") cancel();
    };
    const away = (e: Event) => {
      if (!pop.current?.contains(e.target as Node)) cancel();
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", away, true);
    window.addEventListener("resize", cancel);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", away, true);
      window.removeEventListener("resize", cancel);
    };
  }, [!!open]);
  return (
    <>
      <button
        ref={swatch}
        class={css.colorSwatch}
        title={value}
        aria-label={`Color ${value}`}
        aria-expanded={!!open}
        style={{ background: value }}
        onClick={(e) => {
          if (open) return cancel();
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          setDraft(value);
          setOpen({ top: r.bottom + 4, left: Math.max(8, Math.min(r.right - 196, window.innerWidth - 204)) });
        }}
      />
      {open && (
        <div
          ref={pop}
          class={css.colorPop}
          role="dialog"
          aria-label="Pick a color"
          style={{ top: `${open.top}px`, left: `${open.left}px` }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              apply();
            }
          }}
        >
          <div class={css.colorPopRow}>
            <input type="color" value={draft} onInput={(e) => setDraft((e.target as HTMLInputElement).value)} aria-label="Color" />
            <code>{draft}</code>
          </div>
          <div class={css.colorPopRow}>
            <button class={css.colorPopBtn} onClick={cancel}>
              Cancel
            </button>
            <button class={`${css.colorPopBtn} ${css.colorPopApply}`} onClick={apply}>
              Apply
            </button>
          </div>
        </div>
      )}
    </>
  );
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

const CORNER_TIP = "Radius of the outside of each corner of the stroke. 0 is sharp; anything above 0 is at least half the weight";

/** Square or round ends of open lines. */
function Ends({ round, onPick }: { round: boolean; onPick: (round: boolean) => void }) {
  return (
    <span class={css.ends}>
      <button class={`${css.tab} ${round ? "" : css.active}`} title="Square ends, flush with the line's end points" onClick={() => onPick(false)}>
        Square
      </button>
      <button class={`${css.tab} ${round ? css.active : ""}`} title="Half-circle ends, within the line's length" onClick={() => onPick(true)}>
        Round
      </button>
    </span>
  );
}

/** Tells when a corner radius is drawn larger than typed (strokes cannot round tighter than half the weight). */
function CornerNote({ corner, weight }: { corner: number; weight: number }) {
  const shown = effectiveCorner({ corner, weight });
  if (shown === corner) return null;
  return <div class={css.info}>Drawn as {fmt(shown)}: a stroke cannot round tighter than half its weight.</div>;
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
      <Section title="Background">
        <Row label="Color">
          <ColorInput value={artBackground(doc)} onCommit={(v) => app.setArtBackground(v)} />
        </Row>
      </Section>
      <Section title="Defaults">
        <Row label="Line weight">
          <NumInput value={d.weight} onCommit={(v) => app.setArtDefaults({ weight: v })} />
        </Row>
        <Row label="Color">
          <ColorInput value={d.color} onCommit={(v) => app.setArtDefaults({ color: v })} />
        </Row>
        <Row label="Corner radius">
          <NumInput value={d.corner} title={CORNER_TIP} onCommit={(v) => app.setArtDefaults({ corner: v })} />
        </Row>
        <CornerNote corner={d.corner} weight={d.weight} />
        <Row label="Line ends">
          <Ends round={d.roundEnds} onPick={(v) => app.setArtDefaults({ roundEnds: v })} />
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
        <NumInput value={s0.corner} title={CORNER_TIP} onCommit={(v) => app.setChainStyle(sel, { corner: v })} />
      </Row>
      <CornerNote corner={s0.corner} weight={s0.weight} />
      {anyOpen && (
        <Row label="Line ends" custom={custom("roundEnds")} onReset={reset("roundEnds")}>
          <Ends round={s0.roundEnds} onPick={(v) => app.setChainStyle(sel, { roundEnds: v })} />
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
