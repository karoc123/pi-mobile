#!/bin/sh

set -eu

WORKSPACE_ROOT_PATH="${WORKSPACE_ROOT:-/workspace}"
DATA_ROOT_PATH="${DATA_ROOT:-/data}"
DB_ROOT_PATH="${DB_ROOT:-${DATA_ROOT_PATH}/db}"
PI_ROOT_PATH="${PI_ROOT:-${DATA_ROOT_PATH}/pi}"
SSH_HOME_PATH="${SSH_HOME:-/home/node/.ssh}"
SSH_PRIVATE_KEY_TARGET="${SSH_PRIVATE_KEY_TARGET:-${SSH_HOME_PATH}/id_ed25519}"
SSH_PRIVATE_KEY_SECRET_PATH="${SSH_PRIVATE_KEY_SECRET_PATH:-}"
SSH_KNOWN_HOSTS_PATH="${SSH_KNOWN_HOSTS_PATH:-${DB_ROOT_PATH}/known_hosts}"

mkdir -p "${WORKSPACE_ROOT_PATH}" "${DB_ROOT_PATH}" "${PI_ROOT_PATH}" "${SSH_HOME_PATH}"

touch "${SSH_KNOWN_HOSTS_PATH}"
chmod 600 "${SSH_KNOWN_HOSTS_PATH}"

# ------------------------------------------------------------------
# 1. SSH key provisioning
# ------------------------------------------------------------------
if [ -n "${SSH_PRIVATE_KEY_SECRET_PATH}" ]; then
  if [ ! -f "${SSH_PRIVATE_KEY_SECRET_PATH}" ]; then
    echo "SSH private key secret file not found: ${SSH_PRIVATE_KEY_SECRET_PATH}" >&2
    exit 1
  fi

  cp "${SSH_PRIVATE_KEY_SECRET_PATH}" "${SSH_PRIVATE_KEY_TARGET}"
  chmod 600 "${SSH_PRIVATE_KEY_TARGET}"
fi

# ------------------------------------------------------------------
# 2. ssh-agent: start and load the key so that every child process
#    (including pi agent bash subprocesses) sees SSH_AUTH_SOCK.
# ------------------------------------------------------------------
if [ -f "${SSH_PRIVATE_KEY_TARGET}" ]; then
  echo "Starting ssh-agent and loading SSH key: ${SSH_PRIVATE_KEY_TARGET}"
  eval "$(ssh-agent -s)"
  ssh-add "${SSH_PRIVATE_KEY_TARGET}" 2>&1 || echo "Warning: ssh-add failed (key may have a passphrase or be in an unsupported format)." >&2
  # Export so the Node.js process inherits SSH_AUTH_SOCK / SSH_AGENT_PID.
  export SSH_AUTH_SOCK
  export SSH_AGENT_PID
fi

# ------------------------------------------------------------------
# 3. Git global configuration
# ------------------------------------------------------------------

# Set user identity for merge conflict resolution and other git operations
# that require user.name/user.email config (not just env vars).
if [ -n "${GIT_USER_NAME:-}" ]; then
  git config --global user.name "${GIT_USER_NAME}"
fi

if [ -n "${GIT_USER_EMAIL:-}" ]; then
  git config --global user.email "${GIT_USER_EMAIL}"
fi

# Set pull behavior: merge strategy (no rebase).
# This ensures git pull creates a merge commit when branches diverge,
# rather than rebasing which could rewrite history.
git config --global pull.rebase false

# Ensure safe.directory covers the workspace root to avoid
# "dubious ownership" errors when the workspace is mounted from the host.
git config --global --add safe.directory "${WORKSPACE_ROOT_PATH}" 2>/dev/null || true

# Automatically set upstream when pushing a new branch (avoids the
# "fatal: The current branch has no upstream branch" error).
git config --global push.autoSetupRemote true

# ------------------------------------------------------------------
# 4. Hand off to the CMD (Node.js server).
#    ssh-agent PID is inherited; the Node process can kill it on
#    shutdown if desired, but the container exit will clean it up.
# ------------------------------------------------------------------
exec "$@"

# On process exit (container stop), the ssh-agent child is reaped
# automatically by the kernel once the parent exits.