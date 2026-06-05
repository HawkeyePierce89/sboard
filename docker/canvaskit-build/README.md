# CanvasKit (PDF-enabled) Docker build

Builds CanvasKit (Skia's WebAssembly canvas API) with the Skia C++ PDF backend
(`skia_enable_pdf=true`) compiled in. This is a **prerequisite** for the
"Export to PDF" feature of sboard, but not sufficient on its own (see below).

The official `canvaskit-wasm` npm package ships **without** the PDF backend, so
this custom build is required.

> ⚠️ **`skia_enable_pdf=true` does not by itself expose `MakePDFDocument` to
> JavaScript.** It only builds Skia's C++ `SkPDF::MakeDocument`. Stock
> `modules/canvaskit/canvaskit_bindings.cpp` has no PDF binding, so the
> `canvaskit.js` this build produces still does not export `MakePDFDocument` /
> `_MakePDFDocument`. Exposing it requires patching `canvaskit_bindings.cpp`
> (derive an `SkWStream` into a `Uint8Array` and add an `EMSCRIPTEN_BINDINGS`
> entry) and rebuilding — the deferred "Task 8a" in
> `docs/plans/completed/2026-05-24-pixi-skia-pdf-renderer.md`. Until that lands,
> `exportToPDF()` raises `PDFExportNotSupportedError` (by design) even against
> this PDF-backend build.

## How to run

From the repository root:

```bash
npm run build:canvaskit
```

Or directly:

```bash
bash scripts/build-canvaskit.sh
```

The wrapper builds the Docker image, runs the build inside it, and copies
`canvaskit.js` + `canvaskit.wasm` into `public/canvaskit/`.

## Expected build time / resources

- **Time:** ~30-60 minutes on a modern laptop for the first build (Skia
  source download + `tools/git-sync-deps` + WASM compile). Subsequent runs
  using cached Docker layers are much faster (~10-15 minutes for re-compile
  only).
- **Disk:** ~5-8 GB inside the container during the build (depot_tools,
  Skia checkout, third-party deps, build outputs).
- **Output size:** `canvaskit.wasm` ~6 MB; `canvaskit.js` ~105 KB.

## Build flags

See `build.sh` (which carries inline comments explaining the less-obvious
flags). Key flags:

| Flag | Why |
| --- | --- |
| `skia_enable_pdf=true` | Compiles Skia's C++ `SkPDF::MakeDocument` backend. Necessary but **not** sufficient — the JS `MakePDFDocument` binding must still be added in `canvaskit_bindings.cpp` (see the ⚠️ note at the top). |
| `skia_use_freetype=true` | Text glyph rasterisation/embedding for PDF. |
| `skia_use_harfbuzz=false` | No complex text shaping needed; cuts size. |
| `skia_enable_skshaper=true` | skottie's `TextShaper` references `SkShaper::Make`; with harfbuzz off this builds only the primitive backend (matches the canonical canvaskit build). |
| `skia_enable_paragraph=false`, `skia_canvaskit_enable_paragraph=false` | No paragraph layout; the second flag stops canvaskit compiling `paragraph_bindings.cpp` (undefined `skia::textlayout::*`). |
| `skia_use_zlib=true` | Required for PDF stream compression. |
| `skia_use_system_zlib=false` | No system zlib in the wasm sysroot — the official-build default `true` emits a bare `-lz` wasm-ld can't resolve. `false` compiles Skia's vendored zlib from source. |
| `extra_cflags=["-isystem", ".../externals/zlib"]` | The m120 `freetype2/BUILD.gn` does not propagate the zlib include into units compiled with `-DFT_CONFIG_OPTION_SYSTEM_ZLIB` (`ftgzip.c`, `SkDeflate.cpp` both `#include "zlib.h"`). Use `extra_cflags` (C **and** C++), not `extra_cflags_c`. |
| `skia_use_no_webp_encode=true` | wasm has no real webp encoder, yet `canvaskit_bindings.cpp` calls `SkWebpEncoder::Encode`; this pulls in the no-op stub so the symbol resolves. |
| `skia_use_libpng_decode=true` | Needed for `PIXI.Sprite` (PNG textures). |
| `skia_use_libjpeg_turbo_decode=false` | Not used by our scenes; keep size down. |
| `target_cpu="wasm"` + emscripten toolchain | WebAssembly target. |

## Skia revision

The Dockerfile pins Skia via `ARG SKIA_REF=chrome/m120` (a stable Chrome
release branch). To bump it, rebuild with:

```bash
docker build --build-arg SKIA_REF=chrome/m130 -t canvaskit-pdf:latest \
    docker/canvaskit-build
```

## Current state of the committed artifacts

`public/canvaskit/canvaskit.{js,wasm}` are committed so the project is usable
without running the heavy Docker build. They are the artifacts of **this**
PDF-backend build (`skia_enable_pdf=true`), produced by `npm run build:canvaskit`.

**The "Export to PDF" button still fails** with `PDFExportNotSupportedError`,
because — as the ⚠️ note above explains — the committed `canvaskit.js` does not
export `MakePDFDocument`. Enabling Export to PDF requires the additional
`canvaskit_bindings.cpp` JS-binding patch (deferred "Task 8a") followed by a
rebuild; rebuilding with the current `build.sh` alone will **not** change this.

This matches the fallback explicitly allowed by the implementation plan
(see `docs/plans/completed/2026-05-24-pixi-skia-pdf-renderer.md`, Task 2 ⚠️ note
and Task 8a).

## Troubleshooting

- **`tools/git-sync-deps` fails inside the image:** typically a transient
  network issue against `chromium.googlesource.com`. Re-run `docker build`.
- **`ninja` reports `emcc: not found`:** the emsdk env activation didn't
  carry over — re-pull `emscripten/emsdk:3.1.56` or pin a different patch
  version.
- **Build OOMs:** Skia's link step needs ~4 GB of RAM. Raise Docker
  Desktop's resource limits.
