# Progress

Running log of the Constraint Sketcher build (see the build spec). Newest first within each milestone.

## Art view: color and rounded corners and ends ✅

- **Color**: a document default (Defaults → Color) and a per-chain color, used for the chain's stroke and,
  for a filled profile, its fill. Nested fills keep their own colors: a filled profile inside a filled one is
  a hole in it, and one inside that hole paints again in its own color.
- **Corner radius**: rounds the outside of every corner of a stroke (the inside of a turn gets the radius less
  the weight, so both edges stay concentric). Smooth curves are unaffected unless they bend tighter than the
  radius.
- **End radius**: rounds the corners at the ends of an open chain; half the weight makes a fully round end.
  Ends stay within the line's length (they do not stick out past the endpoint like a canvas round cap).
- Every chain field (weight, color, corner, end) now shows "default" when it follows the document default,
  or a ↺ button to go back to it. Defaults are stored on `doc.art` (`color`, `corner`, `end`).
- A rounded stroke is drawn by filling its outline (`strokeOutline` / `roundPolygon` in `src/model/art.ts`);
  SVG export writes it as a filled path. Strokes without rounding are still stroked paths.
- Selection and hover halos are drawn behind the art and follow rounded outlines.

## Art view: strokes and per-chain styling ✅

Art view now draws every non-construction curve as a black stroke, not just filled closed loops.

- **Chains**: each visible sketch's curves are chained (`buildChains` in `src/model/outline.ts`). Closed loops
  are **profiles** (circles included); everything else becomes open chains that stop at ends and branch
  points. Each curve is in exactly one chain. Loop finding no longer gives up when a walk starts on a tail, so a
  profile with a line hanging off it is still found.
- **Default weight**: one line weight for the document (Art View panel → Defaults), in sketch units (default 2).
- **Per-chain style** (click a chain in Art view or in the split view's art pane; Shift/Ctrl-click adds; drag
  pans; Esc clears; Ctrl+A selects all): weight (or "Use default weight"), width direction (Centered, Left,
  Right) and, for profiles, Filled. Profiles always run counter-clockwise, so Left is Inside and Right is Outside
  (labelled that way when only profiles are selected). Open chains run along their first curve, and the selected
  chain shows an arrow so left and right are clear. Side strokes are drawn along a mitered offset of the chain.
- **Fills**: off by default. Nested filled profiles cut holes (nonzero, oriented by nesting among filled
  profiles only), so filling just the inner one fills it solid.
- **Storage**: `doc.art = { weight, styles }`, styles keyed by curve id and written to every curve of the chain,
  so a piece split off by Trim keeps the style. Saved in the file (still version 3; older files open with
  defaults); styles of deleted curves are dropped on save. Style edits are undo steps and do not re-solve.
- **Export**: PNG matches Art view. SVG has "As in Art view" (on by default): a stroked path per chain with its
  weight plus one nonzero path for filled profiles; off gives the old every-loop-filled output.
- In Art view, Delete does nothing (the sketch is hidden) and switching to it cancels a half-drawn entity.

Tests: `tests/art.test.ts` (chains, tails and branches, style defaults and overrides, fills and holes, offsets,
hit testing, save/load and pruning, SVG). Checked in the browser on the slot and oval samples.

## Feature tree (after the scope change) ✅

A document is an ordered list of sketches (file format version 3), shown in the **Sketches** tree above the
PropertyManager, like the SolidWorks FeatureManager.

- **New sketch** adds a sketch at the bottom and starts editing it. Click a sketch in the tree to edit it;
  switching is not an undo step, so undo returns to the sketch a change was made in.
- **References**: a sketch sees every entity of the sketches above it, drawn gray. It can snap to them and
  relate or dimension to them (the relations and dimensions are stored in the new sketch). That geometry is
  locked: it cannot be dragged, deleted, trimmed, extended, filleted or toggled to construction from the later
  sketch. A relation needs at least one entity of the active sketch; a dimension between locked geometry only
  is driven. Offset Entities and Mirror work on earlier geometry and stay linked to it.
- **Solving**: sketches rebuild top to bottom. Each one solves with the referenced geometry of earlier sketches
  as fixed PlaneGCS parameters (only what it references, so DOF counts only its own geometry; locked arcs keep
  their radius and angles and get no arc rules). Editing a sketch re-solves it and every sketch below; while
  dragging, the sketches below update live (latest frame wins). Variables are global, so changing one rebuilds
  everything.
