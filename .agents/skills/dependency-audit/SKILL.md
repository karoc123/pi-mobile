---
name: dependency-audit
description: Audit, add, review or update npm dependencies in pi-mobile. Check exact versions, security advisories, peer compatibility and SDK/framework migration risks before changing the lockfile.
---

# Dependency Audit and Updates

Run commands from the repository root. This is a single-package Svelte/Node project, not an npm-workspace monorepo.

## Inspect before changing

1. Read `AGENTS.md`, `package.json`, the relevant configuration and affected integration code. Check `git status --short`; do not overwrite another session's manifest or lockfile changes.
2. Run `npm run check:deps`, `npm audit` and `npm outdated`. An outdated/audit command may exit nonzero because it found issues; distinguish findings from registry/network failures.
3. Use `npm ls <package>` or `npm explain <package>` to identify the parent of vulnerable transitive dependencies.
4. Check release notes, Node engines and peer dependencies with `npm view <package>@<version> engines peerDependencies --json`. Pay special attention to Pi SDK APIs, Svelte/Vite, CodeMirror and TypeScript/tool compatibility. Do not guess external API types.
5. Separate patch/minor candidates from major migrations. Patch/minor does not guarantee compatibility. Ask for approval before an unrequested major migration or intentional functionality removal. Keep updates small and independently verifiable.

## Apply reviewed changes

- Direct dependencies and devDependencies use exact versions; `.npmrc` sets `save-exact=true`.
- Keep backend runtime imports in `dependencies`. Frontend-only packages can stay in `devDependencies` because Docker bundles them before pruning.
- Never automatically run `npm audit fix --force`, `npm install --force`, or `--legacy-peer-deps`. Do not downgrade application code or weaken checks to accommodate an incompatible tool.
- Refresh metadata without executing lifecycle scripts:
  ```bash
  npm install --package-lock-only --ignore-scripts
  git diff -- package.json package-lock.json
  ```
- Updating only the lockfile does not update `node_modules`. Before verification, use `npm ci --ignore-scripts` only when no other session relies on the shared installation. Otherwise coordinate first or verify in an isolated checkout. Review and explicitly approve any required install scripts separately.

## Verify

```bash
npm run check
npm test
npm run build
npm audit
```

Run `npm run test:e2e` for UI/core-workflow changes and `npm run verify:container` for SDK/runtime/deployment changes. The container smoke uses disposable credentials and isolated bind mounts, not the running personal stack. Review `AGENTS.md` for current tool coverage and limits.

`check:deps` checks exact versions, undeclared source imports (including Svelte), and backend runtime dependency placement. It does not audit vulnerabilities, detect unused packages, or inspect external packages' transitive import graphs.

## Hand-off

Report package/version changes and reasons, release-note/API adaptations, advisories remaining (including dev-only exposure), passing/failing/skipped checks and available major migrations with their concrete risks. Do not claim a clean audit or full Svelte type safety without evidence. Never commit without an explicit request; stage only your own explicit paths.
