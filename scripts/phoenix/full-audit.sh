#!/usr/bin/env bash
# full-audit.sh v2.0 — максимально детальный аудит всего материала проекта:
# все БД (SQLite/Supabase/Pigsty), все ветки, капсулы, отчёты, секреты-носители (4 канала),
# GitHub API, Cloudflare/R2 REST, контекст-капсула (vault), runtime-инфраструктура.
# Операторское распоряжение 2026-09-27: запускать автоматически (cron 416761 + auto_audit
# из phoenix-secrets-restore) ДО тех пор, пока контекст не станет максимально полным (score=100%).
# v2.0 (SEC-SEALED-3): +7 GitHub API, +8 Cloudflare/R2, +9 vault-капсула, +10 runtime,
#                      расширен §6 (sealed-local канал SEC-SEALED-3 + зеркала + creds-doc).
# Честные статусы: DONE / PARTIAL / BLOCKED(+причина). Значения секретов НЕ печатаются.
set -u
ROOT=/home/z/my-project
OUT_DIR="$ROOT/audit"; mkdir -p "$OUT_DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$OUT_DIR/audit-$TS.md"
SEALED=/tmp/my-project/phoenix-sealed/secrets-bootstrap.sh
SEALED_LOCAL="$ROOT/scripts/phoenix/phoenix-secrets-restore.sealed.sh"
CREDS_DOC=/tmp/my-project/.a2-creds-01.md
VAULT=/home/z/context-vault

# --- harvest auth (file -> var; never printed) ---
GH=""; SB_JWT=""; SB_URL="https://sibnfciqcpkuquxzduqr.supabase.co"; CF_API=""; CF_ACCT=""; CF_AI=""
[ -s /home/z/.a2/.github.env ] && { set -a; . /home/z/.a2/.github.env 2>/dev/null; set +a; GH="${GITHUB_TOKEN_ADMIN:-}"; }
ENVF=/tmp/my-project/.a2-backup/me2.env.20260922
[ -s "$ENVF" ] && { . "$ENVF" 2>/dev/null; SB_URL="${SUPABASE_URL:-$SB_URL}"; SB_JWT="${SUPABASE_SERVICE_ROLE_JWT:-}"; CF_API="${CF_API_TOKEN:-}"; CF_ACCT="${CF_ACCOUNT_ID:-}"; CF_AI="${CF_AI_WORKER_TOKEN:-}"; }
cd "$ROOT" 2>/dev/null || exit 2

DONE=0; PARTIAL=0; BLOCKED=0
verdict() { case "$1" in DONE) DONE=$((DONE+1));; PARTIAL) PARTIAL=$((PARTIAL+1));; *) BLOCKED=$((BLOCKED+1));; esac; }

