# Print Mode — design spec (draft for review)

Status: **draft, not built**. Answers from the first review are in "Decisions" at the end. Sections marked
**[Q]** are still open.

## 1. Goal

A third way of looking at a Sketchworx document, next to Sketch and Art: **Print view**. It treats the
artwork as something an FDM printer will lay down with a real nozzle, and it:

1. lets you draw only what the printer can make (stroke widths in whole nozzle lines, sizes in mm,
   features at least two lines wide),
2. shows what will actually come out of the printer (corners rounded by the nozzle),
3. never lets an edit make something unprintable (typed values are pulled back to the limit, other edits
   are refused with a notice saying why), and
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

- **Prusa MK4S** with **PrusaSlicer**, in one of two setups (chosen in the printer profile):
  - **MMU3**: up to 5 filaments, changed automatically within a layer.
  - **Manual swap** (no MMU): each color is its own body, and PrusaSlicer prints the bodies one after another
    with a pause between them to swap filament. A chore, but fine for color that is one or two layers deep.
    Colors are not limited to 5, but the order the bodies print in matters, so the palette order is the
    print order (section 5).
- The color pattern is a **2D tiling in the XY plane**: every point of the part is exactly one filament.
  Depth (how many layers each color is) is decided in CAD, not here.
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
| Color changes | MMU3 | MMU3 (max 5 colors) or Manual swap (pause between bodies) |
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

- A short list of **filament slots**, each with a name and a color, e.g. `1 White, 2 Black, 3 Red`. Stored on
  `doc.print.filaments`.
  - MMU3: at most 5; slot numbers match PrusaSlicer's extruder numbers.
  - Manual swap: up to 8; the slot order is the **print order**, and the panel shows the number of
    filament swaps (slots − 1). Slots can be dragged to reorder. A sensible default order is the base first,
    then the colors that cover the most area, but it is your call (e.g. print the color you swap in most
    easily last).
- In Print view each chain gets a **slot**, not a free hex color. Art view keeps working: a chain's Art color
  becomes the slot's color when Print mode is on. Existing documents: on first use, each distinct Art color
  is offered as a slot; with more colors than the setup allows you choose which ones to merge before Print mode turns on.
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
5. No more filaments can be added than the setup allows (5 for the MMU3, 8 for manual swap).

### What is checked on every edit

The region rules (section 8) are checked after each edit, against the regions the edit produces:

- **Typed values** (Modify box, PropertyManager fields, variables, style fields): a value that would break a
  rule is **pulled back to the limit** automatically: the closest value, in the direction you were going,
  that still passes every rule. Typing a gap of 0.62 mm sets 0.90 mm; typing a 1-line stroke sets 2 lines.
  A notice says what happened: "Set to 0.90 mm: min gap between black areas is 2 lines (0.90 mm)".
  - How: the old value passes and the typed one does not, so the app bisects between them (re-solving and
    re-checking each try, about 12 tries for 1 µm) and keeps the last value that passes. A rule can depend on
    the value in odd ways, so the result is checked once more before it is applied.
  - When even the old value is part of an existing break (see below), the typed value is applied only if it
    does not make that break worse; otherwise the value is left as it was, with a notice.
- **Drags**: while dragging, the parts that break a rule turn red live, and the geometry stops at the last
  position that passed, the way it stops at a fully defined limit. Releasing keeps that position.
- **Drawing and other tools** (line, arc, trim, offset, fill, convert…): the edit is refused if it adds a
  break, with a notice (below). A chain that is still being drawn counts as a stroke of its weight, so
  building a profile point by point is not blocked by the half-built shape.

### Notices

Every refused or adjusted edit gets a notice that says what happened and why, never a silent no-op:

- A **toast at the top of the canvas**: the rule, the measured value and the limit, and what was done
  ("Line not added: it would leave a 0.40 mm black strip; min feature is 2 lines (0.90 mm)").
- The **spot is marked** on the canvas in red (the thin strip or the gap) until the next edit, so you can see
  where the problem would be.
- The toast stays until the next action or 6 s, and has a **Show** link that zooms to the spot. The last 20
  notices are kept in the Issues list under "Recent".

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
- **As printed** (default): the multicolor **first layer**, built color by color in print order the way the
  printer lays it down (below).
- **Beads** (toggle, later phase): the perimeter paths drawn as first-layer-width lines in their colors,
  like PrusaSlicer's preview of the first layer.
