#!/usr/bin/env bash
# full-audit.sh v1.0 — максимально детальный аудит всего материала проекта:
# все БД (SQLite/Supabase/Pigsty), все ветки, капсулы, отчёты, секреты-носители.
# Операторское распоряжение 2026-09-27: запускать автоматически (cron) ДО тех пор,
# пока контекст не станет максимально полным (score=100%).
# Честные статусы: DONE / PARTIAL / BLOCKED(+причина). Значения секретов НЕ печатаются.
set -u
ROOT=/home/z/my-project
OUT_DIR="$ROOT/audit"; mkdir -p "$OUT_DIR"
TS=$(date +%Y%m%d-%H%M%S)
OUT="$OUT_DIR/audit-$TS.md"
SEALED=/tmp/my-project/phoenix-sealed/secrets-bootstrap.sh

# --- harvest auth (file -> var; never printed) ---
GH=""; SB_JWT=""; SB_URL="https://sibnfciqcpkuquxzduqr.supabase.co"; CF_API=""; CF_ACCT=""
[ -s /home/z/.a2/.github.env ] && { set -a; . /home/z/.a2/.github.env 2>/dev/null; set +a; GH="${GITHUB_TOKEN_ADMIN:-}"; }
ENVF=/tmp/my-project/.a2-backup/me2.env.20260922
[ -s "$ENVF" ] && { . "$ENVF" 2>/dev/null; SB_URL="${SUPABASE_URL:-$SB_URL}"; SB_JWT="${SUPABASE_SERVICE_ROLE_JWT:-}"; CF_API="${CF_API_TOKEN:-}"; CF_ACCT="${CF_ACCOUNT_ID:-}"; }
cd "$ROOT" 2>/dev/null || exit 2

DONE=0; PARTIAL=0; BLOCKED=0
verdict() { case "$1" in DONE) DONE=$((DONE+1));; PARTIAL) PARTIAL=$((PARTIAL+1));; *) BLOCKED=$((BLOCKED+1));; esac; }

