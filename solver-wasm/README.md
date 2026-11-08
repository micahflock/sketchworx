# Solver WebAssembly build

Sketchworx uses FreeCAD's PlaneGCS through the [planegcs](https://github.com/Salusoft89/planegcs) WebAssembly
port (version 1.3.0), rebuilt here with one addition: an **Equal Curvature (G2)** constraint.

- `equal-curvature.patch`: adds `ConstraintEqualCurvature` to `Constraints.h/.cpp` and
  `addConstraintEqualCurvatureBB` (Bézier end ↔ Bézier end) / `addConstraintEqualCurvatureBA`
  (Bézier end ↔ arc end) to `GCS.h/.cpp`. The error is the sum of the signed curvatures of the two curves,
  each measured leaving the joint, scaled by a reference length; the gradient is a central difference.
- `build.sh`: clones upstream at 1.3.0, applies the patch, regenerates the bindings, compiles with Emscripten
  and copies `planegcs.js`, `planegcs.wasm` and the generated TypeScript into `src/solver/planegcs/`.

The TypeScript wrapper in `src/solver/planegcs/` is vendored from the same upstream revision (one unused
import removed so it passes this repo's strict type check, and `push_circle`/`push_arc` honour a `fixed`
flag so geometry of earlier sketches can be locked). `build.sh` does not touch it. Nothing outside `src/solver/gcs.ts` imports it.

License: PlaneGCS is LGPL (from FreeCAD), the port's wrapper is LGPL-2.1+ (see `src/solver/planegcs/LICENSE`).
Fine for a personal tool; revisit before distributing the app.
