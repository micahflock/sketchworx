import { contextSketch, featureIndex, ORIGIN } from "./sketch";
import type { Dimension, Doc, Entity, Id, Picture, Relation, Sketch, Variable } from "./types";

/**
 * Copy-on-write editor over an immutable Doc. Commands run against an Editor;
 * `result()` returns a new Doc sharing every untouched object with the old one.
 *
 * `s` is the working view of one sketch (by default the active one): its own geometry plus the
 * entities of the sketches above it (`s.ext`). Those borrowed entities can be read and referenced,
 * but every change to them is ignored: only the sketch's own data is written back.
 */
export class Editor {
  private doc: Doc;
  private sketch: Sketch;
  private readonly fi: number;
  private copied = { doc: false, sketch: false, entities: false, relations: false, dimensions: false, features: false };
  /** Automatic relations added by this command that the app drops if they over-define the sketch. */
  readonly tentative: Id[] = [];

  constructor(base: Doc, featureId: Id = base.active) {
    this.doc = base;
    this.fi = featureIndex(base, featureId);
    this.sketch = contextSketch(base, base.features[this.fi].id);
  }

  /** Id of the sketch being edited. */
  get featureId(): Id {
    return this.doc.features[this.fi].id;
  }

  private isExt(id: Id): boolean {
    return !!this.sketch.ext?.[id];
  }

  get s(): Sketch {
    return this.sketch;
  }
  get d(): Doc {
    return this.doc;
  }

  private ensureDoc() {
    if (!this.copied.doc) {
      this.doc = { ...this.doc };
      this.copied.doc = true;
    }
  }
  private ensureSketch() {
    this.ensureDoc();
    if (!this.copied.sketch) {
      this.sketch = { ...this.sketch };
      this.copied.sketch = true;
    }
  }
  private features() {
    this.ensureDoc();
    if (!this.copied.features) {
      this.doc.features = [...this.doc.features];
      this.copied.features = true;
    }
    return this.doc.features;
  }
  private ents(): Record<Id, Entity> {
    this.ensureSketch();
    if (!this.copied.entities) {
      this.sketch.entities = { ...this.sketch.entities };
      this.copied.entities = true;
    }
    return this.sketch.entities;
  }
  private rels(): Record<Id, Relation> {
    this.ensureSketch();
    if (!this.copied.relations) {
      this.sketch.relations = { ...this.sketch.relations };
      this.copied.relations = true;
    }
    return this.sketch.relations;
  }
  private dims(): Record<Id, Dimension> {
    this.ensureSketch();
    if (!this.copied.dimensions) {
      this.sketch.dimensions = { ...this.sketch.dimensions };
      this.copied.dimensions = true;
    }
    return this.sketch.dimensions;
  }

  newId(prefix: string): Id {
    this.ensureDoc();
    const id = `${prefix}${this.doc.nextId}`;
    this.doc.nextId++;
    return id;
  }

  // ---- entities
  addPoint(x: number, y: number, owner?: Id, construction?: boolean): Id {
    const id = this.newId("p");
    this.ents()[id] = { id, type: "point", x, y, ...(owner ? { owner } : {}), ...(construction ? { construction } : {}) };
    return id;
  }

  /** Add a fully built entity (id must already be allocated with newId). */
  put(e: Entity) {
    this.ents()[e.id] = e;
  }

  update<T extends Entity>(id: Id, patch: Partial<T>) {
    const cur = this.sketch.entities[id];
    if (!cur || this.isExt(id)) return;
    this.ents()[id] = { ...cur, ...patch } as Entity;
  }

  movePoint(id: Id, x: number, y: number) {
    const cur = this.sketch.entities[id];
    if (!cur || cur.type !== "point" || this.isExt(id)) return;
    if (cur.x === x && cur.y === y) return;
    this.ents()[id] = { ...cur, x, y };
  }

  /**
   * Delete entities. Curves take their owned points with them; relations and
   * dimensions that lose a required reference are removed.
   */
  deleteEntities(ids: Iterable<Id>) {
    const kill = new Set<Id>();
    for (const id of ids) {
      const e = this.sketch.entities[id];
      if (!e || id === ORIGIN || this.isExt(id)) continue; // other sketches' geometry is read-only here
      if (e.type === "point" && e.owner && this.sketch.entities[e.owner]) continue; // endpoints go with their curve
      if (e.type === "line" && e.owner && this.sketch.entities[e.owner]) continue; // polygon sides go with their spline
      kill.add(id);
    }
    // Owned children (endpoints, control vertices, polygon sides) and driven offsets go with their owner.
    let grew = true;
    while (grew) {
      grew = false;
      for (const e of Object.values(this.sketch.entities)) {
        if (kill.has(e.id) || this.isExt(e.id)) continue;
        const owner = (e.type === "point" || e.type === "line" ? e.owner : undefined) ?? (e.type === "spline" ? e.derived?.source : undefined);
        if (owner && kill.has(owner)) {
          kill.add(e.id);
          grew = true;
        }
      }
    }
    if (kill.size === 0) return;
    const ents = this.ents();
    for (const id of kill) delete ents[id];
    this.pruneReferences(kill);
  }

