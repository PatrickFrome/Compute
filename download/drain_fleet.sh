#!/bin/bash
# Drain old fleet agents: close their tabs + retire by id, retrying until
# every old agent reaches terminal RETIRED state.
set -u
export $(grep -v '^#' /home/z/.a2/supabase-cloud.env | xargs)
BASE="https://xpeibufgzjknrhbhpffp.supabase.co/rest/v1"
CLIENT="2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
AGENTS='["agent_33e8c21f-bd03-4e00-9af6-9fde602191e1","agent_4ba595bc-59ee-446e-8072-360ed6b02616","agent_a0630868-2010-4e4f-832e-c9cbec5f818a","agent_7e6f098c-9e9c-4d7d-b691-d42794670549"]'

issue() { # $1 action, $2 payload-json, $3 idem-key -> command_id
  curl -s --max-time 25 -X POST "$BASE/rpc/h205f22_a2_browser_supervisor_issue_native_v1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_JWT" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_JWT" \
    -H "Content-Type: application/json" \
    -d "{\"p_client_id\":\"$CLIENT\",\"p_action\":\"$1\",\"p_payload\":$2,\"p_ttl_seconds\":90,\"p_issued_by\":\"CHATGPT_SUPERVISOR\",\"p_idempotency_key\":\"$3\"}" \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('command_id',''))"
}

receipt() { # $1 command_id -> result json
  curl -s --max-time 25 "$BASE/compute_fabric_a2_browser_supervisor_command_h205f22?select=status,receipt&command_id=eq.$1" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_JWT" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_JWT" \
  | python3 -c "
import json,sys
rows=json.load(sys.stdin)
if not rows: print(json.dumps({'status':'PENDING','result':{}}))
else:
    rc=rows[0].get('receipt') or {}
    print(json.dumps({'status':rows[0]['status'],'result':rc.get('result') or {}}))"
}

for attempt in 1 2 3 4 5 6 7 8 9 10; do
  TS=$(date -u +%H%M%S)
  CID=$(issue FLEET_RECONCILE "{\"active\":false,\"target_agents\":0,\"retire_agent_ids\":$AGENTS}" "native-supervisor:drain-retire-$attempt-$TS")
  sleep 7
  R=$(receipt "$CID")
  echo "[attempt $attempt] status=$(echo "$R" | python3 -c "import json,sys; print(json.load(sys.stdin)['status'])")"
  echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin); res=d['result']
c=res.get('counts') or {}
print('  counts:', json.dumps(c))
for a in res.get('agents',[]):
    print('  ', a['agent_id'][:24], a['lifecycle_state'], a.get('tab_id'))
" | tee /tmp/drain_state.txt
  if grep -q '"RETIRED": 4' /tmp/drain_state.txt || grep -q '"RETIRED":4' /tmp/drain_state.txt; then
    echo "ALL RETIRED"; break
  fi
  # close current tabs of any still-live agents
  echo "$R" | python3 -c "
import json,sys
d=json.load(sys.stdin)
for a in d['result'].get('agents',[]):
    if a.get('lifecycle_state') in ('ACTIVE','BOUND_UNVERIFIED') and a.get('tab_id'):
        print(a['tab_id'])" > /tmp/tabs.txt
  i=0
  while read -r TAB; do
    [ -z "$TAB" ] && continue
    i=$((i+1))
    issue CLOSE_TAB "{\"tab_id\":\"$TAB\"}" "native-supervisor:drain-close-$attempt-$i-$TS" >/dev/null
  done < /tmp/tabs.txt
  echo "  closed $i tabs; waiting for re-provision window..."
  sleep 8
done
echo "DRAIN LOOP DONE"
