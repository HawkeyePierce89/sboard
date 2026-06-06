# sboard — Pixi → Skia → PDF renderer

A small TypeScript web app that builds a scene with [pixi.js](https://pixijs.com/)
and, in parallel, renders the same scene through a custom TS wrapper on top of
[Skia / CanvasKit](https://skia.org/docs/user/modules/canvaskit/). The Skia
scene exports to a real vector PDF via Skia's PDF backend, exposed to
JavaScript by `docker/canvaskit-build/canvaskit-pdf-bindings.patch`. The
committed `public/canvaskit/canvaskit.{js,wasm}` already carry that patch, so
"Export to PDF" works out of the box without running the Docker build.

Two `<canvas>` elements show the two backends side by side:

- **Canvas 1 (Pixi.js)** — `pixi.js@7.2.4` in Canvas mode (`forceCanvas: true`,
  via `pixi.js-legacy`).
- **Canvas 2 (Skia)** — `CanvasKit.MakeSWCanvasSurface` driven by our own
  `PixiToSkiaRenderer` that walks the Pixi tree and re-emits draw calls.

Both canvases support `pointerdown` / `pointerup` events. On the Pixi canvas
that's native (`eventMode = 'static'`); on the Skia canvas it's a manual
hit-test (`src/skia/hit-test.ts`) that walks the scene tree in reverse Z-order
and dispatches a synthetic Pixi event back to the matched `DisplayObject`.

The two left-hand buttons:

- **Generate random shape** — appends a randomly-typed/positioned/colored
  `PIXI.Graphics` to the current scene; both canvases redraw and the new shape
  becomes interactive.
- **Export to PDF** — runs the scene through Skia's PDF document API and
  downloads a real vector `scene.pdf`. The `MakePDFDocument` JS binding is
  added by `canvaskit-pdf-bindings.patch` and is present in the committed
  `public/canvaskit/` artifacts; `PDFExportNotSupportedError` would only fire
  if a stock/unpatched `canvaskit.js` were swapped in.

## Live demo

Deployed via GitHub Actions to GitHub Pages on every push to `master`:

<https://hawkeyepierce89.github.io/sboard/>

## Stack

- **Language:** TypeScript (strict), ES2020
- **Build:** Vite
- **Test runner:** Vitest (jsdom + node environments)
- **Lint / format:** ESLint (flat config) + Prettier
- **Render:** `pixi.js@7.2.4` + `pixi.js-legacy@7.2.4` (Canvas backend) and
  `canvaskit-wasm@0.41.1` (PDF-enabled rebuild via the bundled Dockerfile)
- **Deploy:** GitHub Actions → GitHub Pages (`.github/workflows/deploy.yml`)

## Prerequisites

- **Node.js 22+** and npm (the CI build uses Node 22).
- **Docker** — only required when *rebuilding* CanvasKit with the PDF backend.
  The repository ships pre-built `canvaskit.js` / `canvaskit.wasm` under
  `public/canvaskit/`, so day-to-day development does **not** need Docker.

## Commands

```bash
npm install           # install dependencies
npm run dev           # start the Vite dev server (http://localhost:5173)
npm run build         # production build into dist/
npm run preview       # serve the production build locally
npm test              # run the Vitest suite once
npm run test:watch    # Vitest in watch mode
npm run typecheck     # tsc --noEmit (strict)
npm run lint          # ESLint over src/ and tests/
npm run build:canvaskit  # rebuild CanvasKit with PDF backend (Docker, slow)
```

When deploying under a path (e.g. GitHub Pages at `/sboard/`), set
`VITE_BASE=/sboard/` before `npm run build`. The CI workflow does this
automatically; the runtime also honours `import.meta.env.BASE_URL` when
loading the CanvasKit `.wasm`, so the same build works at any subpath.

## Project structure

```
sboard/
├── docker/canvaskit-build/   # Dockerfile + build.sh for the PDF-enabled CanvasKit build
├── docs/plans/               # Implementation plan(s) (ralphex)
├── public/canvaskit/         # canvaskit.js + canvaskit.wasm (committed; custom PDF-backend build)
├── scripts/                  # build-canvaskit.sh wrapper
├── src/
│   ├── pixi/
│   │   ├── transform.ts          # getWorldMatrix(): manual world-matrix composition
│   │   ├── graphics-commands.ts  # extractCommands(): PIXI.Graphics → neutral DrawCommand[]
│   │   ├── scene-walker.ts       # walkContainer(): PIXI.Container → SkiaSceneNode tree
│   │   ├── scene-builder.ts      # attachSpecInteractions / makeInteractive helpers
│   │   └── initial-scene.ts      # the spec example (g1..g4 + subContainer)
│   ├── skia/
│   │   ├── canvaskit-loader.ts   # cached initCanvasKit() with injectable loader
│   │   ├── types.ts              # local PDFDocument / CanvasKitWithPDF typings
│   │   ├── renderer.ts           # PixiToSkiaRenderer: SkiaSceneNode → CanvasKit canvas
│   │   ├── hit-test.ts           # reverse-walk hit-test for Skia-canvas pointer events
│   │   └── pdf-exporter.ts       # exportToPDF() + PDFExportNotSupportedError
│   ├── ui/
│   │   ├── dom.ts                # typed getElementById helpers
│   │   ├── status.ts             # status-line reporter (last-event display)
│   │   ├── random-shape.ts       # addRandomShape() for the "Generate" button
│   │   ├── export-button.ts      # "Export to PDF" click handler + download
│   │   └── styles.css            # flexbox layout for the two-canvas UI
│   ├── app.ts                    # App class: Pixi.Application + Skia surface owner
│   └── main.ts                   # browser entry point (boots App, wires buttons)
├── tests/                        # Vitest specs, mirroring src/
├── .github/workflows/deploy.yml  # build + deploy to GitHub Pages
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
└── vitest.config.ts
```

## Architectural notes

### Pixi → Skia rendering pipeline

The pipeline is deliberately split into three pure stages so each can be unit
tested in isolation:

1. **Walk the Pixi tree** (`src/pixi/scene-walker.ts`) into a neutral
   `SkiaSceneNode` IR — a discriminated union of `graphics | sprite | group`
   that depends on neither Pixi nor Skia. World matrices are composed manually
   (`src/pixi/transform.ts`) by walking the parent chain rather than reading
   `worldTransform`, which can be stale without a render pass. Each
   `PIXI.Graphics` is parsed into a neutral `DrawCommand[]`
   (`src/pixi/graphics-commands.ts`) covering `fill`, `stroke`, `moveTo`,
   `lineTo`, `rect`, `ellipse`, `circle`, and `closePath`.

2. **Render the IR into CanvasKit** (`src/skia/renderer.ts`). The walker
   stores **world** matrices, so the renderer concats `inv(parentWorld) *
   nodeWorld` at each step to recover the local matrix and avoid
   double-applying ancestor transforms. Sprites are looked up via an
   injectable `imageProvider` so the sprite branch is testable without
   booting the full WASM module.

3. **Optionally serialise to PDF** (`src/skia/pdf-exporter.ts`) by routing
   the same render pass through `CanvasKit.MakePDFDocument(metadata)`
   → `beginPage / endPage / close / getOutput`. The `MakePDFDocument` JS
   binding is provided by `canvaskit-pdf-bindings.patch`; the exporter throws
   `PDFExportNotSupportedError` only when a stock/unpatched build (without the
   binding) is loaded (see [Known limitations](#known-limitations)).

The neutral IR also makes it trivial to add another backend later (e.g. SVG)
without touching the Pixi side.

### Hit-testing on the Skia canvas

Pixi gives us `pointerdown` / `pointerup` on its own canvas for free, but the
Skia canvas is just pixels — it has no event system of its own. To keep the
two canvases behaviourally identical we walk the `SkiaSceneNode` tree on every
DOM `mousedown` / `mouseup` (`src/skia/hit-test.ts`):

- Iterate children in reverse order so the last-rendered (top-most) sibling
  wins.
- Apply `inv(node.matrix)` once per leaf (the walker stores world matrices on
  every node, so leaves are self-sufficient).
- Test the local-space bounding box of each `DrawCommand`:
  - rectangles, ellipses, circles inflate by `strokeWidth/2` for stroke-only
    fills,
  - polylines use point-to-segment distance with line-width awareness,
  - closed polygons use even-odd point-in-polygon for the fill case,
  - sprites use the **texture** dimensions in local space (not the post-scale
    `sprite.width/height`).
- Return the original `PIXI.DisplayObject` (`node.source`) of the top hit,
  then emit a synthetic Pixi event on it via `source.emit('pointerdown', …)`.

Because the handlers are attached to the `DisplayObject` (not the DOM
canvas), the same listener registered by `attachSpecInteractions` fires for
both a real Pixi-canvas click and a synthetic Skia-canvas hit.

### PDF export

`exportToPDF(canvasKit, container, width, height)`:

1. Checks `hasPDFSupport(canvasKit)` and throws
   `PDFExportNotSupportedError` if the binding is missing.
2. Calls `canvasKit.MakePDFDocument(metadata)` — the document writes to an
   internal sink, so no stream argument is passed.
3. `beginPage(width, height)` → walks the container through
   `PixiToSkiaRenderer` → `endPage()`, with `doc.close()` in a `finally` so
   the page is always finalized. A null `beginPage` (failed document init) or
   an empty `getOutput()` raises `PDFExportFailedError`.
4. Reads the accumulated bytes via `getOutput()` and returns a `Blob` of
   type `application/pdf`, then frees the document with `doc.delete()` (the
   binding is a raw-pointer Embind object, so JS must release it).

The UI handler (`src/ui/export-button.ts`) then creates an object URL, fires a
hidden `<a download="scene.pdf">` click, removes the anchor, and revokes the
URL. The button is disabled while the promise is in flight and re-entrant
clicks are ignored.

### App bootstrap

`App` (`src/app.ts`) owns the Pixi application, the CanvasKit surface, the
current scene container, and the renderer. `setScene(container)` swaps the
root on `pixiApp.stage` and triggers `redrawSkia()`, which clears the surface,
re-walks the container, renders into the Skia canvas, and flushes. The
factory `createApp(...)` resolves the canvases, builds the
`MakeSWCanvasSurface` (software backend, to match `forceCanvas: true`), and
returns a ready-to-use `App`.

## Known limitations

- **Rebuilding CanvasKit is expensive.** `canvaskit-pdf-bindings.patch` patches
  `modules/canvaskit/canvaskit_bindings.cpp` (adds a `JsPDFDocument` wrapper +
  an `EMSCRIPTEN_BINDINGS` entry) and the Dockerfile applies it during
  `docker build`, on top of `skia_enable_pdf=true`. The committed
  `public/canvaskit/canvaskit.{js,wasm}` already include this binding, so most
  contributors never need to run the build. When they do (e.g. to bump the
  Skia ref), `npm run build:canvaskit` takes ~30-60 minutes and needs ~5-8 GB
  of free disk inside the Docker container — see
  `docker/canvaskit-build/README.md` for flags and troubleshooting.

- **GitHub Actions does not rebuild CanvasKit.** The deploy workflow simply
  copies `public/canvaskit/` through `vite build`, so the deployed site
  carries whatever artifacts are committed in the repository.

- **Software backend only.** The Skia surface is `MakeSWCanvasSurface`, which
  matches Pixi's `forceCanvas: true`. WebGL/WebGPU paths are out of scope.

- **No E2E / visual regression tests.** Manual visual comparison between the
  two canvases is the intended verification, plus a smoke test on the PDF
  export (magic bytes + minimum size, gated on a real CanvasKit build).
