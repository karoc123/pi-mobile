# ARCHITECTURE.md — System and Software Architecture

| | Persistent Volumes / Secrets v |
| | • `workspace` <=======> /workspace |
| | • `db` <=======> /data/db |
| | • `pi` <=======> /data/pi |
| | • `ssh_private_key` secret -> runtime `/home/node/.ssh/id_ed25519` |

+------------------------------------------------------------------------+
| SMARTPHONE / CLIENT |
| +------------------------------------------------------------------+ |
| | Web App (Mobile-First UI: Chat, Unified Diff, Text Editor) | |
| +------------------------------------------------------------------+ |
+----------------------------------|-------------------------------------+
| HTTP / WebSockets (Port 3000)
v
+------------------------------------------------------------------------+
| RASPBERRY PI (HOST) |
| +------------------------------------------------------------------+ |
| | Docker Bridge Network Listener | |
| +-------------------------------+----------------------------------+ |
| | |
| +-------------------------------+--------------------------------+ |
| | DOCKER CONTAINER (`pi-mobile-server`) | |
| | | |
| | +--------------------------------------------------------+ | |
| | | 1. Security Gate (Password Authentication Middleware) | | |
| | +---------------------------+----------------------------+ | |
| | | Access Granted | | |
| | v | |
| | +--------------------------------------------------------+ | |
| | | 2. Frontend Assets (Static HTML / JS / Tailwind) | | |
| | +--------------------------------------------------------+ | |
| | ^ | |
| | | REST / WebSockets | |
| | +---------------------------v----------------------------+ | |
| | | 3. Backend (Node.js Workspace Wrapper) | | |
| | | • Agent Runtime Instance (`pi` Core Engine) | | |
| | | • Git Service (Hunk Parser & Revert Pipeline) | | |
| | +---------------------------+----------------------------+ | |
| | | | | |
| | | Invokes natively in-container| | |
| | +---------------------------v----------------------------+ | |
| | | 4. Natively Installed `pi.dev` CLI Runtime | | |
| | +---------------------------+----------------------------+ | |
| +---|---------------------------|--------------------------------+ |
| | | Modifies workspaces directly |
| | Mapped Volumes v |
| | • `/workspace` <=======> /home/pi/projects/ |
| | • `/.pi` <=======> /home/pi/.pi/ (Auth Credentials) |
| | • `/.gitconfig` <=======> /home/pi/.gitconfig |
| | • `/.ssh` <=======> /home/pi/.ssh/ |
+------+-----------------------------------------------------------------+

---

## 2. Component Architecture

### 2.1 Security & Authentication Layer

To secure filesystem access from the mobile client, an explicit authentication boundary is enforced.

- **Mechanism:** Simple Password-Only Authentication.
- **Implementation:** A lightweight, HTTP-only cookie-based session token system managed within the Express backend.
- **Configuration:** The master password is safe-guarded via environment variables (`APP_PASSWORD`) fed through Docker Compose or loaded from a local `.env` file during `npm start`.
- **Flow:** Any unauthenticated requests to REST routes or WebSocket handshake upgrades are intercepted by an auth-middleware and redirected to a minimalist login screen.

### 2.2 Frontend (Mobile-Optimized Web App)

To minimize memory footprint and execution latency on the Raspberry Pi, the frontend drops heavy client-side builds.

- **Technology:** Svelte (compiled down to vanilla JS chunks).
- **Navigation:** Bottom-anchored navigation drawer featuring three unified thumb views:
  1. **Chat (`/chat`):** Feeds interactions directly into the active `pi` execution process. Utilizes modular Markdown text parsing with responsive fullscreen viewports for generated code blocks.
  2. **Git Diff (`/diff`):** Uses `diff2html` in explicit `line-by-line` layout configuration. Augmented with overlay action nodes for single-tap hunk manipulation (`stage`, `unstage`, `revert`) plus header-level `stage all` / `unstage all` / `pull` / `push` / `commit` actions. The header shows remote sync state (`↑ ahead`, `↓ behind`, or up-to-date) and commit counters.
  3. **Editor (`/editor`):** A touch-first text editing surface implemented with **CodeMirror 6**, ensuring fluid virtual keyboard integration, real-time syntax highlighting, and a hidden actions menu for file/folder creation plus file duplicate/rename/move/delete operations.

### 2.3 Backend & Tool-Wrapper

