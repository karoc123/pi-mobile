# AGENTS Playbook: PiMobile Agent Server

## Default Plan (How To Approach Any Task)

1. Confirm scope and delivery order.
2. Read relevant files before editing.
3. Implement smallest coherent slice first (e.g., Backend API route/contract, then Frontend UI/Svelte component wiring).
4. Validate immediately with focused commands (run tests, check Docker logs).
5. Update documentation whenever architecture, API contracts, or core workflows change.
6. Ask questions early if there is any uncertainty about scope, mobile layout constraints, or Git safety mechanics.

## Repository Facts

- **Workspace Documentation**:
  - `docs/VISION.md`
  - `docs/ARCHITECTURE.md`
  - `CONTEXT.md`
- **Monorepo Architecture**:
  - Combined Node.js/TypeScript stack.
  - `src/backend/` — Express server, WebSocket hub, and Git/Filesystem orchestration.
  - `src/frontend/` — Mobile-first web interface (Svelte 5 Runes).
  - Model usage counts for the model palette are stored in `model-usage.json` (`/data/db` in the container, otherwise `WORKSPACE_ROOT/.pi-mobile/`). There is no cost history.

### High-Value Commands

- **Code Quality Gates**: `npm run check` (Runs TypeScript check, `svelte-check`, ESLint, full-tree formatting check, dependency check, and guardrail tests)
- **Local Development Mode**: `npm run dev` (Starts backend server with live reload and frontend asset watch)
- **Production Build**: `npm run build` (Compiles TypeScript and bundles static frontend assets into `dist/`)
- **Run Unit Tests**: `npm test` (Runs Vitest test suite)
- **Run E2E Tests**: `npm run test:e2e` (Runs Playwright test suite using `PI_TEST_PROVIDER=1`)
- **Start Production Server**: `node dist/backend/index.js`
- **Docker Stack**: `docker compose up --build`
- **Container Verification**: `npm run verify:container`

---

## Development Guardrails: Clean Code & Architecture

All contributions must adhere to principles that ensure the system remains extremely lightweight, secure, and resilient for the Raspberry Pi environment.

### 1. Core Principles & State Architecture

