# CanvasKit (PDF-enabled) Docker build

Builds CanvasKit (Skia's WebAssembly canvas API) with the PDF backend
(`skia_enable_pdf=true`) enabled, so we can export scenes to vector PDF
directly from the browser.

The official `canvaskit-wasm` npm package ships **without** the PDF backend, so
this custom build is required for the "Export to PDF" feature of sboard.

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
- **Output size:** `canvaskit.wasm` ~7-9 MB; `canvaskit.js` ~120 KB.

## Build flags

See `build.sh`. Key flags:

| Flag | Why |
| --- | --- |
| `skia_enable_pdf=true` | The whole point — enables `SkPDF::MakeDocument`. |
| `skia_use_freetype=true` | Text glyph rasterisation/embedding for PDF. |
| `skia_use_harfbuzz=false` | No complex text shaping needed; cuts size. |
| `skia_enable_skshaper=false`, `skia_enable_paragraph=false` | Same as above. |
| `skia_use_zlib=true` | Required for PDF stream compression. |
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

## Plan B: pre-built fallback (current state of this repo)

Building Skia from source is heavy. To keep the project usable without
running the Docker build, `public/canvaskit/canvaskit.{js,wasm}` is initially
seeded with the stock `canvaskit-wasm` npm artifact. This **does not** include
the PDF backend — the "Export to PDF" button will fail until you run
`npm run build:canvaskit` and overwrite those artifacts with the PDF-enabled
build.

This matches the fallback explicitly allowed by the implementation plan
(see `docs/plans/2026-05-24-pixi-skia-pdf-renderer.md`, Task 2 ⚠️ note).

## Troubleshooting

- **`tools/git-sync-deps` fails inside the image:** typically a transient
  network issue against `chromium.googlesource.com`. Re-run `docker build`.
- **`ninja` reports `emcc: not found`:** the emsdk env activation didn't
  carry over — re-pull `emscripten/emsdk:3.1.56` or pin a different patch
  version.
- **Build OOMs:** Skia's link step needs ~4 GB of RAM. Raise Docker
  Desktop's resource limits.