Written in TypeScript running on Node.js, the backend acts as a high-fidelity router orchestrating the host environment, Git states, and the `pi` runtime.

- **`In-Container Agent Execution`:** The backend uses the official `@earendil-works/pi-coding-agent` TypeScript SDK as the primary integration layer. A repository-bound `AgentSession` is created directly inside the Node.js process, while Pi auth/model/session data persists inside the dedicated `pi` Docker volume. CLI JSON/RPC modes remain possible fallbacks, but are not the primary kickoff integration.
- **`GitService`:** Parses the standard stream of `git diff -U3` into structural JSON objects, making raw line offsets and hunk chunks readable for the frontend.
- **`FileService`:** Directs file writing from the mobile editor and monitors directory workspaces dynamically using `chokidar` for seamless change synchronization.
- **`Watcher Guardrails`:** Internal runtime directories (`.pi-mobile`, `.pi`) plus configured logs/session paths are ignored by the filesystem watcher so backend artifacts cannot trigger feedback loops (for example repeated diff reload cascades).
- **`Runtime Phase Contract`:** Agent status is no longer modeled as a single boolean. The backend now exposes a phase model (`idle`, `streaming`, `queued`, `compacting`, `retrying`, `bash-running`) together with queue depth and retry/bash flags for richer mobile state rendering.

### 2.4 Observability & Failure Diagnostics

To reduce silent failures and make incidents reproducible directly from mobile devices, the stack now includes a dedicated observability path:

- **Structured Log Service:** Backend emits leveled entries (`debug|info|warn|error`) with `source`, `event`, optional `repo`, and `requestId` metadata.
- **Dual Log Storage:** Logs are persisted to rotating files under `.pi-mobile/logs` while a bounded in-memory buffer powers fast UI retrieval.
- **Request Correlation:** Every HTTP response includes `x-request-id`; API failures return a structured error payload with the same request ID.
- **Live Log Streaming:** `GET /api/logs/stream` (SSE) pushes new backend events in real time, while `GET /api/logs` supports paged history queries.
- **Client Status Panel:** A tool-icon toggle in the app chrome shows/hides runtime status chips. The panel exposes auth, WebSocket, backend health, log-stream state, and required resource-access checks (workspace/cost-db/log-dir/pi-session paths).

---

## 3. Core Workflows & Technical Implementation

### 3.1 Direct File Editing via Smartphone Editor

When a file is manually modified via the integrated touchscreen editor or the editor actions menu runs a filesystem operation:

1. The frontend dispatches writes to `POST /api/files/write` and file operations to dedicated endpoints (`/api/files/create`, `/api/files/create-directory`, `/api/files/duplicate`, `/api/files/rename`, `/api/files/move`, `/api/files/delete`).
2. The backend executes the matching `FileService` operation directly inside the selected repository path and keeps path resolution sandboxed within `/workspace`.
3. The filesystem watcher (`chokidar`) catches resulting change/unlink events and instantly broadcasts a global WebSocket notification to the client: `{ "type": "workspace_changed", "payload": { ... } }`.
4. The frontend schedules a debounced diff refresh and only reloads diff data while the diff view is active, preventing burst traffic during rapid file writes.
5. Because Git remains the _Single Source of Truth_, manual editor operations instantly populate the diff view alongside the agent's work.

### 3.2 Granular Code-Block Invalidation (Hunk-Level Revert)

Since Git does not natively provide a single non-interactive CLI command to discard an isolated hunk cleanly from a mobile UI, the system relies on a reverse-patch application:

1. The user presses the **[ Revert ]** button on a specific code block in the mobile UI.
2. The frontend extracts the raw unified diff text of that specific hunk (including the standard header `@@ -lines +lines @@`).
3. The frontend passes this hunk diff payload via `POST /api/git/revert-hunk` to the backend.
4. The backend forwards the hunk diff directly to `git apply` in reverse mode.
5. The backend executes the following atomic pipe sequence on the Pi:

   ```bash
   echo "<hunk-diff>" | git apply -R --recount --whitespace=nowarn -
   ```

6. The file is cleanly rolled back at that exact position. The `FileService` emits an updated state event, and the `pi` agent natively detects the updated file layout on its next turn.

### 3.3 Git Staging Pipeline (Hunk + All)

The diff view now follows staged-first Git semantics:

1. The user can stage or unstage individual hunks through `POST /api/git/stage-hunk` and `POST /api/git/unstage-hunk`.
2. Global index operations are available via `POST /api/git/stage-all` and `POST /api/git/unstage-all`.
3. Commits no longer auto-stage the full working tree; `POST /api/git/commit` now commits only what is currently staged.
4. Diff payloads mark each hunk with `staged: true|false` so the mobile UI can render the correct action per hunk.

### 3.4 Runtime Incident Review (Menu -> Open log)

When backend behavior is unclear, the mobile client can inspect runtime activity without leaving the UI:

1. The user opens `Menu -> Open log`.
2. The frontend fetches recent entries through `GET /api/logs` with optional filters (level/source/search).
3. The frontend attaches to `GET /api/logs/stream` to receive new entries in real time.
4. Every displayed error includes request-correlation metadata, so API failures can be traced to server-side records quickly.
5. The log view can trigger `DELETE /api/logs` to clear in-memory entries and persisted backend log files (`backend.log` + rotated files).

### 3.5 Start a Fresh Agent Session (Context + Cost Reset)

To avoid carrying forward long-running conversation context, the chat UI exposes a **New session** action:

1. The frontend calls `POST /api/agent/new-session`.
2. The backend disposes the active `AgentSession`, clears in-memory chat/tool state, and creates a brand-new SDK session via `SessionManager.create(...)` for the current repository.
3. The frontend refreshes `/api/agent/state`, so messages/tool activity become empty and usage/cost counters restart from zero for the new session.

### 3.6 Agent Status & Command Resilience

To keep runtime status accurate even when WebSocket delivery is delayed, status synchronization combines push and pull paths:

1. The backend emits `agent_status` envelopes for streaming, queue, compaction, retry, bash, and idle transitions.
2. The frontend consumes `runtimePhase` and related fields to render precise labels instead of a coarse "working" state.
3. If WebSocket is disconnected or the runtime is non-idle, the client starts fallback polling of `GET /api/agent/state` until stable idle conditions return.
4. `GET /api/agent/command-state` now includes discovered slash commands (extension, prompt, skill sources) plus queue/retry/bash indicators used by the command palette.

### 3.7 Clone-From-Picker Workflow

To reduce setup friction on mobile, repository cloning is integrated directly into the repository picker:

1. The user enters a remote URL (and optional destination path) in the picker.
2. The frontend calls `POST /api/workspaces/clone`.
3. The backend clones inside `WORKSPACE_ROOT`, validates the cloned directory as Git repository, and immediately activates it via the existing repo-runtime selection flow.
4. Watchers and agent session context are rebound to the newly cloned repository using the same `repo_selected` event pipeline as manual repo selection.

---

## 4. Container Deployment & Environment Setup

### 4.1 The Dockerfile

The container installs `git`, SSH tooling, and all Node.js dependencies required by the backend and frontend bundle.

```dockerfile
FROM node:22-slim

# Install system dependencies needed for Git and native Node packages
RUN apt-get update && apt-get install -y \
    git \
  openssh-client \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci
COPY . .

RUN npm run build

EXPOSE 3000
CMD ["node", "dist/backend/index.js"]
```

### 4.2 Docker Compose Configuration

The compose topology ensures network reachability across your network interfaces while enforcing volume isolation and environmental configuration.

```yaml
services:
  pi-mobile-server:
    build: .
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      NODE_ENV: production
      WORKSPACE_ROOT: /workspace
      COSTS_DB_PATH: /data/db/costs.sqlite
      LOGS_DIR: /data/db/logs
      PI_AGENT_DIR: /data/pi/agent
      PI_SESSION_DIR: /data/pi/sessions
      SSH_KNOWN_HOSTS_PATH: /data/db/known_hosts
      APP_PASSWORD: DeinSicheresPasswortHier
      SSH_PRIVATE_KEY_SECRET_PATH: /run/secrets/ssh_private_key
    volumes:
      - workspace:/workspace
      - db:/data/db
      - pi:/data/pi
    secrets:
      - ssh_private_key

volumes:
  workspace:
  db:
  pi:

secrets:
  ssh_private_key:
    file: /path/to/id_ed25519
```

The container entrypoint copies the SSH private key secret into the runtime filesystem, initializes the persistent `known_hosts` file under `/data/db/known_hosts`, and keeps all mutable app state inside the named Docker volumes.
