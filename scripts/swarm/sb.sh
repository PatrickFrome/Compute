#!/usr/bin/env bash
# sb.sh — Supabase REST helper for ALL swarm agents (shared DB access).
# usage:
#   bash sb.sh <table> [query-params-urlencoded] [method] [json-body]
#   bash sb.sh "" "" GET                      -> probe (prints HTTP code only)
# examples:
#   bash sb.sh me2_event_mirror_h205f22 "select=seq,type&order=seq.desc&limit=3"
#   bash sb.sh me2_event_mirror_h205f22 "" POST '{"type":"AGENT_HELLO","actor":"RESEARCHER","payload":{}}'
# Secrets are sourced from agent-connect.env.sh; NEVER printed.
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/agent-connect.env.sh" 2>/dev/null
if [ -z "${AGENT_SUPABASE_URL:-}" ] || [ -z "${AGENT_SUPABASE_JWT:-}" ]; then
  echo "ERROR: supabase creds not loaded" >&2; exit 2
fi
TBL="$1"; QS="${2:-}"; M="${3:-GET}"; BODY="${4:-}"
if [ -n "$QS" ]; then QS="?$QS"; fi
URL="${AGENT_SUPABASE_URL}/rest/v1/${TBL}${QS}"
ARGS=(-s --max-time 30 -X "$M" -H "apikey: ${AGENT_SUPABASE_JWT}" -H "Authorization: Bearer ${AGENT_SUPABASE_JWT}"
      -H "Content-Type: application/json" -H "Prefer: return=representation")
[ -n "$BODY" ] && ARGS+=(-d "$BODY")
curl "${ARGS[@]}" "$URL"
