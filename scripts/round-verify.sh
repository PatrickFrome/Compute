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

echo "== EVIDENCE verify (E2 hash-chain) =="
curl -sf --max-time 10 "$B/evidence/verify?limit=500" | j "d['ok'], 'checked='+str(d['checked']), 'range='+str(d['from'])+'..'+str(d['to']), str(d['ms'])+'ms', 'reason='+str(d.get('reason'))"

echo "== EVIDENCE query (связка) =="
TID=$(curl -sf --max-time 5 "$B/state" | python3 -c "import json,sys;d=json.load(sys.stdin);ts=[t['id'] for t in d.get('tasks',[]) if t.get('id')];print(ts[0] if ts else '')")
if [ -n "$TID" ]; then curl -sf --max-time 5 "$B/evidence/query?task_id=$TID" | j "'task='+d['task_id'], 'events='+str(d['total']), 'review='+str(d.get('review')), 'ho_in='+str(d['handoffs_in']), 'ho_out='+str(d['handoffs_out'])"; else echo "(нет задач — WARMUP)"; fi

echo "== GLM =="
curl -sf --max-time 5 "$B/glm" | j "d.get('canonical'), 'honoring='+str(d.get('platform_honoring')), 'agents='+json.dumps(d.get('agents',{}))[:80], 'probes='+str(d.get('probes_total'))"

echo "== WORKGRAPH =="
curl -sf --max-time 5 "$B/workgraph" | j "'objectives='+str(len(d.get('objectives',[]))), 'edges='+str(len(d.get('edges',[]))), 'orphan='+str(len(d.get('orphan_tasks',[])))"
echo "== POOL (E3) =="
curl -sf --max-time 5 "$B/pool" | j "'live='+str(d['live'])+'/'+str(d['ceiling']), 'total='+str(d['workers_total']), 'q='+str(d['queue']['ready'])+'/'+str(d['queue']['running']), 'conc='+str(d['concurrency']['max_observed']), '1ч='+str(d['throughput']['done_1h'])+'✓/'+str(d['throughput']['failed_1h'])+'✗'"
echo "== POOL lease-exclusivity (synthetic) =="
curl -s --max-time 10 -X POST "$B/pool" -H "Content-Type: application/json" -d '{"op":"scale","n":2}' | j "'scale='+str(d['scale']), 'created='+str(d['created'])"

echo "== AGENTCHAT (G1+G2: флот агентных чатов + супервизоры; R46: REST POST снят) =="
curl -sf --max-time 5 "$B/agentchat" | j "'сессий='+str(d['status']['total']), 'active='+str(d['status']['active']), 'thinking='+str(d['status']['thinking']), 'супервизоров='+str(d['status']['supervisors']), 'ходов='+str(d['status']['turns_ok'])+'✓/'+str(d['status']['turns_fail'])+'✗', 'в_полёте='+str(d['status']['in_flight']), 'компакций='+str(d['status']['compactions']), 'деградаций='+str(d['status']['degraded'])"
echo "== AGENTCHAT socket-операции (R46: agentchat:op через WS :3040; REST POST больше нет) =="
bun -e 'import {io} from "socket.io-client"; const s=io("ws://127.0.0.1:3040",{path:"/",transports:["websocket"],timeout:5000}); const done=(r)=>{console.log("tick ok="+(r&&r.ok), "kicked="+((r&&r.kicked)||[]).length, "supervisors="+(r&&r.supervisors)); s.emit("agentchat:op",{op:"objective",id:"noop"},(r2)=>{console.log("objective-op-ответ="+((r2&&r2.error)||"ok")); process.exit(0);});}; s.on("connect",()=>s.emit("agentchat:op",{op:"tick",force:true},done)); s.on("connect_error",()=>{console.log("WS недоступен: "+String(s.io.engine? "":"")); process.exit(1);}); setTimeout(()=>{console.log("ok=SOCKET_TIMEOUT"); process.exit(1);},9000);' 2>/dev/null
curl -s --max-time 5 -X POST "$B/agentchat" -H "Content-Type: application/json" -d '{"op":"tick","force":true}' | j "'REST-POST-снят-подтверждено='+str(d.get('error')=='no route POST /agentchat' or 'no route' in str(d.get('error','')))"
curl -sf --max-time 5 "$B/mechanics" | j "'ME36 G4+G5 WORKS='+str(any('ME36'==m['id'] and m['verdict']=='WORKS' for m in d['mechanics']))"

echo "== AUTONOMY v4 (H-линия: liveness/budget/non-bypass/recovery/independence) =="
curl -sf --max-time 10 "$B/autonomy" | j "'liveness='+str(d['liveness']['verdict']), 'stall='+str(len(d['liveness']['stalled_reasons'])), 'budget='+str(d['budget']['state'])+' ('+str(d['budget']['score'])+'/'+str(d['budget']['breach'])+')', 'non_bypass='+str(d['non_bypass']['verdict'])+' ('+str(len(d['non_bypass']['post_routes']))+' маршрутов)', 'recovery L0-L5='+str(len(d['recovery'])), 'reviewer_пишет_статусы='+str(d['independence']['reviewer_writes_status']), 'chain='+str(d['independence']['chain_ok'])"
curl -sf --max-time 5 "$B/mechanics" | j "'ME37 v4 WORKS='+str(any('ME37'==m['id'] and m['verdict']=='WORKS' for m in d['mechanics']))"