- **Status per sketch**: the tree shows each sketch's state (under / fully / over defined, failed) and a
  warning when it has dangling references.
- **Dangling references**: deleting geometry that a later sketch references keeps that sketch's relation or
  dimension, unsolved, listed under "Dangling references" (Delete / Delete all) and in Display/Delete
  Relations. Trimming in an earlier sketch re-points later sketches' references to the split pieces.
- **Order**: a sketch may only reference sketches above it. Move up/down and Delete are refused (with the
  reason) when they would break that; the last sketch cannot be deleted.
- **Visibility**: the eye toggles a sketch. Hidden sketches still solve and drive later ones but are not drawn,
  snapped to or picked. While editing a sketch, the visible sketches below it are drawn faded and are not
  pickable.
- **Fills and export**: each visible sketch is chained into loops on its own (a loop never runs through two
  sketches), and the loops are combined. A shape in one sketch does not cut a hole in another sketch's fill.
- The sketch picture now belongs to the document. Version 1 and 2 files open as a single "Sketch1".
- Vendored wrapper change: `src/solver/planegcs/sketch/gcs_wrapper.ts` honours `fixed` on circles and arcs
  (two lines, marked "Sketchworx").

- **Convert Entities** (Tools group, or the ⊡ button in the context bar when earlier geometry is selected):
  copies lines, arcs, circles, style splines and standalone points of earlier sketches into the active one.
  Each copy is tied to its source by an **On Edge** relation (glyph ⊡; point for point, plus equal radius for
  circles), so it is fully defined and follows the source. With nothing selected the button starts a pick
  mode (click to convert, Esc to finish); picking an endpoint converts its curve; a source already converted
  into this sketch is skipped. Trim, Extend and Fillet on a copy loosen its link so it keeps lying on the
  source: lines become Collinear, arcs and circles Coradial (a spline copy is unlinked). Driven offset
  splines of earlier sketches count as ordinary locked geometry, so they can be converted and related to.
- **Repair a dangling reference**: each row under "Dangling references" has Repair. Click the geometry to use
  instead; the kind must match what was deleted (point ids start with `p`, curves with `e`), and the
  relation or dimension must still make sense with it, otherwise the pick is refused with the reason. Items
  with several missing references ask for each in turn. Offset square-end pairs pointing at removed geometry
  are dropped.

Acceptance (`tests/features.test.ts`, plus Playwright on the production build): a line in Sketch2 from
Sketch1's corner is fully defined with zero DOF and no redundancy; changing Sketch1's width moves it; dragging
Sketch1 moves Sketch2 mid-drag; locked circles/arcs keep their size; offsets of Sketch1 geometry follow it;
dangling references are reported, not counted as conflicts; delete/reorder refusals; v3 round trip and v2 load;
each convertible kind converts fully defined with no redundancy and follows its source; a trimmed copy stays
collinear with its source; a dangling relation is repaired onto a new point and a wrong-kind or ill-fitting
pick is refused. In the browser: convert from the context bar and in pick mode, then delete the source and
repair the On Edge link onto other geometry (sketch back to fully defined).

## Scope change (after milestone 7)

No font features: no font export toolkits or UI. Removed metric guides, glyph slots and advance widths, the
extrema ("handle hygiene") check, units-per-em, and the font-specific SVG options (metric-guide viewBox, all glyphs
in a row). A document is now a single sketch (file format version 2). Version 1 files still open: the active
sketch is loaded and metric-guide lines are dropped. Font wording was removed from the app, samples and tests.
The notes below describe each milestone as built; items struck by this change are marked *(removed)*.

## Decisions on open questions

| Question | Decision (for now) | Why |
| --- | --- | --- |
| App name | **Sketchworx** (repo name) | Placeholder until Micah picks one |
| Preact vs React | **Preact** | Lighter; the UI chrome is simple and needs no component library |
| Keyboard map | SolidWorks defaults from the spec, in `src/app/keymap.ts` | Rebinding UI later |
| Hosting | Static build (`npm run build` → `dist/`, relative base) | Works from GitHub Pages / Cloudflare Pages or any static server; installable PWA |
| Spike blocker → TS solver or patch bindings? | Moot: no blocker. Per-entity status is computed in TS; the G2 constraint was added by patching the C++ | |
| UFO font export in v1? | No font export at all (scope change) | SVG and PNG only |

