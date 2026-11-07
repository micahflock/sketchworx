#!/usr/bin/env bash
# Rebuild the PlaneGCS WebAssembly solver with the Sketchworx Equal Curvature constraint.
#
# Requirements: git, node/npm, cmake, Emscripten (emcc on PATH; tested with 4.0.10),
# Eigen 3 and Boost headers (Ubuntu: apt-get install libeigen3-dev libboost-dev).
# Boost must be reachable as /inc/boost (the upstream CMakeLists expects it there):
#   sudo mkdir -p /inc && sudo ln -sfn /usr/include/boost /inc/boost
#
# Output: src/solver/planegcs/planegcs_dist/{planegcs.js,planegcs.wasm} and the generated TS bindings.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
WORK="${WORK:-$HERE/.work}"
UPSTREAM=https://github.com/Salusoft89/planegcs.git
REV=9d26bae # planegcs 1.3.0

rm -rf "$WORK" && mkdir -p "$WORK"
git clone --quiet "$UPSTREAM" "$WORK/planegcs"
cd "$WORK/planegcs"
git checkout --quiet "$REV"
git apply "$HERE/equal-curvature.patch"
npm install --silent
(cd build-bindings && bash process_all.sh)

mkdir -p "$WORK/build" && cd "$WORK/build"
emcmake cmake "$WORK/planegcs/planegcs" -DCMAKE_BUILD_TYPE=Release >/dev/null
emmake make -j"$(nproc)" >/dev/null

DEST="$ROOT/src/solver/planegcs"
cp "$WORK/build/bin/planegcs.js" "$WORK/build/bin/planegcs.wasm" "$DEST/planegcs_dist/"
for f in constraint_param_index constraints enums gcs_system id; do
  cp "$WORK/planegcs/planegcs_dist/$f.ts" "$DEST/planegcs_dist/$f.ts"
done
echo "Built $(du -h "$DEST/planegcs_dist/planegcs.wasm" | cut -f1) planegcs.wasm"
