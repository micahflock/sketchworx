# Print Mode — design spec (draft for review)

Status: **draft, not built**. Answers from the first review are in "Decisions" at the end. Sections marked
**[Q]** are still open.

## 1. Goal

A third way of looking at a Sketchworx document, next to Sketch and Art: **Print view**. It treats the
artwork as something an FDM printer will lay down with a real nozzle, and it:

1. lets you draw only what the printer can make (stroke widths in whole nozzle lines, sizes in mm,
   features at least two lines wide),
2. shows what will actually come out of the printer (corners rounded by the nozzle),
3. refuses edits that would make something unprintable, and
4. exports one clean, closed profile file per filament color, ready to extrude into CAD bodies (and from
   there into PrusaSlicer as a multi-part, multi-color object).

It reuses everything that exists: sketches, relations, dimensions, variables, chains and Art styles. Print
view adds a printer profile, a filament palette, a "region" model built from the art, checks and a
preview.

## 2. Target workflow

```
Sketch (constraints, mm) ─► Art styles (strokes, fills, filament per chain)
        │
        ▼
Print view: regions per filament ─► rules checked on every edit + "as printed" preview
        │
        ▼
Export one DXF per filament (shared edges identical between files)
        │
        ▼
CAD: import each DXF as a sketch, extrude each color as its own body (heights set in CAD)
        │
        ▼
PrusaSlicer: load the bodies as parts of one object, assign a filament to each part, print
```

## 3. Assumptions about the printer

- **Prusa MK4S** with **PrusaSlicer**. Different colors side by side in XY need the **MMU3** (5
  filaments, one nozzle); this spec assumes it. **[Q1]**
- The color pattern is a **2D tiling in the XY plane**: every point of the part is exactly one filament.
  Depth (how many layers each color is) is decided in CAD, not here. **[Q1]**
- PrusaSlicer prints each color region with perimeters of **line width `w`** (0.45 mm by default for the
  0.4 mm nozzle) and fills the inside. Its variable-width perimeters (Arachne) can print walls a little
  under `w`, but thin walls print weak and look patchy in color, so this mode requires **two lines**
  (`2w` = 0.9 mm) for every feature.
- What prints is, to a good approximation, each region **opened by a disk of radius `w/2`**: shrink by `w/2`,
  grow back by `w/2`. With every feature at least `2w` wide nothing is lost, so the visible effect is that
  outside (convex) corners round to radius `w/2`. Inside corners stay sharp, but each inside corner is the
  neighbouring color's outside corner, so it gets rounded from the other side.

## 4. Printer profile

Stored on the document (`doc.print.printer`), editable in a **Printer** panel.

| Field | Default | Used for |
| --- | --- | --- |
| Preset | MK4S, 0.4 mm nozzle | Fills the fields below |
| Nozzle diameter | 0.4 mm | Label |
| Line width `w` | 0.45 mm | Stroke widths, rules, preview |
| Minimum feature | 2 × `w` (0.9 mm) | "Too thin" rule |
| Minimum gap | 2 × `w` (0.9 mm) | Two parts of the same color that would merge |
| Layer height | 0.2 mm | Only shown (and kept for a later 3MF export) |

Presets: MK4S with the 0.25, 0.4, 0.6 and 0.8 mm nozzles. Each preset's line width is PrusaSlicer's
default perimeter width for that nozzle; the field stays editable so it can match your own print profile.
The minimum feature and gap are stored as a number of lines (default 2), not mm, so they follow the
nozzle.

Units: Print view needs real units. **1 sketch unit = 1 mm** whenever a document has a printer profile;
dimensions and the status bar show "mm". (The rest of the app stays unitless, as now.) **[Q6]**

## 5. Filament palette

