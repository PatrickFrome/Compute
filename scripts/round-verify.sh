#!/usr/bin/env bash
# R32: round-verify — ОДИН exec вместо ~15 разрозненных команд (директива «никогда больше exec limits exceeded»).
# Полный вериф-конвейер раунда: рестарт демона → health → eval → матрица → evidence v2 → GLM → контуры → lint.
# Использование: bash scripts/round-verify.sh [--no-restart]
set -u
cd "$(dirname "$0")/../mini-services/me2-daemon"

if [ "${1:-}" != "--no-restart" ]; then
  echo "== RESTART =="
  bash start.sh | tail -1
  sleep 4   # boot + автопрогон eval (2.5s) + storage tick
fi

B="http://127.0.0.1:3041"
j() { python3 -c "import json,sys;d=json.load(sys.stdin);print($1)"; }

echo "== HEALTH =="
curl -sf --max-time 5 "$B/health" | j "d.get('version','?'), d.get('boot','?')[:19]"

echo "== EVAL =="
curl -s --max-time 10 -X POST "$B/eval/run" | j "d['verdict'], 'v'+str(d.get('dataset_version')), str(d.get('passed'))+'/'+str(d.get('total')), str(d.get('duration_ms'))+'ms'"

echo "== MECHANICS =="
curl -sf --max-time 5 "$B/mechanics" | j "d.get('verdict'), 'v'+str(d.get('version'))"

echo "== EVIDENCE v2 =="
curl -sf --max-time 5 "$B/evidence" | j "d['mode'], 'method='+str(d.get('method')), 'pending='+str(d['pending']), 'storage.objects='+str(d['storage']['objects']), 'ddl='+str(d['ddl']['last_result'])[:110]"

echo "== EVIDENCE probe_storage (roundtrip) =="
curl -s --max-time 20 -X POST "$B/evidence" -H "Content-Type: application/json" -d '{"op":"probe_storage"}' | j "d.get('ok'), d.get('detail','')"

echo "== EVIDENCE probe_ddl (каналы миграции) =="
curl -s --max-time 40 -X POST "$B/evidence" -H "Content-Type: application/json" -d '{"op":"probe_ddl"}' | j "'applied='+str(d.get('applied')), str(d.get('attempts'))[:220]"

echo "== GLM =="
curl -sf --max-time 5 "$B/glm" | j "d.get('canonical'), 'honoring='+str(d.get('platform_honoring')), 'agents='+json.dumps(d.get('agents',{}))[:80], 'probes='+str(d.get('probes_total'))"

echo "== WORKGRAPH =="
curl -sf --max-time 5 "$B/workgraph" | j "'valid='+str(d.get('valid')), 'nodes='+str(len(d.get('nodes',[]))), 'counts='+json.dumps(d.get('counts',{}))"

echo "== APPROVALS =="
curl -sf --max-time 5 "$B/approvals" | j "'pending='+str(d.get('pending')), 'stats='+json.dumps(d.get('stats',{}))[:80]"

echo "== DB HYGIENE =="
curl -sf --max-time 5 "$B/db/hygiene" | j "'journal='+d['db']['journal_mode'], 'wal='+str(d['db']['wal_mb'])+'MB', 'freelist='+str(d['db']['freelist_pct'])+'%'"

echo "== UI 3000 =="
curl -s -o /dev/null -w "http=%{http_code}\n" --max-time 10 "http://127.0.0.1:3000/"

echo "== LINT =="
cd /home/z/my-project
bun run lint 2>&1 | tail -3

echo "== DAEMON LOG (последние ошибки, если есть) =="
tail -40 mini-services/me2-daemon/daemon.log | grep -iE "error|exception|failed" | tail -5 || echo "(чисто)"
echo "== DONE =="
