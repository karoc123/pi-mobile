#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

mkdir -p "$ROOT_DIR/tmp"
SMOKE_ROOT="$(mktemp -d "$ROOT_DIR/tmp/container-smoke.XXXXXX")"
SMOKE_PORT="${SMOKE_PORT:-3300}"
PROJECT="pi-mobile-smoke-$(basename "$SMOKE_ROOT" | tr '[:upper:].' '[:lower:]-')"
COOKIE_JAR="$SMOKE_ROOT/cookie.txt"
export SMOKE_ROOT SMOKE_PORT

compose() {
  docker compose --env-file /dev/null --project-name "$PROJECT" -f "$ROOT_DIR/docker-compose.smoke.yml" "$@"
}

cleanup() {
  local status=$?
  # Stop the logger before deleting root-owned fixtures so shutdown cannot recreate them.
  compose stop >/dev/null 2>&1 || status=1
  if docker image inspect "$PROJECT-pi-mobile-server" >/dev/null 2>&1; then
    compose run --rm --no-deps --entrypoint sh pi-mobile-server -c \
      'rm -rf /workspace/* /workspace/.[!.]* /data/db/* /data/pi/*' >/dev/null 2>&1 || status=1
  fi
  compose down --volumes --rmi local >/dev/null 2>&1 || status=1
  if ! rm -rf "$SMOKE_ROOT"; then
    echo "[container-smoke] Could not remove this run's fixtures: $SMOKE_ROOT" >&2
    status=1
  fi
  exit "$status"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

mkdir -p "$SMOKE_ROOT/workspace" "$SMOKE_ROOT/db" "$SMOKE_ROOT/pi"
ssh-keygen -t ed25519 -N "" -f "$SMOKE_ROOT/id_ed25519" >/dev/null

wait_for_health() {
  for _ in {1..60}; do
    if curl --max-time 3 -fsS "http://127.0.0.1:$SMOKE_PORT/api/health" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
  compose logs --tail=80 >&2 || true
  echo "[container-smoke] Health endpoint did not become ready." >&2
  return 1
}

login() {
  curl -fsS -c "$COOKIE_JAR" -H "Content-Type: application/json" \
    -d '{"password":"smoke-pass"}' "http://127.0.0.1:$SMOKE_PORT/api/auth/login" >/dev/null
}

assert_unauthorized() {
  local status
  status="$(curl -sS -o /dev/null -w '%{http_code}' "http://127.0.0.1:$SMOKE_PORT/api/agent/state")"
  test "$status" = 401
}

echo "[container-smoke] Build isolated project $PROJECT..."
compose up -d --build
wait_for_health
assert_unauthorized
curl -fsS "http://127.0.0.1:$SMOKE_PORT/api/health" | node -e \
  'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.ok || !d.resources?.allRequiredAccessible) process.exit(1)'

login
PROVIDER="$(curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$SMOKE_PORT/api/pi/auth/status" | node -e \
  'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); const p=d.providers?.[0]?.provider; if(!p) process.exit(1); process.stdout.write(p)')"
TOKEN_BODY="$(node -e 'process.stdout.write(JSON.stringify({provider:process.argv[1],token:"smoke-token"}))' "$PROVIDER")"
curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" -d "$TOKEN_BODY" \
  "http://127.0.0.1:$SMOKE_PORT/api/pi/auth/login-token" >/dev/null

echo "[container-smoke] Verify local clone/pull/push..."
compose exec -T pi-mobile-server sh -lc 'set -e; git init /tmp/smoke-origin >/dev/null; cd /tmp/smoke-origin; echo smoke > README.md; git add README.md; git commit -m init >/dev/null; git clone --bare /tmp/smoke-origin /workspace/smoke-remote.git >/dev/null'
curl -fsS -b "$COOKIE_JAR" -H "Content-Type: application/json" \
  -d '{"remoteUrl":"/workspace/smoke-remote.git","destinationPath":"smoke-clone"}' \
  "http://127.0.0.1:$SMOKE_PORT/api/workspaces/clone" >/dev/null
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$SMOKE_PORT/api/git/pull" >/dev/null
curl -fsS -b "$COOKIE_JAR" -X POST "http://127.0.0.1:$SMOKE_PORT/api/git/push" >/dev/null

compose exec -T pi-mobile-server sh -lc 'echo smoke > /workspace/smoke.marker; echo smoke > /data/db/smoke.marker'
echo "[container-smoke] Recreate only the smoke container and verify persistence..."
compose down
compose up -d
wait_for_health
assert_unauthorized
compose exec -T pi-mobile-server sh -lc 'test -f /workspace/smoke.marker && test -f /workspace/smoke-clone/.git/config && test -f /data/db/smoke.marker && test -f /data/pi/agent/auth.json'
login
curl -fsS -b "$COOKIE_JAR" "http://127.0.0.1:$SMOKE_PORT/api/pi/auth/status" | node -e \
  'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); if(!d.providers.some(p=>p.configured)) process.exit(1)'

echo "[container-smoke] SUCCESS: auth boundary, resources, Git routes and persistence verified with disposable credentials."