## Milestone 7 — Curvature continuity ✅

- **Custom PlaneGCS constraint**: `ConstraintEqualCurvature` added to the PlaneGCS C++ (`solver-wasm/equal-curvature.patch`)
  with `addConstraintEqualCurvatureBB` (spline end ↔ spline end) and `addConstraintEqualCurvatureBA`
  (spline end ↔ arc end). Error = sum of the signed curvatures measured leaving the joint, scaled by a reference
  length; gradient by central differences. It reads every value through `pvec`, so it survives PlaneGCS's
  subsystem parameter redirection.
- **WASM built in this repo**: `solver-wasm/build.sh` clones planegcs 1.3.0, applies the patch, regenerates the
  bindings and compiles with Emscripten 4.0.10. The result (and the port's TypeScript wrapper, vendored from the
  same revision) lives in `src/solver/planegcs/`; the npm package is no longer used. A clean run of the script
  reproduces the committed `planegcs.wasm` byte for byte.
- **Equal Curvature relation** (glyph κ): offered for a style spline meeting another spline (degree ≥ 2) or an arc at a
  shared end. It includes tangency and replaces an existing Tangent relation between the same pair, as in SolidWorks.
- **Point on spline**: Coincident between a point and a style spline. No C++ needed: a single-span Bézier is a clamped
  B-spline, so it uses PlaneGCS's existing point-on-B-spline constraint with the curve parameter as an extra *free*
  solver parameter (B-splines are pushed straight after the points because the wrapper re-registers their poles).
- **Curvature combs** (View → Curvature Combs): teeth on splines and arcs, one scale for the whole sketch so a G2 joint
  shows no step.
- The O-shape sample (`sketchworxSamples.oval()`) now has a G2 right-hand joint; the mirror makes the other three joints G2 by symmetry (adding Equal
  Curvature there too would be redundant and is reported as such).

Acceptance:
- `tests/curvature.test.ts`: the "O" with a G2 joint keeps equal curvature through all four joints (relative error
  < 1e-6) over 12 drag frames of a control vertex; without G2 the same drag produces a curvature jump. Spline-to-arc G2
  gives curvature 1/r at the joint. A point stays on a spline (error < 1e-7) and removes exactly one DOF.
- In the browser (dev and production build): load the O, turn on combs, drag a control vertex; the comb is continuous
  across every joint (measured curvature jumps ≤ 2e-18), no conflicts.

Note: `spike/*.mjs` import the npm package that the spike used. To rerun them: `npm i --no-save @salusoft89/planegcs@1.3.0`.

## Milestone 6 — Art output and iPad polish ✅ (emulated iPad; see notes)

- Fill preview: closed loops of non-construction geometry (lines, arcs, circles, splines, driven offsets) are
  chained by endpoints and filled with the nonzero rule. Loops are re-oriented by nesting depth, so counters
  render as holes. Sketch view shows a light fill under the wireframe; Art view shows black fills only, with
  no chrome. Split view puts the editable sketch on the left and a fitted Art preview on the right.
- Loop diagnostics: open endpoints (orange rings) and self-intersections (orange crosses). Skipped during
  drags to stay fast.
- *(removed)* Metric guides and glyph slots with advance widths.
- Sketch Picture: insert PNG/JPG as a background with opacity/position/scale, and "Calibrate scale" (draw a
  line over a known feature, enter its length).
- *(removed)* Extrema ("handle hygiene") check.
- Export panel: SVG (one path, arcs as `A` or cubics, viewBox from the geometry bounds, optional construction
  for presentation; splines above degree 3 become cubics) and PNG of the Art view at a chosen size.
- PWA: manifest, icons, and a service worker generated at build time that precaches every built file
  (including the solver WASM), then serves cache-first.
- Touch: one finger never pans; it drives the active tool. An on-screen Select / Draw toggle switches between the
  Select tool (tap selects, drag moves geometry or box-selects) and the last drawing tool (the Draw half shows its
  name, e.g. "Line"). Picking a tool sets it too: Line goes to Draw, Add Relation goes to Select. Two fingers
  always pan/pinch-zoom, a quick two-finger tap undoes, a double tap acts as a double-click (ends a line chain),
  long-press in Select opens the context toolbar (on geometry) or the shortcut bar. Pencil behaves like the mouse. On phones
  the PropertyManager starts collapsed and slides over the canvas when opened. On-screen Esc / Ctrl / Undo /
  Redo / Delete appear on touch devices until a keyboard is used. Touch hit radius 22 px, toolbar buttons
  ≥ 46 px.
