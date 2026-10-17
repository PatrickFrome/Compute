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
export ME2_BOOT_MODE=qualification
# This disposable qualification may execute the mutating eval dataset; the
# Browser's read-only probe never gains that permission through a GET query.
export ME2_API_TOKEN="$(bun -e 'console.log(crypto.randomUUID()+crypto.randomUUID())')"
# временный КОНТУР (exec/edit/sandbox2 корни + vault-hide + REPO_ROOT): eval-проверки
# контур-честные; контур НЕ под /tmp|/var|/opt (SYS_READABLE-префиксы иначе гасят redirect-негативы)
CONTOUR="$(mktemp -d "$PWD/../../.me2-gate-contour.XXXXXX")"
export ME2_CONTOUR_HOME="$CONTOUR"
export ME2_REPO_ROOT="$CONTOUR/my-project"
mkdir -p "$DATA/repo"
mkdir -p "$CONTOUR/my-project" "$CONTOUR/me2-sandboxes" "$CONTOUR/me2-worktrees" "$CONTOUR/.a2"

cleanup() {
  kill "$PROBE_PID" 2>/dev/null || true
  # Git Bash launches Bun through a Windows process tree; killing the shell
  # wrapper alone leaves the disposable daemon listening on the gate ports.
  if command -v taskkill >/dev/null 2>&1 && [ -n "${PROBE_PID:-}" ]; then
    taskkill //PID "$PROBE_PID" //T //F >/dev/null 2>&1 || true
  fi
  rm -f "$LOCK" 2>/dev/null || true
  rm -rf "$CONTOUR" 2>/dev/null || true
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

# Submit once, then observe. A missing response never authorizes another eval.
EVAL_JSON="$(curl -sf -X POST -H "Authorization: Bearer $ME2_API_TOKEN" -H 'Content-Type: application/json' --data '{}' "localhost:$REST/eval/run" || true)"
VERDICT=""; SCORE=""
for _ in $(seq 1 30); do
  if [ -z "$EVAL_JSON" ]; then EVAL_JSON="$(curl -sf -H "Authorization: Bearer $ME2_API_TOKEN" "localhost:$REST/eval" || true)"; fi
  if [ -n "$EVAL_JSON" ]; then
    PARSED="$(printf '%s' "$EVAL_JSON" | node -e '
let body = "";
process.stdin.on("data", chunk => { body += chunk; });
process.stdin.on("end", () => {
  try {
    let d = JSON.parse(body || "{}");
    d = d.last || d;
    process.stdout.write(`${d.verdict || ""} ${d.passed ?? ""}/${d.total ?? ""}`);
  } catch {
    process.stdout.write(" ");
  }
});
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
  printf '%s' "$EVAL_JSON" | node -e '
let body = "";
process.stdin.on("data", chunk => { body += chunk; });
process.stdin.on("end", () => {
  try {
    let d = JSON.parse(body || "{}");
    d = d.last || d;
    for (const r of d.results || []) {
      if (!r.ok) console.log(" -", r.id, "| crit:", r.critical, "|", String(r.evidence || "").slice(0, 110));
    }
  } catch (error) {
    console.log("  (не удалось разобрать результаты:", String(error), ")");
  }
});
'
  tail -40 "$LOG"; exit 1
fi
echo "GATE PASS: daemon boot + eval $SCORE"
