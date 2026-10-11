# ARCHITECTURE.md — System and Software Architecture

## 1. System Overview

```text
+--------------------------------------------------------------+
| SMARTPHONE / WEAR OS CLIENT                                  |
|   Svelte 5 web app (Chat, Diff, Editor) | Wear OS app (subset) |
+-------------------------------+------------------------------+
                                | HTTP / WebSocket (port 3000)
                                v
+--------------------------------------------------------------+
| DOCKER CONTAINER `pi-mobile-server` (node:22-slim, git, ssh) |
|                                                              |
|  1. Security gate: APP_PASSWORD session cookie on /api + /ws |
|  2. Static frontend bundle (dist/public)                     |
|  3. Express backend                                          |
|     - PiAgentService -> in-process pi SDK AgentSession       |
|     - GitService, FileService, WorkspaceService              |
|     - WatcherService (chokidar), LogService, ModelUsageStore |
+-------------------------------+------------------------------+
                                | bind mounts / secret
                                v
   ./workspace -> /workspace    repositories
   ./db        -> /data/db      logs, known_hosts, model-usage.json
   ./pi        -> /data/pi      pi auth (agent/) and sessions/
   ssh_private_key secret -> /home/node/.ssh/id_ed25519
```

---

## 2. Component Architecture

### 2.1 Security & Authentication Layer

To secure filesystem access from mobile clients, an explicit authentication boundary is enforced.

- **Mechanism:** Simple Password-Only Authentication.
- **Implementation:** A lightweight, HTTP-only cookie-based session token system managed within the Express backend.
- **Configuration:** The master password is safe-guarded via environment variables (`APP_PASSWORD`) fed through Docker Compose or loaded from a local `.env` file during `npm start`.
- **Flow:** `GET /api/health`, `GET /api/auth/session` and `POST /api/auth/login` are public. A single middleware registered after them rejects every other `/api` request without a valid session with `401`, and the WebSocket upgrade performs the same check. The frontend then shows the login screen.

### 2.2 Frontend (Mobile-Optimized Svelte 5 Web App)

- **Technology:** Svelte 5 Runes exclusively (`$state`, `$derived`, `$effect`, `$props`, snippet/callback props), scoped CSS with two themes (`vscode-dark` and `vscode-light`), and centralized design tokens in `styles.css`.
- **Navigation:** A bottom navigation switches between three primary views; the app menu holds the repository picker, theme switch, log view and Pi login:
  1. **Chat:** Feeds interactions directly into the active `pi` execution process. Utilizes modular Markdown text parsing with responsive fullscreen viewports for generated code blocks. Embedded `<ToolCalls>` provides structured, collapsible tool inspections via native `<details>`.
  2. **Git Diff:** Uses `diff2html` in explicit `line-by-line` layout configuration. Hunk actions (`stage`, `unstage`, `revert`) route through a single consolidated endpoint `POST /api/git/hunk`. Header shows remote sync state (`↑ ahead`, `↓ behind`, or up-to-date) and commit counters.
  3. **Editor:** A touch-first text editing surface implemented with **CodeMirror 6** (dynamically loaded), ensuring fluid virtual keyboard integration, real-time syntax highlighting, and file actions powered by raw binary/text transport.
- **Native Elements:** Dialogs and bottom sheets use native `<dialog>` elements for accessible modal semantics without custom overlay wrappers.

### 2.3 Backend & Tool-Wrapper

Written in TypeScript running on Node.js, the backend acts as a high-fidelity router orchestrating the host environment, Git states, and the `pi` runtime.

- **`In-Container Agent Execution`:** The backend uses the official `@earendil-works/pi-coding-agent` (v1.0+) TypeScript SDK as the primary integration layer. A repository-bound `AgentSession` is created directly inside the Node.js process using `ModelRuntime` for model discovery, selection, and auth credential synchronization.
- **`Snapshot-Push WebSocket Architecture`:** The backend delivers initial state upon connection and after any session mutation via the `snapshot` envelope. Live deltas (`chat_message_delta`, `chat_message_updated`, `agent_status`) keep the client perfectly in sync without polling.
- **`GitService`:** Parses `git diff -U3` into structural JSON objects, making raw line offsets and hunk chunks readable for the frontend. Applies hunk staging, unstaging, and reverts via `git apply`.
- **`FileService`:** Executes raw text and binary file operations with streaming and atomic rename guarantees. Non-text files are recognized via NUL-byte inspection in the first 8 KB.
- **`WatcherService`:** Watches the selected repository with `chokidar` and broadcasts `workspace_changed` events. Internal runtime directories (`.pi-mobile`, `.pi`) and logs/session paths are ignored.
- **`ModelUsageStore`:** Counts accepted prompts per `provider/model` in a small JSON file (`model-usage.json`) and ranks the model palette by current model, usage count, availability and name.
- **`Test Provider`:** Setting `PI_TEST_PROVIDER=1` activates an in-process faux provider within `ModelRuntime` for fast, offline, deterministic unit and Playwright E2E testing.

### 2.4 Observability & Failure Diagnostics

