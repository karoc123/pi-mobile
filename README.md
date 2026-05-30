# PiMobile

PiMobile is a mobile-first web cockpit for local Git repositories. It combines four pieces in one runtime:

- password-protected access to a workspace root
- repository selection below that workspace root
- a live `pi.dev` SDK session bound to the active repository
- touch-friendly diff review and file editing
- persistent per-session cost tracking with a menu-driven overview

## What is implemented

- Express + TypeScript backend with cookie-based password auth
- Svelte mobile UI with Chat, Diff, and Editor views
- menu-driven cost dashboard with filters for repository, model, and timeframe
- menu-driven backend log view with live streaming and filters for level, source, and search text
- VS-Code-like light and dark themes via burger menu
- chat status surface with explicit ready/running state, model label, and token/cost/context footer
- global system status strip showing auth state, socket connectivity, backend health, and live-log link state
- mobile-first slash command suggestions for fast `/model`, `/session`, `/compact`, and related commands
- repository picker for any Git repo below `WORKSPACE_ROOT`
- websocket updates for agent state and filesystem changes
- hunk-level revert through reverse `git apply`
- CodeMirror editor with save flow
- SQLite-backed cost persistence under `.pi-mobile/costs.sqlite` by default
- Docker and local run paths

## Prerequisites

- Node.js 22+
- npm 10+
- Git
- an existing `pi.dev` authentication under `~/.pi/agent`

If `~/.pi/agent` is not authenticated yet, log in once with the official package before using the chat view. One way is:

```bash
npx @earendil-works/pi-coding-agent
```

Then complete `/login` inside the interactive session and exit again.

## Local start on this machine

1. Create the environment file.

```bash
cp .env.example .env
```

2. Edit `.env` and set at least these values:

```env
APP_PASSWORD=your-local-password
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=you@example.com
WORKSPACE_ROOT=/home/zink/dev
COSTS_DB_PATH=/home/zink/dev/.pi-mobile/costs.sqlite
PI_AGENT_DIR=/home/zink/.pi/agent
PI_SESSION_DIR=/home/zink/.pi/agent/sessions
```

`GIT_USER_NAME` and `GIT_USER_EMAIL` are injected into every Git operation so containerized runs do not depend on a global gitconfig.

3. Install dependencies.

```bash
npm install
```

4. Start the development servers.

```bash
set -a
source .env
set +a
npm run dev
```

5. Open the web UI.

```text
http://localhost:5173
```

6. Log in with `APP_PASSWORD`.

7. Open the burger menu, choose `Choose repo`, browse within `/home/zink/dev`, and select `pi-mobile`.

8. Use the three main views:

- `Chat`: send prompts to the active repository through the `pi.dev` SDK session, inspect explicit ready/running state, and use slash suggestions for common commands
- `Diff`: inspect changed hunks and revert individual hunks
- `Editor`: browse files, edit them in-place, and save

9. Open `Menu -> Open costs` for the persistent cost overview. The dashboard aggregates all recorded Pi sessions and can be filtered by repository, model, and date range.

10. Open `Menu -> Open log` to inspect the full backend runtime stream. The log view supports live streaming, request-id correlation, and paging older entries for incident analysis.

## Production-style local run

If you want to test the built server instead of Vite dev mode:

```bash
set -a
source .env
set +a
npm run build
npm start
```

Then open:

```text
http://localhost:3000
```

## Docker start

1. Copy `.env.example` to `.env` and set at least:

```env
APP_PASSWORD=your-local-password
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=you@example.com
HOST_PORT=3000
SESSION_COOKIE_SECURE=false
WORKSPACE_HOST_PATH=/home/zink/dev
PI_HOME_HOST_PATH=/home/zink/.pi
GITCONFIG_HOST_PATH=/home/zink/.gitconfig
SSH_HOST_PATH=/home/zink/.ssh
HOST_UID=1000
HOST_GID=1000
```

Replace `HOST_UID` and `HOST_GID` with your host user and group IDs. You can check them once with `id -u` and `id -g`, or export them before Compose with `export HOST_UID=$(id -u) HOST_GID=$(id -g)`.

Leave `SESSION_COOKIE_SECURE=false` when you open the Dockerized app over plain `http://...`. Only switch it to `true` if you terminate TLS in front of PiMobile and access it via HTTPS.

If port 3000 is already in use on the host, change `HOST_PORT` to another free port such as `3001`.

2. Start the container:

```bash
docker compose up --build
```

3. Open:

```text
http://localhost:HOST_PORT
```

4. Pick `pi-mobile` from the repository picker to work on this repository itself.

If login succeeds but the initial workspace bootstrap fails, the UI now returns to the login screen and shows the backend error instead of leaving you in an empty picker state.

The container stores the cost database and backend logs under `/tmp/pi-mobile/` (`costs.sqlite` + `logs/`). This avoids startup failures when mounted host paths are read-only. Note: `/tmp` is container-local, so costs/logs are reset when the container is recreated.

## Verification run in this workspace

The current kickoff was validated with:

```bash
npm run build
npm test
```

Both commands pass in this workspace.

## Browser end-to-end suite

The manually verified browser flow is available as a Playwright suite.

1. Install the Playwright browser once:

```bash
npx playwright install chromium
```

2. Run the suite:

```bash
npm run test:e2e
```

What it covers:

- password login
- burger menu and theme toggle
- repository picker selection
- slash command suggestion visibility
- chat flow against a deterministic mock pi runtime
- explicit finished state plus usage footer rendering
- editor save
- diff view detection
- hunk revert back to a clean tree

The suite starts the built app automatically against an isolated workspace under `.playwright/workspace` and does not touch your real repositories.

## Current limitations

- the frontend still has a non-trivial client bundle, but Diff2Html and CodeMirror are now loaded on demand with the Diff and Editor views instead of the initial page load
- the app tracks one active repository at a time in the UI
- the chat layer uses the `pi.dev` SDK directly; CLI JSON/RPC fallbacks are not wired yet
- cost persistence uses Node's built-in `node:sqlite` module on Node 22+, which currently emits an experimental runtime warning
- the in-memory log buffer is capped for responsiveness; older entries remain in rotated files under `.pi-mobile/logs`
