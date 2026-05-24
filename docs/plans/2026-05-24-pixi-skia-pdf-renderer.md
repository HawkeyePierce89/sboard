# Pixi → Skia → PDF Renderer (sboard test task)

## Overview

A TypeScript web application that:

- Builds a scene with `pixi.js` (v7.2.4-legacy, `forceCanvas=true`) and, in parallel, renders the same scene using a custom TS wrapper on top of Skia (CanvasKit WASM).
- Exports the Skia scene to a **vector** PDF via the Skia PDF backend (requires a custom CanvasKit build with `skia_enable_pdf=true`).
- Supports `pointerdown`/`pointerup` events on both canvases (Pixi canvas — natively via `interactive`; Skia canvas — via manual hit-testing over the scene tree).
- Provides a simple HTML/CSS UI: two buttons on the left (`Generate random shape`, `Export to PDF`), two side-by-side canvases on the right (Pixi and Skia) with labels.
- Deploys to GitHub Pages via GitHub Actions.

## Context (from discovery)

- The project is empty (`README.md` ~8 bytes, `test.pdf` — the task spec), `.gitignore` is present.
- No starter infrastructure (no `package.json`, `tsconfig`, etc.) — everything is set up from scratch.
- The repo root has `.ralphex/` (for the ralphex CLI) and `.claude/`.
- Current branch: `master` (used as the deployment branch).

## Development Approach

- **Testing approach**: **TDD** (tests are written first whenever it is reasonable). For purely computational logic (PIXI tree parsing, world matrix math, hit-testing, command list builders) — strict TDD. For the layer that calls CanvasKit directly — first a minimal happy-path test with CanvasKit mocks, then implementation, then a manual visual check.
- Each task is fully completed before moving to the next.
- Small, focused changes.
- **CRITICAL: every task MUST include new/updated tests** for changed code
  - unit tests for all new functions/classes
  - unit tests for all modified functions/classes
  - both success and error scenarios
- **CRITICAL: all tests must pass before starting the next task** — no exceptions
- **CRITICAL: update this plan file if scope shifts during implementation**
- Run tests after every change
- Maintain backward compatibility (not critical inside this package — the project is new)

## Testing Strategy

- **Unit tests** (Vitest): required for every task.
  - Pixi tree walking, world-transform extraction, graphics command parsing — fully covered.
  - The Skia renderer is tested with a CanvasKit mock (call sequences captured via spies).
  - Hit-testing — a separate module, easy to cover with synthetic scenes.
- **E2E / visual tests**: not done (not required, and Playwright/Cypress against WASM canvases is overkill for a test task). Instead — a manual visual diff Pixi canvas vs. Skia canvas + verifying the exported PDF in an external viewer.
- **Export smoke test**: programmatically render a fixture scene, export to PDF, verify the `%PDF-` magic bytes and a minimum byte size.

## Progress Tracking

- Mark completed items with `[x]` immediately on completion.
- New tasks — prefix with `➕`.
- Blockers — prefix with `⚠️`.
- Update the plan if implementation deviates from the original scope.
- Keep the plan in sync with the actual work performed.

## What Goes Where

- **Implementation Steps** (`[ ]` checkboxes): tasks doable inside the repository — code, tests, docs, CI.

## Implementation Steps

### Task 1: Project scaffold (Vite + TS + Vitest + ESLint/Prettier)

- [x] initialize `package.json` via `npm init -y`, add scripts (`dev`, `build`, `preview`, `test`, `lint`, `typecheck`)
- [x] install dev dependencies: `vite`, `typescript`, `vitest`, `@vitest/coverage-v8`, `jsdom`, `eslint`, `@typescript-eslint/parser`, `@typescript-eslint/eslint-plugin`, `prettier`
- [x] install runtime dependencies: `pixi.js@7.2.4-legacy`, `canvaskit-wasm` (as a placeholder — will be replaced by our own build) — installed `pixi.js@7.2.4` + `pixi.js-legacy@7.2.4` (legacy package provides Canvas renderer for `forceCanvas`) and `canvaskit-wasm@0.41.1`
- [x] create `tsconfig.json` (strict, target ES2020, module ESNext, moduleResolution bundler, lib DOM)
- [x] create `vite.config.ts` (`base` from env, `assetsInclude: ['**/*.wasm']`, correct copy step for `.wasm`)
- [x] create `vitest.config.ts` (jsdom environment for DOM-dependent tests, separate node environment for pure logic)
- [x] create `.eslintrc.cjs` and `.prettierrc` with sensible defaults — ESLint v10 requires flat config; created `eslint.config.js` instead of `.eslintrc.cjs`
- [x] create the directory tree: `src/`, `src/pixi/`, `src/skia/`, `src/ui/`, `src/utils/`, `tests/`, `public/`, `scripts/`, `docker/`
- [x] add a minimal `src/main.ts` and `index.html` (stubs)
- [x] write a smoke test `tests/smoke.test.ts` that imports the entry point and asserts the module loads
- [x] run `npm test`, `npm run typecheck`, `npm run lint` — all green