- Fixes found while testing: Preact 11 no longer appends `px` to numeric inline styles, which had hidden the
  shortcut bar, context toolbar and Modify box (all now explicit `px`). The solver loop now re-solves when a
  result is superseded instead of dropping it.

Acceptance:
- SVG: the outlined "O" (O-shape skeleton offset 40 both ways, base geometry → construction) exports as one
  path with two subpaths. Rendered with Chromium and with resvg (an independent renderer), the filled
  outlines differ in 0.12% of pixels (anti-aliased edges only). The slot sample differs in 0.32% (arcs as `A`)
  and 0.28% (as cubics). **Inkscape is not installed in this environment**, so it was not used; please open
  an exported file in Inkscape once to confirm.
- Offline: production build served locally, one online visit, then network offline + reload → the app loads,
  the solver worker runs, and a rectangle solves (Playwright).
- Touch gestures checked with emulated iPad Pro multi-touch (CDP touch events). **Not yet tried on a real
  iPad with Apple Pencil.**
- Unit tests: `tests/outline.test.ts` (loops, hole orientation, open ends, self-intersections, SVG arcs vs
  cubics, cubic arc accuracy).

## Milestone 5 — Style splines and tools ✅

- Style Spline tool (B): click control vertices; 4 by default (cubic), 3–8 in the PropertyManager; double-click
  or Enter finishes early. Single-span Bézier, degree = vertices − 1.
- Control-polygon sides are real construction lines owned by the spline (not just solver-internal), so they
  take Horizontal/Vertical/Parallel/Equal relations and dimensions directly: the usual way to set horizontal
  tangents at curve extremes. H/V inferred while placing a vertex is applied to that side. Deleting the spline
  deletes its vertices and sides.
- Spline tangency (line, arc, spline at a shared end) maps onto polygon-side constraints as the spec says.
- Power Trim: drag a stroke across segments (one undo step) or click. Trimming keeps the entity's other
  relations, re-attaches cut ends with Coincident, splits into Collinear (lines) / Coradial (arcs) pieces,
  turns circles into arcs, and trims splines by de Casteljau subdivision.
- Extend: hover previews, click extends the nearest end of a line/arc to the next intersection.
- Sketch Fillet: click a corner (or two lines); tangent + coincident relations, radius dimension on the first,
  Equal for the rest made in the same session.
- Offset Entities: chain selection, side from the cursor, bi-directional, cap ends with arcs or lines. The offset
  stays linked by one visible offset dimension driven by an auto-created variable (`offset1`, …); lines get
  parallel + distance, arcs concentric + radius difference, open ends stay square to the source.
- Offset of style splines: true offsets are approximated with a minimal number of cubic segments (adaptive
  subdivision, least-squares handle lengths, tolerance 0.1% of the curve span) and stored as driven geometry
  linked to the source. They are recomputed after every solve and drag frame, take no relations, and draw gray.
- Mirror Entities (select entities + a centerline): copies linked by Symmetric relations; points that lie on the
  centerline are shared via Coincident instead, which avoids redundancy. Dynamic Mirror mirrors new
  entities while you draw until toggled off.
- Shared curve geometry in `geom/curves.ts` (parameterization, analytic line/circle/arc intersections, Bézier
  intersections by polyline + Newton refinement).

Acceptance:
- `tests/edits.test.ts` "O shape": four style splines, tangent joints, right half mirrored about a
  centerline, no redundant or conflicting relations; dragging a control vertex 15 frames keeps all four
  joints tangent to < 1e-6 rad. Also available as a sample (`window.sketchworxSamples.o()`), checked
  interactively in the browser.
- Unit tests for trim (end, split, delete), extend, fillet geometry, offset chain + variable change, spline
  offset fit tolerance.

## Milestone 4 — SolidWorks feel ✅

- Auto-relations while drawing with dotted blue inference lines and yellow preview glyphs: coincident
  (points), on-curve, midpoint, horizontal/vertical (also when closing onto an existing point), tangent when
  leaving an arc end along its tangent, perpendicular to the previous segment, alignment guides to other
  points. Ctrl (or the on-screen Ctrl on iPad) suppresses them; chained endpoints stay connected.
