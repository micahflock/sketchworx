# Print Mode — design spec (draft for review)

Status: **draft, not built**. Sections marked **[Q]** are open questions that change the design; answers
go in the "Decisions" table at the end.

## 1. Goal

A third way of looking at a Sketchworx document, next to Sketch and Art: **Print view**. It treats the
artwork as something an FDM printer will lay down with a real nozzle, and it:

1. lets you draw with the printer's limits in mind (stroke widths in nozzle lines, sizes in mm),
2. shows what will actually come out of the printer (thin bits lost, corners rounded),
3. flags the places that will not print as drawn, and
4. exports one clean, closed, non-overlapping profile per filament color, ready to extrude into CAD
   bodies (and from there into the slicer as a multi-body, multi-color part).

It reuses everything that exists: sketches, relations, dimensions, variables, chains and Art styles. Print
view adds a printer profile, a filament palette, a "region" model built from the art, checks and a
preview.

## 2. Target workflow

```
Sketch (constraints, mm) ─► Art styles (strokes, fills, filament per chain)
        │
        ▼
Print view: regions per filament ─► checks + "as printed" preview ─► fix in Sketch/Art
        │
        ▼
Export DXF / SVG (one closed profile set per filament, shared edges identical)
        │
        ▼
CAD: import as sketch, extrude each color as its own body (heights set in CAD)
        │
        ▼
Slicer: assign filament per body, print
```

## 3. Assumptions about the printer

- FDM, **one nozzle, several filaments** (AMS / MMU style) or a tool changer. Colors are changed per region in
  XY; there is no mixing.
- The color pattern is a **2D tiling in the XY plane**: every point of the part is exactly one filament.
  Depth (how many layers each color is) is decided in CAD, not here. **[Q1]**
- The slicer prints each color region with perimeters of **line width `w`** (usually a bit more than the
  nozzle diameter, e.g. 0.42–0.45 mm for a 0.4 mm nozzle) and fills the inside. The slicer's variable-width
  perimeters (Arachne) let it print walls a little under `w`, but anything well under about `w` is dropped
  or smeared.
- What prints is, to a good approximation, each region **opened by a disk of radius `w/2`**: shrink by `w/2`,
  grow back by `w/2`. That gives the two visible effects:
  - features narrower than about `w` disappear (and the neighbouring color fills the gap),
  - outside (convex) corners round to radius `w/2`; inside corners stay sharp, but each inside corner is the
    neighbouring color's outside corner, so it gets rounded from the other side.

## 4. Printer profile

Stored on the document (`doc.print.printer`), editable in a **Printer** panel, with a few presets.

| Field | Default | Used for |
| --- | --- | --- |
| Nozzle diameter | 0.4 mm | Label, presets |
| Line width `w` | 0.42 mm | Stroke quantizing, checks, preview |
| Minimum feature | 1 × `w` (option: 2 × `w`) | "Too thin" check **[Q5]** |
| Layer height | 0.2 mm | Only shown, and passed to 3MF if that is ever added |
| Minimum gap | equal to minimum feature | Same-color features that would merge |

Units: Print view needs real units. **1 sketch unit = 1 mm** whenever a document has a printer profile;
dimensions and the status bar show "mm". (The rest of the app stays unitless, as now.) **[Q6]**

## 5. Filament palette

- A short list of **filament slots** (e.g. 4 for one AMS), each with a name and a color, e.g.
  `1 White, 2 Black, 3 Red, 4 Yellow`. Stored on `doc.print.filaments`.