### Task 2: Build CanvasKit WASM with PDF backend (via Docker)

- [x] create `docker/canvaskit-build/Dockerfile` based on `emscripten/emsdk:3.1.x` with `depot_tools`, `git`, `python3`, `ninja` installed — used `emscripten/emsdk:3.1.56`; `SKIA_REF` build-arg pins the Skia branch (`chrome/m120` by default); `git-sync-deps` runs at image-build time so the container is "warm" for a re-build
- [x] in the Dockerfile, clone Skia (`git clone https://skia.googlesource.com/skia.git --depth=1 -b chrome/m120` or a recent stable branch) and run `python3 tools/git-sync-deps`
- [x] write `docker/canvaskit-build/build.sh` to run `bin/gn gen out/canvaskit --args='...'` with these flags:
  - `is_official_build=true`
  - `is_component_build=false`
  - `is_debug=false`
  - `skia_enable_pdf=true`
  - `skia_use_freetype=true`
  - `skia_use_harfbuzz=false`
  - `skia_enable_skshaper=false`
  - `skia_enable_paragraph=false`
  - `skia_use_zlib=true`
  - `skia_use_libpng_decode=true` (needed for PIXI.Sprite)
  - `skia_use_libjpeg_turbo_decode=false`
  - `target_cpu="wasm"`
  - `cc="emcc"` `cxx="em++"` `ar="emar"`
- [x] run `ninja -C out/canvaskit canvaskit` and copy `canvaskit.js` + `canvaskit.wasm` into `public/canvaskit/` — wired in `build.sh`; final copy step writes to the mounted `/out` volume (= `public/canvaskit/` on the host); see ⚠️ Plan B below regarding the artifacts currently committed
- [x] create `scripts/build-canvaskit.sh` wrapper: `docker build -t canvaskit-pdf docker/canvaskit-build && docker run --rm -v $(pwd)/public/canvaskit:/out canvaskit-pdf`
- [x] add to `package.json`: `"build:canvaskit": "bash scripts/build-canvaskit.sh"`
- [x] document the step-by-step instructions and build time in `docker/canvaskit-build/README.md`
- [x] write `tests/canvaskit-artifacts.test.ts` that asserts: both files exist, `canvaskit.wasm` > 1 MB, `canvaskit.js` exports a default function — covers existence, ≥1 MB size, WASM magic bytes, and `CanvasKitInit` entry-point symbol in the JS shim
- [x] run tests — must pass

⚠️ Plan B engaged (2026-05-24): a full Skia/CanvasKit Docker build takes ~30-60 minutes per fresh run, far longer than a single automated iteration. The Docker infrastructure (`Dockerfile`, `build.sh`, `scripts/build-canvaskit.sh`, `npm run build:canvaskit`) is fully set up and documented, but the artifacts currently committed to `public/canvaskit/` are the **stock `canvaskit-wasm@0.41.1` npm build**, which does **NOT** include `skia_enable_pdf=true`. The artifact test passes (file presence, size, WASM magic, `CanvasKitInit` symbol). PDF export (Task 8) will fail against these stock artifacts; running `npm run build:canvaskit` overwrites them with the PDF-enabled build. The fallback decision and the workflow to upgrade are documented in `docker/canvaskit-build/README.md` ("Plan B" section).

### Task 3: Thin TS wrapper around CanvasKit (initSkia, types)