  /** Remove or shrink relations/dimensions referencing deleted entities. */
  private pruneReferences(dead: Set<Id>) {
    for (const r of Object.values(this.sketch.relations)) {
      if (!r.refs.some((x) => dead.has(x))) continue;
      const keep = r.refs.filter((x) => !dead.has(x));
      const multi = ["horizontal", "vertical", "parallel", "perpendicular", "collinear", "equal", "concentric", "coradial"];
      const min = r.type === "horizontal" || r.type === "vertical" || r.type === "fix" ? 1 : 2;
      if (multi.includes(r.type) && keep.length >= min && keep.length < r.refs.length && r.type !== "perpendicular") {
        this.rels()[r.id] = { ...r, refs: keep };
      } else {
        delete this.rels()[r.id];
      }
    }
    for (const d of Object.values(this.sketch.dimensions)) {
      if (d.refs.some((x) => dead.has(x))) delete this.dims()[d.id];
    }
  }

  // ---- relations
  addRelation(r: Omit<Relation, "id">): Id {
    const id = this.newId("r");
    this.rels()[id] = { ...r, id };
    return id;
  }
  updateRelation(id: Id, patch: Partial<Relation>) {
    const cur = this.sketch.relations[id];
    if (cur) this.rels()[id] = { ...cur, ...patch };
  }
  /**
   * Re-point every relation and dimension reference from one id to another, in this sketch and in
   * the sketches below it (which may reference this sketch's geometry).
   */
  substitute(from: Id, to: Id) {
    const swap = (refs: Id[]) => refs.map((x) => (x === from ? to : x));
    const subDim = (d: Dimension): Dimension => ({
      ...d,
      refs: swap(d.refs),
      ...(d.align ? { align: d.align.map((p) => swap(p) as [Id, Id]) } : {}),
    });
    const dimUses = (d: Dimension) => d.refs.includes(from) || !!d.align?.some((p) => p.includes(from));
    for (const r of Object.values(this.sketch.relations)) if (r.refs.includes(from)) this.rels()[r.id] = { ...r, refs: swap(r.refs) };
    for (const d of Object.values(this.sketch.dimensions)) if (dimUses(d)) this.dims()[d.id] = subDim(d);
    for (let j = this.fi + 1; j < this.doc.features.length; j++) {
      const f = this.doc.features[j];
      const rels = Object.values(f.sketch.relations).filter((r) => r.refs.includes(from));
      const dims = Object.values(f.sketch.dimensions).filter(dimUses);
      if (!rels.length && !dims.length) continue;
      const relations = { ...f.sketch.relations };
      const dimensions = { ...f.sketch.dimensions };
      for (const r of rels) relations[r.id] = { ...r, refs: swap(r.refs) };
      for (const d of dims) dimensions[d.id] = subDim(d);
      this.features()[j] = { ...f, sketch: { ...f.sketch, relations, dimensions } };
    }
  }
  deleteRelation(id: Id) {
    if (this.sketch.relations[id]) delete this.rels()[id];
  }

  // ---- dimensions
  addDimension(d: Omit<Dimension, "id">): Id {
    const id = this.newId("d");
    this.dims()[id] = { ...d, id };
    return id;
  }
  updateDimension(id: Id, patch: Partial<Dimension>) {
    const cur = this.sketch.dimensions[id];
    if (cur) this.dims()[id] = { ...cur, ...patch };
  }
  deleteDimension(id: Id) {
    if (this.sketch.dimensions[id]) delete this.dims()[id];
  }

  // ---- variables
  setVariables(vars: Variable[]) {
    this.ensureDoc();
    this.doc.variables = vars;
  }

  // ---- document / sketch fields
  setDocField<K extends keyof Doc>(key: K, value: Doc[K]) {
    this.ensureDoc();
    this.doc[key] = value;
  }
  /** The background picture belongs to the document (shared by every sketch). */
  setPicture(pic: Picture | undefined) {
    this.ensureDoc();
    if (pic) this.doc.picture = pic;
    else delete this.doc.picture;
    if (this.copied.sketch) {
      if (pic) this.sketch.picture = pic;
      else delete this.sketch.picture;
    }
  }

  /** Delete any id: entity, relation or dimension. */
  deleteAny(ids: Iterable<Id>) {
    const ents: Id[] = [];
    for (const id of ids) {
      if (this.sketch.relations[id]) this.deleteRelation(id);
      else if (this.sketch.dimensions[id]) this.deleteDimension(id);
      else ents.push(id);
    }
    this.deleteEntities(ents);
  }

  result(): Doc {
    if (this.copied.sketch) {
      // Write back only the sketch's own data.
      const stored = this.doc.features[this.fi].sketch;
      const ext = this.sketch.ext;
      let entities = this.sketch.entities;
      if (!this.copied.entities) entities = stored.entities;
      else if (ext) {
        entities = {};
        for (const [id, e] of Object.entries(this.sketch.entities)) if (!ext[id]) entities[id] = e;
      }
      const own: Sketch = { entities, relations: this.sketch.relations, dimensions: this.sketch.dimensions };
      const changed = own.entities !== stored.entities || own.relations !== stored.relations || own.dimensions !== stored.dimensions;
      if (changed) {
        const f = this.doc.features[this.fi];
        this.features()[this.fi] = { ...f, sketch: own };
      }
    }
    return this.doc;
  }
}

export type CommandFn = (ed: Editor) => void;

export function applyCommand(doc: Doc, fn: CommandFn, featureId?: Id): Doc {
  const ed = new Editor(doc, featureId);
  fn(ed);
  return ed.result();
}