- Line tool: A toggles a tangent arc; the SolidWorks gesture (move away from the last endpoint, come back,
  move out again) also switches to a tangent arc. Standalone Tangent Arc tool in the Arc flyout.
- Context toolbar after a selection (most likely relations + construction toggle), shortcut bar on S,
  Display/Delete Relations, construction toggle (Q), Centerline.
- Keyboard map: SolidWorks defaults; a Keyboard panel (File group) rebinds keys, saved per browser.

Acceptance (Playwright):
- Rectangle drawn by eye with the Line tool (corners off by 2–5 px) → 4 corner coincident + 2 H + 2 V
  (plus one coincident to the origin when the first click lands on it).
- Same clicks with Ctrl held → only the 3 chain joints, no H/V and no closing coincident.

## Milestone 3 — Smart Dimension and variables ✅

- One Smart Dimension tool (D). Type inferred from the picks and the label position: aligned / horizontal /
  vertical (cursor along the normal, straight up/down, or to the side), point-point, point-line, line-line
  (parallel → distance, otherwise angle with the quadrant under the cursor), radius (arcs), diameter
  (circles), arc length (arc + both endpoints), center distances for circles/arcs. Style-spline polygon sides
  are point-point distances between control vertices.
- Modify box: value focused, Enter/✓ applies, Esc/✕ cancels, ▲▼ (and arrow keys / wheel, Shift ×10) spin,
  accepts expressions (`=width*1.5`, SolidWorks-style `="width"` too). Double-click any dimension to reopen.
- Over-defining dimension → "Make Dimension Driven?" prompt (driven or leave driving). Driven dimensions are
  measurements of solved geometry (not solver constraints), drawn gray in parentheses.
- Global Variables panel: add, rename (rewrites references), edit, delete; dependency order and cycle errors.
  Variables are document-wide. Changing one re-evaluates every dimension
  expression and re-solves.
- Expression parser (`model/expr.ts`): `+ - * / ( )`, unary minus, `min max sqrt sin cos` (degrees). No `eval`.
- Sketch origin is now a fixed, selectable point (relate/dimension to it like the SolidWorks origin).
- Dimension labels are stored relative to their anchor so they follow the geometry; drag a label to move it.
- PropertyManager shows a Dimension section (value/expression, Driven checkbox) for a selected dimension.

Acceptance (Playwright):
- Fully dimensioned slot (sample in `src/io/samples.ts`, `=width` diameter and `=len` center distance) shows
  Fully Defined, 0 DOF, all black. Changing `width` 40 → 70 in the Variables panel updates the arcs to R35 live
  and stays fully defined.
- A radius dimension on the second (equal) arc triggers the driven prompt; choosing driven keeps the sketch
  fully defined and shows (R35).
- Unit tests: `tests/dimensions.test.ts` (expressions, inference, slot DOF 0, variable change, redundancy).

## Milestone 2 — Solver and relations ✅

- `solver/` exposes one interface (`Solver.solve(params, constraints, drag?) → { params, entityStatus, conflicts, … }`
  plus drag sessions). `solver/gcs.ts` is the only file importing planegcs; it runs in a Web Worker
  (`solver/worker.ts`, proxied by `solver/client.ts`).
- `solver/build.ts` translates relations into a small constraint vocabulary. Style splines (milestone 5) enter
  the solver only as control vertices plus hidden polygon-side lines.
