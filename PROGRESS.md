# Progress

Running log of the Constraint Sketcher build (see the build spec). Newest first within each milestone.

## Decisions on open questions

| Question | Decision (for now) | Why |
| --- | --- | --- |
| App name | **Sketchworx** (repo name) | Placeholder until Micah picks one |
| Preact vs React | **Preact** | Lighter; the UI chrome is simple and needs no component library |
| Keyboard map | SolidWorks defaults from the spec, in `src/app/keymap.ts` | Rebinding UI later |
| Hosting | Static build (`npm run build` → `dist/`, relative base) | Works from GitHub Pages / Cloudflare Pages or a local file server |

## Milestone 6 — Art output and iPad polish ✅ (emulated iPad; see notes)

- Fill preview: closed loops of non-construction geometry (lines, arcs, circles, splines, driven offsets) are
  chained by endpoints and filled with the nonzero rule. Loops are re-oriented by nesting depth, so counters
  render as holes. Sketch view shows a light fill under the wireframe; Art view shows black fills only, with
  no chrome. Split view puts the editable sketch on the left and a fitted Art preview on the right.
- Loop diagnostics: open endpoints (orange rings) and self-intersections (orange crosses). Skipped during
  drags to stay fast.
- Metric guides (View → Metric Guides, or the Glyph section): baseline, xheight, capheight, ascender,
  descender lines driven by variables of those names (defaults for 1000 units/em). They are real fixed
  construction lines, so points and curves can be made Coincident with them.
- Glyph slots: strip of thumbnails at the bottom (View → Glyph Slots), add, click to switch, double-click to
  rename, per-slot advance width. Variables are shared; changing one re-solves every slot in the background.
- Sketch Picture: insert PNG/JPG as a background with opacity/position/scale, and "Calibrate scale" (draw a
  line over a known feature, enter its length).
- Handle hygiene: View → Extrema Check marks horizontal/vertical extrema of splines and arcs that have no
  on-curve point.
- Export panel: SVG (current glyph or all glyphs in a row, arcs as `A` or cubics, viewBox from bounds or metric
  guides + advance, optional construction for presentation; splines above degree 3 become cubics) and PNG of
  the Art view at a chosen size.
- PWA: manifest, icons, and a service worker generated at build time that precaches every built file
  (including the solver WASM), then serves cache-first.
- Touch: one finger pans, two fingers pinch-zoom/pan, two-finger tap undoes, long-press opens the context
  toolbar (on geometry) or the shortcut bar. Pencil behaves like the mouse. On-screen Esc / Ctrl / Undo /
  Redo / Delete appear on touch devices until a keyboard is used. Touch hit radius 22 px, toolbar buttons
  ≥ 46 px.
- Fixes found while testing: Preact 11 no longer appends `px` to numeric inline styles, which had hidden the
  shortcut bar, context toolbar and Modify box (all now explicit `px`). The solver loop now re-solves when a
  result is superseded instead of dropping it.

Acceptance:
- SVG: the outlined "O" (letter-O skeleton offset 40 both ways, base geometry → construction) exports as one
  path with two subpaths. Rendered with Chromium and with resvg (an independent renderer), the filled
  outlines differ in 0.12% of pixels (anti-aliased edges only). The slot sample differs in 0.32% (arcs as `A`)
  and 0.28% (as cubics). **Inkscape is not installed in this environment**, so it was not used; please open
  an exported file in Inkscape once to confirm.
- Offline: production build served locally, one online visit, then network offline + reload → the app loads,
  the solver worker runs, and a rectangle solves (Playwright).
- Touch gestures checked with emulated iPad Pro multi-touch (CDP touch events). **Not yet tried on a real
  iPad with Apple Pencil.**
- Unit tests: `tests/outline.test.ts` (loops, hole orientation, open ends, self-intersections, SVG arcs vs
  cubics, cubic arc accuracy, extrema check).

## Milestone 5 — Style splines and tools ✅

- Style Spline tool (B): click control vertices; 4 by default (cubic), 3–8 in the PropertyManager; double-click
  or Enter finishes early. Single-span Bézier, degree = vertices − 1.
- Control-polygon sides are real construction lines owned by the spline (not just solver-internal), so they
  take Horizontal/Vertical/Parallel/Equal relations and dimensions directly: the usual way to set horizontal
  tangents at extrema. H/V inferred while placing a vertex is applied to that side. Deleting the spline
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
- `tests/edits.test.ts` "letter O": four style splines, tangent joints, right half mirrored about a
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
  accepts expressions (`=stem*1.5`, SolidWorks-style `="stem"` too). Double-click any dimension to reopen.
- Over-defining dimension → "Make Dimension Driven?" prompt (driven or leave driving). Driven dimensions are
  measurements of solved geometry (not solver constraints), drawn gray in parentheses.
- Global Variables panel: add, rename (rewrites references), edit, delete; dependency order and cycle errors.
  Variables are document-wide (shared by all future glyph slots). Changing one re-evaluates every dimension
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
