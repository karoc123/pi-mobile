---
name: code-janitor
description: Validate code quality before handing off changes or when asked to check cleanliness in pi-mobile. Run scoped formatting, JavaScript lint, TypeScript checks, tested architecture/dependency policies and relevant tests without unrelated cleanup.
---

# Code Janitor

Read `AGENTS.md` and `docs/DEVELOPMENT.md`. Run commands from the repository root.

## Focused change gate

1. Review your changed files and run the affected tests.
2. Run `npm run check`: TypeScript checks, JavaScript lint, changed-file Prettier check, dependency/import policies and guardrail regressions.
3. Review the diff for unrelated changes or accidental functionality removal.

Fix failures without weakening rules. TypeScript ESLint and `svelte-check` are currently absent because their available releases/prereleases do not support this project's TypeScript 7. `tsc` does not typecheck Svelte component scripts or templates. Never describe the current gate as full Svelte lint/type coverage.

## Broad change gate

For dependency, API, SDK/runtime or core UI changes, also run:

```bash
npm test
npm run build
```

- UI/core flows: `npm run test:e2e` (mobile browser, mock agent).
- Deployment/runtime: `npm run verify:container` (separate disposable Compose project).
- Docs-only changes: check formatting of your changed docs; explain why code checks are not needed.

## Safe fixes and cleanup

- `npm run format` checks tracked changes against HEAD plus untracked files. Supply explicit paths to limit the scope. `npm run format:all` only checks the whole tracked tree; legacy formatting debt is not a reason for sweeping unrelated rewrites.
- Writes require explicit paths: `npm run format:fix -- <your-files>` and `npm run lint:fix -- <your-js-files>`.
- Never format, stage, revert or delete another session's changes.
- Create scratch fixtures with unique directories under `tmp/`; delete only your own artifacts. Do not clear shared test caches or run global Docker cleanup.
- No commits without a user request.

## Hand-off

List executed checks and outcomes, skipped checks with reasons, pre-existing failures and remaining risks. A missing service, browser binary or network is not a passing integration check.