echo "== GOVERNOR G11 + DEMAND G10 (полосы/bucket/breaker + автопилот спроса) =="
curl -sf --max-time 5 "$B/governor" | j "'breaker='+str(d['breaker']['state']), 'trips='+str(d['breaker']['trips']), 'cooldown_s='+str(d['breaker']['cooldown_ms']//1000), 'полосы='+','.join(l['lane']+':'+str(l['tokens'])+'/'+str(l['capacity']) for l in d['lanes']), 'admitted='+str(d['admitted_total']), 'rejected='+str(d['rejected_total'])"
curl -sf --max-time 5 "$B/demand" | j "'config='+str(d['config']), 'тиков='+str(d['ticks']), 'снимок: ready='+str(d['snapshot']['ready_count']), 'leases='+str(d['snapshot']['pool_leases'])+'/'+str(d['snapshot']['pool_max']), 'fails15м='+str(d['snapshot']['fails_15m']), 'чатов='+str(d['snapshot']['active_chats']), 'последнее='+str((d['last_decision'] or {}).get('action'))+' '+str((d['last_decision'] or {}).get('signal') or '')"
curl -sf --max-time 5 "$B/mechanics" | j "'ME38 WORKS='+str(any('ME38'==m['id'] and m['verdict']=='WORKS' for m in d['mechanics']))"
echo "-- demand tick вручную (честное решение на живом состоянии) --"
curl -sf --max-time 5 -X POST "$B/demand" -H "content-type: application/json" -d '{"op":"tick"}' | j "'решение='+str(d['decision']['action']), 'signal='+str(d['decision']['signal']), 'detail='+str(d['decision']['detail'][:60])"

echo "== TOKENS VAULT R47 (все токены в БД; наружу — маска) =="
curl -sf --max-time 5 "$B/tokens" | j "'в_БД='+str(d['status']['total'])+'/'+str(d['status']['known_total']), 'по_тирам='+json.dumps(d['status']['by_tier']), 'known_missing='+str(d['status']['known_missing']), 'seeded='+str(d['status']['seeded_at'] is not None), 'имена='+','.join(t['name'] for t in d['tokens'][:6])"
curl -sf --max-time 5 "$B/tokens" | j "'raw-утечка-в-списке='+str(any(t['masked'].count('…')==0 and t['masked'].count('len')!=1 for t in d['tokens']))"
curl -sf --max-time 5 "$B/mechanics" | j "'ME40 VAULT WORKS='+str(any('ME40'==m['id'] and m['verdict']=='WORKS' for m in d['mechanics']))"
echo "-- tokens:op socket (set probe → list без raw → delete) --"
bun -e 'import {io} from "socket.io-client"; const s=io("ws://127.0.0.1:3040",{path:"/",transports:["websocket"],timeout:5000}); const sec="probe_"+Date.now().toString(36); s.on("connect",()=>{ s.emit("tokens:op",{op:"set",name:"RV_TOKEN_PROBE",value:sec,tier:"T2",by:"round-verify"},(r1)=>{ if(!r1||!r1.ok){console.log("set ok=false err="+(r1&&r1.error)); process.exit(1);} const leak=JSON.stringify(r1.tokens).includes(sec); s.emit("tokens:op",{op:"delete",name:"RV_TOKEN_PROBE",by:"round-verify"},(r2)=>{ console.log("set ok=true", "raw-утечка="+leak, "delete ok="+(r2&&r2.ok)); process.exit(0); }); }); }); s.on("connect_error",()=>{console.log("ok=SOCKET_FAIL"); process.exit(1);}); setTimeout(()=>{console.log("ok=SOCKET_TIMEOUT"); process.exit(1);},9000);' 2>/dev/null

echo "== MEMORY ECONOMY (E5) =="
curl -sf --max-time 5 "$B/memory/economy" | j "'deliveries='+str(d['deliveries']), 'avg_saved='+str(round(d['avg_saved_pct']*100))+'%', 'bytes_saved='+str(d['bytes_saved_total']), 'consumers='+','.join(c['consumer'] for c in d['by_consumer'][:4])"
echo "== MEMORY economy live delivery ×2 (1-я = базлайн, 2-я = familiar-элиминация) =="
curl -s --max-time 5 -X POST "$B/memory" -H "Content-Type: application/json" -d '{"op":"economy","consumer":"verify-demo"}' | j "'#1 ok='+str(d.get('ok')), 'saved='+str(d['metrics']['saved_pct']), 'fresh='+str(d['metrics']['fresh_n']), 'sticky='+str(d['metrics']['sticky_n']), 'familiar='+str(d['metrics']['familiar_n'])"
curl -s --max-time 5 -X POST "$B/memory" -H "Content-Type: application/json" -d '{"op":"economy","consumer":"verify-demo"}' | j "'#2 ok='+str(d.get('ok')), 'saved='+str(d['metrics']['saved_pct']), 'full='+str(d['metrics']['bytes_full'])+'b', 'compact='+str(d['metrics']['bytes_compact'])+'b', 'fresh='+str(d['metrics']['fresh_n']), 'familiar='+str(d['metrics']['familiar_n'])"

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
