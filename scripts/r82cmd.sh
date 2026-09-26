#!/bin/bash
# R82 command fastlane helper: issue a native supervisor command and poll to terminal.
# usage: r82cmd.sh ACTION [PAYLOAD_JSON] [TTL]
source /home/z/.a2/supabase-cloud.env
H1="apikey: $SUPABASE_SERVICE_ROLE_KEY"; H2="Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY"
CLIENT="2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ACTION="$1"; PAYLOAD="${2:-{\}}"; TTL="${3:-120}"
KEY="r82-op-$(date +%s)-$RANDOM"
ISSUE=$(curl -s -X POST "$SUPABASE_URL/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1" \
  -H "$H1" -H "$H2" -H "Content-Type: application/json" \
  -d "{\"p_client_id\":\"$CLIENT\",\"p_action\":\"$ACTION\",\"p_payload\":$PAYLOAD,\"p_ttl_seconds\":$TTL,\"p_issued_by\":\"R82_OPERATOR_SANDBOX\",\"p_idempotency_key\":\"$KEY\"}")
CMD_ID=$(echo "$ISSUE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('command_id') or d.get('code') or 'ERR')" 2>/dev/null)
echo "issue[$ACTION] -> $CMD_ID"
[ "$CMD_ID" = "ERR" ] && echo "$ISSUE" && exit 1
for i in $(seq 1 60); do
  sleep 3
  ROW=$(curl -s "$SUPABASE_URL/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?command_id=eq.$CMD_ID&select=status,error,receipt,leased_at,completed_at" -H "$H1" -H "$H2")
  ST=$(echo "$ROW" | python3 -c "import json,sys; print(json.load(sys.stdin)[0]['status'])")
  if [ "$ST" != "PENDING" ] && [ "$ST" != "LEASED" ]; then
    echo "status: $ST (poll $i)"
    echo "$ROW" | python3 -c "
import json,sys
r=json.load(sys.stdin)[0]
print('error:', r.get('error'))
print('receipt:', json.dumps(r.get('receipt'),ensure_ascii=False)[:3500])
"
    exit 0
  fi
done
echo "TIMEOUT still $ST"; exit 2
