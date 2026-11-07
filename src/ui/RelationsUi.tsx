import { useState } from "preact/hooks";
import { describeRelation, relationGlyphs, relationNames, relationsOf } from "../model/relations";
import type { Relation, RelationType } from "../model/types";
import { useApp, useUi } from "./hooks";
import { Section } from "./PropertyManager";
import css from "./ui.module.css";

export function Glyph({ type, bad }: { type: RelationType; bad?: boolean }) {
  return <span class={`${css.glyph} ${bad ? css.glyphBad : ""}`}>{relationGlyphs[type]}</span>;
}

function RelationRow({ r }: { r: Relation }) {
  const app = useApp();
  const ui = useUi();
  const s = app.sketch();
  const bad = ui.status.conflicts.includes(r.id);
  return (
    <li
      onMouseEnter={() => app.setHover(r.id)}
      onMouseLeave={() => app.setHover(null)}
      onClick={() => app.select([r.id])}
      class={bad ? css.conflict : ""}
      title={describeRelation(s, r)}
    >
      <span>
        <Glyph type={r.type} bad={bad} /> {relationNames[r.type]}
        {bad ? " (over defining)" : ""}
        <span class={css.info}> {describeRelation(s, r)}</span>
      </span>
      <button
        class={css.small}
        title="Delete relation"
        onClick={(e) => {
          e.stopPropagation();
          app.deleteRelation(r.id);
        }}
      >
        ✕
      </button>
    </li>
  );
}

/** Existing Relations + Add Relations for the current selection (PropertyManager). */
export function RelationsSections() {
  const app = useApp();
  const ui = useUi();
  const s = app.sketch();
  const ents = ui.selection.filter((id) => s.entities[id]);
  if (!ents.length) return null;
  const existing = relationsOf(s, ents);
  const valid = app.validRelations();
  return (
    <>
      <Section title="Existing Relations">
        {existing.length ? (
          <ul class={css.list}>
            {existing.map((r) => (
              <RelationRow key={r.id} r={r} />
            ))}
          </ul>
        ) : (
          <div class={css.info}>None</div>
        )}
      </Section>
      {valid.length > 0 && (
        <Section title="Add Relations">
          <div class={css.relBtns}>
            {valid.map((t) => (
              <button key={t} class={css.relBtn} onClick={() => app.addRelation(t)}>
                <Glyph type={t} /> {relationNames[t]}
              </button>
            ))}
          </div>
        </Section>
      )}
    </>
  );
}

/** SketchXpert lite: list conflicting relations/dimensions with delete buttons. */
export function ConflictList() {
  const app = useApp();
  const ui = useUi();
  const s = app.sketch();
  if (!ui.status.conflicts.length) return null;
  return (
    <Section title="Over Defined: conflicting items">
      <div class={css.info}>Delete one of these to resolve the conflict.</div>
      <ul class={css.list}>
        {ui.status.conflicts.map((id) => {
          const r = s.relations[id];
          const d = s.dimensions[id];
          if (!r && !d) return null;
          return (
            <li key={id} class={css.conflict} onMouseEnter={() => app.setHover(id)} onMouseLeave={() => app.setHover(null)}>
              <span>{r ? <><Glyph type={r.type} bad /> {relationNames[r.type]} <span class={css.info}>{describeRelation(s, r)}</span></> : `Dimension ${d!.expr}`}</span>
              <button class={css.small} onClick={() => app.commit("Delete", (ed) => ed.deleteAny([id]))}>
                Delete this one
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

type Filter = "all" | "selected" | "dangling" | "over";

/** Display/Delete Relations panel. */
export function RelationsPanel() {
  const app = useApp();
  const ui = useUi();
  const s = app.sketch();
  const [filter, setFilter] = useState<Filter>(ui.status.conflicts.length ? "over" : "all");
  const all = Object.values(s.relations);
  const conflicts = new Set(ui.status.conflicts);
  const list =
    filter === "all"
      ? all
      : filter === "selected"
        ? relationsOf(s, ui.selection.filter((id) => s.entities[id]))
        : filter === "over"
          ? all.filter((r) => conflicts.has(r.id))
          : all.filter((r) => r.refs.some((id) => !s.entities[id]));
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>
        Display/Delete Relations{" "}
        <button class={css.small} style={{ float: "right" }} onClick={() => app.store.set({ panel: "auto" })}>
          Close
        </button>
      </div>
      <div class={css.tabs}>
        {(
          [
            ["all", "All in sketch"],
            ["selected", "Selected entities"],
            ["dangling", "Dangling"],
            ["over", "Over defining"],
          ] as [Filter, string][]
        ).map(([k, label]) => (
          <button key={k} class={`${css.tab} ${filter === k ? css.active : ""}`} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>
      {list.length ? (
        <ul class={css.list} style={{ maxHeight: "none" }}>
          {list.map((r) => (
            <RelationRow key={r.id} r={r} />
          ))}
        </ul>
      ) : (
        <div class={css.info}>No relations.</div>
      )}
      {list.length > 1 && (
        <button class={css.small} style={{ marginTop: "8px" }} onClick={() => app.commit("Delete Relations", (ed) => ed.deleteAny(list.map((r) => r.id)))}>
          Delete all listed
        </button>
      )}
      <ConflictList />
    </div>
  );
}
