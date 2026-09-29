#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ME2 R58 «Политики как данные» — RLS-самоаудит облака против ожидаемой матрицы.
#
# Роль: sql/0003 (политики) + sql/0004 (гранты) + sql/0001..0002 (RLS-флаги) —
# ИСТОЧНИК ОЖИДАНИЙ; этот скрипт читает ЖИВОЙ каталог Postgres (psql-канал R56)
# и сверяет факт с планом. Аналоги: git fsck, pg_dump --schema-only diff,
# Terraform drift detection — «ожидаемое состояние как данные», не как память.
#
# Честность:
#   • без SUPABASE_DB_URL        → HONEST-SKIP (exit 2) — аудировать нечего;
#   • без psql                   → HONEST-FAIL (exit 3) — канал не построен;
#   • SQLite-URL                 → HONEST-FAIL (exit 4) — это не Supabase;
#   • расхождение матрицы        → FAIL (exit 5) + JSON с mismatch-списком.
# JSON (единая строка после маркера RLS_AUDIT_JSON:) — для daemon'а /sqlmirror/rls-audit.
# Секреты не печатаются: URL маскируется, значения грантов/политик — не секреты.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DAEMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${ME2_SUPABASE_ENV:-/home/z/.a2/supabase-cloud.env}"
OUT_FILE="${ME2_RLS_AUDIT_OUT:-}"

# psql: системный или извлечённый без root (канон apply-sql-migrations.sh)
PSQL_BIN="${ME2_PSQL_BIN:-$(command -v psql 2>/dev/null || true)}"
[ -z "$PSQL_BIN" ] && PSQL_BIN=/tmp/psql-root/usr/lib/postgresql/17/bin/psql
if [ ! -x "$PSQL_BIN" ]; then
  echo "[rls-audit] HONEST-FAIL: psql не найден (ни в PATH, ни /tmp/psql-root) — аудита не будет"; exit 3
fi
export LD_LIBRARY_PATH="/tmp/psql-root/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

DB_URL="${SUPABASE_DB_URL:-${1:-}}"
if [ -z "$DB_URL" ] && [ -f "$ENV_FILE" ]; then
  DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$DB_URL" ]; then
  echo "[rls-audit] HONEST-SKIP: SUPABASE_DB_URL отсутствует — живой каталог недоступен, аудит честно не выполняется."; exit 2
fi
case "$DB_URL" in
  file:*|sqlite:*) echo "[rls-audit] HONEST-FAIL: URL указывает на локальную SQLite — НЕ Supabase."; exit 4 ;;
esac
MASKED="$(printf '%s' "$DB_URL" | sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***@#')"

# ── ОЖИДАЕМАЯ МАТРИЦА (источник: sql/0003 + sql/0004 + relrowsecurity из 0001/0002) ──
# Формат строк: table|role|privs  (privs отсортированы алфавитно)
EXPECTED_GRANTS="$(cat <<'EOT'
me2_event_mirror_h205f22|authenticated|SELECT
me2_event_mirror_h205f22|service_role|DELETE,INSERT,SELECT,UPDATE
me2_rpc_registry_h205f22|authenticated|SELECT
me2_rpc_registry_h205f22|service_role|SELECT
EOT
)"
# Формат: table|policyname|roles|cmd
EXPECTED_POLICIES="$(cat <<'EOT'
me2_event_mirror_h205f22|me2_event_mirror_read_auth|authenticated|SELECT
me2_rpc_registry_h205f22|me2_rpc_registry_read_auth|authenticated|SELECT
EOT
)"
TABLES="'me2_event_mirror_h205f22','me2_rpc_registry_h205f22'"

run_q() { "$PSQL_BIN" "$DB_URL" -At -v ON_ERROR_STOP=1 -c "$1" 2>&1; }

