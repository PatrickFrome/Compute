#!/usr/bin/env bash
# ── ME2 unified gate (R51, план C6/C7): boot-probe изолированного daemon'а ──
# Поднимает daemon на свежей SQLite (свой DATA_DIR) и свободных портах, ждёт
# /health, требует eval verdict=PASS. Аналог: smoke-тесты VS Code с
# --user-data-dir. В CI вызывается как `bun run check` (apps/me2-daemon).
# Выход: 0 = GATE PASS (boot + eval), 1 = GATE FAIL (честная диагностика в логе).
set -euo pipefail
cd "$(dirname "$0")/.."

WS="${ME2_PROBE_WS:-14040}"
REST="${ME2_PROBE_REST:-14041}"
MIRROR="${ME2_PROBE_MIRROR:-14042}"
SC="${ME2_PROBE_SC:-14043}"
DATA="$(mktemp -d /tmp/me2-gate-data.XXXXXX)"
LOCK="$(mktemp -u /tmp/me2-gate-lock.XXXXXX)"
LOG="$DATA/probe.log"

export ME2_WS_PORT="$WS" ME2_REST_PORT="$REST" ME2_LEGACY_MIRROR_PORT="$MIRROR" \
       ME2_SCREENCEAST_PORT="$SC" ME2_DATA_DIR="$DATA" ME2_LOCK_FILE="$LOCK"
export ME2_BOOT_MODE=probe
# корень репо/чатов probe-инстанса — внутри его временного каталога (CI: /home/z недоступен)
mkdir -p "$DATA/repo"
export ME2_REPO_ROOT="$DATA/repo"

cleanup() {
  kill "$PROBE_PID" 2>/dev/null || true
  rm -f "$LOCK" 2>/dev/null || true
}
trap cleanup EXIT

bun index.ts > "$LOG" 2>&1 &
PROBE_PID=$!

UP=0
for _ in $(seq 1 45); do
  if ! kill -0 "$PROBE_PID" 2>/dev/null; then
    echo "GATE FAIL: daemon умер при старте"; tail -40 "$LOG"; exit 1
  fi
  if curl -sf "localhost:$REST/health" >/dev/null 2>&1; then UP=1; break; fi
  sleep 1
done
if [ "$UP" != "1" ]; then
  echo "GATE FAIL: /health не поднялся за 45с"; tail -40 "$LOG"; exit 1
fi

# eval-прогон асинхронный относительно бута — ждём готовый вердикт (ретраи, не шторм)
VERDICT=""; SCORE=""
for _ in $(seq 1 30); do
  EVAL_JSON="$(curl -sf "localhost:$REST/eval?run=1" || true)"
  if [ -n "$EVAL_JSON" ]; then
    PARSED="$(printf '%s' "$EVAL_JSON" | python3 -c '
import json,sys
try:
    d=(json.load(sys.stdin) or {}).get("last") or {}
    print((d.get("verdict") or ""), str(d.get("passed"))+"/"+str(d.get("total")))
except Exception:
    print("", "")
' 2>/dev/null || true)"
    VERDICT="$(echo "$PARSED" | cut -d' ' -f1)"
    SCORE="$(echo "$PARSED" | cut -d' ' -f2)"
    if [ "$VERDICT" = "PASS" ] || [ "$VERDICT" = "WARN" ] || [ "$VERDICT" = "FAIL" ]; then break; fi
  fi
  sleep 1
done
if [ -z "$VERDICT" ]; then
  echo "GATE FAIL: eval не дал вердикт за 30с"; tail -40 "$LOG"; exit 1
fi

echo "gate: eval $VERDICT $SCORE (ws:$WS rest:$REST, data=$DATA)"
if [ "$VERDICT" != "PASS" ]; then
  echo "GATE FAIL: eval вердикт $VERDICT — упавшие проверки:"
  printf '%s' "$EVAL_JSON" | python3 -c '
import json,sys
try:
    d=(json.load(sys.stdin) or {}).get("last") or {}
    for r in d.get("results") or []:
        if not r.get("ok"):
            print(" -", r.get("id"), "| crit:", r.get("critical"), "|", str(r.get("evidence",""))[:110])
except Exception as e:
    print("  (не удалось разобрать результаты:", e, ")")'
  tail -40 "$LOG"; exit 1
fi
echo "GATE PASS: daemon boot + eval $SCORE"
