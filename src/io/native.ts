import { DOC_VERSION } from "../model/types";
import type { Doc, Entity, Sketch } from "../model/types";
import { ORIGIN, originPoint } from "../model/sketch";

export const FILE_EXT = ".sketch.json";

/** Serialize to the native `.sketch.json` format (stores intent + solved coordinates). */
export function serializeDoc(doc: Doc): string {
  const out = {
    format: "sketchworx",
    version: DOC_VERSION,
    nextId: doc.nextId,
    unitsPerEm: doc.unitsPerEm,
    activeSlot: doc.activeSlot,
    variables: doc.variables,
    slots: doc.slots.map((s) => ({
      id: s.id,
      name: s.name,
      advance: s.advance,
      entities: Object.values(s.entities),
      relations: Object.values(s.relations),
      dimensions: Object.values(s.dimensions),
      ...(s.picture ? { picture: s.picture } : {}),
    })),
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
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.slots)) throw new FileFormatError("Not a sketch file");
  if (typeof raw.version !== "number" || raw.version > DOC_VERSION)
    throw new FileFormatError(`Unsupported file version ${raw.version}`);
  const slots: Sketch[] = raw.slots.map((s: any, i: number) => {
    const entities: Record<string, Entity> = {};
    if (!(s.entities ?? []).some((e: Entity) => e.id === ORIGIN)) entities[ORIGIN] = originPoint();
    for (const e of s.entities ?? []) entities[e.id] = e;
    const relations: Sketch["relations"] = {};
    for (const r of s.relations ?? []) relations[r.id] = r;
    const dimensions: Sketch["dimensions"] = {};
    for (const d of s.dimensions ?? []) dimensions[d.id] = d;
    return {
      id: String(s.id ?? `s${i + 1}`),
      name: String(s.name ?? `Sketch${i + 1}`),
      advance: Number(s.advance ?? 600),
      entities,
      relations,
      dimensions,
      ...(s.picture ? { picture: s.picture } : {}),
    };
  });
  if (slots.length === 0) throw new FileFormatError("File has no sketches");
  // nextId must exceed every numeric id suffix so new ids never collide.
  let maxId = Number(raw.nextId ?? 1);
  for (const s of slots)
    for (const rec of [s.entities, s.relations, s.dimensions])
      for (const id of Object.keys(rec)) {
        const n = Number(id.replace(/^[a-z]+/i, ""));
        if (Number.isFinite(n)) maxId = Math.max(maxId, n + 1);
      }
  return {
    version: DOC_VERSION,
    nextId: maxId,
    unitsPerEm: raw.unitsPerEm,
    variables: Array.isArray(raw.variables) ? raw.variables : [],
    slots,
    activeSlot: Math.min(Math.max(0, Number(raw.activeSlot ?? 0)), slots.length - 1),
  };
}