- **Svelte 5 Runes Exclusively**: Zero legacy Svelte syntax allowed (`createEventDispatcher`, `export let`, `$:` or `on:`). All components must use `$state`, `$derived`, `$effect`, `$props`, snippet/callback props (`onsubmit`, `onclick`, etc.), and scoped `<style>` blocks.
- **TypeScript 6.0.x Pin**: TypeScript is pinned to `~6.0.2` to guarantee complete compatibility and strict type safety across `svelte-check`, `typescript-eslint`, and `eslint-plugin-svelte` without version divergence.
- **Test Isolation & Gates**: Agent tests must set isolated `piAgentDir` and `piSessionDir`. E2E starts its own server without `.env` loading or server reuse. The Svelte compiler enforces Runes; warnings fail typecheck. `npm run check` checks formatting across the tracked tree and new files.
- **Stateless & Git Single Source of Truth**: The local filesystem and Git tree are the absolute Single Source of Truth. Avoid heavy databases or persistent sync state; use simple memory states or HTTP-only cookies for password sessions.
- **Agent Snapshot Push (No Polling)**: The server pushes a full `snapshot` WebSocket envelope upon client connection and after any session mutation (repo selection, new session, resume, fork, tree, compaction, bash execution). Clients update state reactively via snapshot and real-time delta envelopes; no polling loops.
- **Clean Lifecycle & Auth Gate**: The root `App.svelte` acts as an authentication gate. Unmounting the `Workspace` component automatically disposes WebSocket connections and resets active editor state.
- **Deterministic Test Provider**: Setting `PI_TEST_PROVIDER=1` registers an in-process faux provider within the Pi agent runtime for fast, deterministic unit and Playwright E2E testing without external network calls or API keys.
- **DRY (Don't Repeat Yourself)**: Centralize WebSocket event schemas and API responses in `src/shared/contracts.ts`. Share TypeScript interfaces between backend routes and frontend components.
- **SOLID & Separation of Concerns**: Keep Git/Process logic completely decoupled from HTTP routing. Express controllers delegate directly to `GitService`, `FileService`, or `PiAgentService`.
- **YAGNI (You Ain't Gonna Need It)**: Do not implement multi-tenant setups or cloud sync. This tool is built strictly as a personal, password-secured, single-user mobile studio.

### 2. Mobile-First Web UI & UX

- **Thumb-Zone Layout**: All primary destructive and affirmative interactions (e.g., **[ Commit ]**, **[ Revert ]**, Sending Prompts) must be positioned in a bottom-anchored, thumb-accessible layout.
- **Scoped Styles & Global Primitives**: `styles.css` is reserved strictly for design tokens, base typography, global resets, and universal primitives (buttons, inputs, notices). All view- and component-specific styling must be scoped within component `<style>` blocks.
- **Viewport Protection**: Code fragments, Markdown outputs, and Diffs must handle text wrapping or scrolling gracefully. Never break the horizontal mobile viewport constraint; use fullscreen code overlays or collapsible accordions instead.
- **Unified Diff Layout**: Always force `line-by-line` layout formatting for diffs using `diff2html`. Side-by-side layouts are unusable on smartphone viewports.
- **Touch & Keyboard Optimization**: The integrated editor component using **CodeMirror 6** must maintain seamless virtual keyboard hooks and touch selection behaviors without breaking mobile browser scrolling gestures.

### 3. TypeScript / Node.js Backend

- **Type Safety**: Enforce strict TypeScript types across all API payloads, Git hunk extractions, and WebSocket messages.
- **Resource Preservation**: Minimize CPU spikes on the Raspberry Pi. Use streaming techniques for long-running agent or process outputs. Keep filesystem watching (`chokidar`) targeted and exclude `node_modules` or `.git` folders.
- **Fail-Safe Process Execution**: When spawning sub-processes, always ensure robust standard error (`stderr`) handling, proper exit-code capture, and automated child-process cleanup to prevent zombie tasks.

### 4. Security Gate & Contracts

- **Password Gate**: Every REST route (except public health, login, and session checks) and WebSocket connection upgrade _must_ be protected by the `APP_PASSWORD` session-validation middleware. No data should leak if an unauthenticated request occurs.
- **WebSocket Schema**: Follow a strict payload pattern for real-time messaging: `{ "type": string, "payload": object }` (e.g., `{ "type": "snapshot", "payload": { ... } }`).
- **Atomic Operations**: File modifications via the raw file transport or hunk mutations must execute instantly and safely. If a reverse-patch fails, the system must gracefully reject the operation and report the Git error without corrupting the file state.

## Known Pitfalls

- **Mobile Input Lag**: Heavy rendering of massive unified diff trees can freeze mobile web views. Always use lazy rendering, virtualization, or accordion structures to keep the DOM light.

## Style Instructions

- **Naming Conventions**: Use crisp, domain-driven terminology matching the spec (e.g., `HunkPayload`, `AgentSession`, `GitService`).
- **Comments**: Write self-documenting code. Use comments exclusively to document _Why_ a complex regular expression or Git binary pipeline pipe was introduced, not _What_ the syntax does.

## Definition of Done

- Feature completely satisfies the mobile-first UX goals (thumb-reachable targets, tight viewports).
- Zero legacy Svelte syntax; 100% Svelte 5 Runes.
- Secure password boundaries are active and verified across all newly introduced routes.
- Quality gates pass: `npm run check` (0 errors, 0 warnings), `npm test`, `npm run build`, and `npm run test:e2e`.
- Documentation (`ARCHITECTURE.md`, `CONTEXT.md`, `AGENTS.md`) is updated to reflect any technical pivot.
- Hand-off report includes a short summary of implemented logic and remaining risks.
