# Node 20 deprecation warning — bump actions + runtime in deploy.yml

## Overview
GitHub Actions emits a Node 20 deprecation warning. Bump the pinned action versions and the Node runtime in the single CI workflow to clear the warning and move to Node 22 LTS.

## Context
- Files involved: `.github/workflows/deploy.yml` (only file referencing these actions / node version)
- Related patterns: GitHub Actions workflow with pinned `uses:` major-version tags
- Dependencies: `README.md` (Prerequisites section) also states the Node version and must be kept in sync; no `.nvmrc` or `package.json` `engines` field exists
- Also-on-Node-20 actions that must be bumped to clear the warning (verified via each action's `action.yml` `runs.using`): `actions/configure-pages@v5` → `@v6` (line 49), `actions/upload-pages-artifact@v3` → `@v5` (line 52), `actions/deploy-pages@v4` → `@v5` (line 66) — all targets run on `node24`

## Development Approach
- **Testing approach**: Regular — this is a CI config change with no application code, so there are no unit tests to add; verification is YAML well-formedness plus the workflow running green on GitHub
- Complete the single task fully before considering the change done
- Keep the diff minimal: only the action/runtime version lines below change

## Implementation Steps

### Task 1: Bump action versions and Node runtime

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [x] update `actions/checkout@v4` → `@v5` (line 25)
- [x] update `actions/setup-node@v4` → `@v5` (line 28)
- [x] update `node-version: '20'` → `'22'` (line 30)
- [x] update `actions/configure-pages@v5` → `@v6` (line 49)
- [x] update `actions/upload-pages-artifact@v3` → `@v5` (line 52)
- [x] update `actions/deploy-pages@v4` → `@v5` (line 66)
- [x] update `README.md` Prerequisites Node version to match (Node 22)
- [x] validate YAML is still well-formed (e.g. `npx --yes yaml-lint .github/workflows/deploy.yml` or equivalent)

### Task 2: Verify acceptance criteria

- [x] confirm `git diff .github/workflows/deploy.yml` shows exactly the intended action/runtime version changes and nothing else
- [x] confirm no action in the workflow still runs on the Node 20 runtime (`@v4` checkout/setup-node, configure-pages `@v5`, upload-pages-artifact `@v3`, deploy-pages `@v4`) and no `node-version: '20'`

## Post-Completion (manual / external)
- Push to `master` (or trigger `workflow_dispatch`) and confirm the deploy workflow runs green on Node 22 with no Node 20 deprecation warning