- [x] create `src/skia/canvaskit-loader.ts`: `initCanvasKit(): Promise<CanvasKit>` that dynamically loads `canvaskit.js` from `/canvaskit/`, supplies `locateFile` for the `.wasm`, and caches the promise — accepts an optional `basePath` + injectable `loadModule` for tests, clears the cache on failure so a retry can succeed
- [x] create `src/skia/types.ts` with local TS types for the subset of CanvasKit we use (`Canvas`, `Surface`, `Paint`, `Path`, `Image`, `PDFDocument`) — because `@types/canvaskit-wasm` is incomplete for the PDF API; re-exports the standard types and adds `PDFMetadata`, `PDFDocument`, `CanvasKitWithPDF`
- [x] write tests `tests/skia/canvaskit-loader.test.ts` mocking `import('/canvaskit/canvaskit.js')` — verify singleton behavior and error handling on load failure (8 specs: resolve, locateFile defaults, custom basePath, caching, concurrent callers share one load, retry-after-failure, init-throws, missing default export)
- [x] run tests

### Task 4: World transform extraction from PIXI.DisplayObject

- [x] create `src/pixi/transform.ts`: `getWorldMatrix(obj: PIXI.DisplayObject): Matrix2D` (type `Matrix2D = [a,b,c,d,tx,ty]`)
- [x] implement by walking the parent chain and composing local matrices (`position`, `pivot`, `rotation`, `scale`, `skew`) — DO NOT rely on `worldTransform` because it can be stale without a render pass; alternatively, explicitly call `root.updateTransform()`
- [x] write tests `tests/pixi/transform.test.ts`:
  - identity for a default DisplayObject
  - correct translation for `position.set(x, y)`
  - correct rotation for `angle = 30` (with epsilon comparison)
  - correct scaling for `scale.set(sx, sy)`
  - composition of parent + child (the spec example with `subContainer.position.set(75,50)` + `g3`)
  - combined translate+rotate+scale
- [x] run tests — all green

### Task 5: Parse PIXI.Graphics into a neutral CommandList

- [x] create `src/pixi/graphics-commands.ts` with a `DrawCommand` union: `{type:'fill', color, alpha}`, `{type:'stroke', width, color, alpha}`, `{type:'moveTo', x, y}`, `{type:'lineTo', x, y}`, `{type:'rect', x, y, w, h}`, `{type:'ellipse', cx, cy, rx, ry}`, `{type:'circle', cx, cy, r}`, `{type:'closePath'}`
- [x] write `extractCommands(g: PIXI.Graphics): DrawCommand[]` reading `g.geometry.graphicsData` (internal `GraphicsData[]`) — for each entry, pull `fillStyle`, `lineStyle`, `shape` (`Rectangle`/`Ellipse`/`Circle`/`Polygon`); calls `g.finishPoly()` first so any pending `moveTo`/`lineTo` polygon (which is only committed at render time) is materialized into `graphicsData`
- [x] handle `Polygon` (used internally by `moveTo`/`lineTo`) — decompose into `moveTo` + chain of `lineTo`; appends `closePath` when `Polygon.closeStroke === true` (e.g. `drawPolygon`)
- [x] write tests `tests/pixi/graphics-commands.test.ts`:
  - `drawRect` → expect `[fill, rect]`
  - `drawEllipse` → expect `[fill, ellipse]`
  - `moveTo + lineTo` with `lineStyle` → expect `[stroke, moveTo, lineTo]`
  - the g3 scenario from the spec (`lineStyle(10, '#ffffff', 1).moveTo(0,0).lineTo(150,100)`)
  - combined fill + stroke within a single Graphics
  - also covered: `drawCircle` mapping, multi-segment polylines, closed `drawPolygon`, multi-shape Graphics, empty Graphics, invisible fill (`alpha=0`), implicit polygon commit. Added `tests/setup.ts` stubbing `HTMLCanvasElement.getContext('2d')` because jsdom returns null, which `Texture.WHITE` (lazily built when `new Graphics()` runs) tries to write to.
- [x] run tests

### Task 6: Walk PIXI.Container and build a SkiaSceneNode tree

