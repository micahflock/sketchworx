import { useEffect, useRef, useState } from "preact/hooks";
import { deleteConflict, moveConflict, parents } from "../model/features";
import type { CrossRefs } from "../model/features";
import type { Doc, SketchFeature } from "../model/types";
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

/** "2 relations and 1 dimension" (empty when there are none) */
const removedText = (c: CrossRefs) =>
  andList([c.relations.length && plural(c.relations.length, "relation"), c.dimensions.length && plural(c.dimensions.length, "dimension")].filter(Boolean) as string[]) ?? "";

/** "removes 2 relations and 1 dimension and unlinks 1 offset" */
export function lossText(c: CrossRefs): string {
  const out: string[] = [];
  if (removedText(c)) out.push(`removes ${removedText(c)}`);
  if (c.offsets.length) out.push(`unlinks ${plural(c.offsets.length, "offset")}`);
  return out.join(" and ");
}

/** Which button a question belongs to: the alert's arrow points at it. */
type Pending = "up" | "down" | "delete";

/** Asks before a move or delete that would break references, right under the button pressed. */
function RefConfirm({ at, text, okLabel, onOk, onDone }: { at: Pending; text: string; okLabel: string; onOk: () => void; onDone: () => void }) {
  const ok = useRef<HTMLButtonElement>(null);
  useEffect(() => ok.current?.focus(), []);
  const arrow = at === "up" ? css.ftConfirmUp : at === "down" ? css.ftConfirmDown : css.ftConfirmDelete;
  return (
    <li
      class={`${css.ftConfirm} ${arrow}`}
      role="alertdialog"
      aria-label={okLabel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onDone();
        }
      }}
    >
      <p>{text}</p>
      <div class={css.ftConfirmBtns}>
        <button
          ref={ok}
          class={css.ftConfirmOk}
          onClick={() => {
            onDone();
            onOk();
          }}
        >
          {okLabel}
        </button>
        <button class={css.small} onClick={onDone}>
          Cancel
        </button>
      </div>
    </li>
  );
}

const offsetNote = (n: number) => (n ? " Unlinked offsets stay where they are as free curves." : "");

/** The question for a pending move or delete, or null when it would break nothing. */
function question(doc: Doc, f: SketchFeature, at: Pending): { text: string; okLabel: string } | null {
  if (at === "delete") {
    const deps = deleteConflict(doc, f.id);
    if (!deps.length) return null;
    const users = andList(deps.map((d) => d.feature.name));
    // "removes 1 relation in Sketch2, and 1 relation and 1 dimension in Sketch3 and unlinks 2 offsets"
    const removed = deps.filter((d) => removedText(d.refs)).map((d) => `${removedText(d.refs)} in ${d.feature.name}`);
    const offsets = deps.reduce((n, d) => n + d.refs.offsets.length, 0);
    const verbs: string[] = [];
    if (removed.length) verbs.push(`removes ${removed.length > 1 ? `${removed.slice(0, -1).join(", ")}, and ${removed[removed.length - 1]}` : removed[0]}`);
    if (offsets) verbs.push(`unlinks ${plural(offsets, "offset")}`);
    return {
      text: `${users} ${deps.length === 1 ? "uses" : "use"} ${f.name}. Deleting ${f.name} ${verbs.join(" and ")}.${offsetNote(offsets)}`,
      okLabel: "Remove and delete",
    };
  }
  const c = moveConflict(doc, f.id, at === "up" ? -1 : 1);
  if (!c) return null;
  return {
    text: `${c.lower.name} uses ${c.upper.name}. Moving ${f.name} ${at} ${lossText(c.refs)} in ${c.lower.name}.${offsetNote(c.refs.offsets.length)}`,
    okLabel: "Remove and move",
  };
}

function Row({ f, index, count }: { f: SketchFeature; index: number; count: number }) {
  const app = useApp();
  const ui = useUi();
  const doc = app.store.doc;
  const active = doc.active === f.id;
  const [editing, setEditing] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  // Any change to the document (undo, another edit) drops a question that may no longer apply.
  useEffect(() => setPending(null), [doc]);
  const q = pending && active ? question(doc, f, pending) : null;
  const run = (at: Pending, removeRefs: boolean) => {
    if (at === "delete") app.deleteSketch(f.id, removeRefs);
    else app.moveSketch(f.id, at === "up" ? -1 : 1, removeRefs);
  };
  /** Act at once when nothing would break; otherwise ask (pressing the same button again closes the question). */
  const press = (at: Pending) => {
    if (question(doc, f, at)) setPending(pending === at ? null : at);
    else run(at, false);
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
          <button class={`${css.ftIcon} ${pending === "up" ? css.active : ""}`} title="Move up" disabled={index === 0} onClick={(e) => (e.stopPropagation(), press("up"))}>
            ▲
          </button>
          <button class={`${css.ftIcon} ${pending === "down" ? css.active : ""}`} title="Move down" disabled={index === count - 1} onClick={(e) => (e.stopPropagation(), press("down"))}>
            ▼
          </button>
          <button class={css.ftIcon} title="Rename" onClick={(e) => (e.stopPropagation(), setEditing(true))}>
            ✎
          </button>
          <button class={`${css.ftIcon} ${pending === "delete" ? css.active : ""}`} title="Delete sketch" disabled={count === 1} onClick={(e) => (e.stopPropagation(), press("delete"))}>
            ✕
          </button>
        </span>
      )}
    </li>
    {q && pending && <RefConfirm at={pending} text={q.text} okLabel={q.okLabel} onOk={() => run(pending, true)} onDone={() => setPending(null)} />}
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
