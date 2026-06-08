#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

APP_PASSWORD="${APP_PASSWORD:-phase7-pass}"
HOST_PORT="${HOST_PORT:-3300}"
HOST_UID="${HOST_UID:-0}"
HOST_GID="${HOST_GID:-0}"
COOKIE_JAR="${ROOT_DIR}/.pi-mobile/phase7-cookie.txt"
TEMP_KEY_DIR="$(mktemp -d)"
SSH_PRIVATE_KEY_FILE="${SSH_PRIVATE_KEY_FILE:-${TEMP_KEY_DIR}/id_ed25519}"

cleanup() {
  rm -f "$COOKIE_JAR"
  if [[ -d "$TEMP_KEY_DIR" ]]; then
    rm -rf "$TEMP_KEY_DIR"
  fi
}
trap cleanup EXIT

if [[ ! -f "$SSH_PRIVATE_KEY_FILE" ]]; then
  mkdir -p "$(dirname "$SSH_PRIVATE_KEY_FILE")"
  ssh-keygen -t ed25519 -N "" -f "$SSH_PRIVATE_KEY_FILE" >/dev/null
fi

export APP_PASSWORD
export HOST_PORT
export SSH_PRIVATE_KEY_FILE
export HOST_UID
export HOST_GID

echo "[phase7] Reset stack with fresh volumes..."
docker compose down -v --remove-orphans >/dev/null 2>&1 || true
docker compose up -d --build

echo "[phase7] Wait for health endpoint..."
for _ in {1..60}; do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null; then
    break
  fi

  if docker compose ps --format json | node -e 'const fs=require("fs"); const lines=fs.readFileSync(0,"utf8").trim().split(/\n+/).filter(Boolean); const down=lines.some((line)=>{const s=JSON.parse(line).State||""; return s.includes("restarting")||s.includes("exited")||s.includes("dead")}); process.exit(down?0:1);'; then
    echo "[phase7] Container failed during startup. Recent logs:" >&2
    docker compose logs --tail=80 pi-mobile-server >&2 || true
    exit 1
  fi

  sleep 1
done

HEALTH_JSON="$(curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health")"
printf '%s' "$HEALTH_JSON" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!data.ok){process.exit(1)} if(!data.resources?.allRequiredAccessible){console.error("resources not accessible"); process.exit(1)}'

echo "[phase7] Login and capture provider status..."
curl -fsS -c "$COOKIE_JAR" -H "Content-Type: application/json" -d "{\"password\":\"${APP_PASSWORD}\"}" "http://127.0.0.1:${HOST_PORT}/api/auth/login" >/dev/null
PROVIDER="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${HOST_PORT}/api/pi/auth/status" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const provider=data.providers?.[0]?.provider; if(!provider){process.exit(1)} process.stdout.write(provider);')"

curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" -d "{\"provider\":\"${PROVIDER}\",\"token\":\"phase7-token\"}" "http://127.0.0.1:${HOST_PORT}/api/pi/auth/login-token" >/dev/null

echo "[phase7] Prepare local git remote and verify clone/pull/push routes..."
docker compose exec -T pi-mobile-server sh -lc 'set -e; rm -rf /tmp/phase7-origin /workspace/phase7-remote.git; git init /tmp/phase7-origin >/dev/null; cd /tmp/phase7-origin; git config user.name phase7; git config user.email phase7@example.com; echo "phase7" > README.md; git add README.md; git commit -m "init" >/dev/null; git clone --bare /tmp/phase7-origin /workspace/phase7-remote.git >/dev/null'

curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" -d '{"remoteUrl":"/workspace/phase7-remote.git","destinationPath":"phase7-clone"}' "http://127.0.0.1:${HOST_PORT}/api/workspaces/clone" >/dev/null
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:${HOST_PORT}/api/git/pull" >/dev/null
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:${HOST_PORT}/api/git/push" >/dev/null

echo "[phase7] Write persistence markers inside volumes..."
docker compose exec -T pi-mobile-server sh -lc "echo phase7 > /workspace/phase7.marker && echo phase7 > /data/db/phase7.marker"

echo "[phase7] Recreate container and verify persisted state..."
docker compose down >/dev/null
docker compose up -d >/dev/null

for _ in {1..30}; do
  if curl -fsS "http://127.0.0.1:${HOST_PORT}/api/health" >/dev/null; then
    break
  fi
  sleep 1
done

docker compose exec -T pi-mobile-server sh -lc "test -f /workspace/phase7.marker && test -f /workspace/phase7-clone/.git/config && test -f /data/db/phase7.marker && test -f /data/pi/agent/auth.json"

curl -fsS -c "$COOKIE_JAR" -H "Content-Type: application/json" -d "{\"password\":\"${APP_PASSWORD}\"}" "http://127.0.0.1:${HOST_PORT}/api/auth/login" >/dev/null
POST_RESTART_STATUS="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:${HOST_PORT}/api/pi/auth/status")"
printf '%s' "$POST_RESTART_STATUS" | node -e 'const data=JSON.parse(require("fs").readFileSync(0,"utf8")); const configured=(data.providers||[]).some((p)=>p.configured===true); if(!configured){console.error("no configured provider after restart"); process.exit(1)}'

echo "[phase7] SUCCESS: health/resources ok, clone/pull/push routes ok, volume persistence ok, pi auth persistence ok."
