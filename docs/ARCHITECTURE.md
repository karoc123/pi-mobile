Hier ist die bereinigte und fokussierte Fassung der **`ARCHITECTURE.md`**. Alle Erklärungen zum lokalen Netzwerk-Routing wurden entfernt, und die Architektur wurde strikt auf **Vorschlag B** (die native Installation von `pi.dev` direkt innerhalb des Docker-Containers) sowie die Passwort-Authentifizierung ausgerichtet.

````markdown
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

- **Technology:** Svelte (compiled down to vanilla JS chunks) or structural Vanilla JS, paired with Tailwind CSS.
- **Navigation:** Bottom-anchored navigation drawer featuring three unified thumb views:
  1. **Chat (`/chat`):** Feeds interactions directly into the active `pi` execution process. Utilizes modular Markdown text parsing with responsive fullscreen viewports for generated code blocks.
  2. **Git Diff (`/diff`):** Uses `diff2html` in explicit `line-by-line` layout configuration. Augmented with overlay action nodes for single-tap file and hunk manipulation.
  3. **Editor (`/editor`):** A touch-first text editing surface implemented with **CodeMirror 6**, ensuring fluid virtual keyboard integration and real-time syntax highlighting.

### 2.3 Backend & Tool-Wrapper

Written in TypeScript running on Node.js, the backend acts as a high-fidelity router orchestrating the host environment, Git states, and the `pi` sub-processes.

- **`In-Container Agent Execution`:** `pi.dev` is installed globally _inside_ the Docker image. The backend initiates the agent via explicit programmatic CLI flags (`pi --json-stream`) or imports its Core SDK inside the event loop. By mapping `~/.pi` from the host to the container, the agent immediately inherits active session logins (Claude Code, OpenAI, etc.).
- **`GitService`:** Parses the standard stream of `git diff -U3` into structural JSON objects, making raw line offsets and hunk chunks readable for the frontend.
- **`FileService`:** Directs file writing from the mobile editor and monitors directory workspaces dynamically using `chokidar` for seamless change synchronization.

---

## 3. Core Workflows & Technical Implementation

### 3.1 Direct File Editing via Smartphone Editor

When a file is manually modified via the integrated touchscreen editor:

1. The frontend dispatches the updated contents to `POST /api/files/write`.
2. The backend commits the raw string directly into the targeted file within the `/workspace` directory.
3. The filesystem watcher (`chokidar`) catches the write event and instantly broadcasts a global WebSocket notification to the client: `{ "event": "workspace_changed" }`.
4. The frontend fetches the updated diff context. Because Git remains the _Single Source of Truth_, your manual touch-ups instantly populate the diff view alongside the agent's work.

### 3.2 Granular Code-Block Invalidation (Hunk-Level Revert)

Since Git does not native provide a single CLI command to discard an isolated hunk without user prompt, the system relies on a reverse-patch injection mechanism:

1. The user presses the **[ Revert ]** button on a specific code block in the mobile UI.
2. The frontend extracts the raw unified diff text of that specific hunk (including the standard header `@@ -lines +lines @@`).
3. The frontend passes this hunk diff payload via `POST /api/git/revert-hunk` to the backend.
4. The backend inverts the diff signs (swapping `+` with `-` and vice versa) to synthesize a _reverse patch_.
5. The backend executes the following atomic pipe sequence on the Pi:

   ```bash
   echo "<inverted-hunk-diff>" | git apply --cached --unidiff-zero -
   git checkout -- <file-path>
   ```

6. The file is cleanly rolled back at that exact position. The `FileService` emits an updated state event, and the `pi` agent natively detects the updated file layout on its next turn.

---

## 4. Container Deployment & Environment Setup

### 4.1 The Dockerfile

The container installs `git`, compilation tools, and the `pi.dev` core agent natively into its own system context.

```dockerfile
FROM node:20-slim

# Install system dependencies needed for Git and native Node packages
RUN apt-get update && apt-get install -y \
    git \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Globally install the pi.dev core ecosystem within the container
RUN npm install -g @earendil-works/pi-coding-agent

# Build the internal custom dashboard server
COPY package*.json ./
RUN npm install
COPY . .

RUN npm run build

EXPOSE 3000
CMD ["node", "dist/index.js"]
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
      - WORKSPACE_DIR=/workspace
      - PI_CONFIG_DIR=/home/node/.pi
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
````
