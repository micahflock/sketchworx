import { DOC_VERSION } from "../model/types";
import type { Doc, Entity, Sketch, SketchFeature } from "../model/types";
import { FIRST_FEATURE, ORIGIN, originPoint } from "../model/sketch";

export const FILE_EXT = ".sketch.json";

/** Serialize to the native `.sketch.json` format (stores intent + solved coordinates). */
export function serializeDoc(doc: Doc): string {
  const out = {
    format: "sketchworx",
    version: DOC_VERSION,
    nextId: doc.nextId,
    variables: doc.variables,
    active: doc.active,
    sketches: doc.features.map((f) => ({
      id: f.id,
      name: f.name,
      visible: f.visible,
      entities: Object.values(f.sketch.entities),
      relations: Object.values(f.sketch.relations),
      dimensions: Object.values(f.sketch.dimensions),
    })),
    ...(doc.picture ? { picture: doc.picture } : {}),
  };
  return JSON.stringify(out, null, 1);
}

export class FileFormatError extends Error {}

/**
 * One stored sketch. `known` holds ids of the sketches above it (they may be referenced).
 * With `keepDangling`, relations/dimensions whose geometry is gone are kept (shown as dangling).
 */
function readSketch(src: any, known: Set<string>, keepDangling: boolean): Sketch {
  const entities: Record<string, Entity> = {};
  const list: any[] = Array.isArray(src.entities) ? src.entities : [];
  if (!list.some((e) => e.id === ORIGIN)) entities[ORIGIN] = originPoint();
  for (const e of list) {
    if (e.type === "line" && "guide" in e) continue; // v1 metric guides are no longer supported
    entities[e.id] = e;
  }
  // Drop the endpoints of removed guide lines.
  for (const e of Object.values(entities)) if (e.type === "point" && e.owner && !entities[e.owner]) delete entities[e.id];
  const ok = (id: string) => !!entities[id] || known.has(id) || keepDangling;
  const relations: Sketch["relations"] = {};
  for (const r of src.relations ?? []) if (Array.isArray(r.refs) && r.refs.every(ok)) relations[r.id] = r;
  const dimensions: Sketch["dimensions"] = {};
  for (const d of src.dimensions ?? []) if (Array.isArray(d.refs) && d.refs.every(ok)) dimensions[d.id] = d;
  return { entities, relations, dimensions };
}

export function parseDoc(text: string): Doc {
  let raw: any;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new FileFormatError("Not a JSON file");
  }
  if (!raw || typeof raw !== "object") throw new FileFormatError("Not a sketch file");
  if (typeof raw.version !== "number" || raw.version > DOC_VERSION) throw new FileFormatError(`Unsupported file version ${raw.version}`);

  // Version 1 held glyph slots (open the active one); version 2 a single sketch; version 3 a feature tree.
  let sources: { id: string; name: string; visible: boolean; src: any }[];
  let picture: any;
  if (raw.version < 2) {
    if (!Array.isArray(raw.slots) || raw.slots.length === 0) throw new FileFormatError("Not a sketch file");
    const slot = raw.slots[Math.min(Math.max(0, Number(raw.activeSlot ?? 0)), raw.slots.length - 1)];
    sources = [{ id: FIRST_FEATURE, name: "Sketch1", visible: true, src: slot }];
    picture = slot.picture;
  } else if (raw.version < 3) {
    if (!Array.isArray(raw.entities)) throw new FileFormatError("Not a sketch file");
    sources = [{ id: FIRST_FEATURE, name: "Sketch1", visible: true, src: raw }];
    picture = raw.picture;
  } else {
    if (!Array.isArray(raw.sketches) || raw.sketches.length === 0) throw new FileFormatError("Not a sketch file");
    sources = raw.sketches.map((s: any, i: number) => ({
      id: typeof s.id === "string" ? s.id : `sk${i + 1}`,
      name: typeof s.name === "string" && s.name ? s.name : `Sketch${i + 1}`,
      visible: s.visible !== false,
      src: s,
    }));
    picture = raw.picture;
  }

  const known = new Set<string>();
  const features: SketchFeature[] = sources.map((x) => {
    const sketch = readSketch(x.src, known, raw.version >= 3);
    for (const id of Object.keys(sketch.entities)) known.add(id);
    return { id: x.id, name: x.name, visible: x.visible, sketch };
  });

  // nextId must exceed every numeric id suffix so new ids never collide.
  let maxId = Number(raw.nextId ?? 1);
  const bump = (id: string) => {
    const n = Number(id.replace(/^[a-z]+/i, ""));
    if (Number.isFinite(n)) maxId = Math.max(maxId, n + 1);
  };
  for (const f of features) {
    bump(f.id);
    for (const rec of [f.sketch.entities, f.sketch.relations, f.sketch.dimensions]) for (const id of Object.keys(rec)) bump(id);
  }
  const active = features.some((f) => f.id === raw.active) ? raw.active : features[features.length - 1].id;
  return {
    version: DOC_VERSION,
    nextId: maxId,
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    features,
    active,
    ...(picture ? { picture } : {}),
  };
}
