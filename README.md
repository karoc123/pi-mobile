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

The companion Wear OS client is maintained in the [PiMobile Wear OS repository](https://github.com/karoc123/pi-mobile-wear-app).

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

## Provider login

Open **App menu → Pi Login**. For a ChatGPT subscription choose **OpenAI Codex / ChatGPT
subscription → Sign in with ChatGPT** and enter the displayed code on the sign-in page.
If device-code login is blocked (ChatGPT security settings or workspace policy), use
**browser sign-in** and paste the complete `localhost:1455/auth/callback?...` address back
into PiMobile.

Credentials are stored in `PI_AGENT_DIR/auth.json` (`/data/pi/agent/auth.json` in Docker).
The Pi CLI `/login` works as well when it uses the same agent directory.

---

## Local dev mode (alternative, no Docker)

Use this if you want hot reload and to contribute to PiMobile itself or use self evolving Pi agents:

```bash
git clone https://github.com/karoc123/pi-mobile.git
cd pi-mobile
cp .env.example .env
npm ci --ignore-scripts
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
npm run check         # static checks + guardrail tests
npm test              # unit/integration + guardrail tests
npm run test:e2e      # mobile Playwright e2e
npm run build         # production build
npm run verify:container # isolated container smoke (not the personal stack)
npm run format:fix -- <paths> # format only explicit files
```

---

## Troubleshooting

- **APP_PASSWORD missing**
  - Ensure `.env` exists and `APP_PASSWORD` is set.
- **Docker secret error for SSH key**
  - Ensure `SSH_PRIVATE_KEY_FILE` points to an existing readable private key.
- **First SSH clone fails due to host trust**
  - `known_hosts` is persisted in `./db` (`/data/db/known_hosts` in the container) after first acceptance.

---

## Docs

- Architecture: `docs/ARCHITECTURE.md`
- Product vision: `docs/VISION.md`
- Playbook and development guardrails: `AGENTS.md`
