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

# PDF JS binding — skia_enable_pdf builds the Skia *C++* PDF backend
# (SkPDF::MakeDocument). The CanvasKit *JS* binding (MakePDFDocument) is added
# separately by canvaskit-pdf-bindings.patch, which the Dockerfile applies to
# modules/canvaskit/canvaskit_bindings.cpp right after the Skia clone. So the
# canvaskit.js this build produces *does* export MakePDFDocument, and
# exportToPDF() drives the real PDF branch. This script's job is to make
# `npm run build:canvaskit` compile valid artifacts with the PDF backend +
# JS binding compiled in.
#
# zlib notes (there is no system zlib in the emscripten wasm sysroot):
#  * skia_use_system_zlib=false: the official-build default is true, which makes
#    third_party/zlib/BUILD.gn emit system("zlib"){libs=["z"]} -> a bare -lz at
#    link time that wasm-ld cannot resolve ("unable to find library -lz").
#    Setting it false makes Skia compile its own vendored third_party/externals
#    /zlib from source and link that instead.
#  * extra_cflags: even with the vendored zlib target built, Skia's m120
#    freetype2/BUILD.gn does not propagate the zlib include into the units
#    compiled with -DFT_CONFIG_OPTION_SYSTEM_ZLIB. A C unit
#    (freetype src/gzip/ftgzip.c) and a C++ unit (src/pdf/SkDeflate.cpp) both
#    #include "zlib.h", so we use extra_cflags (C and C++) rather than
#    extra_cflags_c (C only) to put the vendored zlib dir on the include path.
# Link-stage consistency for the trimmed feature set (canvaskit binds more than
# the Skia libs we enable, causing wasm-ld undefined symbols):
#  * skia_enable_skshaper=true: skottie's TextShaper references SkShaper::Make
#    and the run iterators. With skshaper disabled those are undefined. With
#    harfbuzz off, skshaper builds only its primitive backend (no icu/harfbuzz
#    needed), which supplies those symbols -- matching the canonical canvaskit
#    build, which always enables skshaper.
#  * skia_canvaskit_enable_paragraph=false: we disable the paragraph/skshaper
#    Skia libs, but canvaskit defaults skia_canvaskit_enable_paragraph=true and
#    compiles paragraph_bindings.cpp -> undefined skia::textlayout::* symbols.
#  * skia_use_no_webp_encode=true: for wasm skia_use_libwebp_encode defaults to
#    false (no real encoder), yet canvaskit_bindings.cpp encodeImage() calls
#    SkWebpEncoder::Encode unconditionally. This flag pulls in the no-op encoder
#    stub (skia_no_encode_webp_srcs) so the symbol resolves without libwebp.
# Keep these comments OUT of the --args string below: inline comments inside
# --args break gn arg parsing ("Need exactly one build directory to generate").
bin/gn gen "${OUT_DIR}" --args='
    is_official_build=true
    is_component_build=false
    is_debug=false
    skia_enable_pdf=true
    skia_use_freetype=true
    skia_use_harfbuzz=false
    skia_enable_skshaper=true
    skia_enable_paragraph=false
    skia_canvaskit_enable_paragraph=false
    skia_use_zlib=true
    skia_use_system_zlib=false
    skia_use_libpng_decode=true
    skia_use_libjpeg_turbo_decode=false
    skia_use_no_webp_encode=true
    extra_cflags=["-isystem", "/workspace/skia/third_party/externals/zlib"]
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