- In Print view each chain gets a **slot**, not a free hex color. Art view keeps working: a chain's Art color
  becomes the slot's color when Print mode is on. Existing documents: on first use, each distinct Art color
  is offered as a slot (merging up to the slot count is the user's call).
- One slot is the **base**: the color of everything inside the part outline that no other region covers.
- **Part outline**: by default the outermost filled profile; it can be set to any closed profile ("Set as
  part outline"). Nothing outside it is exported.

## 6. Drawing with the printer in mind

What changes while drawing and styling, when Print mode is on:

1. **Stroke weights in lines.** The weight field accepts `3 lines` (or `3L`) and mm. Weights snap to whole
   multiples of `w` (option: half lines, off by default). The panel shows both: `1.26 mm · 3 lines`.
   Weights under the minimum feature are refused with the reason.
2. **Grid** can be set to `w` (or a multiple), so hand-placed points land on printable spacing.
3. **Variables** `w` and `nozzle` exist automatically and follow the printer profile, so dimensions can be
   written as `=3*w` and the whole design re-solves if the nozzle changes (e.g. 0.4 → 0.2 mm).
4. **Corner radius** of strokes defaults to `w/2` (the smallest the printer makes anyway), so Art view
   already looks like the print.
5. Live checks (section 8) run as you edit, the same way open-end and self-intersection markers do today.

Enforcing vs. warning: by default the app **snaps and warns** but never blocks drawing. **[Q4]**

## 7. Regions: from art to filament areas

The core new piece. Art today is a stack of strokes and fills that may overlap. Printing needs a **planar
partition**: non-overlapping regions, each one filament, that tile the part with no gaps.

Steps (pure functions in `src/model/print.ts`, no DOM):

1. **Shapes per chain.** Each chain becomes a filled area:
   - a filled profile → its inside,
   - a stroke → the area the stroke covers (centered, left or right; with its corner and end style). This is
     the stroke's outline, the same geometry Art view draws.
2. **Stacking order.** Later chains cover earlier ones (drawing order: feature tree order, then creation
   order), as the Art view already paints. **[Q3]** — or an explicit per-chain "z order".
3. **Flatten.** For each slot: union of its shapes, minus every shape above it, clipped to the part
   outline. The base slot gets what is left of the outline.
4. **Clean.** Drop slivers below a tiny area (e.g. 0.001 mm²) that come from numeric noise, not design.

Geometry engine: boolean operations on curved shapes are hard to do exactly. Proposal:

- Flatten curves to polylines at a tolerance far below print resolution (≤ 1 µm), run booleans with
  **Clipper2** (integer coordinates, robust, also does the `w/2` offsets for the preview). Adds one
  dependency (`clipper2-js` or similar, MIT/BSL). **[Q8]**
- Before export, **refit lines and arcs** to the result (tolerance ~5 µm), so CAD gets real arcs, not
  thousands of tiny segments. Edges that come straight from a sketch line or arc keep their exact
  geometry where they survive unchanged.
- Each boundary between two colors is computed once and written to both profiles, so adjacent CAD bodies
  share the exact same edge (no gaps or overlaps between bodies).

## 8. Checks (design rules)

Shown in an **Issues** list in the Print panel and as orange markers on the canvas (click to zoom to it).
Each check names the region, the measured value and the limit.

| Check | Rule | Marker |
| --- | --- | --- |
| Too thin | Part of a region narrower than the minimum feature (it vanishes in the "as printed" preview) | Orange hatch on the lost area |
| Gap too small | Two parts of the same color closer than the minimum gap (they will merge) | Orange bar across the gap |
| Tiny island | A region smaller than e.g. 2w × 2w (likely blobs or is skipped) | Ring |
| Stroke not whole lines | Stroke weight not a multiple of `w` (only when snapping is off) | On the chain |
| Open or crossing art | Existing open-end and self-intersection checks, since they break regions | As today |
| Too many colors | More slots used than the printer has | Banner |

Thin/gap detection uses the same opening as the preview: area in the drawn region but not in the
"as printed" region is "too thin"; area in the as-printed closing (grow then shrink) that is not in the region
is "gap too small".

## 9. Print view (preview)

A view mode next to Sketch / Art / Split (`ViewMode = "print"`), and the right-hand pane of Split can show it.

- **Drawn**: the flattened regions in filament colors (what will be exported).
- **As printed** (toggle, default on): each region opened by `w/2`. Lost areas are hatched, rounded corners
  show as rounded. This is the honest preview.
- **Beads** (toggle, later phase): the outer perimeter path(s) drawn as `w`-wide lines, like a slicer preview
  of one layer. **[Q7]**
- **Zoom to real size** button (1:1 on screen using the display's DPI where the browser reports it) and a
  **"nozzle" cursor**: a circle of diameter `w` that follows the pointer, to judge small details by eye.
- Picking in Print view selects the chain that made the region, so its style can be edited in place
  (like Art view).

## 10. Export

All exports are in mm, y-up, origin at the sketch origin (so re-exports line up in CAD).

1. **DXF** (main target for CAD): one layer per filament (`F1_White`, `F2_Black`, …) plus `OUTLINE`. Entities
   as `LINE`, `ARC`, `CIRCLE` and `LWPOLYLINE` (bulges for arcs); style splines as `SPLINE` where they survive
   unchanged, otherwise fitted arcs. Every profile closed. Option: one file per filament (some CAD imports
   handle one-profile-per-file more easily). **[Q2]**
2. **SVG per filament** (for CAD/slicers that take SVG): one file per slot, or one file with one `<g>` per slot,
   filled paths only, `width`/`height` in mm.
3. **Preview PNG** of Print view (drawn or as printed).
4. Later, maybe: **3MF** with each color extruded to a given height as its own object, ready for the slicer
   without CAD. Out of scope for v1. **[Q1]**

## 11. Data model and file format

```ts
interface PrintSettings {
  printer: { nozzle: number; lineWidth: number; minFeature: number; minGap: number; layerHeight: number };
  filaments: { id: Id; name: string; color: string }[];
  base: Id;              // filament slot of the background
  outline?: Id;          // chain key of the part outline (unset: outermost filled profile)
  snapLines: boolean;    // stroke weights snap to whole lines
}
// Doc.print?: PrintSettings      ArtStyle.filament?: Id
```

Optional field on the existing version 3 format (older files open with Print mode off). Print settings
are undo steps and, like Art styles, never re-solve the sketch (except changing the line width, which
re-solves because the `w` variable changes).

## 12. Out of scope (v1)

- Slicing, toolpaths or G-code.
- Per-color heights, reliefs, layered color mixing (HueForge-style), gradients, dithering.
- Image tracing into regions (the Sketch Picture stays a tracing aid).
- Purge/prime towers, filament cost, print time.

## 13. Build order

1. Printer profile, units (mm), `w` variable, stroke weights in lines.
2. Filament palette, slot per chain, base and part outline.
3. Region flattening (Clipper2) + Print view "Drawn".
4. "As printed" preview + Too thin / Gap / Island checks.
5. DXF and per-filament SVG export with arc refit and shared edges.
6. Beads view, real-size zoom, nozzle cursor.

## 14. Acceptance

- A 30 × 30 mm two-color logo (black strokes on a white base, w = 0.42) exports a DXF that SolidWorks imports
  as a sketch whose two layers each extrude without errors, and the two bodies neither overlap nor leave a gap
  (Combine → Common is empty; Combine → Add gives one body with the outline's area, to 0.001 mm²).
- A 0.3 mm stroke is refused (min feature 0.42); with snapping off, a 0.3 mm gap between two black regions is
  flagged "Gap too small" and the as-printed preview shows them merged.
- Changing the line width to 0.22 (0.2 mm nozzle) re-solves dimensions written as `=3*w` and clears the
  flags that only failed at 0.42.
- Arc refit: a circle of the design exports as one `CIRCLE`/`ARC` entity, not a polyline.
- Unit tests for flattening (stacking, holes, nesting), opening/closing checks, DXF writer round trip.

## 15. Open questions

| # | Question | Default if no answer |
| --- | --- | --- |
| Q1 | Is color only in XY (a flat tile, depth set in CAD), or do you also want colors at different heights / a 3MF straight to the slicer? | XY only; heights in CAD; no 3MF in v1 |
| Q2 | Which CAD (SolidWorks?) and import format: one layered DXF, one DXF per color, or SVG? | Layered DXF + option for one file per color |
| Q3 | How should overlaps resolve: drawing order (later on top), or an explicit order per chain? | Drawing order, with Bring to Front / Send to Back |
| Q4 | Should the printer limits **block** (refuse a too-thin stroke) or only **warn**? | Snap stroke weights to whole lines, warn on everything else |
| Q5 | Minimum feature: 1 line width or 2? (2 is safer for colors that need a solid look.) | 1 × w, setting for 2 |
| Q6 | mm everywhere in Print mode OK? Inches needed? | mm only |
| Q7 | Is a bead/toolpath preview useful, or is the "as printed" outline enough? | Outline in v1, beads later |
| Q8 | OK to add one geometry dependency (Clipper2 port) for booleans and offsets? | Yes |
| Q9 | Printer and slicer in use (e.g. Bambu + AMS / Orca, Prusa + MMU)? Used for presets and wording. | Generic 0.4 mm preset + 0.2 / 0.6 presets |

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| | | |