- **Structured Log Service:** Backend emits leveled entries (`debug|info|warn|error`) with `source`, `event`, optional `repo`, and `requestId` metadata.
- **Dual Log Storage:** Logs are persisted to rotating files under `.pi-mobile/logs` while a bounded in-memory buffer powers fast UI retrieval.
- **Request Correlation:** Every HTTP response includes `x-request-id`; API failures return a structured error payload with the same request ID.
- **Live Log Streaming:** `GET /api/logs/stream` (SSE) pushes new backend events in real time, while `GET /api/logs` supports paged history queries.
- **Client Status Panel:** A tool-icon toggle in the app chrome shows/hides runtime status chips (WebSocket connection, backend health, log stream, resource access checks).

### 2.5 Wear OS Client

The companion Android application connects to this backend over the authenticated HTTP API and uses exactly these routes, which must stay compatible:

- `POST /api/auth/login`, `GET /api/auth/session`
- `GET /api/agent/state?minimal=true` (shared `AgentMinimalState` contract, including `usage.totalCost`)
- `POST /api/agent/prompt`, `POST /api/agent/abort`, `POST /api/agent/new-session`
- `GET /api/workspaces/browse`, `POST /api/workspaces/select`
- `POST /api/git/commit`

All API responses follow standard contracts: success payloads return JSON data or `{ ok: true }`, and error responses return `{ ok: false, error: { code, message, ... } }` accompanied by matching HTTP status codes.

---

## 3. Core Workflows & Technical Implementation

### 3.1 Direct File Editing & Raw Transport

File operations use direct HTTP transport without base64 serialization overhead:

1. **Viewing & Downloading**: The frontend accesses files via `GET /api/files/raw?path=...[&download=1]`. Images are previewed directly via `<img src>`, and downloads trigger native browser saving via `<a download>`.
2. **Saving**: The editor dispatches content updates to `PUT /api/files/raw?path=...`. The backend streams the payload into a temporary file and executes an atomic rename upon completion.
3. **Change Detection**: The filesystem watcher (`chokidar`) detects resulting filesystem events and broadcasts `{ "type": "workspace_changed", "payload": { ... } }`.
4. **Reactive Reloading**: Active views reload automatically upon receiving workspace change notifications.

### 3.2 Consolidated Hunk Actions (Stage, Unstage, Revert)

Hunk operations are unified into a single endpoint `POST /api/git/hunk`:

1. The frontend passes the unified diff text and desired action `{ diff, action: 'stage' | 'unstage' | 'revert' }`.
2. For reverts, the backend executes atomic reverse-patching:
   ```bash
   echo "<hunk-diff>" | git apply -R --recount --whitespace=nowarn -
   ```
3. For staging and unstaging, `git apply --cached` and `git apply --cached --reverse` are used respectively.
4. The operation broadcasts `workspace_changed`, and open views update seamlessly.

### 3.3 Structured Chat Tools

Tool execution traces are embedded directly in chat messages:

1. The backend hydrator transforms tool calls and execution results into structured `ChatToolCall` items on `ChatMessage.tools`.
2. Real-time updates during tool execution broadcast `chat_message_updated` envelopes.
3. The frontend `<ToolCalls>` component renders native `<details class="tool-inline-item">` blocks with status badges, icons, and formatted tool details.

### 3.4 Snapshot-Push Synchronization (Zero Polling)

To eliminate CPU-intensive polling on low-power devices:

1. When a client establishes a WebSocket connection, the backend immediately sends a full `snapshot` envelope containing all active messages, tools, usage, and runtime phase.
2. Any session-level reset (`new-session`, `resume`, `fork`, `tree`, `compact`, `bash`) triggers a fresh `snapshot` broadcast.
3. The frontend maintains its active conversation state purely from push envelopes, with zero HTTP polling during idle or active execution.

### 3.5 Clone-From-Picker Workflow

1. The user enters a remote URL (and optional destination path) in the picker.
2. The frontend calls `POST /api/workspaces/clone`.
3. The backend clones inside `WORKSPACE_ROOT`, validates the repository, and activates it via `activateRepo()`.
4. Watchers and agent session context are rebound to the newly cloned repository immediately.

---

## 4. Container Deployment & Environment Setup

### 4.1 Image & Entrypoint

`Dockerfile` uses a two-stage build:

- Build stage: Installs dependencies, builds frontend and backend, and prunes development packages.
- Runtime stage: Installs `git` and `openssh-client`, copies distribution bundles, and runs `docker/entrypoint.sh`.

The entrypoint initializes the environment before launching the server:

- Sets `core.sshCommand` with `UserKnownHostsFile=/data/db/known_hosts` and `StrictHostKeyChecking=accept-new`.
- Configures `safe.directory '*'`.
- Starts `ssh-agent` and loads the SSH key from `/home/node/.ssh/id_ed25519`.

### 4.2 Compose and Persistence

`docker-compose.yml` runs one service and persists state in three bind mounts:

| Host path     | Container path | Contents                                            |
| ------------- | -------------- | --------------------------------------------------- |
| `./workspace` | `/workspace`   | Repositories (`WORKSPACE_ROOT`)                     |
| `./db`        | `/data/db`     | Backend logs, SSH `known_hosts`, `model-usage.json` |
| `./pi`        | `/data/pi`     | Pi auth (`agent/`) and session files (`sessions/`)  |

The SSH private key is provided as a Compose secret. Outside Docker, logs and `model-usage.json` default to `WORKSPACE_ROOT/.pi-mobile/`.
