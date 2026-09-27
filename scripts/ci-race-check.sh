#!/usr/bin/env bash
# ci-race-check.sh — CI-гонка watcher для PR-ветки ME2 desktop (ME2 DEV-LOOP, Job 417497, шаг 1)
#
# Назначение: единая детерминированная проверка «можно ли пушить в PR-ветку».
# Правило оператора: cancel-in-progress=true — любой новый пуш в ветку отменяет
# in-flight прогоны (включая физический visual capture в Package Smoke) → пуш запрещён,
# пока на ветке есть in_progress/queued/waiting прогоны.
#
# Usage: bash scripts/ci-race-check.sh [branch]
#   branch (default: work/r85-control-room-ui-v1)
#
# Выход:
#   RACE=1            — есть in-flight прогоны → пуш в PR-ветку ЗАПРЕЩЁН (freeze)
#   RACE=0            — окно тишины → пуш разрешён (после повторной проверки перед самим пушем)
#   RACE=UNKNOWN rc=2 — среда недоступна (нет env/токена/сети) → консервативно считаем ветку замороженной
#
# Инварианты: токен не печатается и не логируется; только GET-запросы; без jq (python3 stdlib).
set -euo pipefail

BRANCH="${1:-work/r85-control-room-ui-v1}"
ENV_FILE="${GITHUB_ENV_FILE:-/home/z/.a2/.github.env}"
REPO="${GITHUB_REPO:-PatrickFrome/Compute}"

if [ ! -r "$ENV_FILE" ]; then
  echo "RACE=UNKNOWN reason=no_env_file"
  exit 2
fi

TOKEN=$(grep -m1 -oE 'GITHUB_TOKEN_ADMIN=[^"[:space:]]+' "$ENV_FILE" | sed 's/^GITHUB_TOKEN_ADMIN=//; s/^"\(.*\)"$/\1/')
if [ -z "$TOKEN" ]; then
  echo "RACE=UNKNOWN reason=no_token"
  exit 2
fi

API="https://api.github.com/repos/${REPO}/actions/runs?branch=${BRANCH}&per_page=30"
HTTP=$(curl -sS -o /tmp/ci-race-check.$$.json -w '%{http_code}' \
  -H "Authorization: token ${TOKEN}" \
  -H "Accept: application/vnd.github+json" \
  "$API") || { rm -f /tmp/ci-race-check.$$.json; echo "RACE=UNKNOWN reason=curl_failed"; exit 2; }

if [ "$HTTP" != "200" ]; then
  rm -f /tmp/ci-race-check.$$.json
  echo "RACE=UNKNOWN reason=http_${HTTP}"
  exit 2
fi

python3 - /tmp/ci-race-check.$$.json "$BRANCH" <<'PY'
import json, sys

path, branch = sys.argv[1], sys.argv[2]
with open(path, "r", encoding="utf-8") as fh:
    data = json.load(fh)

ACTIVE = ("in_progress", "queued", "waiting")
inflight = []
for r in data.get("workflow_runs", []):
    if r.get("status") in ACTIVE:
        inflight.append({
            "id": r.get("id"),
            "name": (r.get("name") or "")[:60],
            "status": r.get("status"),
            "head": (r.get("head_sha") or "")[:8],
            "url": r.get("html_url", ""),
        })

print(f"branch={branch}")
if inflight:
    print("RACE=1")
    for x in inflight:
        print(f"INFLIGHT {x['id']} {x['name']} [{x['status']}] {x['head']}")
else:
    print("RACE=0")
    print("WINDOW=silent")
PY

rm -f /tmp/ci-race-check.$$.json
