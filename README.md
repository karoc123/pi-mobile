# PiMobile

PiMobile turns a local Git workspace into a mobile-first coding cockpit.

You can run it either:

- locally with npm start
- containerized with docker compose up

The goal is simple: clone, configure once, and start working from your phone in minutes.

## Why This Repo

- Fast local setup for Raspberry Pi and Linux hosts
- Password-gated web UI for chat, diffs, and editing
- Works against real repositories on your filesystem

## Prerequisites

- Node.js 22+
- npm 10+
- Git
- Existing pi.dev auth under ~/.pi/agent

If pi.dev is not authenticated yet:

```bash
npx @earendil-works/pi-coding-agent
```

Then run /login once and exit.

## 5-Minute Local Quickstart

1. Clone and enter the repo.

```bash
git clone git@github.com:karoc123/pi-mobile.git
cd pi-mobile
```

2. Create environment file.

```bash
cp .env.example .env
```

3. Edit .env and set at minimum:

```env
APP_PASSWORD=your-local-password
WORKSPACE_ROOT=/home/your-user/dev
PI_AGENT_DIR=/home/your-user/.pi/agent
PI_SESSION_DIR=/home/your-user/.pi/agent/sessions
```

Optional but recommended for commits:

```env
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=you@example.com
```

4. Install and start.

```bash
npm install
npm start
```

5. Open:

```text
http://localhost:3000
```

Login with APP_PASSWORD, select a repository, and start.

## Docker Quickstart

1. Create .env from template and set at minimum:

```env
APP_PASSWORD=your-local-password
SESSION_COOKIE_SECURE=false
SSH_PRIVATE_KEY_FILE=/home/your-user/.ssh/id_ed25519
```

2. Build and run:

```bash
docker compose up --build
```

PiMobile now keeps runtime state in three named Docker volumes:

- `workspace` for cloned repositories and file edits
- `db` for `costs.sqlite`, logs, and `known_hosts`
- `pi` for Pi auth, model metadata, and session files

The SSH private key is injected as a Compose secret at startup and copied into the container runtime. No host workspace, `~/.pi`, or `~/.ssh` directory is mounted into the container.

3. Open:

```text
http://localhost:3000
```

## Day-to-Day Commands

```bash
npm run dev           # frontend + backend watch mode
npm test              # test suite
npm run build         # production build
npm run verify:phase7 # container hardening smoke (fresh volumes + persistence)
```

During `npm run dev`, open `http://localhost:5173` (or `http://<your-host>:5173` from mobile).
`http://localhost:3000` remains the backend/API server and will redirect to Vite in development.

## Common First-Run Issues

- APP_PASSWORD missing:
  - Ensure .env exists and APP_PASSWORD is non-empty.
- Docker secret issues:
  - Ensure `SSH_PRIVATE_KEY_FILE` points to an existing private key readable by Docker Compose.
- SSH host trust:
  - Unknown SSH hosts are accepted automatically on first use and persisted in the `db` volume `known_hosts` file.

## Where To Go Next

- Architecture overview: docs/ARCHITECTURE.md
- Product scope: docs/VISION.md
- Runtime/domain context: CONTEXT.md
