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
  - docs/VISION.md
  - docs/ARCHITECTURE.md
- **Monorepo Architecture**:
  - Combined Node.js/TypeScript stack.
  - `src/backend/` — Express server, WebSocket management, and Git/Filesystem orchestration.
  - `src/frontend/` — Mobile-first web interface (Svelte).

### High-Value Commands

- **Local Development Mode**: `npm run dev` (Starts backend server with live reload and frontend asset watch)
- **Production Build**: `npm run build` (Compiles TypeScript and bundles static frontend assets into `dist/`)
- **Start Production Server**: `node dist/index.js`
- **Docker Stack**: `docker compose up --build`
- **Run Test Suite**: `npm test`

---

## Development Guardrails: Clean Code & Architecture

All contributions must adhere to principles that ensure the system remains extremely lightweight, secure, and resilient for the Raspberry Pi environment.

### 1. Core Principles

- **KISS (Keep It Simple, Stupid)**: Stick to a stateless approach regarding Git repositories. The local filesystem/Git tree is the absolute Single Source of Truth. Avoid heavy databases or complex persistent stores; use simple memory states or HTTP-only cookies for the password session.
- **DRY (Don't Repeat Yourself)**: Centralize WebSocket event schemas and API responses. Share TypeScript interfaces between backend routes and frontend components.
- **SOLID & Separation of Concerns**: Keep the Git/Process logic completely decoupled from the HTTP routing. The Express controllers should only handle requests and session checks, delegation goes to `GitService` or `FileService`.
- **YAGNI (You Ain't Gonna Need It)**: Do not implement complex user management, cloud sync, or multi-tenant setups. This tool is built strictly as a personal, password-secured, single-user mobile studio.

### 2. Mobile-First Web UI & UX

- **Thumb-Zone Layout**: All primary destructive and affirmative interactions (e.g., **[ Commit ]**, **[ Revert ]**, Sending Prompts) must be positioned in a bottom-anchored, thumb-accessible layout.
- **Viewport Protection**: Code fragments, Markdown outputs, and Diffs must handle text wrapping or scrolling gracefully. Never break the horizontal mobile viewport constraint; use fullscreen code overlays or collapsible accordions instead.
- **Unified Diff Layout**: Always force `line-by-line` layout formatting for diffs using `diff2html`. Side-by-side layouts are unusable on smartphone viewports.
- **Touch & Keyboard Optimization**: The integrated editor component using **CodeMirror 6** must maintain seamless virtual keyboard hooks and touch selection behaviors without breaking mobile browser scrolling gestures.

### 3. TypeScript / Node.js Backend

- **Type Safety**: Enforce strict TypeScript types across all API payloads, Git hunk extractions, and WebSocket messages.
- **Ressource Preservation**: Minimize CPU spikes on the Raspberry Pi. Use streaming techniques for long-running agent or process outputs. Keep filesystem watching (`chokidar`) targeted and exclude `node_modules` or `.git` folders.
- **Fail-Safe Process Execution**: When spawning sub-processes (like `pi --json-stream`), always ensure robust standard error (`stderr`) handling, proper exit-code capture, and automated child-process cleanup to prevent zombie tasks.

### 4. Security Gate & Contracts

- **Password Gate**: Every single REST route and WebSocket connection upgrade _must_ be protected by the `APP_PASSWORD` session-validation middleware. No data should leak if an unauthenticated request occurs.
- **WebSocket Schema**: Follow a strict payload pattern for real-time messaging: `{ "type": string, "payload": object }` (e.g., `{ "type": "thinking_delta", "payload": { "text": "..." } }`).
- **Atomic Operations**: File modifications via the editor or hunk-reverting must execute instantly and safely. If a reverse-patch fails, the system must gracefully reject the operation and report the Git error without corrupting the file state.

## Known Pitfalls

- **Mobile Input Lag**: Heavy rendering of massive unified diff trees can freeze mobile web views. Always use lazy rendering, virtualization, or accordion structures to keep the DOM light.

## Style Instructions

- **Minimal Diffs**: Prefer targeted, clean updates. Refrain from massive refactoring loops unless specifically prompted.
- **Naming Conventions**: Use crisp, domain-driven terminology matching the spec (e.g., `HunkPayload`, `AgentSession`, `RevertService`).
- **Comments**: Write self-documenting code. Use comments exclusively to document _Why_ a complex regular expression or Git binary pipeline pipe was introduced, not _What_ the syntax does.

## Definition of Done

- Feature completely satisfies the mobile-first UX goals (thumb-reachable targets, tight viewports).
- Secure password boundaries are active and verified across all newly introduced routes.
- Hunk-level reverting and CodeMirror save-states execute successfully against test repositories.
- Local tests pass, linting is green, and the `ARCHITECTURE.md` is updated to reflect any technical pivot.
- Hand-off report includes a short summary of implemented logic and remaining risks.
