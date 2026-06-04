#!/usr/bin/env bash
#
# Build CanvasKit (WASM) with the Skia PDF backend enabled.
#
# Designed to run inside the Docker image produced by the sibling Dockerfile.
# The compiled artifacts (canvaskit.js + canvaskit.wasm) are copied to /out,
# which the wrapper script (scripts/build-canvaskit.sh) mounts to
# <repo>/public/canvaskit/.
#
set -euo pipefail

cd /workspace/skia

OUT_DIR="out/canvaskit"

bin/gn gen "${OUT_DIR}" --args='
    is_official_build=true
    is_component_build=false
    is_debug=false
    skia_enable_pdf=true
    skia_use_freetype=true
    skia_use_harfbuzz=false
    skia_enable_skshaper=false
    skia_enable_paragraph=false
    skia_use_zlib=true
    skia_use_libpng_decode=true
    skia_use_libjpeg_turbo_decode=false
    extra_cflags_c=["-isystem", "/workspace/skia/third_party/externals/zlib"]
    target_cpu="wasm"
    cc="emcc"
    cxx="em++"
    ar="emar"
'

ninja -C "${OUT_DIR}" canvaskit

mkdir -p /out
cp -v "${OUT_DIR}/canvaskit.js"   /out/canvaskit.js
cp -v "${OUT_DIR}/canvaskit.wasm" /out/canvaskit.wasm

echo "CanvasKit build complete. Artifacts in /out:"
ls -lh /out