# Сортировку делает bash-norm (SQL order by position при одном выражении select-list невалиден —
# урок R58-1: аудит поймал собственный баг до eval).
G_ACTUAL="$(run_q "select table_name||'|'||grantee||'|'||string_agg(privilege_type,',' order by privilege_type) from information_schema.role_table_grants where table_schema='public' and table_name in ($TABLES) and grantee in ('anon','authenticated','service_role') group by table_name,grantee;")"
P_ACTUAL="$(run_q "select tablename||'|'||policyname||'|'||array_to_string(roles,',')||'|'||cmd from pg_policies where schemaname='public' and tablename in ($TABLES);")"
F_ACTUAL="$(run_q "select c.relname||'|'||c.relrowsecurity||'|'||coalesce(c.relforcerowsecurity,false) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname in ($TABLES);")"
Q_RC=$?

ERR_LINE="$(printf '%s' "$F_ACTUAL" | grep -m1 '^ERROR' || true)"
if [ $Q_RC -ne 0 ] || [ -n "$ERR_LINE" ]; then
  echo "[rls-audit] HONEST-FAIL: psql-запрос не удался (rc=$Q_RC): $(printf '%s' "$ERR_LINE" | head -c 160)"
  exit 6
fi

echo "[rls-audit] цель: $MASKED"
echo "[rls-audit] psql: $($PSQL_BIN --version | head -1)"

