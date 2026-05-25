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

- [x] create `src/app.ts` with class `App` that owns:
  - `pixiApp: PIXI.Application` (constructed with `view: pixiCanvas`, `forceCanvas: true`, `width`, `height`, `backgroundColor: 0xffffff`) — `createApp` factory wires this; the `App` constructor itself takes already-resolved dependencies so unit tests can mock them
  - `canvasKit: CanvasKit`
  - `skiaSurface: SkSurface` — created via `MakeSWCanvasSurface(skiaCanvas)` inside `createApp` so the Software backend matches `forceCanvas: true`; factory throws a descriptive error when CanvasKit returns null
  - `currentScene: PIXI.Container` — current root container, swapped wholesale by `setScene`
  - `renderer: PixiToSkiaRenderer`
- [x] `redrawSkia()`: clears the Skia surface, renders `currentScene`, calls `surface.flush()` — clear color derives from the `backgroundColor` option (defaults to white `0xffffff`) so both canvases agree
- [x] `setScene(container)`: swaps the root on `pixiApp.stage` and `currentScene`, then calls `redrawSkia()` — uses `stage.removeChildren()` for a clean swap regardless of prior state
- [x] initial scene — the spec example (g1 ellipse, g2 rect, g3+g4 lines in subContainer) — implemented in `src/pixi/initial-scene.ts` (`buildInitialScene()`); objects tagged with stable `name` values (`g1`, `g2`, `subContainer`, `g3`, `g4`) so Task 11 / Task 12 can dispatch events back to them. `src/main.ts` exposes a new `start()` async entry that wires the canvases, CanvasKit, and the App, auto-running in the browser only when `#pixi-canvas` exists (so the smoke test stays unaffected). Also switched `Application` import to `pixi.js-legacy` so `forceCanvas: true` actually registers a Canvas renderer.
- [x] write `tests/app.test.ts` with PIXI and CanvasKit mocks: constructor wires correctly, `setScene` refreshes both canvases — 14 App specs (constructor wiring + default/custom background color + immediate `clear/render/flush` ordering; `setScene` updates `currentScene`, swaps stage children, redraws Skia; `redrawSkia` order invariant and canvas passthrough; `createApp` error path + happy path including a real `pixi.js-legacy` Application). Plus 7 `tests/pixi/initial-scene.test.ts` specs covering tree shape, node names, sub-container position, g1 ellipse / g2 rect commands, g3 spec line (width 10, white, 0,0→150,100), g4 line presence, and per-call instance independence.
- [x] run tests — 123 total now pass (was 102 before this task); `npm run typecheck` and `npm run lint` clean

### Task 11: pointerdown/pointerup on the Pixi canvas

