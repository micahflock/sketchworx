import { useEffect, useRef, useState } from "preact/hooks";
import { moveConflict, parents } from "../model/features";
import type { CrossRefs } from "../model/features";
import type { SketchFeature } from "../model/types";
import { useApp, useUi } from "./hooks";
import css from "./ui.module.css";

const stateLabel: Record<string, string> = {
  empty: "Empty",
  under: "Under defined",
  full: "Fully defined",
  over: "Over defined",
  failed: "Could not solve",
};

function Eye({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.3" />
      {open ? <circle cx="8" cy="8" r="2.2" fill="currentColor" /> : <path d="M2.5 13.5l11-11" stroke="currentColor" stroke-width="1.3" />}
    </svg>
  );
}

/** Small sketch icon tinted by rebuild state, with a warning mark for dangling references. */
function StateIcon({ state, dangling }: { state?: string; dangling: number }) {
  const color = state === "over" ? "var(--sw-over)" : state === "failed" ? "var(--sw-failed)" : state === "full" ? "var(--sw-full)" : "var(--sw-under)";
  return (
    <span class={css.ftState} title={`${stateLabel[state ?? "empty"] ?? ""}${dangling ? ` · ${dangling} dangling reference${dangling > 1 ? "s" : ""}` : ""}`}>
      <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 12.5L6 4l3.5 5 2-3 2 6.5z" fill="none" style={{ stroke: color }} stroke-width="1.4" stroke-linejoin="round" />
      </svg>
      {(state === "over" || state === "failed") && <b class={css.ftBad}>!</b>}
      {dangling > 0 && state !== "over" && state !== "failed" && <b class={css.ftWarn}>?</b>}
    </span>
  );
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
const andList = (parts: string[]) => (parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0]);

/** "removes 2 relations and 1 dimension and unlinks 1 offset" */
export function lossText(c: CrossRefs): string {
  const removed = [c.relations.length && plural(c.relations.length, "relation"), c.dimensions.length && plural(c.dimensions.length, "dimension")].filter(Boolean) as string[];
  const out: string[] = [];
  if (removed.length) out.push(`removes ${andList(removed)}`);
  if (c.offsets.length) out.push(`unlinks ${plural(c.offsets.length, "offset")}`);
  return out.join(" and ");
}

/** Asks before a move that would break references, right under the move button. */
function MoveConfirm({ f, dir, refs, lower, upper, onDone }: { f: SketchFeature; dir: -1 | 1; refs: CrossRefs; lower: string; upper: string; onDone: () => void }) {
  const app = useApp();
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  return (
    <li
      class={`${css.ftConfirm} ${dir < 0 ? css.ftConfirmUp : css.ftConfirmDown}`}
      role="alertdialog"
      aria-label="Confirm move"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <p>
        {lower} uses {upper}. Moving {f.name} {dir < 0 ? "up" : "down"} {lossText(refs)} in {lower}.
        {refs.offsets.length > 0 && " Unlinked offsets stay where they are as free curves."}
      </p>
      <div class={css.ftConfirmBtns}>
        <button
          ref={ok}
          class={css.ftConfirmOk}
          onClick={() => {
            onDone();
            app.moveSketch(f.id, dir, true);
          }}
        >
          Remove and move
        </button>
        <button class={css.small} onClick={onDone}>
          Cancel
        </button>
      </div>
    </li>
  );
}

function Row({ f, index, count }: { f: SketchFeature; index: number; count: number }) {
  const app = useApp();
  const ui = useUi();
  const doc = app.store.doc;
  const active = doc.active === f.id;
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<-1 | 1 | null>(null);
  // Any change to the document (undo, another edit) drops a question that may no longer apply.
  useEffect(() => setPending(null), [doc]);
  const conflict = pending && active ? moveConflict(doc, f.id, pending) : null;
  const move = (dir: -1 | 1) => {
    if (moveConflict(doc, f.id, dir)) setPending(pending === dir ? null : dir);
    else app.moveSketch(f.id, dir);
  };
  const st = ui.featureStatus[f.id];
  const refs = parents(doc, f.id).map((p) => p.name);
  const finish = (value: string | null) => {
    setEditing(false);
    if (value !== null) app.renameSketch(f.id, value);
  };
  return (
    <>
    <li
      class={`${css.ftRow} ${active ? css.ftActive : ""} ${f.visible ? "" : css.ftHidden}`}
      onClick={() => app.activateSketch(f.id)}
      title={active ? `Editing ${f.name}` : `Click to edit ${f.name}`}
    >
      <button
        class={css.ftIcon}
        title={f.visible ? "Hide sketch" : "Show sketch"}
        onClick={(e) => {
          e.stopPropagation();
          app.setSketchVisible(f.id, !f.visible);
        }}
      >
        <Eye open={f.visible} />
      </button>
      <StateIcon state={st?.state} dangling={st?.dangling ?? 0} />
      {editing ? (
        <input
          class={css.ftName}
          value={f.name}
          ref={(el) => el?.focus()}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => finish((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") finish((e.target as HTMLInputElement).value);
            else if (e.key === "Escape") finish(null);
          }}
        />
      ) : (
        <span
          class={css.ftLabel}
          onDblClick={(e) => {
            e.stopPropagation();
            setEditing(true);
          }}
        >
          {f.name}
          {refs.length > 0 && <span class={css.ftRefs}> → {refs.join(", ")}</span>}
        </span>
      )}
      {active && (
        <span class={css.ftActions}>
          <button class={`${css.ftIcon} ${pending === -1 ? css.active : ""}`} title="Move up" disabled={index === 0} onClick={(e) => (e.stopPropagation(), move(-1))}>
            ▲
          </button>
          <button class={`${css.ftIcon} ${pending === 1 ? css.active : ""}`} title="Move down" disabled={index === count - 1} onClick={(e) => (e.stopPropagation(), move(1))}>
            ▼
          </button>
          <button class={css.ftIcon} title="Rename" onClick={(e) => (e.stopPropagation(), setEditing(true))}>
            ✎
          </button>
          <button class={css.ftIcon} title="Delete sketch" disabled={count === 1} onClick={(e) => (e.stopPropagation(), app.deleteSketch(f.id))}>
            ✕
          </button>
        </span>
      )}
    </li>
    {conflict && pending && (
      <MoveConfirm f={f} dir={pending} refs={conflict.refs} lower={conflict.lower.name} upper={conflict.upper.name} onDone={() => setPending(null)} />
    )}
    </>
  );
}

/**
 * FeatureManager design tree: sketches in rebuild order. Click a sketch to edit it; a sketch can
 * reference geometry of the sketches above it, which stays locked while you edit it.
 */
export function FeatureTree() {
  const app = useApp();
  useUi();
  const doc = app.store.doc;
  const [open, setOpen] = useState(true);
  return (
    <div class={css.ft}>
      <div class={css.ftHead}>
        <button class={css.ftToggle} onClick={() => setOpen(!open)} title={open ? "Collapse" : "Expand"}>
          {open ? "▾" : "▸"} Sketches
        </button>
        <button class={css.small} onClick={() => app.newSketch()} title="Add a sketch below the others and edit it">
          + New sketch
        </button>
      </div>
      {open && (
        <ul class={css.ftList}>
          {doc.features.map((f, i) => (
            <Row key={f.id} f={f} index={i} count={doc.features.length} />
          ))}
        </ul>
      )}
    </div>
  );
}
