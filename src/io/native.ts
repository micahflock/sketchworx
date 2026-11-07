import { DOC_VERSION } from "../model/types";
import type { Doc, Entity, Sketch } from "../model/types";
import { ORIGIN, originPoint } from "../model/sketch";

export const FILE_EXT = ".sketch.json";

/** Serialize to the native `.sketch.json` format (stores intent + solved coordinates). */
export function serializeDoc(doc: Doc): string {
  const s = doc.sketch;
  const out = {
    format: "sketchworx",
    version: DOC_VERSION,
    nextId: doc.nextId,
    variables: doc.variables,
    entities: Object.values(s.entities),
    relations: Object.values(s.relations),
    dimensions: Object.values(s.dimensions),
    ...(s.picture ? { picture: s.picture } : {}),
  };
  return JSON.stringify(out, null, 1);
}

export class FileFormatError extends Error {}

export function parseDoc(text: string): Doc {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileFormatError("Not a JSON file");
  }
  if (!raw || typeof raw !== "object") throw new FileFormatError("Not a sketch file");
  if (typeof raw.version !== "number" || raw.version > DOC_VERSION) throw new FileFormatError(`Unsupported file version ${raw.version}`);
  // Version 1 files held a list of sketches; open the one that was active.
  let src: any = raw;
  if (raw.version < 2) {
    if (!Array.isArray(raw.slots) || raw.slots.length === 0) throw new FileFormatError("Not a sketch file");
    src = raw.slots[Math.min(Math.max(0, Number(raw.activeSlot ?? 0)), raw.slots.length - 1)];
  } else if (!Array.isArray(raw.entities)) throw new FileFormatError("Not a sketch file");

  const entities: Record<string, Entity> = {};
  const list: any[] = src.entities ?? [];
  if (!list.some((e) => e.id === ORIGIN)) entities[ORIGIN] = originPoint();
  for (const e of list) {
    if (e.type === "line" && "guide" in e) continue; // v1 metric guides are no longer supported
    entities[e.id] = e;
  }
  // Drop the endpoints of removed guide lines.
  for (const e of Object.values(entities)) if (e.type === "point" && e.owner && !entities[e.owner]) delete entities[e.id];
  const relations: Sketch["relations"] = {};
  for (const r of src.relations ?? []) if (r.refs.every((id: string) => entities[id])) relations[r.id] = r;
  const dimensions: Sketch["dimensions"] = {};
  for (const d of src.dimensions ?? []) if (d.refs.every((id: string) => entities[id])) dimensions[d.id] = d;
  const sketch: Sketch = { entities, relations, dimensions, ...(src.picture ? { picture: src.picture } : {}) };

  // nextId must exceed every numeric id suffix so new ids never collide.
  let maxId = Number(raw.nextId ?? 1);
  for (const rec of [sketch.entities, sketch.relations, sketch.dimensions])
    for (const id of Object.keys(rec)) {
      const n = Number(id.replace(/^[a-z]+/i, ""));
      if (Number.isFinite(n)) maxId = Math.max(maxId, n + 1);
    }
  return { version: DOC_VERSION, nextId: maxId, variables: Array.isArray(raw.variables) ? raw.variables : [], sketch };
}
