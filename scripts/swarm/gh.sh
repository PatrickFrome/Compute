#!/usr/bin/env bash
# gh.sh — GitHub helper for ALL swarm agents (shared repo access).
# usage:
#   bash gh.sh whoami                        -> verify token (prints login or code)
#   bash gh.sh clone [destdir]               -> clone shared repo (default: /tmp/swarm-repo)
#   bash gh.sh pull                          -> fetch+reset shared repo workdir to origin
#   bash gh.sh push <branch> ["message"]     -> commit all & push current workdir repo
#   bash gh.sh api <method> <path> [json]    -> raw API call
# Token is used in-memory/URL only; NEVER printed. Repo is PUBLIC: secrets must NOT be
# committed (guard in scripts/git-sync.sh + directive rule).
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/agent-connect.env.sh" 2>/dev/null
if [ -z "${AGENT_GITHUB_TOKEN:-}" ] || [ -z "${AGENT_GITHUB_REPO:-}" ]; then
  echo "ERROR: github creds not loaded" >&2; exit 2
fi
REPO="${AGENT_GITHUB_REPO}"
AUTH="x-access-token:${AGENT_GITHUB_TOKEN}@github.com"
WORK="${GH_WORKDIR:-/tmp/swarm-repo}"

case "${1:-}" in
  whoami)
    curl -s --max-time 20 -H "Authorization: Bearer ${AGENT_GITHUB_TOKEN}" https://api.github.com/user \
      | python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('login') or ('HTTP-'+str(d.get('message','?'))[:20]))" ;;
  clone)
    D="${2:-$WORK}"
    git clone -q "https://${AUTH}/${REPO}.git" "$D" && echo "cloned -> $D" ;;
  pull)
    git -C "$WORK" fetch -q origin && git -C "$WORK" reset -q --hard "origin/${AGENT_GITHUB_BRANCH_SYNC}" \
      && echo "pulled -> $WORK @ ${AGENT_GITHUB_BRANCH_SYNC}" ;;
  push)
    BR="${2:-$AGENT_GITHUB_BRANCH_SYNC}"; MSG="${3:-swarm agent sync $(date -u +%Y-%m-%dT%H:%M:%SZ)}"
    git -C "$WORK" add -A
    if git -C "$WORK" diff --cached --quiet; then echo "nothing to commit"; exit 0; fi
    if git -C "$WORK" diff --cached | grep -qEi 'ghp_[A-Za-z0-9]{20,}|github_pat_|eyJ''hbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9|cfa''t_|vck_[A-Za-z0-9]{16,}|BEGIN (RSA|OPENSSH) PRIVATE KEY'; then
      echo "BLOCKED: staged content looks like a secret (public repo!)" >&2; exit 1; fi
    git -C "$WORK" commit -q -m "$MSG" && git -C "$WORK" push -q "https://${AUTH}/${REPO}.git" "HEAD:refs/heads/${BR}" \
      && echo "pushed -> ${BR}" ;;
  api)
    if [ "$#" -ge 3 ] && [[ "${2}" =~ ^(GET|POST|PUT|PATCH|DELETE)$ ]]; then
      M="$2"; P="$3"; B="${4:-}"
    else
      M="GET"; P="${2:-/}"; B="${3:-}"
    fi
    A=(); [ -n "$B" ] && A=(-d "$B")
    curl -s --max-time 30 -X "$M" -H "Authorization: Bearer ${AGENT_GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" ${A[@]+"${A[@]}"} "https://api.github.com${P}" ;;
  *) echo "usage: gh.sh {whoami|clone|pull|push|api}" >&2; exit 1 ;;
esac