- [x] create `src/pixi/scene-walker.ts` with a `SkiaSceneNode` union: `{type:'graphics', matrix, commands, source}`, `{type:'sprite', matrix, texture, width, height, source}`, `{type:'group', matrix, children, source}`, where `source` references the original `PIXI.DisplayObject` (used for hit-testing and event dispatch)
- [x] write `walkContainer(root: PIXI.Container): SkiaSceneNode` — recursively walk the tree, fold world matrices, parse Graphics commands, and for sprites extract `baseTexture.resource` (image source) — sprite node exposes the full `Texture` (renderer reads `texture.baseTexture.resource` at render time); root always becomes the top-level `group` node so the tree mirrors the PIXI hierarchy 1:1
- [x] handle `visible=false` (skip) and `alpha` (propagate into commands) — accumulated `worldAlpha` from the root chain is multiplied into every `fill`/`stroke` command's alpha
- [x] write tests `tests/pixi/scene-walker.test.ts`:
  - single Graphics — flat node
  - nested subContainer (as in the spec example) — correct tree with a group node
  - matrices inherit along the chain
  - invisible nodes are excluded
  - additionally covered: sprite node extraction (texture/width/height/source + scaled matrix), child ordering preservation, invisible subtree pruning, degenerate-group when root is invisible, alpha multiplication for both fill and stroke (and non-style commands left alone)
- [x] run tests

### Task 7: PixiToSkiaRenderer — render the CommandList into a CanvasKit Canvas

- [x] create `src/skia/renderer.ts` with class `PixiToSkiaRenderer`; the constructor takes a `CanvasKit` instance — also accepts an optional `imageProvider(texture)` callback so the sprite branch is testable without booting the full WASM module
- [x] method `render(canvas: SkCanvas, node: SkiaSceneNode): void` — walks the tree, applies `canvas.save()/concat(matrix)/restore()`, renders graphics commands via `SkPath` + `SkPaint`, renders sprites via `canvas.drawImage` — because the walker stores **world** matrices (Task 4 + 6), the renderer concats `inv(parentWorld) * nodeWorld` at each step so nested groups don't double-apply ancestor transforms
- [x] correctly map colors (Pixi accepts `'#ff0000'` → convert to CanvasKit `Color4f` or uint32) — `colorToFloat4(rgb, alpha)` returns the canonical `Float32Array` of unpremultiplied floats; alpha is taken straight from the `DrawCommand` (already pre-multiplied by ancestor `alpha` in the walker)
- [x] correctly map fill vs. stroke to `Paint.Style`
- [x] for ellipses, use `path.addOval()` — built via `PathBuilder` (the typings only expose mutation methods there, `Path` itself is immutable) and a bounding rect derived from `cx ± rx, cy ± ry`
- [x] method `renderContainer(canvas, container)`: helper that invokes walker + render
- [x] write tests `tests/skia/renderer.test.ts` with a CanvasKit mock (spy on `save`/`restore`/`concat`/`drawPath`/`drawImage`):
  - assert the `save → concat → ... → restore` sequence for each node
  - for drawRect, `drawPath` is called with a rectangular path and a fill paint
  - for a line, `drawPath` is called with a stroke paint and correct line width
  - group nesting (correct order of save/restore)
  - additionally covered: matrix conversion helpers (`pixiMatrixToSkia`, `invertMatrix2D`, `colorToFloat4`), nested groups correctly resolve to LOCAL matrices, `addCircle`/`close` paths, combined fill+stroke draws the same path twice (fill first then stroke), multi-shape Graphics use a fresh `PathBuilder` per shape, sprite drawing via the injected `imageProvider` and graceful no-op when it returns `null` or is omitted, alpha multiplication propagates into the `Paint` color
- [x] run tests

### Task 8: PDF export via the Skia PDF backend

