# Fix `new ck.PathBuilder()` crash — switch the Skia renderer to `ck.Path`

## Overview

At App startup the renderer calls `new ck.PathBuilder()` (`src/skia/renderer.ts:206`). Our self-built `public/canvaskit/canvaskit.wasm` (Skia chrome/m120) never exported `SkPathBuilder`, so `ck.PathBuilder` is `undefined` and `new undefined()` throws "is not a constructor". Verified: `strings public/canvaskit/canvaskit.wasm | grep PathBuilder` → 0 hits, while `Path`, `moveTo`, `lineTo`, `addRect`, `addOval`, `addCircle`, `close` are all present. The fix is to build geometry on a `ck.Path` directly (which our wasm has) instead of a `PathBuilder`, drawing the `Path` straight into `drawPath` without `detach()`.

## Important wrinkle discovered (not in the original write-up)

The original analysis says "moveTo/lineTo/addRect/addOval/addCircle/close все на Path". That is true at RUNTIME for our m120 wasm, but it is NOT true in the TypeScript types we compile against. `canvaskit-wasm@0.41.1` ships its own types (`node_modules/canvaskit-wasm/types/index.d.ts`), and in that version the `Path` interface is the immutable subset (`computeTightBounds`, `contains`, `copy`, `makeStroked`, `toSVGString`, …) — the mutation methods (`moveTo`/`lineTo`/`addRect`/`addOval`/`addCircle`/`close`) are declared only on `PathBuilder`. So `new ck.Path()` followed by `path.moveTo(...)` will FAIL `tsc` unless we bridge the type gap.

We bridge it exactly the way the codebase already bridges the PDF runtime/types divergence (the local `PDFDocument` / `CanvasKitWithPDF` interfaces in `src/skia/types.ts`): add a small local `MutablePath` interface that extends `Path` with the mutation methods our wasm actually exposes, and cast `new ck.Path()` to it.

## Context

- Files involved:
  - `src/skia/renderer.ts` — the crash site; `drawGraphics` builds the path
  - `src/skia/types.ts` — where local CanvasKit type bridges already live (`MutablePath` goes here)
  - `tests/skia/renderer.test.ts` — mocks `ck.PathBuilder` (SpyPathBuilder, lines 27/96/108) — must mock `ck.Path` instead
  - `tests/skia/pdf-exporter.test.ts` — mocks `ck.PathBuilder` (lines 89, 207, 219); the PDF exporter drives the same renderer, so these must move to `ck.Path`
  - `tests/app.test.ts` — line 268 comment references PathBuilder (comment-only update)
- Related patterns:
  - Local runtime/types bridge interfaces in `src/skia/types.ts` (`PDFMetadata`, `PDFDocument`, `CanvasKitWithPDF`)
  - `InputRect` type from `canvaskit-wasm` (used by `addRect`/`addOval`)
- Dependencies: none. No canvaskit rebuild, no new packages.

## Development Approach

- **Testing approach**: Regular (code first, then tests) — this is a mechanical refactor of existing covered code; update each test mock alongside its change.
- Complete each task fully before moving to the next.
- **CRITICAL: every task includes updated tests.**
- **CRITICAL: all tests must pass (`npm test`) before starting the next task.**
- Also gate on `npm run typecheck` since the whole point is runtime/type alignment.

## Implementation Steps

### Task 1: Bridge type + switch renderer from PathBuilder to Path

**Files:**
- Modify: `src/skia/types.ts`
- Modify: `src/skia/renderer.ts`
- Modify: `tests/skia/renderer.test.ts`

- [ ] In `src/skia/types.ts`, add and export a `MutablePath` interface extending `Path` with the mutation methods our m120 wasm exposes: `moveTo(x,y)`, `lineTo(x,y)`, `addRect(rect: InputRect)`, `addOval(oval: InputRect)`, `addCircle(x,y,r)`, `close()` (import `InputRect` from `canvaskit-wasm`)
- [ ] In `src/skia/renderer.ts`: drop the `PathBuilder` import; import `Path`/`MutablePath` (and `InputRect` if needed) from the local types / `canvaskit-wasm`
- [ ] In `drawGraphics`: rename `builder` → `path` typed `MutablePath | null`; `ensureBuilder` → `ensurePath` creating `new ck.Path() as MutablePath`; keep the `hasGeometry` flag
- [ ] In `flush`: draw the `path` object directly into `canvas.drawPath(path, fillPaint/strokePaint)` (remove the `builder.detach()` step), then `path.delete()` and reset `path = null`; update the `finally` cleanup from `(builder as PathBuilder | null)?.delete()` to `path?.delete()`
- [ ] Update `tests/skia/renderer.test.ts`: rename `SpyPathBuilder`→`SpyPath`/`builders`→`paths` mock infrastructure, register the ctor as `ck.Path` (not `ck.PathBuilder`), drop `detach`, make `drawPath` receive the path spy directly, and fix assertions that used `detach`/`_builderId` (multi-shape test compares distinct path instances instead)
- [ ] run `npm test` — must pass
- [ ] run `npm run typecheck` — must pass (proves the runtime/types gap is closed)

### Task 2: Update downstream test mocks (PDF exporter + app)

**Files:**
- Modify: `tests/skia/pdf-exporter.test.ts`
- Modify: `tests/app.test.ts`

- [ ] In `tests/skia/pdf-exporter.test.ts`: replace the `PathBuilderCtor` mock (lines ~89-100) with a `PathCtor` registered as `ck.Path` returning `{ moveTo, lineTo, addRect, addOval, addCircle, close, delete }` (no `detach`)
- [ ] Update the bare `PathBuilder: vi.fn()` stub (~line 207) and the "ThrowingPathBuilder" failure-mode stub (~line 219) to target `ck.Path` so rendering still constructs/throws as intended
- [ ] In `tests/app.test.ts`: update the line ~268 comment that mentions "PathBuilder constructors" to reference `Path`
- [ ] run `npm test` — must pass

### Task 3: Verify acceptance criteria

- [ ] run `npm test` (full suite) — all green
- [ ] run `npm run typecheck` — no errors
- [ ] run `npm run lint` — no new errors
- [ ] grep `src` + `tests` for any remaining `PathBuilder` reference — expect none
