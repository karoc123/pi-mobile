# ARCHITECTURE.md — System and Software Architecture

This document outlines the technical design of the **PiMobile Agent Server**. The system integrates the official `pi.dev` core engine directly inside a custom Node.js/TypeScript backend wrapper, packaged into a lightweight, secured Docker container optimized for the ARM architecture of a Raspberry Pi.

---

## 1. System Topology

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
- **Configuration:** The master password is safe-guarded via environment variables (`APP_PASSWORD`) fed through Docker Compose.
- **Flow:** Any unauthenticated requests to REST routes or WebSocket handshake upgrades are intercepted by an auth-middleware and redirected to a minimalist login screen.

### 2.2 Frontend (Mobile-Optimized Web App)

To minimize memory footprint and execution latency on the Raspberry Pi, the frontend drops heavy client-side builds.

- **Technology:** Svelte (compiled down to vanilla JS chunks).
- **Navigation:** Bottom-anchored navigation drawer featuring three unified thumb views:
  1. **Chat (`/chat`):** Feeds interactions directly into the active `pi` execution process. Utilizes modular Markdown text parsing with responsive fullscreen viewports for generated code blocks.
  2. **Git Diff (`/diff`):** Uses `diff2html` in explicit `line-by-line` layout configuration. Augmented with overlay action nodes for single-tap hunk manipulation plus header-level `pull` / `push` / `commit` actions.
  3. **Editor (`/editor`):** A touch-first text editing surface implemented with **CodeMirror 6**, ensuring fluid virtual keyboard integration and real-time syntax highlighting.

### 2.3 Backend & Tool-Wrapper

Written in TypeScript running on Node.js, the backend acts as a high-fidelity router orchestrating the host environment, Git states, and the `pi` runtime.

- **`In-Container Agent Execution`:** The backend uses the official `@earendil-works/pi-coding-agent` TypeScript SDK as the primary integration layer. A repository-bound `AgentSession` is created directly inside the Node.js process, while `~/.pi/agent` from the host is mounted into the container so the runtime inherits existing pi.dev logins and model configuration. CLI JSON/RPC modes remain possible fallbacks, but are not the primary kickoff integration.
- **`GitService`:** Parses the standard stream of `git diff -U3` into structural JSON objects, making raw line offsets and hunk chunks readable for the frontend.
- **`FileService`:** Directs file writing from the mobile editor and monitors directory workspaces dynamically using `chokidar` for seamless change synchronization.

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

When a file is manually modified via the integrated touchscreen editor:

1. The frontend dispatches the updated contents to `POST /api/files/write`.
2. The backend commits the raw string directly into the targeted file within the `/workspace` directory.
3. The filesystem watcher (`chokidar`) catches the write event and instantly broadcasts a global WebSocket notification to the client: `{ "type": "workspace_changed", "payload": { ... } }`.
4. The frontend fetches the updated diff context. Because Git remains the _Single Source of Truth_, your manual touch-ups instantly populate the diff view alongside the agent's work.

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

### 3.4 Runtime Incident Review (Menu -> Open log)

When backend behavior is unclear, the mobile client can inspect runtime activity without leaving the UI:

1. The user opens `Menu -> Open log`.
2. The frontend fetches recent entries through `GET /api/logs` with optional filters (level/source/search).
3. The frontend attaches to `GET /api/logs/stream` to receive new entries in real time.
4. Every displayed error includes request-correlation metadata, so API failures can be traced to server-side records quickly.
5. The log view can trigger `DELETE /api/logs` to clear in-memory entries and persisted backend log files (`backend.log` + rotated files).

### 3.3 Start a Fresh Agent Session (Context + Cost Reset)

To avoid carrying forward long-running conversation context, the chat UI exposes a **New session** action:

1. The frontend calls `POST /api/agent/new-session`.
2. The backend disposes the active `AgentSession`, clears in-memory chat/tool state, and creates a brand-new SDK session via `SessionManager.create(...)` for the current repository.
3. The frontend refreshes `/api/agent/state`, so messages/tool activity become empty and usage/cost counters restart from zero for the new session.

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
version: "3.8"

services:
  pi-mobile-server:
    build: .
    container_name: pi-mobile-server
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - WORKSPACE_ROOT=/workspace
      - COSTS_DB_PATH=/workspace/pi-mobile/.pi-mobile/costs.sqlite
      - LOGS_DIR=/workspace/pi-mobile/.pi-mobile/logs
      - PI_AGENT_DIR=/home/node/.pi/agent
      - PI_SESSION_DIR=/workspace/pi-mobile/.pi-mobile/sessions
      # Password protection gate for mobile access
      - APP_PASSWORD=DeinSicheresPasswortHier # Change this value before deployment
    volumes:
      # Active development repositories living on the Pi host
      - /home/pi/projects:/workspace
      # Preserved pi.dev authentication matrices (Claude Code, Token states)
      - /home/pi/.pi:/home/node/.pi
      # Shared Git user profile configuration for correct commit tracking
      - /home/pi/.gitconfig:/home/node/.gitconfig:ro
      # Bound host SSH credentials to sign commits or pull/push to remote origins
      - /home/pi/.ssh:/home/node/.ssh:ro
    user: "${UID}:${GID}" # Runs with identical host IDs to negate Docker root permission locking
```