- Up to **5 filament slots** (the MMU3's count), each with a name and a color, e.g.
  `1 White, 2 Black, 3 Red, 4 Yellow, 5 Blue`. Slot numbers match PrusaSlicer's extruder numbers. Stored on
  `doc.print.filaments`.
- In Print view each chain gets a **slot**, not a free hex color. Art view keeps working: a chain's Art color
  becomes the slot's color when Print mode is on. Existing documents: on first use, each distinct Art color
  is offered as a slot; with more than 5 colors you choose which ones to merge before Print mode turns on.
- One slot is the **base**: the color of everything inside the part outline that no other region covers.
- **Part outline**: by default the outermost filled profile; it can be set to any closed profile ("Set as
  part outline"). Nothing outside it is exported.

## 6. Drawing within the printer's limits

Print mode **blocks** unprintable results instead of warning about them.

### What is enforced directly

1. **Stroke weights are whole lines.** The weight field takes a number of lines (`3`, shown as
   `3 lines · 1.35 mm`) or mm, which is rounded to the nearest whole line. The smallest weight is the
   minimum feature (2 lines). There is no half-line option.
2. **Corner radius** of strokes is at least `w/2` (the printer cannot make a sharper outside corner), and that
   is the default.
3. **Variables** `w` and `nozzle` exist automatically and follow the printer profile, so dimensions can be
   written as `=4*w` and the design re-solves if the nozzle changes.
4. **Grid** can be set to `w` (or a multiple), so hand-placed points land on printable spacing.
5. A sixth filament cannot be added.

### What is checked on every edit

The region rules (section 8) are checked after each edit, against the regions the edit produces:

- **Typed values** (Modify box, PropertyManager fields, variables, style fields): a value that would break a
  rule is refused, with the reason in the box: "Gap between the two black areas would be 0.62 mm (min
  0.90)". The old value stays.
- **Drags**: while dragging, the parts that break a rule turn red live. If the drag ends with a break, it is
  undone (geometry springs back to where the drag started) and the status bar says why.
- **Drawing and other tools** (line, arc, trim, offset, fill, convert…): the edit is refused if it adds a
  break, and the tool shows the reason. A chain that is still being drawn counts as a stroke of its weight,
  so building a profile point by point is not blocked by the half-built shape.

### Breaks that already exist

Some actions cannot be refused without trapping you: turning Print mode on for an existing drawing, opening
a file, or changing the printer (e.g. 0.4 → 0.25 mm nozzle). These are allowed. Any breaks they create are
listed in the Issues list, and from then on the rule is a ratchet: an edit may fix or keep existing breaks
but never add one. **Export is blocked while any break exists.**

## 7. Regions: from art to filament areas

The core new piece. Art today is a stack of strokes and fills that may overlap. Printing needs a **planar
partition**: non-overlapping regions, each one filament, that tile the part with no gaps.

Steps (pure functions in `src/model/print.ts`, no DOM):

1. **Shapes per chain.** Each chain becomes a filled area:
   - a filled profile → its inside,
   - a stroke → the area the stroke covers (centered, left or right; with its corner and end style). This is
     the stroke's outline, the same geometry Art view draws.
2. **Stacking order.** Later chains cover earlier ones (drawing order: feature tree order, then creation
   order), as the Art view already paints, with Bring to Front / Send to Back to change it. **[Q3]**
3. **Flatten.** For each slot: union of its shapes, minus every shape above it, clipped to the part
   outline. The base slot gets what is left of the outline.
4. **Clean.** Drop slivers below a tiny area (e.g. 0.001 mm²) that come from numeric noise, not design.

Geometry engine:

- Flatten curves to polylines at a tolerance far below print resolution (≤ 1 µm) and run booleans and
  offsets with **Clipper2** (integer coordinates, robust). New dependency, approved.
- Before export, **refit lines and arcs** to the result (tolerance ~5 µm), so CAD gets real arcs, not
  thousands of tiny segments. Edges that come straight from a sketch line or arc keep their exact
  geometry where they survive unchanged.
- Each boundary between two colors is computed once and written to both colors' files, so adjacent CAD
  bodies share the exact same edge (no gaps or overlaps between bodies).
- Speed: rules run on every committed edit and every drag frame, so the whole pass (flatten + rules) has a
  budget of **30 ms** for a typical logo (≈ 50 chains, 5 colors). Drags reuse the last result for chains the
  drag does not move.

## 8. Rules

Each rule names the region, the measured value and the limit. They are shown in an **Issues** list in the
Print panel and as red markers on the canvas (click to zoom to it).

| Rule | Meaning | Marker |
| --- | --- | --- |
| Too thin | Part of a region narrower than the minimum feature (2 lines) | Red hatch on the thin area |
| Gap too small | Two parts of the same color closer than the minimum gap (they would merge) | Red bar across the gap |
| Open or crossing art | A filled profile that is open or crosses itself (it cannot become a region) | As today, in red |
| Outside the part | Art that lies outside the part outline (it would not be exported) | Faded, listed |

How "too thin" and "gap" are measured: open each region by a disk of radius `minFeature/2` (shrink then
grow); area that disappears is too thin. Close each color (grow then shrink by `minGap/2`); area added
between two parts of that color is a gap that is too small. A tiny island is just a too-thin region, so it
needs no rule of its own.

## 9. Print view (preview)

A view mode next to Sketch / Art / Split (`ViewMode = "print"`), and the right-hand pane of Split can show it.

- **Drawn**: the flattened regions in filament colors (what will be exported).
- **As printed** (toggle, default on): each region opened by `w/2`, so the corners round as they will on the
  print.
- **Beads** (toggle, later phase): the outer perimeter path(s) drawn as `w`-wide lines, like PrusaSlicer's
  preview of one layer. **[Q7]**
- **Real size** button (1:1 on screen where the browser reports the display's DPI) and a **nozzle cursor**: a
  circle of diameter `w` that follows the pointer, to judge small details by eye.
- Picking in Print view selects the chain that made the region, so its style can be edited in place
  (like Art view).

## 10. Export

All exports are in mm, y-up, origin at the sketch origin, so every file lines up in CAD when imported at
the origin. Export is unavailable while the Issues list has breaks.

1. **One DXF per filament** (the main output). Files are named `<document>-F<slot>-<name>.dxf`, e.g.
   `badge-F1-White.dxf`. Each holds that color's closed profiles only (the base file is the outline minus
   everything on top of it). Entities: `LINE`, `ARC`, `CIRCLE` and `LWPOLYLINE` (bulges for arcs); style
   splines as `SPLINE` where they survive unchanged, otherwise fitted arcs. Every profile closed, no
   overlaps, no zero-length pieces.
   - The set downloads as one `.zip` (written by a small built-in zip writer, no extra dependency), or, in
     browsers with the File System Access API, is saved straight into a folder you pick.
   - Also in the set: `<document>-outline.dxf` (the part outline alone) for a base plate or a cutting
     body.
2. **One SVG per filament** (same names, `.svg`), filled paths only, `width`/`height` in mm, for tools that
   prefer SVG. PrusaSlicer can also import an SVG directly as a part.
3. **Preview PNG** of Print view.
4. Later: **one layered DXF** (a layer per filament) and **3MF** with each color extruded as its own part,
   ready for PrusaSlicer without CAD. **[Q1]**

## 11. Data model and file format

```ts
interface PrintSettings {
  printer: { preset: string; nozzle: number; lineWidth: number; minFeatureLines: number; minGapLines: number; layerHeight: number };
  filaments: { slot: 1 | 2 | 3 | 4 | 5; name: string; color: string }[];
  base: number;          // slot of the background
  outline?: Id;          // chain key of the part outline (unset: outermost filled profile)
}
// Doc.print?: PrintSettings      ArtStyle.filament?: number (slot)
```

Optional field on the existing version 3 format (older files open with Print mode off). Print settings
are undo steps and, like Art styles, never re-solve the sketch (except changing the line width, which
re-solves because the `w` variable changes).

## 12. Out of scope (v1)

- Slicing, toolpaths or G-code.
- Per-color heights, reliefs, layered color mixing (HueForge-style), gradients, dithering.
- Color changes by layer (M600) for printers without the MMU3. **[Q1]**
- Image tracing into regions (the Sketch Picture stays a tracing aid).
- Wipe tower, filament use, print time.

## 13. Build order

1. Printer profile and presets, units (mm), `w` and `nozzle` variables, stroke weights in whole lines.
2. Filament palette (5 slots), slot per chain, base and part outline.
3. Region flattening (Clipper2) + Print view "Drawn".
4. Rules + blocking (typed values, drags, tools) + Issues list.
5. "As printed" preview.
6. Per-filament DXF and SVG export (zip / folder) with arc refit and shared edges.
7. Beads view, real size, nozzle cursor.

## 14. Acceptance

- A 30 × 30 mm two-color badge (black strokes on a white base, MK4S 0.4 preset) exports `-F1-White.dxf`,
  `-F2-Black.dxf` and `-outline.dxf`. In CAD, each imports as a sketch at the origin and extrudes without
  errors, and the two color bodies neither overlap nor leave a gap (their intersection is empty; their union
  has the outline's area, to 0.001 mm²).
- The stroke weight field turns `1.1 mm` into `2 lines · 0.90 mm` and refuses `1 line`.
- With two black strokes 2 mm apart, typing a gap of 0.6 mm in the Modify box is refused with the measured gap
  and the limit; dragging one stroke to 0.6 mm shows red while dragging and springs back on release.
- Switching the preset to the 0.25 mm nozzle re-solves dimensions written as `=4*w`. Switching to 0.8 mm
  lists the new breaks, blocks export, and still allows edits that fix them.
- Arc refit: a circle of the design exports as one `CIRCLE`, not a polyline.
- Rules pass on the badge in under 30 ms.
- Unit tests for flattening (stacking, holes, nesting), opening/closing rules, the blocking ratchet, the DXF
  writer and the zip writer.

## 15. Open questions

| # | Question | Default if no answer |
| --- | --- | --- |
| Q1 | Do you have the MMU3 (colors side by side), or only the MK4S (colors change by layer height, with a filament swap)? And is color only in XY with heights set in CAD, or do you also want a 3MF straight to PrusaSlicer? | MMU3; XY only; heights in CAD; no 3MF in v1 |
| Q3 | How should overlaps resolve: drawing order (later on top), or an explicit order per chain? | Drawing order, with Bring to Front / Send to Back |
| Q6 | mm everywhere in Print mode OK? Inches needed? | mm only |
| Q7 | Is a bead/toolpath preview useful, or is the "as printed" outline enough? | Outline in v1, beads later |
| — | Which CAD program? (Changes only the import test, not the files.) | Any that imports DXF |

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Q2 Export format | One DXF per filament (plus an outline file), as a zip or into a folder; SVG per filament too. Layered DXF later | Your call: start with one file per color |
| Q4 Block or warn | Block: whole-line weights, typed values and tool edits that break a rule are refused, drags spring back. Breaks from opening a file or changing the printer are listed, may not grow, and block export | Your call: block. The ratchet keeps a printer change from locking the drawing |
| Q5 Minimum feature | 2 lines (0.9 mm on the 0.4 nozzle), for features and same-color gaps | Your call |
| Q8 Geometry library | Clipper2 for booleans and offsets | Approved |
| Q9 Printer and slicer | Prusa MK4S + PrusaSlicer; presets for the 0.25 / 0.4 / 0.6 / 0.8 mm nozzles; 5 slots (MMU3) | Your printer |
