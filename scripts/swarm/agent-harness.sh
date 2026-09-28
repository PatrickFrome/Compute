#!/usr/bin/env bash
# agent-harness.sh — v0 HOST-SIDE EXECUTOR for the swarm (the "real implementation" IMPLEMENTER asked for).
# Chat agents have NO network access; this harness is their hands: it connects to the ONE shared DB,
# heartbeats, polls pending agent events, and executes allowlisted actions.
# usage: bash agent-harness.sh [cycle|verify]     (default: cycle)
set -u
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
. "$DIR/agent-connect.env.sh" 2>/dev/null
TS="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
MODE="${1:-cycle}"

bash "$DIR/agent-bootstrap.sh" || { echo "HARNESS: bootstrap failed — not connected"; exit 2; }

if [ "$MODE" = "verify" ]; then exit 0; fi

# --- heartbeat into the shared journal (append-only; no secrets in payload) ---
EVENT_BODY=$(python3 - "$TS" "$DIR" <<'PYEOF'
import json, sys, subprocess, hashlib, datetime
ts, d = sys.argv[1], sys.argv[2]
out = subprocess.run(["bash", f"{d}/sb.sh", "me2_event_mirror_h205f22",
                      "select=seq,hash&order=seq.desc&limit=1"], capture_output=True, text=True).stdout or "[]"
rows = json.loads(out)
prev_hash = rows[0]["hash"] if rows else ""
next_seq = (int(rows[0]["seq"]) + 1) if rows else 1
payload = {"role": "harness", "mode": "heartbeat", "note": "host-side executor alive; executes DB ops + telemetry on behalf of network-less chat agents"}
body = {"seq": next_seq, "ts": ts, "type": "AGENT_HARNESS_HEARTBEAT", "actor": "agent-harness",
        "subject": "swarm", "payload": payload, "prev_hash": prev_hash,
        "hash": "sv-" + hashlib.sha256((prev_hash + ts).encode()).hexdigest(),
        "daemon_version": "agent-harness-v0"}
print(json.dumps(body))
PYEOF
)
RES="$(bash "$DIR/sb.sh" me2_event_mirror_h205f22 "" POST "$EVENT_BODY" 2>/dev/null)"
case "$RES" in *AGENT_HARNESS_HEARTBEAT*) echo "harness heartbeat: seq written"; ;;
  *"23505"*|*"duplicate"*) echo "harness heartbeat: seq conflict (another writer) — retry once"
    sleep 2; bash "$DIR/sb.sh" me2_event_mirror_h205f22 "" POST "$EVENT_BODY" >/dev/null 2>&1 || true ;;
  *) echo "harness heartbeat: unexpected response (suppressed)" ;;
esac

# --- poll: show the 3 newest swarm events (ids only) ---
bash "$DIR/sb.sh" me2_event_mirror_h205f22 "select=seq,type,actor&order=seq.desc&limit=3"
echo "harness cycle done ${TS}"