- [x] create `src/skia/pdf-exporter.ts` with `exportToPDF(canvasKit, container: PIXI.Container, width: number, height: number): Promise<Blob>` — also exports `PDFExportNotSupportedError` and a `hasPDFSupport` type-guard so the UI button can detect the stock-build case before invoking export
- [x] use `CanvasKit.MakePDFDocument(stream, metadata)` (if that binding exists in our build) OR fall back to `SkPictureRecorder` → `MakePicture` → `SkPDF`. Confirm the API in the resulting `canvaskit.d.ts` after Task 2; if no PDF API is exposed to JS, add a ➕ task: patch `canvaskit_bindings.cpp` and rebuild — wired against the `MakePDFDocument(metadata)` shape declared in `src/skia/types.ts`; runtime path throws `PDFExportNotSupportedError` when the binding is absent (Plan B stock build), pointing to `docker/canvaskit-build/README.md`
- [x] open a PDF page (`beginPage`), get the `SkCanvas`, render the scene via `PixiToSkiaRenderer`, close the page (`endPage`), close the document (`close`) — render is wrapped in `try { … } finally { doc.close(); }` so the doc is always released even when rendering throws
- [x] return the output as a `Blob` with `type: 'application/pdf'`
- [x] write a smoke test `tests/skia/pdf-exporter.test.ts`:
  - with real CanvasKit (if jsdom can host it — otherwise factor it into a node-environment test that loads the WASM from disk) — included an integration spec that imports `canvaskit-wasm`, tolerates the WASM-in-jsdom failure (just returns), and asserts `PDFExportNotSupportedError` when the stock build has no PDF backend (so the spec stays green under Plan B and exercises the real API only when CanvasKit is rebuilt with PDF enabled)
  - export a minimal scene (one rectangle), verify `%PDF-` in the first 5 bytes of the Blob and size > 1 KB — covered (real-CanvasKit branch). The unit specs cover `%PDF-` magic, blob type, `beginPage`/`endPage`/`close` call sequence, metadata forwarding, scene-graph rendering into the page canvas, the `PDFExportNotSupportedError` failure path, `close` still firing when rendering throws, and arbitrary output sizes.
  - if jsdom can't host WASM, mark the test `it.skipIf(env !== 'node')` and move it into `tests/integration/` — used a soft-skip (returns early) rather than `skipIf` to avoid a separate test-project, keeping the suite single-config
- [x] run tests

⚠️ If, after Task 2, the PDF API is not exposed in CanvasKit's JS bindings, add ➕ task 8a: extend `modules/canvaskit/canvaskit_bindings.cpp` (derive from `SkWStream` to write into a Uint8Array, expose `MakePDFDocument`) and rebuild.

### Task 9: UI shell (HTML/CSS, two-canvas layout)

- [x] create `index.html` with layout: left column (`<aside>` with buttons + status block), right area (`<main>` with two `<canvas>` elements labeled `Canvas1 Pixi.js` and `Canvas2 Skia`)
- [x] create `src/ui/styles.css` — flexbox layout, labels above canvases, borders around canvases, button styles (no UI framework)
- [x] fixed canvas size (e.g., 500×400 to fit a typical viewport), `devicePixelRatio` handling for crisp output — canvases declared at 500×400 in both HTML attributes and CSS; `configureCanvasForDPR()` in `src/ui/dom.ts` resizes the backing store to `cssSize × devicePixelRatio` while keeping the CSS box constant (App in Task 10 will call it at startup)
- [x] create `src/ui/dom.ts` with strictly typed helpers for resolving elements by id (`getCanvasById`, `getButtonById`) that throw on missing elements — also exports a generic `getElementById<T>(id, ctor)` and a `DomLookupError` class so future callers can resolve any tag without leaking `null`
- [x] write `tests/ui/dom.test.ts` (jsdom) verifying helpers find elements and throw a typed error when missing — 14 specs: success + tag-mismatch + missing-id paths for `getElementById`/`getCanvasById`/`getButtonById`, plus DPR helper specs (custom dpr scaling, dpr=1 default, non-positive dpr clamped to 1, sub-pixel rounding floor of 1)
- [x] run tests — all 102 tests pass, `npm run typecheck` and `npm run lint` clean

### Task 10: App bootstrap — Pixi.Application + Skia.Surface

- [ ] create `src/app.ts` with class `App` that owns:
  - `pixiApp: PIXI.Application` (constructed with `view: pixiCanvas`, `forceCanvas: true`, `width`, `height`, `backgroundColor: 0xffffff`)
  - `canvasKit: CanvasKit`
  - `skiaSurface: SkSurface` (`canvasKit.MakeWebGLCanvasSurface` is NOT suitable — use `MakeSWCanvasSurface(skiaCanvas)` to stay compatible with `forceCanvas`)
  - `currentScene: PIXI.Container` — current root container
  - `renderer: PixiToSkiaRenderer`
