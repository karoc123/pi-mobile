# PiMobile

PiMobile turns a local Git workspace into a **mobile-first coding cockpit** (chat, diffs, edits, commits) with a password-protected web UI.

## Quickstart (Docker, recommended)

If you just want it running fast:

```bash
git clone https://github.com/karoc123/pi-mobile.git
cd pi-mobile
cp .env.example .env
# edit .env (minimum: APP_PASSWORD)
docker compose up --build
```

Open: <http://localhost:3000>

Log in with `APP_PASSWORD`, clone a repo, start coding.

---

## Why Docker is the default path

- No local Node/npm setup required
- Reproducible runtime
- Isolated state in named Docker volumes
- No bind-mount of your full `~/.ssh` or `~/.pi` directories

PiMobile persists data in named volumes:

- `workspace` (`pi-mobile-workspace`) → repositories + file edits
- `db` (`pi-mobile-db`) → `costs.sqlite`, logs, `known_hosts`
- `pi` (`pi-mobile-pi`) → Pi auth/session data

---

## Required `.env` values for Docker

At minimum:

```env
APP_PASSWORD=your-local-password
SESSION_COOKIE_SECURE=false
SSH_PRIVATE_KEY_FILE=/home/your-user/.ssh/id_ed25519 # if you want to use Git SSH auth (recommended)
```

Optional:

```env
HOST_PORT=3000
DEFAULT_REPO=
GIT_USER_NAME=Your Name
GIT_USER_EMAIL=you@example.com
PI_PROVIDER=
PI_MODEL=
PI_THINKING_LEVEL=
```

---

## Local dev mode (alternative, no Docker)

> If Pi is not authenticated yet:
>
> ```bash
> npx @earendil-works/pi-coding-agent
> ```
>
> Then run `/login` once and exit.

Use this if you want hot reload and to contribute to PiMobile itself or use self evolving Pi agents:

```bash
git clone https://github.com/karoc123/pi-mobile.git
cd pi-mobile
cp .env.example .env
npm install
npm run dev
```

- Frontend (Vite): <http://localhost:5173>
- Backend/API: <http://localhost:3000>

Production local run:

```bash
npm start
```

---

## Common commands

```bash
npm test              # unit/integration tests
npm run test:e2e      # playwright e2e
npm run build         # production build
npm run verify:container # container hardening smoke test
```

---

## Troubleshooting

- **APP_PASSWORD missing**
  - Ensure `.env` exists and `APP_PASSWORD` is set.
- **Docker secret error for SSH key**
  - Ensure `SSH_PRIVATE_KEY_FILE` points to an existing readable private key.
- **First SSH clone fails due to host trust**
  - `known_hosts` is persisted in the `db` volume at `/data/db/known_hosts` after first acceptance.

---

## Docs

- Architecture: `docs/ARCHITECTURE.md`
- Product vision: `docs/VISION.md`
- Runtime/domain context: `CONTEXT.md`
