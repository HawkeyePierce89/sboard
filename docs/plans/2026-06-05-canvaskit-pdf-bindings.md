# CanvasKit PDF JS-binding patch (Skia m120 in Docker)

## Overview
Add the missing `MakePDFDocument` JavaScript binding to CanvasKit by patching Skia's `modules/canvaskit/canvaskit_bindings.cpp` (and, only if required, `modules/canvaskit/BUILD.gn`) at build time inside the existing Docker image. The patch is delivered as a committed git-diff (`docker/canvaskit-build/canvaskit-pdf-bindings.patch`) applied during `docker build`, so it survives image rebuilds and is not tied to a specific checkout. The TypeScript side already targets this API and needs no functional change; only now-stale "not supported" doc comments get corrected.

## Context
- Files involved:
  - Create: `docker/canvaskit-build/canvaskit-pdf-bindings.patch` (git-diff against Skia sources)
  - Modify: `docker/canvaskit-build/Dockerfile` (COPY patch + `git apply`)
  - Modify: `docker/canvaskit-build/build.sh` (remove the "Task 8a not done" SCOPE NOTE)
  - Modify: `docker/canvaskit-build/README.md` (update current-state / ⚠️ notes)
  - Modify: `src/skia/pdf-exporter.ts`, `src/skia/types.ts` (correct stale "no build exposes MakePDFDocument" comments — no functional/API change)
  - Unchanged (functional): `src/skia/pdf-exporter.ts` flow, `tests/skia/pdf-exporter.test.ts`
- Related patterns:
  - Existing build flags live in `build.sh` (`skia_enable_pdf=true` already set)
  - Integration smoke test in `tests/skia/pdf-exporter.test.ts` already auto-exercises the real PDF branch once a PDF-enabled `canvaskit.js` is bundled (no test rewrite needed)
- Dependencies: Docker; Skia `chrome/m120` (pinned via `ARG SKIA_REF` in the Dockerfile); skia.googlesource.com to fetch exact pinned sources for an accurate diff.

## Key design decision (correction to the provided snippet)
The provided `getOutput()` builds a `typed_memory_view` over `sk_sp<SkData> data` declared as a **local** — that buffer is freed when `getOutput()` returns, leaving JS a dangling view. Fix: store the detached `SkData` as a member (`sk_sp<SkData> fData`) so it lives as long as the `JsPDFDocument`. The view stays a `Uint8Array`, `exportToPDF()` copies it synchronously into a `Blob`, and `getOutput(): Uint8Array` in `types.ts` stays correct — so no TS API change and no `register_vector`.

## Development Approach
- **Testing approach**: Regular (code first, then tests). The TS-side tests already exist and must keep passing; the C++/Docker artifacts are validated via `git apply --check` and Dockerfile parse checks since the actual WASM rebuild is a manual ~30-60 min step (Post-Completion).
- Complete each task fully before moving to the next.
- **CRITICAL: every task that changes code/config must keep the existing test suite green.**
- **CRITICAL: all tests must pass before starting the next task.**

## Implementation Steps

### Task 1: Fetch pinned m120 sources and resolve the GN PDF target

**Files:** none committed (scratch only)

- [ ] Fetch `modules/canvaskit/canvaskit_bindings.cpp` and `modules/canvaskit/BUILD.gn` from skia.googlesource.com at `chrome/m120` into a scratch dir (e.g. `/tmp/skia-m120/`) via raw download
- [ ] Locate the `EMSCRIPTEN_BINDINGS(Skia)` block and a stable insertion anchor in `canvaskit_bindings.cpp`; note exact context lines for the diff
- [ ] Grep the fetched `BUILD.gn` (and reference the top-level Skia `BUILD.gn` layout) to determine whether `SkPDF::MakeDocument` is folded into the existing `../../:skia` dep (m120 typically compiles `src/pdf` into the core target when `skia_enable_pdf=true`) or requires an explicit `deps += [ "../../:pdf" ]` — record the verdict to decide if the patch touches `BUILD.gn` at all
- [ ] write a short note of findings into the patch header comment (anchor + GN verdict) for reviewer traceability

### Task 2: Author `canvaskit-pdf-bindings.patch`

