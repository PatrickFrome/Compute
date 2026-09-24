#!/usr/bin/env bash
# R68: self-test канала webhooks-in (POST /hooks/github, push-фаза P0-e).
#
# Секрет GITHUB_WEBHOOK_SECRET читается из vault (data/me2.db, tokens) —
# НИКОГДА не печатается и не попадает в логи. Если в vault'а нет — генерирует
# случайный и кладёт через POST /tokens op=set (канонический путь).
#
# Проверки:
#   F1 POST без подписи            → 401 (expect)
#   F2 POST с битой подписью       → 401 (expect)
#   T1 POST ping с валидной HMAC   → 200 + emitted HOOK_PING (expect)
#   T2 повтор той же доставки GUID → 200 dedupe:true, без повторного события (expect)
#   T3 POST push валидный          → 200 + emitted GIT_PUSH (expect)
#   S  GET /hooks                  → verdict/counters (info)
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
REST="${ME2_REST:-http://127.0.0.1:3041}"
FAIL=0
expect() { # name actual want
  if [ "$2" = "$3" ]; then echo "  ✓ $1: $2"; else echo "  ✗ $1: $2 (expect $3)"; FAIL=1; fi
}

# ── секрет из vault (никогда не печатаем) ──────────────────────────
SECRET=$(ME2_DB="$HERE/../data/me2.db" bun -e '
import { Database } from "bun:sqlite";
const db = new Database(process.env.ME2_DB!, { readonly: true });
try {
  const r = db.query("SELECT value FROM tokens WHERE name=?").get("GITHUB_WEBHOOK_SECRET");
  if (r && (r as { value?: string }).value) process.stdout.write(String((r as { value: string }).value));
} finally { db.close(false); }
')
if [ -z "$SECRET" ]; then
  SECRET=$(bun -e 'process.stdout.write(require("crypto").randomBytes(32).toString("hex"))')
  curl -s -X POST "$REST/tokens" -H 'content-type: application/json' \
    -d "{\"op\":\"set\",\"name\":\"GITHUB_WEBHOOK_SECRET\",\"value\":\"$SECRET\",\"by\":\"r68-selftest\"}" >/dev/null
  echo "vault: GITHUB_WEBHOOK_SECRET создан (op=set, значение скрыто)"
else
  echo "vault: GITHUB_WEBHOOK_SECRET найден (значение скрыто)"
fi

sign() { # $1=body → sha256=hex
  HOOK_BODY="$1" HOOK_SECRET="$SECRET" bun -e 'const c=require("crypto");process.stdout.write("sha256="+c.createHmac("sha256",process.env.HOOK_SECRET!).update(process.env.HOOK_BODY||"").digest("hex"))'
}

TS=$(date +%s)
GUID="r68-selftest-$TS"
BODY='{"zen":"me2 r68 selftest: non-blocking failure is the only failure.","hook_id":68,"repository":{"full_name":"PatrickFrome/Compute"}}'
SIG=$(sign "$BODY")

echo "F1: POST без подписи"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$REST/hooks/github" -H 'content-type: application/json' \
  -H "x-github-event: ping" -H "x-github-delivery: $GUID" -d "$BODY")
expect "F1 no-signature" "$C" "401"

echo "F2: POST с битой подписью"
C=$(curl -s -o /dev/null -w '%{http_code}' -X POST "$REST/hooks/github" -H 'content-type: application/json' \
  -H "x-github-event: ping" -H "x-github-delivery: $GUID" \
  -H "x-hub-signature-256: sha256=0000000000000000000000000000000000000000000000000000000000000000" -d "$BODY")
expect "F2 bad-signature" "$C" "401"

echo "T1: POST ping с валидной HMAC"
R=$(curl -s -w '\n%{http_code}' -X POST "$REST/hooks/github" -H 'content-type: application/json' \
  -H "x-github-event: ping" -H "x-github-delivery: $GUID" -H "x-hub-signature-256: $SIG" -d "$BODY")
C=$(echo "$R" | tail -1); B=$(echo "$R" | head -1)
expect "T1 ping HTTP" "$C" "200"
echo "$B" | grep -q '"HOOK_PING"' && echo "  ✓ T1 emitted HOOK_PING" || { echo "  ✗ T1 HOOK_PING не эмиттен: $B"; FAIL=1; }

echo "T2: повтор той же доставки (dedupe)"
R=$(curl -s -w '\n%{http_code}' -X POST "$REST/hooks/github" -H 'content-type: application/json' \
  -H "x-github-event: ping" -H "x-github-delivery: $GUID" -H "x-hub-signature-256: $SIG" -d "$BODY")
C=$(echo "$R" | tail -1); B=$(echo "$R" | head -1)
expect "T2 dedupe HTTP" "$C" "200"
echo "$B" | grep -q '"dedupe":true' && echo "  ✓ T2 dedupe:true (повторного события нет)" || { echo "  ✗ T2 dedupe не сработал: $B"; FAIL=1; }

echo "T3: POST push валидный"
BODY2="{\"ref\":\"refs/heads/sandbox/me2-os\",\"after\":\"r68cafe5678\",\"pusher\":{\"name\":\"me2-selftest\"},\"commits\":[{},{}],\"repository\":{\"full_name\":\"PatrickFrome/Compute\"}}"
SIG2=$(sign "$BODY2")
R=$(curl -s -w '\n%{http_code}' -X POST "$REST/hooks/github" -H 'content-type: application/json' \
  -H "x-github-event: push" -H "x-github-delivery: $GUID-push" -H "x-hub-signature-256: $SIG2" -d "$BODY2")
C=$(echo "$R" | tail -1); B=$(echo "$R" | head -1)
expect "T3 push HTTP" "$C" "200"
echo "$B" | grep -q '"GIT_PUSH"' && echo "  ✓ T3 emitted GIT_PUSH" || { echo "  ✗ T3 GIT_PUSH не эмиттен: $B"; FAIL=1; }

echo "S: GET /hooks"
curl -s "$REST/hooks" | bun -e '
const j = await new Response(Bun.stdin.stream()).json();
console.log(`  verdict=${j.verdict} secret=${j.secret} received=${j.received_total} verified=${j.verified_total} rejected=${j.rejected_total} events=${j.events_emitted_total} dedupe_size=${j.dedupe_size}`);'

if [ "$FAIL" = "1" ]; then echo "SELFTEST: FAIL"; exit 1; fi
echo "SELFTEST: PASS"
