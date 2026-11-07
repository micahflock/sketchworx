# Sketchworx

A browser-based 2D constraint sketcher that behaves like the SolidWorks sketch environment, for logos and vector
art. Lines, arcs and style splines, SolidWorks relations and Smart Dimension, unitless values, and clean filled SVG
export.

```sh
npm install
npm run dev      # http://localhost:5173
npm test         # unit tests (Vitest)
npm run build    # static build in dist/
```

See `PROGRESS.md` for milestone status, decisions and known gaps.

- `src/model` document, relations, dimensions, expressions, outlines (pure data, no DOM)
- `src/solver` solver interface, relation → constraint translation, DOF analysis, PlaneGCS adapter + worker
- `src/solver/planegcs` vendored PlaneGCS WebAssembly build with the Equal Curvature constraint (`solver-wasm/` rebuilds it)
- `src/tools`, `src/inference`, `src/render`, `src/ui`, `src/io` as in the spec

Samples for a quick look (browser console): `sketchworx.loadDoc(sketchworxSamples.slot())` or `sketchworxSamples.oval()`.
