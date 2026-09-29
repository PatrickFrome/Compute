#!/usr/bin/env bash
# R80 push-pending: publishes EVERYTHING that exists only locally after the env-reset.
# Requires: GITHUB_TOKEN_ADMIN inside /home/z/.a2/.github.env (operator restores it first).
# PAT-safe: token never printed, never logged; remote URL restored immediately after each push.
set -euo pipefail
cd /home/z/my-project

ENVF=/home/z/.a2/.github.env
[[ -f "$ENVF" ]] || { echo "BLOCKER: $ENVF missing — operator must place a fresh PAT first"; exit 2; }
# shellcheck disable=SC1090
source "$ENVF"
[[ -n "${GITHUB_TOKEN_ADMIN:-}" ]] || { echo "BLOCKER: GITHUB_TOKEN_ADMIN empty"; exit 2; }

CLEAN_URL=$(git remote get-url origin)
AUTH_URL="https://x-access-token:${GITHUB_TOKEN_ADMIN}@github.com/PatrickFrome/Compute.git"
restore() { git remote set-url origin "$CLEAN_URL"; }
trap restore EXIT

push_ref() { # $1 = local ref, $2 = remote ref
  echo "== push $1 -> $2 =="
  git remote set-url origin "$AUTH_URL"
  git push origin "$1:$2"
  git remote set-url origin "$CLEAN_URL"
}

# 1. Rail: reconstructed worklog (R78-1a / R78 / R79 / R80 audit) — pure fast-forward b39db2e0..44dd5f64+
push_ref main sandbox/me2-os

# 2. Orphan preservation: R21 sandbox snapshot (73486dd) — absent from ALL remote branches
push_ref local/r21-snapshot me2/archive-r21-sandbox-snapshot

# 3. Orphan preservation: pre-monorepo v0.4.0 archive (c95de21) — absent from ALL remote branches
push_ref main-archive me2/archive-v040-main-archive

echo "== verify =="
git ls-remote origin refs/heads/sandbox/me2-os refs/heads/me2/archive-r21-sandbox-snapshot refs/heads/me2/archive-v040-main-archive
echo "DONE: all local state published."