- **Real size** button (1:1 on screen where the browser reports the display's DPI) and a **nozzle cursor**: a
  circle of diameter `w` that follows the pointer, to judge small details by eye.
- Picking in Print view selects the chain that made the region, so its style can be edited in place
  (like Art view).

### As printed: stacking the first layer

The preview shows the first layer as it comes off the bed, with each color laid down against the ones
printed before it. Colors go down in **print order**: the slot order (for manual swap this is exactly the
order of the bodies; for the MMU3 it is the order PrusaSlicer uses when it starts the layer with extruder 1,
which is close enough for a preview).

For each color, in order:

1. **Shape the nozzle can make**: the color's region opened by `w₁/2`, where `w₁` is the first-layer line
   width. Outside corners round; inside corners stay sharp.
2. **Squish**: the first layer is pressed flat, so the beads spread by `s` past their path. The color grows by
   `s` into space that is still empty, but not into plastic already on the bed and not outside the part.
   So a color printed earlier pushes slightly into its later neighbours, and fills part of the small
   gaps the rounding leaves at corners.
3. What it covers is painted in its color and counts as taken for the colors after it.

What is left uncovered inside the part is **bare bed**: the pinholes where a rounded corner of one color
meets the sharp inside corner of another. They are drawn in the sheet color (setting; default the dark gold
of the satin sheet) so they are easy to spot, and a **Pinholes** count and largest size appear under the
preview. They are information, not rule breaks: every outside corner makes some.

The preview is shown from the **bed side** by default: mirrored left to right, as the face that was on the
sheet looks when the part is turned over. A **Top** toggle shows it unmirrored, as PrusaSlicer does. The
toggle is kept per document (`doc.print.view`). Only the preview is mirrored: the sketch, Art view and every
export stay in design coordinates, so mirror the bodies in CAD or flip the part in PrusaSlicer as usual.

Changing the print order (dragging slots) updates the preview straight away, so the order can be chosen by
how the edges come out.

New printer profile fields for this:

| Field | Default | Used for |
| --- | --- | --- |
| First-layer line width `w₁` | 0.5 mm (PrusaSlicer's MK4S default for the 0.4 nozzle; check against your profile) | Corner rounding in the preview |
| Squish `s` | 0.05 mm per side (an estimate; 0 turns it off) | Spread of each color in the preview |
| Sheet color | `#8a6d3b` (satin) | Bare bed in the preview |

The rules (section 8) still use `w`, not `w₁`: they are about every layer, the preview is about the face.

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
     body, and a short `README.txt` listing the colors in slot order with their files (for manual swap: the
     print order and where each pause goes).
   - Written for **Fusion 360**'s Insert DXF: header `$INSUNITS = 4` (mm) and `$MEASUREMENT = 1`, so the
     import comes in at full size; geometry at its real coordinates, so every file lands in the same place
     when inserted at the sketch plane's origin; one closed profile per region, so Fusion offers each as an
     extrudable profile without fixing anything.
2. **One SVG per filament** (same names, `.svg`), filled paths only, `width`/`height` in mm, for tools that
   prefer SVG. (Fusion's Insert SVG scales by its own DPI guess, so DXF is the one to use there.)
3. **Preview PNG** of Print view.
4. Later: **one layered DXF** (a layer per filament) and **3MF** with each color extruded as its own part,
   ready for PrusaSlicer without CAD.

## 11. Data model and file format

```ts
interface PrintSettings {
  printer: { preset: string; nozzle: number; lineWidth: number; minFeatureLines: number; minGapLines: number; layerHeight: number;
             firstLayerWidth: number; squish: number; sheetColor: string };
  filaments: { slot: 1 | 2 | 3 | 4 | 5; name: string; color: string }[];
  base: number;          // slot of the background
  outline?: Id;          // chain key of the part outline (unset: outermost filled profile)
  view?: "bed" | "top";  // As printed preview side (unset: "bed", mirrored)
}
// Doc.print?: PrintSettings      ArtStyle.filament?: number (slot)
```

Optional field on the existing version 3 format (older files open with Print mode off). Print settings
are undo steps and, like Art styles, never re-solve the sketch (except changing the line width, which
re-solves because the `w` variable changes).

## 12. Out of scope (v1)

- Slicing, toolpaths or G-code.
- Per-color heights, reliefs, layered color mixing (HueForge-style), gradients, dithering.
- Writing PrusaSlicer's pause G-code or object order for the manual-swap setup: set in PrusaSlicer by
  hand, following the README's order.
- Image tracing into regions (the Sketch Picture stays a tracing aid).
- Wipe tower, filament use, print time.

## 13. Build order

1. Printer profile and presets, units (mm), `w` and `nozzle` variables, stroke weights in whole lines.
2. Filament palette (MMU3 / manual swap, print order), slot per chain, base and part outline.
3. Region flattening (Clipper2) + Print view "Drawn".
4. Rules, pulling typed values back to the limit, drag stops, refusals, notices, Issues list.
5. "As printed" first-layer preview: stacking in print order, squish, pinholes, bed side.
6. Per-filament DXF (Fusion 360 ready) and SVG export (zip / folder) with arc refit and shared edges.
7. Beads view, real size, nozzle cursor.

## 14. Acceptance

- A 30 × 30 mm two-color badge (black strokes on a white base, MK4S 0.4 preset) exports `-F1-White.dxf`,
  `-F2-Black.dxf` and `-outline.dxf`. In **Fusion 360** (Insert DXF, mm), each comes in at full size at the
  origin, every region is a closed profile, each extrudes without errors, and the two color bodies neither
  overlap nor leave a gap (their intersection is empty; their union has the outline's area, to 0.001 mm²).
  Automated tests check the same with a DXF parser; the Fusion import is checked by hand once.
- The stroke weight field turns `1.1 mm` into `2 lines · 0.90 mm`, and `1 line` into 2 lines with a notice.
- With two black strokes 2 mm apart, typing a gap of 0.6 mm in the Modify box sets 0.90 mm (±1 µm) with a
  notice; dragging one stroke toward the other stops at 0.90 mm.
- Drawing a line that would leave a 0.4 mm strip is refused with a toast naming the rule, 0.40 mm and
  0.90 mm, and the strip is marked in red.
- As printed, a 5 mm black square on a white base, squish 0: each of the square's corners leaves a pinhole
  of area `(1 − π/4)(w₁/2)²` (±1%). With squish on, printing white first shifts the white/black edge `s`
  into the black and shrinks the pinholes; swapping the order shifts it the other way.
- Manual swap with 6 colors: the palette accepts them, shows 5 swaps, and the README lists the print order.
- Switching the preset to the 0.25 mm nozzle re-solves dimensions written as `=4*w`. Switching to 0.8 mm
  lists the new breaks, blocks export, and still allows edits that fix them.
- Arc refit: a circle of the design exports as one `CIRCLE`, not a polyline.
- Rules pass on the badge in under 30 ms.
- Unit tests for flattening (stacking, holes, nesting), opening/closing rules, the blocking ratchet, the DXF
  writer and the zip writer.

## 15. Open questions

| # | Question | Default if no answer |
| --- | --- | --- |
| Q3 | How should overlaps resolve: drawing order (later on top), or an explicit order per chain? | Drawing order, with Bring to Front / Send to Back |
| Q6 | mm everywhere in Print mode OK? Inches needed? | mm only |

## Decisions

| Question | Decision | Why |
| --- | --- | --- |
| Q2 Export format | One DXF per filament (plus an outline file), as a zip or into a folder; SVG per filament too. Layered DXF later | Your call: start with one file per color |
| Q4 Block or warn | Block. Typed values are pulled back to the limit; drags stop at the last passing position; tool edits that break a rule are refused with a notice (toast, measured value, limit, spot marked). Breaks from opening a file or changing the printer are listed, may not grow, and block export | Your call: block, drop to minimum, clear notice. Drag stops follow the same idea. The ratchet keeps a printer change from locking the drawing |
| Q5 Minimum feature | 2 lines (0.9 mm on the 0.4 nozzle), for features and same-color gaps | Your call |
| Q8 Geometry library | Clipper2 for booleans and offsets | Approved |
| Q9 Printer and slicer | Prusa MK4S + PrusaSlicer; presets for the 0.25 / 0.4 / 0.6 / 0.8 mm nozzles | Your printer |
| Q1 Color setup | MMU3 (5 slots) or manual swap (bodies printed in order with pauses, up to 8 slots, slot order = print order). Color only in XY; heights in CAD; no 3MF in v1 | Mid-layer changes work without the MMU by pausing between bodies |
| CAD | Fusion 360 (Insert DXF, mm units in the header) | Your main CAD |
| Q7 Preview | "As printed" stacks the colors in print order as a first layer: nozzle rounding at `w₁`, squish into empty space only, uncovered spots shown as pinholes. Bead view later | Your call: stack colors as on a multicolor first layer |
| Q10 Preview side | Bed side (mirrored) by default, Top as a toggle; exports are never mirrored | Your call: graphics are printed face-down |