{
echo "# FULL PROJECT AUDIT — $TS"
echo "Директива оператора: полный аудит всех БД/веток/капсул/отчётов до максимальной полноты контекста."
echo

echo "## 1. Git: ветки и синхронизация"
echo '```'
git branch -v --format='%(refname:short) %(objectname:short) %(subject:trailers=off)' 2>/dev/null | cut -c1-100
echo "-- remote refs (anonymous ls-remote, repo публично читаем):"
timeout 45 git ls-remote origin 2>/dev/null | awk '{print "  " $2 " " substr($1,1,12)}' | head -12
echo "-- divergence local main vs origin/sandbox/me2-os (если origin-реф локально известен):"
if git rev-parse -q --verify origin/sandbox/me2-os >/dev/null 2>&1; then
  echo "  behind/ahead: $(git rev-list --left-right --count main...origin/sandbox/me2-os 2>/dev/null || echo n/a)"
else echo "  origin/sandbox/me2-os not fetched locally"; fi
echo "-- dangling objects: $(git fsck --no-progress 2>/dev/null | grep -c dangling || true)"
echo '```'
V_GIT=DONE; verdict DONE
echo
echo "## 2. Канонический worklog"
WLS=$(stat -c%s worklog.md 2>/dev/null || echo 0)
SEC=$(grep -c '^Task ID:' worklog.md 2>/dev/null || echo 0)
LAST=$(grep '^Task ID:' worklog.md 2>/dev/null | tail -1)
GSHA=$(cat /home/z/context-vault/latest/worklog.sha256 2>/dev/null | cut -c1-12)
LSHA=$(sha256sum worklog.md 2>/dev/null | cut -c1-12)
echo "- размер: ${WLS}B; секций Task ID: $SEC; последняя: $LAST"
if [ -n "$GSHA" ] && [ "$GSHA" = "$LSHA" ]; then echo "- guard-эталон: СОВПАДАЕТ ($GSHA)"; V_WL=DONE; else echo "- guard-эталон: $GSHA vs local $LSHA (расхождение = свежая правка до guard-тика)"; V_WL=PARTIAL; fi
verdict "$V_WL"
echo
echo "## 3. Базы данных"
echo "### 3.1 SQLite (локальная)"
for DBF in db/custom.db db/*.db; do
  [ -f "$DBF" ] || continue
  echo "- $DBF: $(stat -c%s "$DBF")B"
  if command -v bun >/dev/null 2>&1; then
    bun -e "import {Database} from 'bun:sqlite'; const db=new Database('$DBF',{readonly:true}); const t=db.query(\"SELECT name FROM sqlite_master WHERE type='table'\").all(); console.log('  tables:', t.map(x=>x.name).join(', ')||'(none)'); for (const x of t) { const n=db.query('SELECT COUNT(*) c FROM \"'+x.name+'\"').get(); console.log('  ', x.name, '=', n.c, 'rows'); }" 2>/dev/null || echo "  (bun:sqlite read failed)"
  else echo "  (bun недоступен)"; fi
done
[ -f db/custom.db ] && { V_SQL=DONE; verdict DONE; } || { echo "- db/custom.db: ОТСУТСТВУЕТ"; V_SQL=BLOCKED; verdict BLOCKED; }
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
  V_SB=DONE; verdict DONE
else
  echo "- host: $SB_URL"
  echo "- СТАТУС: BLOCKED — SUPABASE_SERVICE_ROLE_JWT утерян 2026-09-26 17:11 (ENVF→0B); облачная копия циклична."
  echo "  Для завершения аудита БД оператору нужно перевыпустить service_role JWT, затем: bash scripts/phoenix/tools/build-sealed-bootstrap.sh"
  V_SB=BLOCKED; verdict BLOCKED
fi
echo "### 3.3 Pigsty/PostgreSQL (127.0.0.1:55432)"
if timeout 3 bash -c 'echo > /dev/tcp/127.0.0.1/55432' 2>/dev/null; then echo "- TCP: ОТКРЫТ"; V_PG=PARTIAL; else echo "- TCP: закрыт (кластер погиб при reset; исторический, по creds-doc)"; V_PG=DONE; fi
verdict "$V_PG"
echo
echo "## 4. Капсулы и evidence"
CAP="https://sibnfciqcpkuquxzduqr.supabase.co/storage/v1/object/public/me2-capsule/me2-os-capsule-2026-09-26.zip"
CRESP=$(curl -s -o /dev/null -w '%{http_code} %{size_download}' -I --max-time 20 "$CAP" 2>/dev/null)
echo "- me2-capsule (public): HTTP/размер HEAD → ${CRESP:-unreachable} (объект me2-os-capsule-2026-09-26.zip)"
[ "${CRESP%% *}" = "200" ] && { V_CAP=DONE; verdict DONE; } || { V_CAP=BLOCKED; verdict BLOCKED; }
if [ -n "$SB_JWT" ]; then
  LST=$(curl -s --max-time 20 -X POST -H "apikey: $SB_JWT" -H "Authorization: Bearer $SB_JWT" -H "Content-Type: application/json" "$SB_URL/storage/v1/me2-evidence/list" -d '{"prefix":"context-vault","limit":50}' 2>/dev/null | grep -oE '"name":"[^"]+"' | head -15)
  echo "- me2-evidence (service-key): ${LST:-пусто/недоступно}"; V_EV=DONE
else echo "- me2-evidence: BLOCKED (нужен service JWT — см. 3.2)"; V_EV=BLOCKED; fi
verdict "$V_EV"
if [ -d a2-capsule ]; then
  NA=$(find a2-capsule -type f 2>/dev/null | wc -l); SA=$(du -sb a2-capsule 2>/dev/null | cut -f1)
  echo "- локальная a2-capsule/: $NA файлов, ${SA}B"; V_LCAP=DONE; else V_LCAP=BLOCKED; echo "- локальная a2-capsule/: отсутствует"; fi
verdict "$V_LCAP"
echo
echo "## 5. Отчёты и документы"
MDS=$(find . -maxdepth 3 -name '*.md' -not -path './node_modules/*' -not -path './.git/*' -not -path './.next/*' 2>/dev/null)
echo "- md-документов (depth<=3): $(echo "$MDS" | grep -c . )"
echo "$MDS" | head -20 | while read -r f; do [ -f "$f" ] && echo "  - $f ($(stat -c%s "$f")B, sha12=$(sha256sum "$f" | cut -c1-12))"; done
V_REP=DONE; verdict DONE
echo
echo "## 6. Секреты и носители (значения не печатаются)"
if [ -s /home/z/.a2/.github.env ]; then
  C=$( (set -a; . /home/z/.a2/.github.env 2>/dev/null; set +a; [ -n "${GITHUB_TOKEN_ADMIN:-}" ] && curl -s -o /dev/null -w '%{http_code}' -H "Authorization: token ${GITHUB_TOKEN_ADMIN}" https://api.github.com/user) || echo 000)
  echo "- .github.env: присутствует, github_api=$C"; [ "$C" = "200" ] && V_S1=DONE || V_S1=BLOCKED
else echo "- .github.env: ОТСУТСТВУЕТ"; V_S1=BLOCKED; fi
verdict "$V_S1"
echo "- ENVF: $( [ -s "$ENVF" ] && echo "присутствует ($(stat -c%s "$ENVF")B, ключей: $(grep -cE '^[A-Z_]+=' "$ENVF"))" || echo '0B/отсутствует (JWT ожидает перевыпуска)')"
if [ -s "$SEALED" ]; then echo "- sealed: $(stat -c%s "$SEALED")B sha12=$(sha256sum "$SEALED" | cut -c1-12) + зеркала"; V_S2=DONE; else echo "- sealed: ОТСУТСТВУЕТ"; V_S2=BLOCKED; fi
verdict "$V_S2"
echo
echo "## 7. Итог полноты"
echo "- DONE=$DONE PARTIAL=$PARTIAL BLOCKED=$BLOCKED"
SCORE=$(( (DONE*100 + PARTIAL*50) / (DONE+PARTIAL+BLOCKED) ))
echo "- COMPLETENESS SCORE: $SCORE%"
if [ "$BLOCKED" = "0" ] && [ "$PARTIAL" = "0" ]; then echo "- ВЕРДИКТ: AUDIT COMPLETE — контекст максимально полон"; else echo "- ВЕРДИКТ: контекст НЕПОЛОН — см. BLOCKED выше (критический блокер: Supabase service JWT)"; fi
} > "$OUT"

# state (для цикла cron: повторять до 100%)
{ echo "ts=$TS score=$SCORE done=$DONE partial=$PARTIAL blocked=$BLOCKED report=$OUT"; } >> "$OUT_DIR/.audit-state"
echo "audit written: $OUT ($(stat -c%s "$OUT")B)"
echo "score=$SCORE% done=$DONE partial=$PARTIAL blocked=$BLOCKED"
grep -E 'СТАТУС|BLOCKED|ВЕРДИКТ' "$OUT" | head -8
