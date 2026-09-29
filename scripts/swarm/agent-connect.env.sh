#!/usr/bin/env bash
# agent-connect.env.sh — v1 (2026-09-28) Swarm shared-DB connect env (Supabase + GitHub)
# Purpose: EVERY swarm agent (PLANNER/RESEARCHER/IMPLEMENTER/CRITIC + IM cron agents)
#          connects to the ONE shared database via the same canonical credentials.
# Usage:   . /home/z/my-project/scripts/swarm/agent-connect.env.sh   (or source it)
# RULE:    secrets are sourced, NEVER echoed/printed/logged/committed (directive + lesson R8).
set -u

# --- canonical secret stores (phoenix-restored) ---
_ME2="${ME2_ENV:-/tmp/my-project/.a2-backup/me2.env.20260922}"
_GHENV="${GH_ENV:-/home/z/.a2/.github.env}"
_SWARM="${SWARM_SECRETS:-$(dirname "${BASH_SOURCE[0]}")/swarm-secrets.env}"

# order: swarm-secrets (self-contained capsule) -> me2.env -> github.env  (first source wins via :-)
[ -s "$_SWARM" ] && . "$_SWARM" 2>/dev/null
[ -s "$_ME2" ]   && . "$_ME2"   2>/dev/null
[ -s "$_GHENV" ] && . "$_GHENV" 2>/dev/null

export AGENT_SUPABASE_URL="${AGENT_SUPABASE_URL:-${SUPABASE_URL:-}}"
export AGENT_SUPABASE_JWT="${AGENT_SUPABASE_JWT:-${SUPABASE_SERVICE_ROLE_JWT:-}}"
export AGENT_GITHUB_TOKEN="${AGENT_GITHUB_TOKEN:-${GITHUB_TOKEN_ADMIN:-${GITHUB_TOKEN:-}}}"
export AGENT_GITHUB_REPO="${AGENT_GITHUB_REPO:-${GITHUB_REPO:-PatrickFrome/Compute}}"
export AGENT_GITHUB_BRANCH_SYNC="sandbox/me2-os"
export AGENT_WORKSPACE_ID="${AGENT_WORKSPACE_ID:-${WORKSPACE_ID:-}}"
export AGENT_CLIENT_ID="${AGENT_CLIENT_ID:-${CLIENT_ID:-}}"
export AGENT_SWARM_DIR="${AGENT_SWARM_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)}"

# canonical DB tables (suffix _h205f22):
#   compute_fabric_a2_browser_supervisor_state_h205f22  (heartbeat/state)
#   compute_fabric_a2_browser_supervisor_command_h205f22 (command queue: status/receipt/error)
#   compute_fabric_a2_supervisor_mesh_instance_h205f22   (fleet)
#   compute_fabric_a2_browser_device_h205f22             (devices)
#   me2_event_mirror_h205f22                             (event journal / capsule storage)

agent_db_ok()   { [ -n "$AGENT_SUPABASE_URL" ] && [ -n "$AGENT_SUPABASE_JWT" ]; }
agent_gh_ok()   { [ -n "$AGENT_GITHUB_TOKEN" ] && [ -n "$AGENT_GITHUB_REPO" ]; }
agent_status() { # prints codes only, never values
  echo "supabase=$([ "$(bash "$AGENT_SWARM_DIR/sb.sh" '' '' GET >/dev/null 2>&1; echo $?)" = 0 ] && echo loaded || echo missing) github=$([ -n "$AGENT_GITHUB_TOKEN" ] && echo loaded || echo missing)"
}