**Files:** Create `docker/canvaskit-build/canvaskit-pdf-bindings.patch`

- [ ] Diff hunk 1 (headers): add `#include "include/docs/SkPDFDocument.h"` and `#include "include/core/SkStream.h"`
- [ ] Diff hunk 2 (wrapper): add `class JsPDFDocument` with `SkDynamicMemoryWStream fStream`, `std::unique_ptr<SkDocument> fDoc`, **and `sk_sp<SkData> fData` member**; `getOutput()` does `fData = fStream.detachAsData();` then returns a `typed_memory_view` over `fData->data()/size()` (keeps buffer alive → `Uint8Array`)
- [ ] Diff hunk 3 (bindings): inside `EMSCRIPTEN_BINDINGS(Skia)`, add `class_<JsPDFDocument>("PDFDocument")` with `beginPage/endPage/close/getOutput` and the `MakePDFDocument` `optional_override` reading the metadata `emscripten::val` fields
- [ ] Diff hunk 4 (GN, conditional): add `deps += [ "../../:pdf" ]` to the canvaskit target **only if** Task 1 proved a separate PDF target exists; otherwise omit this hunk
- [ ] Verify the patch applies: in the scratch m120 checkout/copy run `git apply --check docker/canvaskit-build/canvaskit-pdf-bindings.patch` — must succeed with no fuzz failures

### Task 3: Wire the patch into the Docker build

**Files:** Modify `docker/canvaskit-build/Dockerfile`

- [ ] After the `git clone ... skia.git` step (WORKDIR `/workspace/skia`), add `COPY canvaskit-pdf-bindings.patch /workspace/canvaskit-pdf-bindings.patch` and `RUN git apply /workspace/canvaskit-pdf-bindings.patch` (before `COPY build.sh` / the ENTRYPOINT build)
- [ ] Confirm ordering relative to `tools/git-sync-deps` (deps sync does not touch these two files, so applying right after clone is safe and deterministic)
- [ ] verify the Dockerfile still lints/parses (e.g. `docker build` syntax check or `hadolint` if available; otherwise a no-op build-arg dry check)

### Task 4: Correct now-stale documentation and code comments

**Files:** Modify `docker/canvaskit-build/build.sh`, `docker/canvaskit-build/README.md`, `src/skia/pdf-exporter.ts`, `src/skia/types.ts`

- [ ] Remove/replace the `build.sh` "SCOPE NOTE" that says the JS binding is not added (it now is, via the patch)
- [ ] Update `README.md` ⚠️ notes and "Current state" section to state the patch now exports `MakePDFDocument`, and document `canvaskit-pdf-bindings.patch` (purpose + how `git apply` runs in the Dockerfile)
- [ ] Update the `hasPDFSupport` docstring and `PDFExportNotSupportedError` message in `pdf-exporter.ts`, and the comments in `types.ts`, so they no longer claim "no build exposes" the binding (keep behavior: still throws if a stock/unpatched build is loaded)
- [ ] run `npm test` — existing pdf-exporter suite (incl. the soft-skip integration smoke) must still pass unchanged
- [ ] run `npm run typecheck` and `npm run lint` — must pass

### Task 5: Verify acceptance criteria (automatable portion)

- [ ] run full test suite `npm test` — all pass
- [ ] run `npm run lint` and `npm run typecheck` — clean
- [ ] re-run `git apply --check` of the patch against a freshly fetched m120 copy to confirm it is not order/context fragile

## Post-Completion

*Manual / external — requires the ~30–60 min Docker rebuild and a human, no checkboxes:*

- `npm run build:canvaskit` (rebuild image with the patch + compile WASM)
- `grep -c "MakePDFDocument" public/canvaskit/canvaskit.js` → expect > 0
- `npm test -- pdf-exporter` now drives the real PDF branch (integration smoke produces a `%PDF-` blob instead of soft-skipping)
- `npm run dev` → Export button downloads a file; open in Preview/Acrobat, zoom — lines stay crisp (vector, not raster)
- Commit the regenerated `public/canvaskit/canvaskit.{js,wasm}` artifacts
- Watch wasm size (+~200–400 KB for SkPDF + zlib deflate is expected/acceptable)
