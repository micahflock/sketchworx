# Progress

Running log of the Constraint Sketcher build (see the build spec). Newest first within each milestone.

## Decisions on open questions

| Question | Decision (for now) | Why |
| --- | --- | --- |
| App name | **Sketchworx** (repo name) | Placeholder until Micah picks one |
| Preact vs React | **Preact** | Lighter; the UI chrome is simple and needs no component library |
| Keyboard map | SolidWorks defaults from the spec, in `src/app/keymap.ts` | Rebinding UI later |
| Hosting | Static build (`npm run build` → `dist/`, relative base) | Works from GitHub Pages / Cloudflare Pages or a local file server |

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