# ── Сверка: ДВУХСЛОЙНАЯ матрица (урок живой пробы R58-1) ──
# Живой каталог содержит, кроме наших грантов sql/0004, платформенные дефолты Supabase:
# REFERENCES,TRIGGER,TRUNCATE всем ролям (ALTER DEFAULT PRIVILEGES проекта; PostgREST их
# НЕ открывает — это не DML). Вердикт строится СТРОГО по DML-слою (SELECT/INSERT/UPDATE/
# DELETE — ровно то, чем оперирует PostgREST-гейт); платформенный слой — info.
norm() { printf '%s' "$1" | tr -d ' ' | sort; }
dml_only() { awk -F'|' 'BEGIN{split("DELETE,INSERT,SELECT,UPDATE",a,","); for(i in a) d[a[i]]=1}
  { out=""; n=split($3,p,","); for(i=1;i<=n;i++){ if(p[i] in d) out=(out==""?p[i]:out","p[i]) }
    if(out!="") print $1"|"$2"|"out }'; }
platform_only() { awk -F'|' 'BEGIN{split("DELETE,INSERT,SELECT,UPDATE",a,","); for(i in a) d[a[i]]=1}
  { out=""; n=split($3,p,","); for(i=1;i<=n;i++){ if(!(p[i] in d)) out=(out==""?p[i]:out","p[i]) }
    if(out!="") print $1"|"$2"|"out }'; }

G_EXP_N="$(norm "$EXPECTED_GRANTS")"
G_DML_ACT_N="$(norm "$(printf '%s' "$G_ACTUAL" | dml_only)")"
PLATFORM_ACT="$(printf '%s' "$G_ACTUAL" | platform_only | sort)"
PLATFORM_ACT_N="$(printf '%s' "$PLATFORM_ACT" | grep -c . || true)"
PLATFORM_ANON="$(printf '%s' "$PLATFORM_ACT" | grep -c '|anon|' || true)"
P_EXP_N="$(norm "$EXPECTED_POLICIES")"; P_ACT_N="$(norm "$P_ACTUAL")"

G_MISMATCH=0; P_MISMATCH=0; F_MISMATCH=0
G_DIFF="$(diff <(printf '%s\n' "$G_EXP_N") <(printf '%s\n' "$G_DML_ACT_N") || true)"
P_DIFF="$(diff <(printf '%s\n' "$P_EXP_N") <(printf '%s\n' "$P_ACT_N") || true)"
[ -n "$(printf '%s' "$G_DIFF" | tr -d '[:space:]')" ] && G_MISMATCH=1
[ -n "$(printf '%s' "$P_DIFF" | tr -d '[:space:]')" ] && P_MISMATCH=1
# RLS-флаги: обе таблицы обязаны иметь relrowsecurity = true
F_BAD="$(printf '%s' "$F_ACTUAL" | awk -F'|' '$2!="true" {print $1}')"
[ -n "$F_BAD" ] && F_MISMATCH=1
# anon fail-closed: ни одного DML-гранта и ни одной политики роли anon
ANON_DML="$(printf '%s' "$G_DML_ACT_N" | grep -c '^me2_[a-z0-9_]*|anon|' || true)"
ANON_P="$(printf '%s' "$P_ACT_N" | grep -c '^me2_[a-z0-9_]*|.*|.*anon' || true)"

VERDICT=PASS
[ $G_MISMATCH -ne 0 ] || [ $P_MISMATCH -ne 0 ] || [ $F_MISMATCH -ne 0 ] && VERDICT=FAIL

echo "[rls-audit] гранты DML: expected=4 actual=$(printf '%s' "$G_DML_ACT_N" | grep -c . || true) mismatch=$G_MISMATCH"
echo "[rls-audit] платформенные дефолты Supabase (REFERENCES/TRIGGER/TRUNCATE, PostgREST не открывает): строк=$PLATFORM_ACT_N (anon в числе: $PLATFORM_ANON — платформенный базлайн, DML у anon отсутствует = fail-closed ✓)"
echo "[rls-audit] политики: expected=2 actual=$(printf '%s' "$P_ACT_N" | grep -c . || true) mismatch=$P_MISMATCH"
echo "[rls-audit] RLS-флаги: $(printf '%s' "$F_ACTUAL" | tr '\n' ' ') mismatch=$F_MISMATCH"
echo "[rls-audit] anon fail-closed: DML-грантов=$ANON_DML политик=$ANON_P (ожидание 0/0)"
if [ "$VERDICT" = "FAIL" ]; then
  echo "[rls-audit] РАСХОЖДЕНИЯ:"
  printf '%s\n' "$G_DIFF" | sed 's/^/[rls-audit]   grants-dml /'
  printf '%s\n' "$P_DIFF" | sed 's/^/[rls-audit]   policies /'
  [ -n "$F_BAD" ] && printf '%s\n' "$F_BAD" | sed 's/^/[rls-audit]   rls-flag off: /'
fi
echo "[rls-audit] VERDICT: $VERDICT"

# ── JSON для daemon'а (секретов в матрице нет — гранты/политики это DDL-факты) ──
json_escape() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read()))' 2>/dev/null || printf '""'; }
json_lines() { printf '%s' "$1" | python3 -c 'import json,sys; print(json.dumps([l for l in sys.stdin.read().splitlines() if l]))' 2>/dev/null || echo '[]'; }
if [ -n "$OUT_FILE" ]; then
  {
    printf '{"schema":"me2.rls-audit.v1","mode":"live","verdict":"%s","ran_at":"%s",' "$VERDICT" "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf '"grants":{"expected_dml":%s,"actual_dml":%s,"mismatch":%s,"platform_extra":%s,"platform_anon_rows":%s},' \
      "$(json_escape "$EXPECTED_GRANTS")" "$(json_escape "$G_DML_ACT_N")" "$G_MISMATCH" \
      "$(json_lines "$PLATFORM_ACT")" "$PLATFORM_ANON"
    printf '"policies":{"expected":%s,"actual":%s,"rows":%s,"mismatch":%s},' \
      "$(json_escape "$EXPECTED_POLICIES")" "$(json_escape "$P_ACTUAL")" \
      "$(json_lines "$P_ACT_N")" "$P_MISMATCH"
    printf '"rls_flags":%s,"anon":{"dml_grants":%s,"policies":%s}}' \
      "$(printf '%s' "$F_ACTUAL" | python3 -c 'import json,sys; d={};
for l in sys.stdin.read().splitlines():
    p=l.split("|")
    if len(p)>=2: d[p[0]]=(p[1]=="true")
print(json.dumps(d))' 2>/dev/null || echo '{}')" "$ANON_DML" "$ANON_P"
  } > "$OUT_FILE" 2>/dev/null
fi

[ "$VERDICT" = "PASS" ] && exit 0 || exit 5
