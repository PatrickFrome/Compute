#!/usr/bin/env bash
# capsule-upload-retry-1130.sh — background retry of capsule upload to Supabase Storage.
# 5 attempts, 3-min backoff. Secrets never printed; errors masked. Writes result to
# /tmp/capsule-upload-retry.out (safe to print: no secrets, errors masked).
set -u
OUT="/tmp/capsule-upload-retry.out"
ENVF="/tmp/my-project/.a2-backup/me2.env.20260922"
F="/home/z/my-project/download/me2-capsule-20260929-033230.tar.gz"
SU="$(grep -oE '^SUPABASE_URL=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n "')"
SJ="$(grep -oE '^SUPABASE_SERVICE_ROLE_JWT=.*' "$ENVF" | head -1 | cut -d= -f2- | tr -d '\r\n "')"
URL="$SU/storage/v1/object/me2-evidence/context-vault/capsules/me2-capsule-20260929-033230.tar.gz"
HDR="$(mktemp /tmp/.cap-hdr.XXXXXX)"; chmod 600 "$HDR"
printf 'Authorization: Bearer %s\napikey: %s\nx-upsert: true\nContent-Type: application/gzip\n' "$SJ" "$SJ" > "$HDR"
BODY="$(mktemp /tmp/.cap-body.XXXXXX)"; chmod 600 "$BODY"
for try in 1 2 3 4 5; do
  code="$(curl -s -o "$BODY" -w '%{http_code}' -X POST -H @"$HDR" --data-binary @"$F" --max-time 120 "$URL" 2>/dev/null)"; code="${code:-000}"
  case "$code" in
    2??)
      echo "UPLOAD OK HTTP=$code try=$try"
      echo "DOWNLOAD_URL: $URL"
      rm -f "$HDR" "$BODY"; exit 0 ;;
    *)
      err="$(head -c 200 "$BODY" 2>/dev/null | tr -d '\n' | sed -E 's/[A-Za-z0-9_.\/+-]{40,}/<masked>/g')"
      echo "try=$try HTTP=$code err=$err" >> "$OUT" ;;
  esac
  [ "$try" -lt 5 ] && sleep 180
done
echo "UPLOAD FAILED after 5 tries (see above)" >> "$OUT"
rm -f "$HDR" "$BODY"