{
echo "# FULL PROJECT AUDIT v2.0 — $TS"
echo "Директива оператора: полный аудит всех БД/веток/капсул/отчётов/секретов до максимальной полноты контекста (авто-цикл)."
echo

echo "## 1. Git: ветки и синхронизация"
echo '```'
git branch -v --format='%(refname:short) %(objectname:short) %(subject:trailers=off)' 2>/dev/null | cut -c1-100
echo "-- remote refs (anonymous ls-remote, repo публично читаем):"
timeout 45 git ls-remote origin 2>/dev/null | awk '{print "  " $2 " " substr($1,1,12)}' | head -14
echo "-- divergence local main vs origin/sandbox/me2-os:"
if git rev-parse -q --verify origin/sandbox/me2-os >/dev/null 2>&1; then
  echo "  behind/ahead: $(git rev-list --left-right --count main...origin/sandbox/me2-os 2>/dev/null || echo n/a)"
else echo "  origin/sandbox/me2-os not fetched locally"; fi
echo "-- dangling objects: $(git fsck --no-progress 2>/dev/null | grep -c dangling || true)"
echo '```'
verdict DONE
echo

echo "## 2. Канонический worklog"
WLS=$(stat -c%s worklog.md 2>/dev/null || echo 0)
SEC=$(grep -c '^Task ID:' worklog.md 2>/dev/null || echo 0)
LAST=$(grep '^Task ID:' worklog.md 2>/dev/null | tail -1)
GSHA=$(cat "$VAULT/latest/worklog.sha256" 2>/dev/null | cut -c1-12)
LSHA=$(sha256sum worklog.md 2>/dev/null | cut -c1-12)
echo "- размер: ${WLS}B; секций Task ID: $SEC; последняя: $LAST"
if [ -n "$GSHA" ] && [ "$GSHA" = "$LSHA" ]; then echo "- guard-эталон: СОВПАДАЕТ ($GSHA)"; verdict DONE; else echo "- guard-эталон: $GSHA vs local $LSHA (расхождение = свежая правка до guard-тика)"; verdict PARTIAL; fi
echo

echo "## 3. Базы данных"
echo "### 3.1 SQLite (локальная)"
for DBF in $(ls -1 db/*.db 2>/dev/null | sort -u); do
  echo "- $DBF: $(stat -c%s "$DBF")B"
  if command -v bun >/dev/null 2>&1; then
    bun -e "import {Database} from 'bun:sqlite'; const db=new Database('$DBF',{readonly:true}); const t=db.query(\"SELECT name FROM sqlite_master WHERE type='table'\").all(); console.log('  tables:', t.map(x=>x.name).join(', ')||'(none)'); for (const x of t) { const n=db.query('SELECT COUNT(*) c FROM \"'+x.name+'\"').get(); console.log('  ', x.name, '=', n.c, 'rows'); }" 2>/dev/null || echo "  (bun:sqlite read failed)"
  else echo "  (bun недоступен)"; fi
done
[ -f db/custom.db ] && verdict DONE || { echo "- db/custom.db: ОТСУТСТВУЕТ"; verdict BLOCKED; }
echo "### 3.2 Supabase (живой проект h205f22)"
if [ -n "$SB_JWT" ]; then
  echo "- host: $SB_URL (JWT присутствует — аудит REST)"
  SPEC=$(curl -s --max-time 20 -H "apikey: $SB_JWT" -H "Authorization: Bearer $SB_JWT" "$SB_URL/rest/v1/" 2>/dev/null)
  TB=$(echo "$SPEC" | grep -oE '"/rest/v1/[a-z0-9_]+"|"definitions":\{"[a-z0-9_]+"' | grep -oE '[a-z0-9_]+"$' | tr -d '"' | head -25)
  echo "- таблиц (первые 25): ${TB:-нет данных}"
  N=0
  for T in $TB; do
    [ $N -ge 10 ] && break; N=$((N+1))
    CR=$(curl -s -o /dev/null -D - --max-time 15 -H "apikey: $SB_JWT" -H "Authorization: Bearer $SB_JWT" -H "Prefer: count=exact" -H "Range: 0-0" "$SB_URL/rest/v1/$T?select=*" 2>/dev/null | grep -i content-range | grep -oE '/[0-9]+' | tr -d '/')
    echo "  $T = ${CR:-?} rows"
  done
  verdict DONE
else
  echo "- host: $SB_URL"
  echo "- СТАТУС: BLOCKED — SUPABASE_SERVICE_ROLE_JWT утерян 2026-09-26 17:11 (ENVF wiped); облачная копия циклична."
  echo "  Для завершения аудита БД оператору нужно перевыпустить service_role JWT."
  verdict BLOCKED
fi
echo "### 3.3 Pigsty/PostgreSQL (127.0.0.1:55432)"
if timeout 3 bash -c 'echo > /dev/tcp/127.0.0.1/55432' 2>/dev/null; then echo "- TCP: ОТКРЫТ"; verdict PARTIAL; else echo "- TCP: закрыт (кластер погиб при reset; исторический, по creds-doc)"; verdict DONE; fi
echo

echo "## 4. Капсулы и evidence"
CAP="https://sibnfciqcpkuquxzduqr.supabase.co/storage/v1/object/public/me2-capsule/me2-os-capsule-2026-09-26.zip"
CRESP=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' -I --max-time 20 "$CAP" 2>/dev/null)
echo "- me2-capsule (public): HTTP/размер HEAD → ${CRESP:-unreachable} (объект me2-os-capsule-2026-09-26.zip)"
[ "${CRESP%% *}" = "200" ] && verdict DONE || verdict BLOCKED
if [ -n "$SB_JWT" ]; then
  LST=$(curl -s --max-time 20 -X POST -H "apikey: $SB_JWT" -H "Authorization: Bearer $SB_JWT" -H "Content-Type: application/json" "$SB_URL/storage/v1/me2-evidence/list" -d '{"prefix":"context-vault","limit":50}' 2>/dev/null | grep -oE '"name":"[^"]+"' | head -15)
  echo "- me2-evidence (service-key): ${LST:-пусто/недоступно}"; verdict DONE
else echo "- me2-evidence: BLOCKED (нужен service JWT — см. 3.2)"; verdict BLOCKED; fi
if [ -d a2-capsule ]; then
  NA=$(find a2-capsule -type f 2>/dev/null | wc -l); SA=$(du -sb a2-capsule 2>/dev/null | cut -f1)
  echo "- локальная a2-capsule/: $NA файлов, ${SA}B"; verdict DONE
else echo "- локальная a2-capsule/: отсутствует (канон: Supabase me2-capsule + capsule/ в .gitignore)"; verdict BLOCKED; fi
echo

echo "## 5. Отчёты и документы"
MDS=$(find . -maxdepth 3 -name '*.md' -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*' 2>/dev/null)
echo "- md-документов (depth<=3): $(echo "$MDS" | grep -c . )"
echo "$MDS" | head -20 | while read -r f; do [ -f "$f" ] && echo "  - $f ($(stat -c%s "$f")B, sha12=$(sha256sum "$f" | cut -c1-12))"; done
echo "- аудит-отчётов в audit/: $(ls -1 audit/audit-*.md 2>/dev/null | wc -l | tr -d ' ') (последний: $(ls -1t audit/audit-*.md 2>/dev/null | head -1))"
verdict DONE
echo

echo "## 6. Секреты и носители — 4 канала выживания (значения не печатаются)"
if [ -s /home/z/.a2/.github.env ]; then
  C=$( (set -a; . /home/z/.a2/.github.env 2>/dev/null; set +a; [ -n "${GITHUB_TOKEN_ADMIN:-}" ] && curl -s -o /dev/null -w '%{http_code}' --max-time 20 -H "Authorization: token ${GITHUB_TOKEN_ADMIN}" https://api.github.com/user) || echo 000)
  echo "- канал A .github.env: присутствует, github_api=$C"; [ "$C" = "200" ] && verdict DONE || verdict BLOCKED
else echo "- канал A .github.env: ОТСУТСТВУЕТ"; verdict BLOCKED; fi
if [ -s "$ENVF" ]; then echo "- канал B ENVF: присутствует ($(stat -c%s "$ENVF")B, ключей: $(grep -cE '^[A-Z_]+=' "$ENVF"))"; verdict DONE; else echo "- канал B ENVF: 0B/отсутствует"; verdict BLOCKED; fi
if [ -s "$SEALED" ]; then echo "- канал C sealed (PolarFS): $(stat -c%s "$SEALED")B sha12=$(sha256sum "$SEALED" | cut -c1-12)"; else echo "- канал C sealed: ОТСУТСТВУЕТ"; fi
MIR=0; [ -s /tmp/context-vault-mirror/phoenix-sealed/secrets-bootstrap.sh ] && MIR=$((MIR+1)); [ -s /home/sync/me2-context-backups/phoenix-sealed/secrets-bootstrap.sh ] && MIR=$((MIR+1))
echo "- канал C зеркала: $MIR/2 (/tmp/context-vault-mirror, /home/sync ossfs)"
if [ -s "$SEALED" ]; then [ "$MIR" -ge 1 ] && verdict DONE || verdict PARTIAL; else verdict BLOCKED; fi
if [ -s "$SEALED_LOCAL" ]; then
  GI=$(git check-ignore -q "$SEALED_LOCAL" 2>/dev/null && echo "git-ignored:yes" || echo "git-ignored:NO!")
  TR=$(git ls-files --error-unmatch "$SEALED_LOCAL" >/dev/null 2>&1 && echo "TRACKED:BAD!" || echo "untracked:ok")
  echo "- канал D sealed-local (SEC-SEALED-3, литералы прямо в скрипте по распоряжению оператора): $(stat -c%s "$SEALED_LOCAL")B $(stat -c%A "$SEALED_LOCAL"), $GI, $TR"
  if echo "$GI$TR" | grep -q 'BAD\|NO!'; then verdict BLOCKED; else verdict DONE; fi
else echo "- канал D sealed-local: ОТСУТСТВУЕТ"; verdict BLOCKED; fi
[ -s "$CREDS_DOC" ] && echo "- creds-doc: присутствует ($(stat -c%s "$CREDS_DOC")B)" || echo "- creds-doc: отсутствует"
echo

echo "## 7. GitHub API (аутентифицированный)"
if [ -n "$GH" ]; then
  TMPF="$(mktemp)"
  CODE=$(curl -s --max-time 20 -o "$TMPF" -w '%{http_code}' -H "Authorization: token $GH" https://api.github.com/repos/PatrickFrome/Compute)
  echo "- GET /repos/PatrickFrome/Compute: HTTP=$CODE"
  if [ "$CODE" = "200" ]; then
    echo "- private=$(grep -m1 -o '"private": *[a-z]*' "$TMPF" | grep -o '[a-z]*$'), default_branch=$(grep -m1 -o '"default_branch": *"[^"]*"' "$TMPF" | cut -d'"' -f4), pushed_at=$(grep -m1 -o '"pushed_at": *"[^"]*"' "$TMPF" | cut -d'"' -f4)"
    verdict DONE
  else verdict PARTIAL; fi
  CCODE=$(curl -s --max-time 20 -o "$TMPF" -w '%{http_code}' -H "Authorization: token $GH" "https://api.github.com/repos/PatrickFrome/Compute/commits?per_page=5")
  echo "- последние 5 коммитов (HTTP=$CCODE):"
  if [ "$CCODE" = "200" ]; then
    grep -oE '"message": "[^"]{1,100}' "$TMPF" | head -5 | cut -d'"' -f4 | cut -d'\\' -f1 | sed 's/^/  /'
    verdict DONE
  else verdict BLOCKED; fi
  RREM=$(curl -s --max-time 20 -H "Authorization: token $GH" https://api.github.com/rate_limit | grep -m1 -o '"remaining": *[0-9]*' | grep -o '[0-9]*$')
  echo "- rate_limit remaining: ${RREM:-?}"
  rm -f "$TMPF"
else
  echo "- BLOCKED: GITHUB_TOKEN_ADMIN отсутствует"; verdict BLOCKED; verdict BLOCKED
fi
echo

echo "## 8. Cloudflare / R2 (REST, Bearer)"
if [ -n "$CF_API" ] && [ -n "$CF_ACCT" ]; then
  AC=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' -H "Authorization: Bearer $CF_API" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT")
  echo "- GET /accounts/{id}: HTTP=$AC (cfat_ скоуп-токен)"; [ "$AC" = "200" ] && verdict DONE || verdict BLOCKED
  BK=$(curl -s --max-time 20 -H "Authorization: Bearer $CF_API" "https://api.cloudflare.com/client/v4/accounts/$CF_ACCT/r2/buckets")
  if echo "$BK" | grep -q '"success":true'; then
    echo "- R2 buckets: $(echo "$BK" | grep -oE '"name":"[^"]+"' | cut -d'"' -f4 | head -10 | tr '\n' ' ')"
    verdict DONE
  else echo "- R2 buckets list: недоступен этим скоуп-токеном (success:false)"; verdict PARTIAL; fi
  echo "- R2 S3 (SIGv4): BLOCKED — secret access key не передан оператором (есть только Access Key ID)"
  verdict BLOCKED
  AV=$(curl -s --max-time 20 -H "Authorization: Bearer ${CF_AI:-none}" "https://api.cloudflare.com/client/v4/user/tokens/verify" | grep -o '"success":[a-z]*' | head -1)
  echo "- AI worker token (cfut_): verify=$AV"
  [ "$AV" = '"success":true' ] && verdict DONE || verdict PARTIAL
else
  echo "- BLOCKED: CF_API_TOKEN/CF_ACCOUNT_ID отсутствуют"; verdict BLOCKED; verdict BLOCKED; verdict BLOCKED
fi
echo

echo "## 9. Контекст-капсула (Phoenix vault)"
if [ -d "$VAULT" ]; then
  NS=$(ls -1 "$VAULT"/snapshots/worklog-*.md 2>/dev/null | wc -l | tr -d ' ')
  echo "- snapshots: $NS worklog-снапшотов; latest sha12=$(cat "$VAULT/latest/worklog.sha256" 2>/dev/null | cut -c1-12)"
  echo "- incidents: $(wc -l < "$VAULT/journal/incidents.log" 2>/dev/null || echo 0) записей; journal: $(wc -l < "$VAULT/journal/context-journal.log" 2>/dev/null || echo 0) строк"
  [ -d "$VAULT/repo/.git" ] && echo "- vault/repo HEAD: $(git -C "$VAULT/repo" log --oneline -1 2>/dev/null | cut -c1-60)"
  for f in CONTEXT.md CONTEXT-CURRENT.md PHOENIX-PROTOCOL.md; do
    [ -s "$ROOT/$f" ] && echo "- $f: $(stat -c%s "$ROOT/$f")B sha12=$(sha256sum "$ROOT/$f" | cut -c1-12)" || echo "- $f: ОТСУТСТВУЕТ"
  done
  [ "$NS" -ge 1 ] && verdict DONE || verdict PARTIAL
else
  echo "- BLOCKED: /home/z/context-vault отсутствует"; verdict BLOCKED
fi
echo

echo "## 10. Runtime-инфраструктура"
echo "- prisma models: $(grep -c '^model ' prisma/schema.prisma 2>/dev/null || echo 0) ($(grep -oE '^model [A-Za-z]+' prisma/schema.prisma 2>/dev/null | awk '{print $2}' | tr '\n' ' '))"
echo "- mini-services: $(ls -1 mini-services 2>/dev/null | tr '\n' ' ')"
echo "- scripts/phoenix: $(ls -1 scripts/phoenix/*.sh scripts/phoenix/tools/*.sh 2>/dev/null | wc -l | tr -d ' ') скриптов (оркестратор v1.1, full-audit v2.0, builder, heartbeat, restore, snapshot$([ -s "$SEALED_LOCAL" ] && echo ', sealed-local SEC-SEALED-3'))"
[ -s "$ROOT/dev.log" ] && echo "- dev.log: $(stat -c%s "$ROOT/dev.log")B, error/fatal в последних 200 строках: $(tail -200 "$ROOT/dev.log" 2>/dev/null | grep -ciE 'error|fatal' || true)"
command -v bun >/dev/null 2>&1 && echo "- bun: $(bun --version 2>/dev/null)"
verdict DONE
echo

echo "## 11. Итог полноты"
echo "- DONE=$DONE PARTIAL=$PARTIAL BLOCKED=$BLOCKED"
SCORE=$(( (DONE*100 + PARTIAL*50) / (DONE+PARTIAL+BLOCKED) ))
echo "- COMPLETENESS SCORE: $SCORE%"
if [ "$BLOCKED" = "0" ] && [ "$PARTIAL" = "0" ]; then echo "- ВЕРДИКТ: AUDIT COMPLETE — контекст максимально полон"; else echo "- ВЕРДИКТ: контекст НЕПОЛОН — см. BLOCKED выше (корневой блокер: Supabase service JWT утерян 2026-09-26 17:11; R2 secret access key не передан)"; fi
} > "$OUT"

# state (для цикла cron: повторять до 100%)
{ echo "ts=$TS score=$SCORE done=$DONE partial=$PARTIAL blocked=$BLOCKED report=$OUT"; } >> "$OUT_DIR/.audit-state"
echo "audit written: $OUT ($(stat -c%s "$OUT")B)"
echo "score=$SCORE% done=$DONE partial=$PARTIAL blocked=$BLOCKED"
grep -E 'СТАТУС|BLOCKED|ВЕРДИКТ' "$OUT" | head -10
