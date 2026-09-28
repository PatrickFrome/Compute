#!/bin/bash
# Explore Supabase project: connectivity, tables, storage, context-vault
# URL is DERIVED from JWT ref claim to avoid transcription errors
set -u
ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
SJ="$(sed -n 's/^SUPABASE_SERVICE_ROLE_JWT=//p' "$ENVF" | head -1 | tr -d '\r\n')"
REF="$(echo "$SJ" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('ref',''))" 2>/dev/null)"
SU="https://${REF}.supabase.co"
# Rewrite env with corrected URL (keep JWT)
umask 177; printf 'SUPABASE_URL=%s\nSUPABASE_SERVICE_ROLE_JWT=%s\n' "$SU" "$SJ" > "$ENVF"; chmod 600 "$ENVF"
H_AUTH="Authorization: Bearer $SJ"
H_API="apikey: $SJ"

echo "=== 1. Project ==="
echo "URL: $SU  (derived from JWT ref, JWT hidden)"

echo ""
echo "=== 2. REST API (PostgREST) root: HTTP status + defined tables ==="
code="$(curl -s -o /tmp/sb-root.json -w '%{http_code}' -H "$H_API" -H "$H_AUTH" -H 'Accept: application/openapi+json' --max-time 30 "$SU/rest/v1/")"
echo "HTTP $code"
if [ "$code" = "200" ]; then
  python3 /home/z/my-project/scripts/phoenix/_parse_root.py 2>/dev/null || head -c 500 /tmp/sb-root.json
else
  head -c 300 /tmp/sb-root.json 2>/dev/null; echo
fi

echo ""
echo "=== 3. Storage buckets ==="
code="$(curl -s -o /tmp/sb-buckets.json -w '%{http_code}' -H "$H_API" -H "$H_AUTH" --max-time 30 "$SU/storage/v1/bucket")"
echo "HTTP $code"
if [ "$code" = "200" ]; then
  python3 /home/z/my-project/scripts/phoenix/_parse_buckets.py 2>/dev/null
else
  head -c 300 /tmp/sb-buckets.json 2>/dev/null; echo
fi

echo ""
echo "=== 4. Objects in me2-evidence/context-vault (previous session context) ==="
for prefix in "context-vault" "context-vault/latest" ""; do
  code="$(curl -s -o /tmp/sb-obj.json -w '%{http_code}' -X POST -H "$H_API" -H "$H_AUTH" -H 'Content-Type: application/json' --max-time 30 -d "{\"prefix\":\"$prefix\",\"limit\":100}" "$SU/storage/v1/object/list/me2-evidence")"
  if [ "$code" = "200" ]; then
    echo "prefix='$prefix' -> HTTP 200:"
    python3 /home/z/my-project/scripts/phoenix/_parse_objects.py 2>/dev/null
    break
  else
    echo "prefix='$prefix' -> HTTP $code"
  fi
done

echo ""
echo "=== 5. auth/users count (admin, no PII printed) ==="
code="$(curl -s -o /tmp/sb-users.json -w '%{http_code}' -H "$H_API" -H "$H_AUTH" --max-time 30 "$SU/auth/v1/admin/users")"
uc="$(python3 -c "import json;d=json.load(open('/tmp/sb-users.json'));print(len(d.get('users',[])))" 2>/dev/null || echo '?')"
echo "HTTP $code; user_count=$uc (emails/ids hidden)"
