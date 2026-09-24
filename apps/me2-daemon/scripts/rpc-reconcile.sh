#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# ME2 R59 «Реестр как данные» — сверка живого RPC-реестра облака с классификацией R52.
#
# Роль: research/2026/r52-rpc-registry.json (243 RPC: ACTIVE 24 / CONTROL_PLANE 37 /
# FREEZE 182, собран из живого OpenAPI в R52) — ИСТОЧНИК ОЖИДАНИЙ, версионирован в
# репо; живая таблица me2_rpc_registry_h205f22 (psql-канал R56) — ФАКТ. Скрипт сводит
# их: count + поимённый состав + тир-дрейф + sha256-хеш отсортированного множества.
# Аналоги: Kubernetes reconcile (desired vs observed), AWS Config drift, git fsck.
#
# Честность:
#   • без SUPABASE_DB_URL        → HONEST-SKIP (exit 2) — сверять нечего;
#   • без psql                   → HONEST-FAIL (exit 3) — канал не построен;
#   • SQLite-URL                 → HONEST-FAIL (exit 4) — это не Supabase;
#   • источник ожиданий отсутствует/битый → HONEST-FAIL (exit 7);
#   • psql-запрос не удался      → HONEST-FAIL (exit 6);
#   • расхождение реестра        → FAIL (exit 5) + JSON со списками.
# JSON (единый документ в OUT_FILE) — для daemon'а /sqlmirror/rpc-reconcile.
# Секреты не печатаются: URL маскируется; имена RPC/тиры — не секреты.
# Урок R58-1: bash тонкий (канал+честные выходы), вся математика — в python3.
# ─────────────────────────────────────────────────────────────────────────────
set -uo pipefail

DAEMON_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_DIR="$(cd "$DAEMON_DIR/../.." && pwd)"
EXPECTED_JSON="${ME2_RPC_EXPECTED_JSON:-$REPO_DIR/research/2026/r52-rpc-registry.json}"
ENV_FILE="${ME2_SUPABASE_ENV:-/home/z/.a2/supabase-cloud.env}"
OUT_FILE="${ME2_RPC_RECONCILE_OUT:-}"

# psql: системный или извлечённый без root (канон rls-audit.sh / apply-sql-migrations.sh)
PSQL_BIN="${ME2_PSQL_BIN:-$(command -v psql 2>/dev/null || true)}"
[ -z "$PSQL_BIN" ] && PSQL_BIN=/tmp/psql-root/usr/lib/postgresql/17/bin/psql
if [ ! -x "$PSQL_BIN" ]; then
  echo "[rpc-reconcile] HONEST-FAIL: psql не найден (ни в PATH, ни /tmp/psql-root) — сверки не будет"; exit 3
fi
export LD_LIBRARY_PATH="/tmp/psql-root/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"

DB_URL="${SUPABASE_DB_URL:-${1:-}}"
if [ -z "$DB_URL" ] && [ -f "$ENV_FILE" ]; then
  DB_URL="$(grep -E '^SUPABASE_DB_URL=' "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- | tr -d '"' || true)"
fi
if [ -z "$DB_URL" ]; then
  echo "[rpc-reconcile] HONEST-SKIP: SUPABASE_DB_URL отсутствует — живой реестр недоступен, сверка честно не выполняется."; exit 2
fi
case "$DB_URL" in
  file:*|sqlite:*) echo "[rpc-reconcile] HONEST-FAIL: URL указывает на локальную SQLite — НЕ Supabase."; exit 4 ;;
esac
MASKED="$(printf '%s' "$DB_URL" | sed -E 's#(postgres(ql)?://[^:]+:)[^@]+@#\1***@#')"

if [ ! -s "$EXPECTED_JSON" ]; then
  echo "[rpc-reconcile] HONEST-FAIL: источник ожиданий отсутствует: $EXPECTED_JSON"; exit 7
fi

echo "[rpc-reconcile] цель: $MASKED"
echo "[rpc-reconcile] psql: $($PSQL_BIN --version | head -1)"

