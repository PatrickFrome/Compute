#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ME2 R53 (фаза D-исполнение): САМОПРИМЕНЕНИЕ миграций sql/0001..0003 в Supabase.
#
# Инструкция оператора (R53, дословно): «Тебе нужно самому применить sql/0001 +
# sql/0002 (psql $DATABASE_URL -f …) → зеркало само перейдёт WARMUP→LIVE».
#
# Факты песочницы (честная инвентаризация R53-0):
#   • $DATABASE_URL в окружении указывает на ЛОКАЛЬНУЮ SQLite (file:…/db/custom.db) —
#     это не Supabase, по нему psql работать не может;
#   • прямой Postgres-порт db.<ref>.supabase.co:5432 песочницей ЗАБЛОКИРОВАН (network
#     unreachable), но Supavisor session-pooler :5432 ДОСТИЖИМ;
#   • DB-пароля Supabase в sandbox нет (vault R47 = 5 ключей, mgmt-PAT отсутствует) —
#     DDL-канал физически не существовал до этого раунда;
#   • psql собран локально (postgresql-client-17, dpkg -x без root, libpq5 системный).
#
# Решение: когда оператор положит строку подключения (session-pooler) в
# /home/z/.a2/supabase-cloud.env как SUPABASE_DB_URL="postgresql://…", СИСТЕМА
# сама применит 0001→0002→0003 (start.sh зовёт этот скрипт при каждом старте —
# миграции идемпотентны) — человек-шаг исчезает. Без URL — честный отказ.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DAEMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # scripts/.. = mini-services/me2-daemon
SQL_DIR="$(cd "$DAEMON_DIR/../.." && pwd)/sql"                  # repo-root/sql (и локально, и в release-ветке apps/…)
ENV_FILE="${ME2_SUPABASE_ENV:-/home/z/.a2/supabase-cloud.env}"

# psql: системный или извлечённый без root
PSQL_BIN="$(command -v psql 2>/dev/null || true)"
[ -z "$PSQL_BIN" ] && PSQL_BIN=/tmp/psql-root/usr/lib/postgresql/17/bin/psql
if [ ! -x "$PSQL_BIN" ]; then
  echo "[apply-sql] HONEST-FAIL: psql не найден (ни в PATH, ни /tmp/psql-root)"; exit 3
fi
export LD_LIBRARY_PATH="/tmp/psql-root/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

# строка подключения: аргумент > env > ENV-файл
DB_URL="${SUPABASE_DB_URL:-${1:-}}"
if [ -z "$DB_URL" ] && [ -f "$ENV_FILE" ]; then
  DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$DB_URL" ]; then
  echo "[apply-sql] HONEST-SKIP: SUPABASE_DB_URL отсутствует — DDL невозможен из песочницы."
  echo "[apply-sql] Путь оператора (одна строка): добавить в $ENV_FILE"
  echo '[apply-sql]   SUPABASE_DB_URL="postgresql://postgres.<ref>:<PASSWORD>@aws-0-<region>.pooler.supabase.com:5432/postgres"'
  echo "[apply-sql] После этого start.sh применит 0001+0002+0003 сам, зеркало перейдёт WARMUP→LIVE автоматически."
  exit 2
fi
case "$DB_URL" in
  file:*|sqlite:*) echo "[apply-sql] HONEST-FAIL: URL указывает на локальную SQLite — НЕ Supabase; локальные DDL-миграции сюда не применяются."; exit 4 ;;
esac

# маска пароля в журнале
MASKED="$(printf '%s' "$DB_URL" | sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***@#')"
echo "[apply-sql] цель: $MASKED"
echo "[apply-sql] psql: $PSQL_BIN ($($PSQL_BIN --version | head -1))"

FAILED=0
for f in 0001-me2-event-mirror.sql 0002-rpc-registry.sql 0003-mirror-read-policy.sql 0004-mirror-grants.sql; do
  if [ ! -f "$SQL_DIR/$f" ]; then echo "[apply-sql] пропущен (файла нет в $SQL_DIR): $f"; continue; fi
  echo "[apply-sql] → применяю $f"
  if ! "$PSQL_BIN" "$DB_URL" -v ON_ERROR_STOP=1 -f "$SQL_DIR/$f" 2>&1 | sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***@#g'; then
    echo "[apply-sql] HONEST-FAIL: $f"; FAILED=1
  fi
done
[ "$FAILED" = "0" ] || exit 5

echo "[apply-sql] верификация таблиц:"
"$PSQL_BIN" "$DB_URL" -v ON_ERROR_STOP=1 -c "select tablename from pg_tables where tablename in ('me2_event_mirror_h205f22','me2_rpc_registry_h205f22') order by tablename;" 2>&1
echo "[apply-sql] верификация политик (RLS-гейт):"
"$PSQL_BIN" "$DB_URL" -v ON_ERROR_STOP=1 -c "select tablename, policyname from pg_policies where tablename like 'me2_%' order by tablename;" 2>&1
echo "[apply-sql] готово: daemon (ME2_SQL_MIRROR=1) перейдёт WARMUP→LIVE сам (проба ≤ раз в 10 мин; рестарт start.sh ускоряет)."
