import type { JSX } from "preact";
import { useState } from "preact/hooks";
import { dist } from "../geom/vec";
import { entityLabel, ptv } from "../model/sketch";
import type { Entity, Id, Sketch } from "../model/types";
import { fmt } from "../tools/line";
import type { ToolOption } from "../tools/tool";
import { useApp, useUi } from "./hooks";
import css from "./ui.module.css";
import { RelationsSections, RelationsPanel } from "./RelationsUi";
import { VariablesPanel } from "./VariablesPanel";

export function Section({ title, children, open = true }: { title: string; children: JSX.Element | JSX.Element[] | null | false; open?: boolean }) {
  const [isOpen, setOpen] = useState(open);
  return (
    <div class={css.section}>
      <button class={css.sectionHead} onClick={() => setOpen(!isOpen)}>
        <span>{isOpen ? "▾" : "▸"}</span> {title}
      </button>
      {isOpen && <div class={css.sectionBody}>{children}</div>}
    </div>
  );
}

/** Number field that commits on Enter/blur. */
export function NumField({ value, onCommit, label, readOnly }: { value: number; onCommit?: (v: number) => void; label: string; readOnly?: boolean }) {
  const [text, setText] = useState<string | null>(null);
  const shown = text ?? fmt(value);
  const commit = () => {
    if (text === null) return;
    const v = Number(text);
    setText(null);
    if (Number.isFinite(v) && onCommit) onCommit(v);
  };
  return (
    <label class={css.field}>
      <span>{label}</span>
      <input
        value={shown}
        readOnly={readOnly || !onCommit}
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
    </label>
  );
}

function ToolOptions({ options }: { options: ToolOption[] }) {
  const [, force] = useState(0);
  return (
    <div>
      {options.map((o) => {
        if (o.kind === "check")
          return (
            <label class={css.check} key={o.key}>
              <input
                type="checkbox"
                checked={o.value}
                onChange={(e) => {
                  o.set((e.target as HTMLInputElement).checked);
                  force((x) => x + 1);
                }}
              />{" "}
              {o.label}
            </label>
          );
        if (o.kind === "number") return <NumField key={o.key} label={o.label} value={o.value} onCommit={(v) => (o.set(v), force((x) => x + 1))} />;
        if (o.kind === "choice")
          return (
            <label class={css.field} key={o.key}>
              <span>{o.label}</span>
              <select
                value={o.value}
                onChange={(e) => {
                  o.set((e.target as HTMLSelectElement).value);
                  force((x) => x + 1);
                }}
              >
                {o.choices.map((c) => (
                  <option value={c.value} key={c.value}>
                    {c.label}
                  </option>
                ))}
              </select>
            </label>
          );
        return (
          <div class={css.info} key={o.key}>
            {o.label}
          </div>
        );
      })}
    </div>
  );
}

