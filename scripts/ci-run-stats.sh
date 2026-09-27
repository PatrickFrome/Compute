#!/usr/bin/env bash
# ci-run-stats.sh — сбор фактических длительностей прогонов consumer-гейтов PR-ветки
# (ME2 DEV-LOOP, Job 417497; R87 backlog: «подрезка таймаутов по фактической статистике»)
#
# Назначение: дать данные (mean / p50 / p95 / max) по завершённым прогонам, чтобы
# будущие правки таймаутов workflow (28→75 / 30→80 / 45→90 мин после R86) опирались
# на статистику, а не на консервативные оценки. Не изменяет workflow — только читает.
#
# Usage: bash scripts/ci-run-stats.sh [branch] [runs_per_workflow]
#   branch            (default: work/r85-control-room-ui-v1)
#   runs_per_workflow (default: 15)
#
# Выход: таблица workflow → n, mean_min, p50_min, p95_min, max_min; итог в CSV
#        /home/z/my-project/download/ci-run-stats.csv (append-safe: перезапись свежими данными).
# Инварианты: токен не печатается; только GET-запросы; workflow без завершённых прогонов не строка-ошибка.
set -euo pipefail

BRANCH="${1:-work/r85-control-room-ui-v1}"
PER_PAGE="${2:-15}"
ENV_FILE="${GITHUB_ENV_FILE:-/home/z/.a2/.github.env}"
REPO="${GITHUB_REPO:-PatrickFrome/Compute}"
OUT_CSV="${OUT_CSV:-/home/z/my-project/download/ci-run-stats.csv}"

if [ ! -r "$ENV_FILE" ]; then
  echo "STATS=UNKNOWN reason=no_env_file"
  exit 2
fi
TOKEN=$(grep -m1 -oE 'GITHUB_TOKEN_ADMIN=[^"[:space:]]+' "$ENV_FILE" | sed 's/^GITHUB_TOKEN_ADMIN=//; s/^"\(.*\)"$/\1/')
if [ -z "$TOKEN" ]; then
  echo "STATS=UNKNOWN reason=no_token"
  exit 2
fi

TMP_JSON=$(mktemp)
HTTP=$(curl -sS -o "$TMP_JSON" -w '%{http_code}' \
  -H "Authorization: token ${TOKEN}" -H "Accept: application/vnd.github+json" \
  "https://api.github.com/repos/${REPO}/actions/runs?branch=${BRANCH}&per_page=100") \
  || { rm -f "$TMP_JSON"; echo "STATS=UNKNOWN reason=curl_failed"; exit 2; }
if [ "$HTTP" != "200" ]; then
  rm -f "$TMP_JSON"
  echo "STATS=UNKNOWN reason=http_${HTTP}"
  exit 2
fi

python3 - "$TMP_JSON" "$BRANCH" "$PER_PAGE" "$OUT_CSV" <<'PY'
import csv, json, math, sys
from datetime import datetime

json_path, branch, per_page, out_csv = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
try:
    with open(json_path, "r", encoding="utf-8") as fh:
        data = json.load(fh)
except (OSError, json.JSONDecodeError) as exc:
    print(f"STATS=UNKNOWN reason=bad_json detail={type(exc).__name__}")
    sys.exit(2)

runs = data.get("workflow_runs", [])
by_name = {}
for r in runs:
    if r.get("status") != "completed" or r.get("conclusion") not in ("success", "failure"):
        continue
    started = r.get("run_started_at")
    updated = r.get("updated_at")
    if not started or not updated:
        continue
    try:
        t0 = datetime.fromisoformat(started.replace("Z", "+00:00"))
        t1 = datetime.fromisoformat(updated.replace("Z", "+00:00"))
    except ValueError:
        continue
    minutes = (t1 - t0).total_seconds() / 60.0
    if minutes < 0 or minutes > 24 * 60:
        continue
    name = (r.get("name") or "unknown")[:52]
    by_name.setdefault(name, []).append((minutes, r.get("conclusion"), r.get("id")))

def pct(sorted_vals, p):
    if not sorted_vals:
        return 0.0
    k = max(0, min(len(sorted_vals) - 1, math.ceil(p / 100.0 * len(sorted_vals)) - 1))
    return sorted_vals[k]

rows = []
print(f"branch={branch} completed_runs_considered={sum(len(v) for v in by_name.values())}")
print(f"{'workflow':52} {'n':>3} {'mean':>7} {'p50':>7} {'p95':>7} {'max':>7}  (minutes)")
for name in sorted(by_name):
    vals = sorted(m for m, _, _ in by_name[name])[-per_page:]
    n = len(vals)
    mean = sum(vals) / n
    p50, p95, mx = pct(vals, 50), pct(vals, 95), vals[-1]
    rows.append({"branch": branch, "workflow": name, "n": n, "mean_min": round(mean, 1),
                 "p50_min": round(p50, 1), "p95_min": round(p95, 1), "max_min": round(mx, 1)})
    print(f"{name:52} {n:>3} {mean:>7.1f} {p50:>7.1f} {p95:>7.1f} {mx:>7.1f}")

if rows:
    with open(out_csv, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=["branch", "workflow", "n", "mean_min", "p50_min", "p95_min", "max_min"])
        w.writeheader()
        w.writerows(rows)
    print(f"CSV={out_csv}")
    print("STATS=OK")
else:
    print("STATS=EMPTY no_completed_runs")
PY

rm -f "$TMP_JSON"
