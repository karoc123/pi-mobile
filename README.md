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
WORKSPACE_HOST_PATH=/home/your-user/dev
PI_HOME_HOST_PATH=/home/your-user/.pi
GITCONFIG_HOST_PATH=/home/your-user/.gitconfig
SSH_HOST_PATH=/home/your-user/.ssh
HOST_UID=1000
HOST_GID=1000
```

2. Build and run:

```bash
docker compose up --build
```

3. Open:

```text
http://localhost:3000
```

## Day-to-Day Commands

```bash
npm run dev      # frontend + backend watch mode
npm test         # test suite
npm run build    # production build
```

During `npm run dev`, open `http://localhost:5173` (or `http://<your-host>:5173` from mobile).
`http://localhost:3000` remains the backend/API server and will redirect to Vite in development.

## Common First-Run Issues

- APP_PASSWORD missing:
  - Ensure .env exists and APP_PASSWORD is non-empty.
- Docker file permission issues:
  - Set HOST_UID and HOST_GID to your user IDs.

## Where To Go Next

- Architecture overview: docs/ARCHITECTURE.md
- Product scope: docs/VISION.md
- Runtime/domain context: CONTEXT.md
