# Fix npm run build:canvaskit: propagate vendored zlib and drive the whole command to completion

## Overview

The CanvasKit build (WASM, Skia PDF backend) currently fails compiling `freetype/src/gzip/ftgzip.c`: the unit is compiled with `-DFT_CONFIG_OPTION_USE_ZLIB -DFT_CONFIG_OPTION_SYSTEM_ZLIB`, but none of the `-isystem` paths point to the vendored zlib directory (Skia keeps it in `third_party/externals/zlib`; in the m120 branch the `freetype2/BUILD.gn` rule does not propagate that include into the gzip unit's compile command; under wasm there is no system zlib in the emscripten sysroot). The base fix is to add the zlib include path via `extra_cflags_c` in the gn args in `docker/canvaskit-build/build.sh`.

But `npm run build:canvaskit` is a whole pipeline (host wrapper -> docker build -> git-sync-deps -> gn gen -> ninja -> artifact copy), and it can fail at any stage. So the goal of this plan is not "fix the single ftgzip error" but to drive the ENTIRE command to full successful completion (exit code 0, artifacts `canvaskit.js` + `canvaskit.wasm` in `public/canvaskit/`), resolving any error at any stage as it appears — not only ninja compile errors.

## Context

- Files involved:
  - `package.json` — the `build:canvaskit` script -> `bash scripts/build-canvaskit.sh`
  - `scripts/build-canvaskit.sh` — host wrapper: docker check, `docker build`, `docker run -v public/canvaskit:/out`, artifact listing; `set -euo pipefail`
  - `docker/canvaskit-build/Dockerfile` — emscripten/emsdk:3.1.56, depot_tools, `git clone -b chrome/m120 skia`, `python3 tools/git-sync-deps`
  - `docker/canvaskit-build/build.sh` — main edit: `bin/gn gen out/canvaskit --args='...'` + `ninja -C out/canvaskit canvaskit` + artifact `cp`; `set -euo pipefail`
  - Current gn args: `is_official_build=true`, `skia_enable_pdf=true`, `skia_use_freetype=true`, `skia_use_harfbuzz=false`, `skia_enable_skshaper=false`, `skia_enable_paragraph=false`, `skia_use_zlib=true`, `skia_use_libpng_decode=true`, `skia_use_libjpeg_turbo_decode=false`, `target_cpu="wasm"`, cc/cxx/ar=emcc/em++/emar
- Related patterns:
  - Approved approach (from Q&A): point fix via `extra_cflags_c`, freetype stays, nothing is stripped
  - Pipeline stages where errors are possible (debugging map):
    1. host wrapper (`scripts/build-canvaskit.sh`): docker not running / not on PATH, no write permission on `public/canvaskit`
    2. docker build (`Dockerfile`): network/apt, depot_tools clone, skia clone (chrome/m120), git-sync-deps (DEPS hooks, network)
    3. gn gen (`build.sh`): syntax/invalid args, missing toolchain binaries
    4. ninja compile/link: missing include / define / wasm-incompatible flag / unresolved symbol (current failure stage — ftgzip.c)
    5. artifact copy (`build.sh` `cp`): target files not produced by the previous stage
- Dependencies: running Docker daemon; full cold build ~30-60 min

## Development Approach

- **Testing approach**: Regular — these are infrastructure build-script edits, there are no unit tests; each task's "test" = actually running the corresponding stage / the whole command and checking output and artifacts
- Complete each task fully before moving to the next
- General debugging loop (applies to ANY stage, not just ninja): run the command -> catch the FIRST error -> identify the stage (host / docker build / git-sync-deps / gn gen / ninja / copy) -> identify the cause -> make a minimal point edit to the relevant file (`scripts/build-canvaskit.sh`, `Dockerfile`, or `build.sh`) -> repeat until it passes. Since `set -euo pipefail` is set in both the wrapper and `build.sh`, any non-zero command stops the pipeline — catch that, not only `ninja: build stopped`
- **CRITICAL**: a task counts as done only if the corresponding run actually reached its success criterion
- Iteration-speed note: each `docker run` does gn gen + ninja from scratch (there is no persistent `out/` volume, only `/out` is mounted for artifacts). To avoid waiting for a full rebuild on every debug iteration, during debugging it is acceptable to run stages manually inside a throwaway container (`docker run --rm -it --entrypoint bash canvaskit-pdf:latest`) and/or temporarily mount a cache volume for `out/canvaskit` for incremental ninja. This is a helper measure and may be excluded from the final commit

## Implementation Steps

### Task 1: Propagate the vendored zlib include into gn args

**Files:**
- Modify: `docker/canvaskit-build/build.sh`

- [x] Add the line to the gn args block: `extra_cflags_c=["-isystem", "/workspace/skia/third_party/externals/zlib"]`
- [x] Start a throwaway container from the `canvaskit-pdf:latest` image (`docker run --rm -it --entrypoint bash`) and verify that `third_party/externals/zlib/zlib.h` exists after git-sync-deps (verified: zlib.h present, 96750 bytes)
- [x] In that same container, run only `bin/gn gen out/canvaskit --args='...'` with the new line and confirm gen passes without args parsing errors (the string array is valid, no trailing-comma error) (verified: gen done, 108 targets, no parse error; only a pre-existing no-op warning on skia_enable_paragraph)
- [x] Compile only the offending unit (`ninja -C out/canvaskit obj/third_party/externals/freetype/src/gzip/libfreetype2.ftgzip.o`) and confirm the `'zlib.h' file not found` error is gone (verified: ftgzip.c compiled OK)

### Task 2: Run the whole command and resolve errors at any stage until full completion

**Files:**
- Modify: `docker/canvaskit-build/build.sh` (gn args / command order edits for gn gen, ninja, copy stage errors)
- Modify: `docker/canvaskit-build/Dockerfile` (edits for docker build / git-sync-deps stage errors — apt packages, ref, deps)
- Modify: `scripts/build-canvaskit.sh` (edits for host-stage errors — docker run flags, paths, permissions)

- [x] Run the full command end-to-end: `npm run build:canvaskit` (includes docker build + docker run) (ran to exit 0; iterated through 6 runs resolving each first error)
- [x] On a stop, catch the FIRST error and classify the stage using the map from Context (host / docker build / git-sync-deps / gn gen / ninja compile-link / copy)
- [x] For a docker build or git-sync-deps stage error: make a minimal edit to the `Dockerfile` (not encountered — docker build + git-sync-deps stages passed; image layers cached, zlib/icu/etc. all present)
- [x] For a gn gen stage error: fix the args syntax/values or toolchain in `build.sh` (encountered "Need exactly one build directory" — moved the explanatory comment OUT of the `--args` string since inline `#` comments break gn arg parsing)
- [x] For a ninja stage error (compile/link): read the first FAILED target, identify the cause and make a minimal point edit to the gn args in `build.sh` (resolved in order: ftgzip.c/SkDeflate.cpp `'zlib.h' file not found` -> `extra_cflags` (C+C++) instead of `extra_cflags_c`; `unable to find library -lz` -> `skia_use_system_zlib=false` so Skia compiles vendored zlib; `skia::textlayout::*` undefined -> `skia_canvaskit_enable_paragraph=false`; `SkWebpEncoder::Encode` undefined -> `skia_use_no_webp_encode=true` (no-op stub); `SkShaper::*` undefined from libskottie -> `skia_enable_skshaper=true` (primitive shaper, harfbuzz off))
- [x] For an artifact copy stage error (`cp` in `build.sh`): confirm the ninja target actually produced `canvaskit.js`/`.wasm` (not encountered — `cp` succeeded; both files produced)
- [x] For a host-stage error (`scripts/build-canvaskit.sh`): fix the wrapper (not encountered — docker check, mount, OUT_DIR all worked)
- [x] Repeat the "run -> first error -> minimal edit to the right file" loop until the whole `npm run build:canvaskit` command runs without a single stop (final run: EXIT_CODE=0, no FAILED/ninja-stopped)
- [x] For each additional edit, leave a short justification comment next to the change (added grouped comments above the `bin/gn gen` call explaining zlib, paragraph, webp, skshaper, and the comment-out-of-args constraint)

### Task 3: Verify artifacts and integration

**Files:**
- Inspect: `public/canvaskit/` (build output)

- [ ] Confirm the container printed "CanvasKit build complete" and the host wrapper reached artifact listing without errors
- [ ] Check that `public/canvaskit/canvaskit.js` and `public/canvaskit/canvaskit.wasm` are created and non-zero size
- [ ] Sanity check: the first bytes of `canvaskit.wasm` are the `\0asm` signature; `canvaskit.js` is non-empty
- [ ] Run `npm test` to confirm the build-script edits did not break anything in the repository

### Task 4: Verify acceptance criteria

- [ ] Clean from-scratch run: `npm run build:canvaskit` finishes with exit code 0 from the first to the last command
- [ ] No stop at any stage: no "ninja: build stopped: subcommand failed", no failed docker build / git-sync-deps / gn gen / cp / host-wrapper steps
- [ ] Artifacts present in `public/canvaskit/` (both files, non-zero)
- [ ] `npm test` passes

### Task 5: Update documentation

- [ ] Add a short comment in `docker/canvaskit-build/build.sh` next to `extra_cflags_c` explaining why the zlib include is needed (the propagation bug in the m120 branch's `freetype2/BUILD.gn`)
- [ ] If Task 2 required additional edits to `build.sh` / `Dockerfile` / `scripts/build-canvaskit.sh` — capture their reasons in comments next to the changes
- [ ] Update README/CLAUDE.md on the canvaskit build process if needed (if the step order changed or new requirements appeared)
