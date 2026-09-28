#!/usr/bin/env bash
# agent-bootstrap.sh — ONE-SHOT connectivity verification for every swarm agent.
# Verifies: shared Supabase DB (REST 200) + shared GitHub repo (token valid + repo reachable).
# Prints STATUS CODES ONLY. Never prints secret values. Exit 0 = fully connected.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/agent-connect.env.sh" 2>/dev/null
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
sb="000"; gh="000"; repo="000"

if [ -n "${AGENT_SUPABASE_URL:-}" ] && [ -n "${AGENT_SUPABASE_JWT:-}" ]; then
  sb="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -H "apikey: ${AGENT_SUPABASE_JWT}" -H "Authorization: Bearer ${AGENT_SUPABASE_JWT}" \
    "${AGENT_SUPABASE_URL}/rest/v1/" 2>/dev/null)"; sb="${sb:-000}"
fi
if [ -n "${AGENT_GITHUB_TOKEN:-}" ]; then
  gh="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -H "Authorization: Bearer ${AGENT_GITHUB_TOKEN}" https://api.github.com/user 2>/dev/null)"; gh="${gh:-000}"
  repo="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 \
    -H "Authorization: Bearer ${AGENT_GITHUB_TOKEN}" "https://api.github.com/repos/${AGENT_GITHUB_REPO}" 2>/dev/null)"; repo="${repo:-000}"
fi
echo "AGENT-DB-CONNECT ${TS} supabase=${sb} github_user=${gh} github_repo=${repo} repo=${AGENT_GITHUB_REPO:-unset} branch_sync=${AGENT_GITHUB_BRANCH_SYNC} workspace=${AGENT_WORKSPACE_ID:+set}"
[ "$sb" = "200" ] && [ "$gh" = "200" ] && [ "$repo" = "200" ]