export function Parameters({ s, e }: { s: Sketch; e: Entity }) {
  const app = useApp();
  const setPoint = (id: Id, x: number, y: number) => app.setPointPosition(id, x, y);
  switch (e.type) {
    case "point":
      return (
        <div>
          <NumField label="X" value={e.x} onCommit={(v) => setPoint(e.id, v, e.y)} />
          <NumField label="Y" value={e.y} onCommit={(v) => setPoint(e.id, e.x, v)} />
        </div>
      );
    case "line": {
      const a = ptv(s, e.p1);
      const b = ptv(s, e.p2);
      return (
        <div>
          <NumField label="Start X" value={a.x} onCommit={(v) => setPoint(e.p1, v, a.y)} />
          <NumField label="Start Y" value={a.y} onCommit={(v) => setPoint(e.p1, a.x, v)} />
          <NumField label="End X" value={b.x} onCommit={(v) => setPoint(e.p2, v, b.y)} />
          <NumField label="End Y" value={b.y} onCommit={(v) => setPoint(e.p2, b.x, v)} />
          <NumField label="Length" value={dist(a, b)} readOnly />
          <NumField label="Angle°" value={(Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI} readOnly />
        </div>
      );
    }
    case "circle": {
      const c = ptv(s, e.c);
      return (
        <div>
          <NumField label="Center X" value={c.x} onCommit={(v) => setPoint(e.c, v, c.y)} />
          <NumField label="Center Y" value={c.y} onCommit={(v) => setPoint(e.c, c.x, v)} />
          <NumField label="Radius" value={e.r} onCommit={(v) => v > 0 && app.setRadius(e.id, v)} />
        </div>
      );
    }
    case "arc": {
      const c = ptv(s, e.c);
      const r = dist(c, ptv(s, e.s));
      return (
        <div>
          <NumField label="Center X" value={c.x} onCommit={(v) => setPoint(e.c, v, c.y)} />
          <NumField label="Center Y" value={c.y} onCommit={(v) => setPoint(e.c, c.x, v)} />
          <NumField label="Radius" value={r} onCommit={(v) => v > 0 && app.setRadius(e.id, v)} />
        </div>
      );
    }
    case "spline": {
      const pts = e.cps.map((id) => ptv(s, id));
      return (
        <div>
          <div class={css.info}>Degree {pts.length - 1} · {pts.length} control vertices</div>
          {pts.slice(0, -1).map((p, i) => (
            <NumField key={i} label={`Side ${i + 1}`} value={dist(p, pts[i + 1])} readOnly />
          ))}
        </div>
      );
    }
  }
}

export function PropertyManager() {
  const app = useApp();
  const ui = useUi();
  const s = app.sketch();
  if (ui.panel === "relations") return <RelationsPanel />;
  if (ui.panel === "variables") return <VariablesPanel />;
  const tool = app.tool;
  if (tool.id !== "select") {
    const opts = tool.options?.() ?? [];
    return (
      <div class={css.pm}>
        <div class={css.pmTitle}>{toolTitle(tool.id)}</div>
        <div class={css.prompt}>{ui.prompt}</div>
        {opts.length > 0 && (
          <Section title="Options">
            <ToolOptions options={opts} />
          </Section>
        )}
      </div>
    );
  }
  const ents = ui.selection.map((id) => s.entities[id]).filter(Boolean) as Entity[];
  if (!ui.selection.length) {
    return (
      <div class={css.pm}>
        <div class={css.pmTitle}>Sketch</div>
        <div class={css.info}>{ui.prompt}</div>
        <SketchSummary s={s} />
      </div>
    );
  }
  const single = ents.length === 1 ? ents[0] : null;
  return (
    <div class={css.pm}>
      <div class={css.pmTitle}>{single ? entityLabel(single) : `${ui.selection.length} items selected`}</div>
      <Section title="Selected Entities">
        <ul class={css.list}>
          {ui.selection.map((id) => (
            <li key={id} onMouseEnter={() => app.setHover(id)} onMouseLeave={() => app.setHover(null)}>
              {s.entities[id] ? entityLabel(s.entities[id]) : s.relations[id] ? `Relation ${id}` : s.dimensions[id] ? `Dimension ${id}` : id}
            </li>
          ))}
        </ul>
      </Section>
      <RelationsSections />
      {ents.some((e) => e.type !== "point") && (
        <Section title="Options">
          <label class={css.check}>
            <input type="checkbox" checked={ents.filter((e) => e.type !== "point").every((e) => e.construction)} onChange={() => app.toggleConstruction()} /> For construction
          </label>
        </Section>
      )}
      {single && (
        <Section title="Parameters">
          <Parameters s={s} e={single} />
        </Section>
      )}
    </div>
  );
}

function SketchSummary({ s }: { s: Sketch }) {
  const n = Object.values(s.entities).filter((e) => e.type !== "point").length;
  return (
    <div class={css.info}>
      {n} entities · {Object.keys(s.relations).length} relations · {Object.keys(s.dimensions).length} dimensions
    </div>
  );
}

export const toolTitle = (id: string) =>
  ({
    line: "Line",
    centerline: "Centerline",
    midline: "Midpoint Line",
    point: "Point",
    circle: "Circle",
    circle3: "Perimeter Circle",
    arc: "Centerpoint Arc",
    arc3: "3 Point Arc",
    tangentArc: "Tangent Arc",
    rect: "Corner Rectangle",
    rectCenter: "Center Rectangle",
    rect3: "3 Point Corner Rectangle",
    rect3Center: "3 Point Center Rectangle",
    parallelogram: "Parallelogram",
    spline: "Style Spline",
    dimension: "Smart Dimension",
    trim: "Trim Entities",
    extend: "Extend Entities",
    fillet: "Sketch Fillet",
    offset: "Offset Entities",
    mirror: "Mirror Entities",
    dynamicMirror: "Dynamic Mirror",
  })[id] ?? id;