ACTUAL="$("$PSQL_BIN" "$DB_URL" -At -v ON_ERROR_STOP=1 -c "select rpc_name||'|'||tier from me2_rpc_registry_h205f22;" 2>&1)"
Q_RC=$?
ERR_LINE="$(printf '%s' "$ACTUAL" | grep -m1 '^ERROR' || true)"
if [ $Q_RC -ne 0 ] || [ -n "$ERR_LINE" ]; then
  echo "[rpc-reconcile] HONEST-FAIL: psql-запрос не удался (rc=$Q_RC): $(printf '%s' "$ERR_LINE" | head -c 160)"
  exit 6
fi

EXPECTED_JSON="$EXPECTED_JSON" ACTUAL_LINES="$ACTUAL" OUT_FILE="$OUT_FILE" python3 <<'PY'
import hashlib, json, os, sys
from datetime import datetime, timezone

with open(os.environ["EXPECTED_JSON"]) as f:
    doc = json.load(f)

exp = {}
for tier in ("ACTIVE", "CONTROL_PLANE", "FREEZE"):
    for name in doc.get(tier) or []:
        exp[str(name).strip()] = tier

act, bad_lines = {}, []
for line in os.environ.get("ACTUAL_LINES", "").splitlines():
    line = line.strip()
    if not line:
        continue
    if "|" not in line:
        bad_lines.append(line[:80]); continue
    name, tier = line.split("|", 1)
    if tier not in ("ACTIVE", "CONTROL_PLANE", "FREEZE"):
        bad_lines.append(line[:80]); continue
    act[name] = tier

missing = sorted(set(exp) - set(act))
extra = sorted(set(act) - set(exp))
tier_mm = sorted(
    f"{n}|expected={exp[n]}|actual={act[n]}"
    for n in (set(exp) & set(act)) if exp[n] != act[n]
)
h = lambda d: hashlib.sha256("\n".join(f"{k}|{d[k]}" for k in sorted(d)).encode()).hexdigest()[:12]

counts_exp = dict(doc.get("counts") or {})
counts_act = {"ACTIVE": 0, "CONTROL_PLANE": 0, "FREEZE": 0}
for t in act.values():
    counts_act[t] += 1

verdict = "PASS" if not (missing or extra or tier_mm or bad_lines) else "FAIL"
reg = {
    "expected_total": int(doc.get("total") or len(exp)),
    "actual_total": len(act),
    "per_tier_expected": counts_exp,
    "per_tier_actual": counts_act,
    "missing": missing[:20], "missing_count": len(missing),
    "extra": extra[:20], "extra_count": len(extra),
    "tier_mismatch": tier_mm[:20], "tier_mismatch_count": len(tier_mm),
    "bad_lines": bad_lines[:10],
    "hash_expected": h(exp), "hash_actual": h(act),
}

print(f"[rpc-reconcile] ожидание={reg['expected_total']} факт={reg['actual_total']} "
      f"ACTIVE {counts_act['ACTIVE']}/{counts_exp.get('ACTIVE')} "
      f"CONTROL_PLANE {counts_act['CONTROL_PLANE']}/{counts_exp.get('CONTROL_PLANE')} "
      f"FREEZE {counts_act['FREEZE']}/{counts_exp.get('FREEZE')}")
print(f"[rpc-reconcile] поимённо: нет={len(missing)} лишних={len(extra)} тир-дрейф={len(tier_mm)} битых-строк={len(bad_lines)}")
print(f"[rpc-reconcile] хеш expected={reg['hash_expected']} actual={reg['hash_actual']}")
if verdict == "FAIL":
    for m in reg["missing"]:        print(f"[rpc-reconcile]   отсутствует: {m}")
    for m in reg["extra"]:          print(f"[rpc-reconcile]   лишний: {m}")
    for m in reg["tier_mismatch"]:  print(f"[rpc-reconcile]   тир: {m}")
    for m in reg["bad_lines"]:      print(f"[rpc-reconcile]   битая строка: {m}")
print(f"[rpc-reconcile] VERDICT: {verdict}")

out = os.environ.get("OUT_FILE")
if out:
    with open(out, "w") as f:
        json.dump({
            "schema": "me2.rpc-reconcile.v1", "mode": "live", "verdict": verdict,
            "ran_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "registry": reg,
        }, f)
sys.exit(0 if verdict == "PASS" else 5)
PY
exit $?