- Two-pass solve for accurate redundancy diagnosis (see spike). Failed solves keep the previous geometry.
- Per-entity status: numerical Jacobian + reduced row echelon form per independent cluster
  (`solver/analysis.ts`). A parameter is fully defined when its unit vector is in the Jacobian's row space.
  Blue under-defined, black fully defined, red over-defined (redundant/conflicting relation's geometry),
  yellow when a solve fails without a conflict report.
- Drag: temporary planegcs constraints whose targets are sketch params, so each frame only updates params and
  re-solves. Frames are coalesced (latest wins) while the worker is busy. Line/spline bodies drag all their
  points; circle/arc edges drag the radius.
- Relations: Coincident (point-point, point-curve), Horizontal/Vertical (lines or points), Parallel,
  Perpendicular, Collinear, Equal (lines or radii), Tangent (line-arc/circle, arc-arc, with endpoint form when
  ends are coincident), Concentric, Coradial, Midpoint, Symmetric (about a centerline; points, lines,
  arcs/circles, splines), Fix (snapshots the current values).
- Valid-relation rules per selection (`model/relations.ts`), Add Relations / Existing Relations in the
  PropertyManager, context toolbar after selecting, green glyphs (hover highlights related entities, click
  selects the relation, Delete removes it), Display/Delete Relations panel with All / Selected / Dangling /
  Over-defining filters, SketchXpert-lite conflict list with "Delete this one", status bar
  Under/Fully/Over Defined + DOF.
- Parameter edits in the PropertyManager move geometry through the solver (temporary constraints), so
  relations hold.

Acceptance (Playwright, dev and production build):
- Corner rectangle (4 coincident, 2 H, 2 V) + Fix on one corner → "Under Defined · 2 DOF"; dragging the
  opposite corner keeps all relations.
- Adding Parallel between the two horizontal sides → status Over Defined, both lines red, the relation listed
  with a delete button.
- Fixture tests: `tests/solver.test.ts` (DOF, exact solve, redundancy, conflicts, drag, tangent, determinism).

Notes:
- Point-point coincident glyphs (chain joints) are hidden to avoid clutter, as SolidWorks does for merged
  endpoints; they still appear in Display/Delete Relations.
- Drag speed in the browser has not been measured on an iPad yet. Node: ~9 ms for 200 lines.

## Milestone 1 — Canvas and drawing ✅

- Vite + TypeScript (strict) + Preact scaffold, CSS modules.
- Canvas 2D renderer, devicePixelRatio aware, y-up sketch space. Dot grid, origin marker.
- Pan (middle-drag, Alt+drag), zoom about cursor (wheel), F zoom to fit.
- Tools: Line (chain, double-click/Esc ends, drag-to-place, A toggles tangent arc), Centerline,
  Midpoint Line, Point, Circle (center, perimeter), Arc (centerpoint with mouse-direction, 3-point),
  Rectangle (corner, center, 3-point corner, 3-point center, parallelogram) with SolidWorks relations.
- Snapping: existing points (coincident), line midpoints, on-curve, H/V from the segment anchor,
  alignment guides. Ctrl suppresses snapping/auto relations.
- Selection: click, Ctrl/Shift-click, box select (left→right window, right→left crossing), Esc clears.
- Delete (removes owned endpoints and dangling relations), unlimited undo/redo (immutable doc snapshots).
- Save/open native `.sketch.json` (File System Access API, download/upload fallback), IndexedDB autosave + restore.

Acceptance:
- Closed shape of lines + arc → save → reload: documents compare identical (Playwright check, and unit test
  for serialize/parse round trip).
- 500 entities: ~7 ms per full redraw at 2× DPR in headless software-rendered Chromium (budget 16 ms).
  Not yet measured on an iPad.

## Solver spike (planegcs 1.3.0) — done early, informs Milestone 2

Script: `spike/spike.mjs`, `spike/spike2.mjs` (run with `node spike/spike.mjs`).

| Check | Result |
| --- | --- |
| Loads in Node and the browser (WASM) | ✅ |
| Rectangle (2H, 2V, fixed corner) | ✅ solves, `dof() = 2` |
| Drag via `temporary` coordinate constraints | ✅ geometry follows, relations hold. Targets can reference sketch params, so a drag frame is `set_sketch_param` + `solve` without rebuilding |
| Drag speed | ~9 ms for 200 lines (50 rects) per solve in Node incl. no rebuild; push of the system ~3 ms |
| Conflicts | ✅ reported when the solve fails (`get_conflicting`), e.g. two different lengths on opposite rect sides |
| Redundancy | ⚠️ diagnosis runs at the *start* of `solve()`, i.e. on the unsolved geometry. Fix: two-pass solve (solve, rebuild at solved coordinates, solve again); then redundant constraints are reported correctly (parallel on an H/H rect, equal on opposite sides) |
| `dof()` | Returns the cached diagnosis; -1 before any solve |
| Per-parameter dependency (blue vs black per entity) | ❌ not exposed by the bindings |
| Debug output | prints to console unless debug mode is set to NoDebug |

Decision: keep planegcs for solving, dragging and conflict/redundancy reports. Compute per-entity
fully-defined status in TypeScript with a numerical Jacobian + rank/null-space analysis over the same
constraint vocabulary (FreeCAD does the equivalent with QR). This avoids rebuilding the WASM now; the
TS residuals are also the base of the fallback solver if one is ever needed.
