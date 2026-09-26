#!/usr/bin/env bash
# R80 desktop push: publishes the me2/r78-desktop-from-scratch rail (desktop client).
# Requires: GITHUB_TOKEN_ADMIN inside /home/z/.a2/.github.env (operator restores it first).
# PAT-safe: token never printed, never logged; remote URL restored immediately after push.
set -euo pipefail
cd /home/z/my-project

BRANCH="${1:-me2/r78-desktop-from-scratch}"

ENVF=/home/z/.a2/.github.env
[[ -f "$ENVF" ]] || { echo "BLOCKER: $ENVF missing — operator must place a fresh PAT first"; exit 2; }
# shellcheck disable=SC1090
source "$ENVF"
[[ -n "${GITHUB_TOKEN_ADMIN:-}" ]] || { echo "BLOCKER: GITHUB_TOKEN_ADMIN empty"; exit 2; }

CLEAN_URL=$(git remote get-url origin)
AUTH_URL="https://x-access-token:${GITHUB_TOKEN_ADMIN}@github.com/PatrickFrome/Compute.git"
restore() { git remote set-url origin "$CLEAN_URL"; }
trap restore EXIT

echo "== push $BRANCH -> $BRANCH =="
git remote set-url origin "$AUTH_URL"
git push origin "$BRANCH:$BRANCH"
git remote set-url origin "$CLEAN_URL"

echo "== verify =="
git ls-remote origin "refs/heads/$BRANCH"
echo "DONE: desktop rail published ($BRANCH)."