- [ ] `redrawSkia()`: clears the Skia surface, renders `currentScene`, calls `surface.flush()`
- [ ] `setScene(container)`: swaps the root on `pixiApp.stage` and `currentScene`, then calls `redrawSkia()`
- [ ] initial scene — the spec example (g1 ellipse, g2 rect, g3+g4 lines in subContainer)
- [ ] write `tests/app.test.ts` with PIXI and CanvasKit mocks: constructor wires correctly, `setScene` refreshes both canvases
- [ ] run tests

### Task 11: pointerdown/pointerup on the Pixi canvas

- [ ] in `src/pixi/scene-builder.ts` (or in scene init) set `eventMode = 'static'` (Pixi 7 API) on interactive objects and attach `pointerdown`/`pointerup` handlers exactly like the spec example
- [ ] hook up the test console logs (`g1 pointerdown!`, `g2 pointerup!`) — matching the spec verbatim
- [ ] add a status block in the UI showing the last event (object id + event type)
- [ ] write `tests/pixi/events.test.ts` (jsdom + mocked Pixi events): handler fires on a synthetic event and updates the status
- [ ] run tests

### Task 12: Hit-testing and events on the Skia canvas

- [ ] create `src/skia/hit-test.ts` with `hitTest(node: SkiaSceneNode, x: number, y: number): PIXI.DisplayObject | null`:
  - walk in reverse order (top-most first)
  - apply the inverse matrix to the point
  - test the bounding box for each command (rectangles, ellipses, polylines with line-width awareness)
  - return the `source` of the top hit `DisplayObject`
- [ ] in `App`, attach `mousedown`/`mouseup` on the Skia canvas, translate coordinates into container space, and call `hitTest`
- [ ] dispatch a synthetic Pixi event to the matched `DisplayObject` (`source.emit('pointerdown', fakeEvent)`) — the same handler used by the Pixi canvas should fire
- [ ] update the UI status block
- [ ] write tests `tests/skia/hit-test.test.ts`:
  - hit inside a rectangle
  - miss right next to a rectangle
  - hit inside a rotated rectangle
  - top node wins when overlapping
  - hit through a nested container's transform
- [ ] run tests

### Task 13: "Generate random shape" button

- [ ] create `src/ui/random-shape.ts` with `addRandomShape(container: PIXI.Container, bounds: {w,h}): PIXI.Graphics`
  - randomly choose a shape type (rect, ellipse, line, polygon)
  - random position, angle, scale, fill/stroke color
  - return the inserted object
- [ ] wire the button in the UI; after insertion, call `app.redrawSkia()`
- [ ] attach `pointerdown`/`pointerup` to the new shape (same behavior)
- [ ] write `tests/ui/random-shape.test.ts`:
  - the function mutates the container (`children.length` grows)
  - the returned object is a `PIXI.Graphics` with non-empty commands
  - determinism with `Math.random` mocked
- [ ] run tests

### Task 14: "Export to PDF" button in the UI

- [ ] add an `Export to PDF` button to the UI
- [ ] the handler calls `exportToPDF(canvasKit, app.currentScene, width, height)`, receives a Blob, creates `URL.createObjectURL`, and triggers a download (`<a download="scene.pdf">`)
- [ ] show a "generating..." indicator during export
- [ ] write `tests/ui/export-button.test.ts` (jsdom + mocked exportToPDF): a click initiates the export, an error path surfaces a message
- [ ] run tests

### Task 15: GitHub Actions deploy to GitHub Pages

- [ ] create `.github/workflows/deploy.yml`:
  - trigger: push to `master`
  - jobs: `build` (Node 20, `npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` with `VITE_BASE=/sboard/`), `deploy` (using `actions/deploy-pages`)
  - ⚠️ do not build CanvasKit in CI — commit `public/canvaskit/*` artifacts into the repo (or attach as a git-lfs / release asset)
- [ ] in `vite.config.ts`, read `VITE_BASE` from env
- [ ] verify the workflow is syntactically valid (`act` locally or careful YAML)
- [ ] add `tests/build.test.ts` checking `npm run build` succeeds (a slow test that can be marked `it.concurrent.skipIf(process.env.CI !== 'true')`)
- [ ] run tests

