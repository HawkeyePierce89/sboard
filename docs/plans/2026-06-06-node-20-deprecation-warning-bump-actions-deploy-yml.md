# Node 20 deprecation warning — bump actions + runtime in deploy.yml

## Overview
GitHub Actions emits a Node 20 deprecation warning. Bump the pinned action versions and the Node runtime in the single CI workflow to clear the warning and move to Node 22 LTS.

## Context
- Files involved: `.github/workflows/deploy.yml` (only file referencing these actions / node version)
- Related patterns: GitHub Actions workflow with pinned `uses:` major-version tags
- Dependencies: none — no `.nvmrc` or `package.json` `engines` field exists, so no other version pins need syncing
- Already-latest actions to leave untouched: `actions/configure-pages@v5` (line 49), `actions/upload-pages-artifact@v3` (line 52), `actions/deploy-pages@v4` (line 66)

## Development Approach
- **Testing approach**: Regular — this is a CI config change with no application code, so there are no unit tests to add; verification is YAML well-formedness plus the workflow running green on GitHub
- Complete the single task fully before considering the change done
- Keep the diff minimal: only the three lines below change

## Implementation Steps

### Task 1: Bump action versions and Node runtime

**Files:**
- Modify: `.github/workflows/deploy.yml`

- [ ] update `actions/checkout@v4` → `@v5` (line 25)
- [ ] update `actions/setup-node@v4` → `@v5` (line 28)
- [ ] update `node-version: '20'` → `'22'` (line 30)
- [ ] confirm `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4` are left unchanged
- [ ] validate YAML is still well-formed (e.g. `npx --yes yaml-lint .github/workflows/deploy.yml` or equivalent)

### Task 2: Verify acceptance criteria

- [ ] confirm `git diff .github/workflows/deploy.yml` shows exactly the three intended line changes and nothing else
- [ ] confirm no remaining references to `@v4` for checkout/setup-node or `node-version: '20'` in the workflow

## Post-Completion (manual / external)
- Push to `master` (or trigger `workflow_dispatch`) and confirm the deploy workflow runs green on Node 22 with no Node 20 deprecation warning
