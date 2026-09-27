#!/usr/bin/env bash
# sbq.sh — Supabase REST query helper (secrets never printed)
# usage: sbq.sh <table> [query-params-urlencoded] [method]
set -u
. /tmp/my-project/.a2-backup/me2.env.20260922 2>/dev/null
SU="${SUPABASE_URL:-}"; SJ="${SUPABASE_SERVICE_ROLE_JWT:-}"
if [ -z "$SU" ] || [ -z "$SJ" ]; then echo "ERROR: creds not loaded" >&2; exit 2; fi
TBL="$1"; QS="${2:-}"; M="${3:-GET}"
if [ -n "$QS" ]; then QS="?$QS"; fi
curl -s --max-time 30 -X "$M" \
  -H "apikey: ${SJ}" -H "Authorization: Bearer ${SJ}" \
  -H "Content-Type: application/json" \
  "${SU}/rest/v1/${TBL}${QS}"
