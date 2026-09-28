#!/bin/bash
# Restore context from Supabase me2-evidence/context-vault (phoenix-restore style)
set -u
ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
SU="$(sed -n 's/^SUPABASE_URL=//p' "$ENVF" | head -1 | tr -d '\r\n')"
SJ="$(sed -n 's/^SUPABASE_SERVICE_ROLE_JWT=//p' "$ENVF" | head -1 | tr -d '\r\n')"
PROJ="/home/z/my-project"
VAULT="/home/z/context-vault"

echo "=== Listing context-vault/latest/ ==="
curl -s -X POST -H "apikey: $SJ" -H "Authorization: Bearer $SJ" -H 'Content-Type: application/json' \
  --max-time 30 -d '{"prefix":"context-vault/latest","limit":100}' \
  "$SU/storage/v1/object/list/me2-evidence" -o /tmp/sb-latest.json
python3 - <<'PY'
import json
try:
    objs = json.load(open('/tmp/sb-latest.json'))
    for o in objs:
        kind = 'DIR ' if o.get('id') is None else 'FILE'
        md = o.get('metadata') or {}
        print(f"  {kind} {o.get('name')}  ({md.get('size','?')}B, upd={(o.get('updated_at') or '')[:19]})")
except Exception as e:
    print("  parse error:", e)
PY

echo ""
echo "=== Downloading context files ==="
dl() { # dl <remote_path> <local_path>
  code="$(curl -s -o "$2" -w '%{http_code}' -H "apikey: $SJ" -H "Authorization: Bearer $SJ" --max-time 60 "$SU/storage/v1/object/me2-evidence/$1")"
  sz="$(stat -c%s "$2" 2>/dev/null || echo 0)"
  echo "  $1 -> $2 : HTTP $code, ${sz}B"
}
mkdir -p "$VAULT/latest" "$VAULT/journal" "$PROJ/scripts/phoenix"
dl "context-vault/latest/worklog.md"            "$PROJ/worklog.md"
dl "context-vault/CONTEXT.md"                   "$PROJ/CONTEXT.md"
dl "context-vault/latest/CONTEXT.md"            "/tmp/ctx-latest-CONTEXT.md"
dl "context-vault/latest/CONTEXT-CURRENT.md"    "$PROJ/CONTEXT-CURRENT.md"
dl "context-vault/latest/PHOENIX-PROTOCOL.md"   "$PROJ/PHOENIX-PROTOCOL.md"
dl "context-vault/latest/phoenix-heartbeat.sh"  "$VAULT/latest/phoenix-heartbeat.sh"
dl "context-vault/latest/phoenix-restore.sh"    "$PROJ/scripts/phoenix/phoenix-restore.sh"
dl "context-vault/latest/phoenix-snapshot.sh"   "$PROJ/scripts/phoenix/phoenix-snapshot.sh"
dl "context-vault/latest/context-guard.sh"      "$VAULT/context-guard.sh"
dl "context-vault/context-guard.sh"             "/tmp/ctx-context-guard.sh"
dl "context-vault/journal-context.log"          "$VAULT/journal/context-journal.log"
dl "context-vault/journal-incidents.log"        "$VAULT/journal/incidents.log"
dl "context-vault/latest/journal-context.log"   "$VAULT/latest/journal-context.log"
dl "context-vault/latest/journal-incidents.log" "$VAULT/latest/journal-incidents.log"
chmod +x "$VAULT"/latest/*.sh "$PROJ"/scripts/phoenix/*.sh 2>/dev/null
echo ""
echo "=== Local sizes after restore ==="
for f in "$PROJ/worklog.md" "$PROJ/CONTEXT.md" "$PROJ/CONTEXT-CURRENT.md" "$PROJ/PHOENIX-PROTOCOL.md"; do
  echo "  $f : $(stat -c%s "$f" 2>/dev/null || echo 0)B"
done