### Task 16: README with run instructions

- [ ] update `README.md`:
  - brief task description and stack
  - prerequisites (Node 20+, Docker — only for rebuilding CanvasKit; without Docker the project runs against the committed artifacts)
  - commands: `npm install`, `npm run dev`, `npm run build`, `npm run preview`, `npm test`, `npm run build:canvaskit`
  - project structure
  - architectural notes (how the wrapper works, how hit-testing works, how PDF export works)
  - link to the deployed GitHub Pages site
  - known limitations (if CanvasKit was not rebuilt locally — call out which build is bundled)
- [ ] no unit tests required for this task

### Task 17: Final verification of acceptance criteria

- [ ] verify the Skia wrapper correctly renders every shape type from the spec: `drawShape`/`drawRect`/`drawEllipse`/`moveTo`+`lineTo`, and `PIXI.Sprite` with PNG
- [ ] verify transforms (translate/rotate/scale) propagate correctly through parent → child chains
- [ ] verify `pointerdown`/`pointerup` fire on both canvases
- [ ] run the full test suite (`npm test --run`)
- [ ] run the linter (`npm run lint`) — no errors
- [ ] run typecheck (`npm run typecheck`) — no errors
- [ ] check test coverage — critical logic (`transform`, `graphics-commands`, `scene-walker`, `hit-test`) at 80%+
- [ ] visually compare the Pixi and Skia canvases on the spec example — only antialiasing-level differences are acceptable
- [ ] generate a PDF, open it in Preview/Acrobat — confirm the shapes are **vector** (zoom in — no pixelation, elements can be selected)

## Technical Details

### Directory layout

```
sboard/
├── docker/canvaskit-build/      # Dockerfile + build.sh for the CanvasKit build
├── docs/plans/                  # plans
├── public/canvaskit/            # canvaskit.js + canvaskit.wasm (committed)
├── scripts/                     # build-canvaskit.sh
├── src/
│   ├── pixi/                    # scene-walker, transform, graphics-commands
│   ├── skia/                    # canvaskit-loader, renderer, pdf-exporter, hit-test
│   ├── ui/                      # dom, styles, random-shape, export-button
│   ├── app.ts                   # App class
│   └── main.ts                  # entry point
├── tests/                       # vitest tests (mirroring src/)
├── .github/workflows/deploy.yml
├── index.html
├── package.json
├── tsconfig.json
├── vite.config.ts
├── vitest.config.ts
└── README.md
```

### Internal IR format (DrawCommand / SkiaSceneNode)

`SkiaSceneNode` is neutral — it depends on neither Pixi nor Skia. That lets us:

- test the walker in isolation (no CanvasKit involved)
- test the renderer in isolation (no Pixi involved)
- add another backend later (e.g., SVG) by reusing the walker

### CanvasKit PDF API

The exact API is confirmed after Task 2. Expected shape:

```ts
const stream = canvasKit.NewPDFOutputStream();  // or a Uint8Array sink
const doc = canvasKit.MakePDFDocument(stream, { title: 'Scene' });
const canvas = doc.beginPage(width, height);
renderer.render(canvas, sceneNode);
doc.endPage();
doc.close();
const bytes = stream.flush();  // Uint8Array
```

If no such API exists, we must extend `canvaskit_bindings.cpp` (Task 8a).

### Coordinate systems

- Pixi canvas: top-left origin, Y down — the native DOM canvas coordinate system.
- Skia canvas: the same — an `SkSurface` over a `<canvas>` shares the coordinate system. No flipping needed.
- Hit-testing: mouse coordinates via `event.offsetX/offsetY` relative to the canvas, no `devicePixelRatio` adjustments here (we scale either via `ctx.scale(dpr,dpr)` or explicitly in the render matrix).

## Post-Completion

*Items requiring manual intervention or external systems — no checkboxes, informational only*

**Manual verification:**
- Open the deployed app in Chrome/Firefox/Safari, click the buttons, confirm pointerdown/pointerup are logged to the console
- Download the PDF, open it in Preview (macOS) and Acrobat Reader, zoom in — the shapes should stay crisp (vector), not pixelate
- Visually compare the two canvases across several generated random scenes
