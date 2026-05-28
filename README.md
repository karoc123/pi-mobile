# PiMobile

PiMobile is a mobile-first web cockpit for local Git repositories. It combines four pieces in one runtime:

- password-protected access to a workspace root
- repository selection below that workspace root
- a live `pi.dev` SDK session bound to the active repository
- touch-friendly diff review and file editing

## What is implemented

- Express + TypeScript backend with cookie-based password auth
- Svelte mobile UI with Chat, Diff, and Editor views
- repository picker for any Git repo below `WORKSPACE_ROOT`
- websocket updates for agent state and filesystem changes
- hunk-level revert through reverse `git apply`
- CodeMirror editor with save flow
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
WORKSPACE_ROOT=/home/zink/dev
PI_AGENT_DIR=/home/zink/.pi/agent
PI_SESSION_DIR=/home/zink/.pi/agent/sessions
```

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

7. Open `Choose repo`, browse within `/home/zink/dev`, and select `pi-mobile`.

8. Use the three main views:

- `Chat`: send prompts to the active repository through the `pi.dev` SDK session
- `Diff`: inspect changed hunks and revert individual hunks
- `Editor`: browse files, edit them in-place, and save

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
WORKSPACE_HOST_PATH=/home/zink/dev
PI_HOME_HOST_PATH=/home/zink/.pi
GITCONFIG_HOST_PATH=/home/zink/.gitconfig
SSH_HOST_PATH=/home/zink/.ssh
```

2. Start the container:

```bash
docker compose up --build
```

3. Open:

```text
http://localhost:3000
```

4. Pick `pi-mobile` from the repository picker to work on this repository itself.

## Verification run in this workspace

The current kickoff was validated with:

```bash
npm run build
npm test
```

Both commands pass in this workspace.

## Current limitations

- the frontend currently ships as one large JS chunk because Diff2Html and CodeMirror are loaded eagerly
- the app tracks one active repository at a time in the UI
- the chat layer uses the `pi.dev` SDK directly; CLI JSON/RPC fallbacks are not wired yet