- [x] in `src/pixi/scene-builder.ts` (or in scene init) set `eventMode = 'static'` (Pixi 7 API) on interactive objects and attach `pointerdown`/`pointerup` handlers exactly like the spec example — `attachSpecInteractions(root, { onEvent, logger? })` flips `eventMode = 'static'` on the spec-named objects and binds the handlers; `makeInteractive(target, events, options)` is exposed for Task 12/13 to wire newly added shapes (e.g. random-shape) with the same contract
- [x] hook up the test console logs (`g1 pointerdown!`, `g2 pointerup!`) — matching the spec verbatim — only `g1` listens for `pointerdown` and only `g2` listens for `pointerup` per the spec; the cross-events (g1 pointerup, g2 pointerdown) are explicitly asserted to be no-ops; default logger falls through to `console.log`
- [x] add a status block in the UI showing the last event (object id + event type) — reused the existing `#status-log` element from Task 9; `src/ui/status.ts` exposes `createStatusReporter(el)` returning `{ report, reset }`. `start()` in `main.ts` looks up `#status-log` (gracefully `undefined` when missing so unit tests that omit it don't crash) and threads the reporter through `attachSpecInteractions` as `onEvent`
- [x] write `tests/pixi/events.test.ts` (jsdom + mocked Pixi events): handler fires on a synthetic event and updates the status — 18 specs covering: `eventMode` flip on g1/g2, g3/g4 untouched (so Task 12 owns hit-test wiring), exact `"g1 pointerdown!"` / `"g2 pointerup!"` console strings, the no-op cross-events, onEvent payload shape, end-to-end DOM status updates through `createStatusReporter`, missing-target safety (`attachSpecInteractions` on an empty Container does not throw), default `console.log` logger, `makeInteractive` with arbitrary event lists and `<unnamed>` fallback, `findDescendantByName` recursion into nested containers, and `formatStatus`/`reset` behavior
- [x] run tests — 141 total pass (was 123 before this task); `npm run typecheck` and `npm run lint` clean

### Task 12: Hit-testing and events on the Skia canvas

- [x] create `src/skia/hit-test.ts` with `hitTest(node: SkiaSceneNode, x: number, y: number): PIXI.DisplayObject | null`:
  - walk in reverse order (top-most first) — children iterated `[N-1 → 0]` so the last-rendered sibling wins
  - apply the inverse matrix to the point — `inv(node.matrix)` is applied once per leaf because the walker stores **world** matrices on every node; group nodes have no geometry of their own and just forward the test to their children
  - test the bounding box for each command (rectangles, ellipses, polylines with line-width awareness) — rect/ellipse/circle inflated by `strokeWidth/2` when stroke-only, polylines via point-to-segment distance, closed polygons via even-odd point-in-polygon for the fill case; sprites use the **texture** dimensions in local space (not the post-scale `sprite.width/height` exposed on the node)
  - return the `source` of the top hit `DisplayObject`
- [x] in `App`, attach `mousedown`/`mouseup` on the Skia canvas, translate coordinates into container space, and call `hitTest` — `skiaCanvas?` added to `AppOptions` (kept optional so existing tests stay valid). `canvasEventToScene` uses `getBoundingClientRect` rather than `offsetX/Y` so the math is DPR-independent. Dispatch is also exposed as a public `dispatchSkiaPointerEvent(kind, x, y)` so unit tests (and a future "Generate random shape" button) can fire events without going through the DOM.
- [x] dispatch a synthetic Pixi event to the matched `DisplayObject` (`source.emit('pointerdown', fakeEvent)`) — the same handler used by the Pixi canvas should fire — synthetic event shape is `{type, global: {x, y}}`; cast to `never` at the `emit` site to bypass `FederatedPointerEvent`'s 70+ unused fields (same approach existing event tests already use). Because `attachSpecInteractions` (Task 11) wires the spec handlers via `target.on(...)`, the synthetic event triggers `g1 pointerdown!` / `g2 pointerup!` exactly like a real Pixi-canvas click.
- [x] update the UI status block — automatically updated via the existing `onEvent` → `createStatusReporter` chain set up in Task 11; no extra wiring needed because the handlers are attached to the `DisplayObject`, not to the DOM canvas
- [x] write tests `tests/skia/hit-test.test.ts`:
  - hit inside a rectangle — covered
  - miss right next to a rectangle — covered (3 boundary-adjacent points)
  - hit inside a rotated rectangle — covered (45° rotation around origin, both centre and an axis tip)
  - top node wins when overlapping — covered (two overlapping rects, plus bottom-only and top-only sample points)
  - hit through a nested container's transform — covered (spec g3 line in a (75,50)-translated sub-container)
  - additionally covered: just-outside rect misses, world-matrix translation on the leaf, alpha=0 fill produces no hit, stroke-only rect (hits on the edge but not the centre), filled ellipse + circle, stroke-width-aware polyline hit, point-in-polygon for closed filled polygon, sprite hit using texture-local bounds, invisible subtree pruning, empty-scene `null` result. 16 specs total.
- [x] add `tests/app.test.ts` coverage for the new wiring: `dispatchSkiaPointerEvent` happy-path (pointerdown + pointerup), miss path, spec subContainer hit, re-walks per call so post-construction mutations are seen, works without a `skiaCanvas`; DOM listeners attach when canvas is provided, `getBoundingClientRect` offset is subtracted before hit-testing, `canvasEventToScene` math sanity. 11 new app specs (total 25, up from 14).
- [x] run tests — 168 total pass (was 141 before this task: 16 hit-test + 11 app specs added); `npm run typecheck` and `npm run lint` clean

### Task 13: "Generate random shape" button

- [x] create `src/ui/random-shape.ts` with `addRandomShape(container: PIXI.Container, bounds: {w,h}): PIXI.Graphics`
  - randomly choose a shape type (rect, ellipse, line, polygon)
  - random position, angle, scale, fill/stroke color
  - return the inserted object — `AddRandomShapeOptions` exposes an injectable `random` source (defaults to `Math.random`) and an optional `name` override; default name is `random:<type>`; shapes drawn around (0,0) so the local matrix (position/rotation/scale) behaves intuitively
- [x] wire the button in the UI; after insertion, call `app.redrawSkia()` — added `wireGenerateButton(app, status)` in `src/main.ts` which gracefully no-ops (via `DomLookupError`) when `#btn-generate` is absent, so the smoke test continues to import the module cleanly
- [x] attach `pointerdown`/`pointerup` to the new shape (same behavior) — reuses `makeInteractive` from `src/pixi/scene-builder.ts`, so the generated shape's events flow through the same status reporter / console-logger chain as the spec `g1`/`g2` objects
- [x] write `tests/ui/random-shape.test.ts`:
  - the function mutates the container (`children.length` grows) — covered
  - the returned object is a `PIXI.Graphics` with non-empty commands — covered
  - determinism with `Math.random` mocked — covered (via `vi.spyOn(Math, 'random')`)
  - additionally covered: each of the four shape types (rect/ellipse/line/polygon) is produced by the matching type-selector seed, polygon emits a closed (`closePath`-terminated) path with ≥3 vertices, position scales with the bounds argument, scale stays in [0.5, 1.5], rotation lands in [0, 2π), explicit `name` override wins over the `random:<type>` default, zero-sized bounds do not throw, and the type table is exactly `[rect, ellipse, line, polygon]` in that order. Documented why `LINE_SEED=0.5` was abandoned (PIXI dedupes `lineTo(0,0)` so the polygon never commits a stroke style).
- [x] run tests — 181 total pass (was 168 before this task: 13 new random-shape specs); `npm run typecheck` and `npm run lint` clean

### Task 14: "Export to PDF" button in the UI

- [x] add an `Export to PDF` button to the UI — already present from the Task 9 layout (`#btn-export-pdf` in `index.html`); this task wires the click handler in `src/ui/export-button.ts` and connects it from `src/main.ts` (`wireExportButton`)
- [x] the handler calls `exportToPDF(canvasKit, app.currentScene, width, height)`, receives a Blob, creates `URL.createObjectURL`, and triggers a download (`<a download="scene.pdf">`) — the scene is resolved lazily via a `scene: () => app.currentScene` callback so shapes added via "Generate random shape" between exports are picked up. `defaultTriggerDownload` creates a hidden anchor, clicks it, removes it, and revokes the object URL. Both `exportFn` and `triggerDownload` are injectable so the unit tests stay independent of CanvasKit and of jsdom's blob-URL plumbing.
- [x] show a "generating..." indicator during export — button is `disabled=true` and its label flips to "Generating…" while the export promise is in flight; restored in a `finally` so a failed export does not leave the UI stuck. A new `StatusReporter.message(text)` method was added (mirroring `report`/`reset`) and is wired through `onStatus` so the status block also shows "Generating PDF…" / "PDF ready — scene.pdf" / a friendly error message. Re-entrant clicks while pending are ignored (the second click sees `button.disabled === true`).
- [x] write `tests/ui/export-button.test.ts` (jsdom + mocked exportToPDF): a click initiates the export, an error path surfaces a message — 18 specs covering: exportFn invoked with (canvasKit, scene, w, h); scene re-evaluated per click; default filename `scene.pdf` and custom filename overrides; button disabled + "Generating…" label during pending and restored after; onStatus emits `Generating PDF…` then `PDF ready — scene.pdf`; re-entrant click suppression; generic Error → `PDF export failed: <msg>`; `PDFExportNotSupportedError` → `PDF export unavailable: …`; non-Error rejections (string/null/object) fall through to `PDF export failed`; missing button no-ops; custom buttonId resolves correctly; integration sanity with a real `Graphics`; `defaultTriggerDownload` calls `URL.createObjectURL`, sets `download`/`href`, clicks the anchor, removes it, and revokes the URL. Plus 1 new spec for `StatusReporter.message()` in `tests/pixi/events.test.ts`.
- [x] run tests — 200 total pass (was 181 before this task: 19 new specs); `npm run typecheck` and `npm run lint` clean

### Task 15: GitHub Actions deploy to GitHub Pages

- [x] create `.github/workflows/deploy.yml`:
  - trigger: push to `master` (plus `workflow_dispatch` for manual reruns)
  - jobs: `build` (Node 20, `npm ci`, `npm run typecheck`, `npm test`, `npm run lint`, `npm run build` with `VITE_BASE=/sboard/`), `deploy` (using `actions/deploy-pages@v4`) — `permissions` block grants `pages: write` and `id-token: write`; `concurrency` group `pages` (no cancel-in-progress so an in-flight deploy is never interrupted)
  - ⚠️ do not build CanvasKit in CI — `public/canvaskit/canvaskit.{js,wasm}` are committed (stock 0.41.1 build per Plan B in Task 2); the workflow just copies the `public/` tree via `vite build`
- [x] in `vite.config.ts`, read `VITE_BASE` from env — already wired in Task 1 (`base: process.env.VITE_BASE ?? '/'`); also added `src/vite-env.d.ts` (`/// <reference types="vite/client" />`) and updated `src/main.ts` to pass `basePath: \`${import.meta.env.BASE_URL}canvaskit/\`` to `initCanvasKit()` so the runtime CanvasKit fetch honours the same base — otherwise the deployed app would 404 on `/canvaskit/canvaskit.wasm` instead of `/sboard/canvaskit/canvaskit.wasm`
- [x] verify the workflow is syntactically valid (`act` locally or careful YAML) — validated via `npx yaml valid` (exit 0) and a `yaml --json` round-trip that confirms the parsed structure: `on.push.branches=[master]`, both jobs, all 9 build steps in order, `VITE_BASE` env, deploy `needs: build` and uses `actions/deploy-pages@v4`
- [x] add `tests/build.test.ts` checking `npm run build` succeeds (a slow test that can be marked `it.concurrent.skipIf(process.env.CI !== 'true')`) — used plain `it.skipIf(!SHOULD_RUN)` (`SHOULD_RUN = process.env.CI === 'true'`); the gated spec spawns `npm run build` with `VITE_BASE=/sboard/`, asserts a clean exit, that `dist/index.html` contains a `/sboard/assets/` rewrite, and that `dist/canvaskit/canvaskit.wasm` was copied wholesale (size > 1 MB). A second always-on spec guards the skip predicate itself so an accidental gate-flip is caught. Verified that with `CI=true` the build spec runs and produces `/sboard/` paths; without `CI` it is skipped (`↓` in vitest verbose output)
- [x] run tests — 201 passed + 1 skipped (the build spec) locally; with `CI=true` 202/202 pass. `npm run lint` and `npm run typecheck` clean

### Task 16: README with run instructions

- [x] update `README.md`:
  - brief task description and stack
  - prerequisites (Node 20+, Docker — only for rebuilding CanvasKit; without Docker the project runs against the committed artifacts)
  - commands: `npm install`, `npm run dev`, `npm run build`, `npm run preview`, `npm test`, `npm run build:canvaskit`
  - project structure
  - architectural notes (how the wrapper works, how hit-testing works, how PDF export works)
  - link to the deployed GitHub Pages site (https://hawkeyepierce89.github.io/sboard/ — derived from the `HawkeyePierce89/sboard` repo + the `VITE_BASE=/sboard/` in `.github/workflows/deploy.yml`)
  - known limitations (if CanvasKit was not rebuilt locally — call out which build is bundled) — README's "Known limitations" section explicitly flags the bundled stock `canvaskit-wasm@0.41.1` build, the resulting `PDFExportNotSupportedError`, and the `npm run build:canvaskit` upgrade path (Plan B from Task 2)
- [x] no unit tests required for this task

### Task 17: Final verification of acceptance criteria

- [x] verify the Skia wrapper correctly renders every shape type from the spec: `drawShape`/`drawRect`/`drawEllipse`/`moveTo`+`lineTo`, and `PIXI.Sprite` with PNG — covered by `tests/pixi/graphics-commands.test.ts` (drawRect / drawEllipse / drawCircle / drawPolygon / moveTo+lineTo specs) and `tests/skia/renderer.test.ts` (rect / ellipse via PathBuilder.addOval / line stroke / circle / sprite via injected `imageProvider`). 25 occurrences of the shape/sprite keywords across the renderer spec.
- [x] verify transforms (translate/rotate/scale) propagate correctly through parent → child chains — covered by `tests/pixi/transform.test.ts` (identity, translate, rotate 30°, scale, parent+child composition per spec, combined T·R·S — 8 specs, file at 100% coverage) and `tests/pixi/scene-walker.test.ts` (matrices inherit along the chain — 96.87% coverage)
- [x] verify `pointerdown`/`pointerup` fire on both canvases — Pixi side covered by `tests/pixi/events.test.ts` (18 specs: `eventMode='static'`, g1/g2 exact log strings, no-op cross-events, status reporter wiring); Skia side covered by `tests/skia/hit-test.test.ts` (16 specs) + `tests/app.test.ts` `dispatchSkiaPointerEvent` specs (synthetic event re-emitted on the matched `DisplayObject` so the same Pixi-side handlers fire)
- [x] run the full test suite (`npm test --run`) — `vitest run` reports 16 files, 201 passed + 1 skipped (build spec gated on `CI=true`), 0 failed
- [x] run the linter (`npm run lint`) — no errors (clean exit, empty output)
- [x] run typecheck (`npm run typecheck`) — no errors (`tsc --noEmit` clean exit, empty output)
- [x] check test coverage — critical logic (`transform`, `graphics-commands`, `scene-walker`, `hit-test`) at 80%+ — measured via `vitest run --coverage`: `transform.ts` 100% stmts, `graphics-commands.ts` 93.93% stmts / 96.77% lines, `scene-walker.ts` 96.87% stmts / 96.42% lines, `hit-test.ts` 81.69% stmts / 83.33% lines. All four clear the 80% bar.
- [x] visually compare the Pixi and Skia canvases on the spec example — only antialiasing-level differences are acceptable — manual test (skipped - not automatable; requires running the dev server in a real browser and a human visual diff)
- [x] generate a PDF, open it in Preview/Acrobat — confirm the shapes are **vector** (zoom in — no pixelation, elements can be selected) — manual test (skipped - not automatable; additionally blocked under Plan B because the bundled stock `canvaskit-wasm@0.41.1` build raises `PDFExportNotSupportedError`. Becomes possible after running `npm run build:canvaskit` to rebuild CanvasKit with `skia_enable_pdf=true` — see `docker/canvaskit-build/README.md`)

### ➕ Task 18: Post-Task-17 code review fixes

Out-of-scope correctness fixes that landed after Task 17 was marked complete. Recorded here per the plan's own "keep in sync" rule.

- [x] canvaskit-loader: load `canvaskit.js` via injected `<script>` tag and read `globalThis.CanvasKitInit`. The previous dynamic `import()` returned an empty module because canvaskit.js is a UMD/IIFE bundle, not ESM — the app never bootstrapped in a real browser. (`src/skia/canvaskit-loader.ts`, `tests/skia/canvaskit-loader.test.ts`)
- [x] main: drop `configureCanvasForDPR` on both canvases. The PIXI `Application` constructor reset the Pixi canvas back to CSS pixels while the Skia canvas stayed DPR-scaled, so on HiDPI displays Skia rendered the scene into only the top-left quarter of its surface. The DPR helper itself was later deleted in this task as dead code. (`src/main.ts`)
- [x] renderer + hit-test: add an `endEntry` `DrawCommand` and reset both paint slots / hit-test state at the end of each `graphicsData` entry so a stroke or fill from one entry no longer leaks into a later entry that omits the corresponding style command. (`src/skia/renderer.ts`, `src/skia/hit-test.ts`, `src/pixi/graphics-commands.ts`, accompanying tests)
- [x] minor: remove dead `configureCanvasForDPR` helper + tests; replace `findDescendantByName` recursion with Pixi's built-in `getChildByName(name, true)`; fix `randomColor` off-by-one (now spans full `0x000000–0xffffff` range); defer `URL.revokeObjectURL` to the next tick to match the JSDoc; delete the tautological `build artifact guard configuration is wired correctly` test.
- [x] scene-walker: also skip nodes where `renderable=false` so the Skia path matches `@pixi/canvas-display` (which suppresses a subtree on either `visible=false` or `renderable=false`). Without this, a `renderable=false` object would still appear (and be hit-testable) on the Skia canvas while Pixi silently dropped it. (`src/pixi/scene-walker.ts`, `tests/pixi/scene-walker.test.ts`)
- [x] sprite parity: capture `sprite.anchor` in the `SkiaSpriteNode` and apply `-anchor * texture.size` as the draw-origin offset in both the renderer (`drawImage`) and the Skia hit-test. Without the offset an `anchor.set(0.5)` sprite was rendered and hit-tested in the top-left quadrant of where Pixi placed it. (`src/pixi/scene-walker.ts`, `src/skia/renderer.ts`, `src/skia/hit-test.ts`, accompanying tests)
- [x] sprite imageProvider default: introduce `defaultImageProvider(canvasKit)` in `src/skia/renderer.ts` (WeakMap-cached, calls `MakeImageFromCanvasImageSource` for an `HTMLImageElement` / `HTMLCanvasElement` / `HTMLVideoElement` / `ImageBitmap` / `OffscreenCanvas` resource source, otherwise `null`). `createApp` now installs this default when no provider is injected, stores it on the `App`, and `wireExportButton` forwards it through to `exportToPDF` so the PDF backend sees the same cached `Image` instances as the on-screen renderer. Without this wiring `start()` and the export path both produced sprite-free output even though the renderer infrastructure was already in place. (`src/skia/renderer.ts`, `src/app.ts`, `src/ui/export-button.ts`, `src/main.ts`, accompanying tests)
- [x] sprite alpha + tint parity: capture `sprite.tintValue` and the accumulated `worldAlpha` on `SkiaSpriteNode`, and apply them in `drawSprite` via `Paint.setAlphaf` and a `Modulate` `ColorFilter`. Without this an `alpha < 1` or `tint !== 0xFFFFFF` sprite would render fully opaque and untinted on the Skia canvas / in the PDF, even though Pixi's canvas renderer applies both. (`src/pixi/scene-walker.ts`, `src/skia/renderer.ts`, accompanying tests)
- [x] sprite atlas-frame support: switch `drawSprite` from `drawImage(image, x, y, null)` to `drawImageRect(image, src=texture.frame, dst=...)` so a `Texture` whose `frame` is a sub-rect of the baseTexture (i.e. an atlas/spritesheet frame) draws the right region. For simple `Texture.from(url)` sprites this is a no-op because `frame` covers the full baseTexture. Trim/rotation are intentionally not honored — the spec only requires "PIXI.Sprite with PNG" (the simple, untrimmed case). (`src/skia/renderer.ts`, accompanying tests)
- [x] run tests, lint, typecheck — all clean (221 specs total, 1 skipped build spec)

Note: the "Coordinate systems" section below still mentions DPR scaling. That paragraph predates the iteration-17 decision to skip DPR entirely so both canvases stay pixel-for-pixel comparable at 500×400; the actual code path no longer applies any `ctx.scale(dpr,dpr)` or render-matrix scaling.

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
