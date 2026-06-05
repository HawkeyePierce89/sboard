# CanvasKit (PDF-enabled) Docker build

Builds CanvasKit (Skia's WebAssembly canvas API) with the Skia C++ PDF backend
(`skia_enable_pdf=true`) compiled in **and** the `MakePDFDocument` JavaScript
binding exposed via `canvaskit-pdf-bindings.patch`. Together these power the
"Export to PDF" feature of sboard.

The official `canvaskit-wasm` npm package ships **without** the PDF backend, so
this custom build is required.

> ℹ️ **`skia_enable_pdf=true` alone does not expose `MakePDFDocument` to
> JavaScript** — it only builds Skia's C++ `SkPDF::MakeDocument`. Stock
> `modules/canvaskit/canvaskit_bindings.cpp` has no PDF binding. This build
> closes that gap with `canvaskit-pdf-bindings.patch` (see below), which adds a
> `JsPDFDocument` wrapper and a `MakePDFDocument` `EMSCRIPTEN_BINDINGS` entry to
> `canvaskit_bindings.cpp`. The resulting `canvaskit.js` **does** export
> `MakePDFDocument` / `_MakePDFDocument`, so `exportToPDF()` produces a real
> PDF. `PDFExportNotSupportedError` now only fires if a stock/unpatched
> `canvaskit.js` is loaded instead of this build's artifacts.

## `canvaskit-pdf-bindings.patch`

A committed git-diff against Skia's `modules/canvaskit/canvaskit_bindings.cpp`
at `chrome/m120`. It adds:

- `#include "include/docs/SkPDFDocument.h"`;
- a `JsPDFDocument` C++ wrapper (an `SkDynamicMemoryWStream` sink, the
  `sk_sp<SkDocument>` from `SkPDF::MakeDocument`, and an `sk_sp<SkData>` member
  that keeps the detached output buffer alive so `getOutput()` can return a
  live `Uint8Array` view);
- an `EMSCRIPTEN_BINDINGS(Skia)` entry exposing `MakePDFDocument` plus the
  document's `beginPage` / `endPage` / `close` / `getOutput` methods.

No `BUILD.gn` patch is needed: `SkPDF::MakeDocument` links transitively through
canvaskit's existing `../..:skia` dependency once `skia_enable_pdf=true` (the
top-level `:pdf` target is in `skia`'s `public_deps`).

The Dockerfile applies it with `git apply` immediately after the Skia clone +
`tools/git-sync-deps` (deps sync never touches `modules/canvaskit/`, so the
application is deterministic).

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
| `skia_enable_pdf=true` | Compiles Skia's C++ `SkPDF::MakeDocument` backend. The JS `MakePDFDocument` binding is added on top by `canvaskit-pdf-bindings.patch` (see the note at the top). |
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

> ⚠️ `canvaskit-pdf-bindings.patch` is authored against `chrome/m120`
> `canvaskit_bindings.cpp`. Bumping `SKIA_REF` to a different branch can make
> the `git apply` step fail if Skia moved the patched context; re-author the
> patch against the new ref (re-fetch the file, regenerate the diff) when you
> bump it.

## Current state of the committed artifacts

`public/canvaskit/canvaskit.{js,wasm}` are committed so the project is usable
without running the heavy Docker build. They are the artifacts of **this**
PDF-backend build (`skia_enable_pdf=true` + `canvaskit-pdf-bindings.patch`),
produced by `npm run build:canvaskit`.

Once those artifacts are regenerated from this build, the committed
`canvaskit.js` exports `MakePDFDocument` and the "Export to PDF" button produces
a real vector PDF. `PDFExportNotSupportedError` only surfaces if a
stock/unpatched `canvaskit.js` is swapped in.

> ⚠️ The currently-committed artifacts predate the patch; regenerate them with
> `npm run build:canvaskit` (a ~30–60 min Docker rebuild) to pick up the
> `MakePDFDocument` binding. See **Post-Completion** in
> `docs/plans/2026-06-05-canvaskit-pdf-bindings.md`.

## Troubleshooting

- **`tools/git-sync-deps` fails inside the image:** typically a transient
  network issue against `chromium.googlesource.com`. Re-run `docker build`.
- **`ninja` reports `emcc: not found`:** the emsdk env activation didn't
  carry over — re-pull `emscripten/emsdk:3.1.56` or pin a different patch
  version.
- **Build OOMs:** Skia's link step needs ~4 GB of RAM. Raise Docker
  Desktop's resource limits.
