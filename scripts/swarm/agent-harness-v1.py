#!/usr/bin/env python3
# agent-harness-v1.py — host-side executor for fleet AGENT_TOOL_REQUEST_V1 events.
# Design source: IMPLEMENTER fleet verdict ("real harness: poll + heartbeat, creds via env")
#                + MANDATE v3 policy-gated autonomy (allowlist = T0 safe actions only).
# Loop: poll me2_event_mirror -> find unanswered AGENT_TOOL_REQUEST_V1 -> execute allowlisted
#       -> persist AGENT_TOOL_RESULT_V1 (chain-linked) -> heartbeat.
# Secrets: env creds used ONLY for REST auth inside sb.sh; never printed, never embedded in results.
# Usage: python3 agent-harness-v1.py once|loop [interval_s]
import json, subprocess, sys, time, datetime, hashlib, re

SB = "/home/z/my-project/scripts/swarm/sb.sh"
TABLE = "me2_event_mirror_h205f22"
ALLOWLIST = {"SYSTEM_TELEMETRY", "MIRROR_STATS", "TIME", "ECHO"}
DENY_NOTE = "not in harness allowlist v1 (SYSTEM_TELEMETRY/MIRROR_STATS/TIME/ECHO); requires operator"

def sb(query, post=None):
    args = ["bash", SB, TABLE, query]
    if post is not None:
        args += ["POST", post]
    r = subprocess.run(args, capture_output=True, text=True, timeout=40)
    out = (r.stdout or "").strip()
    try:
        return json.loads(out)
    except Exception:
        return []

def post_event(etype, subject, payload, retries=3):
    last = sb("select=seq,hash&order=seq.desc&limit=1")
    prev_hash, next_seq = ("", 1)
    if last:
        prev_hash = last[0].get("hash") or ""
        next_seq = int(last[0].get("seq") or 0) + 1
    now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    body = {
        "seq": next_seq,
        "ts": now, "type": etype, "actor": "agent-harness-v1", "subject": subject,
        "payload": payload, "prev_hash": prev_hash,
        "hash": "hv1-" + hashlib.sha256((prev_hash + now + etype).encode()).hexdigest(),
        "daemon_version": "agent-harness-v1",
    }
    ok = False
    for _ in range(retries):
        r = subprocess.run(["bash", SB, TABLE, "", "POST", json.dumps(body)],
                           capture_output=True, text=True, timeout=40)
        if out_ok((r.stdout or "") + (r.stderr or ""), etype):
            ok = True; break
        fresh = sb("select=seq,hash&order=seq.desc&limit=1")
        if fresh:
            prev_hash = fresh[0].get("hash") or prev_hash
            next_seq = int(fresh[0].get("seq") or next_seq) + 1
            body.update({"seq": next_seq, "prev_hash": prev_hash, "ts": now})
        time.sleep(1.5)
    return ok, now

def out_ok(s, etype):
    return etype in s and "[" in s

def telemetry_digest():
    head = sb("select=seq,type&order=seq.desc&limit=1")
    seq_head = head[0]["seq"] if head else -1
    d = subprocess.run(["pgrep", "-c", "-f", "me2-daemon"], capture_output=True, text=True)
    return {
        "kind": "SYSTEM_TELEMETRY",
        "ts": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
        "mirror_seq_head": seq_head,
        "mirror_table": TABLE,
        "daemon_alive": d.returncode == 0 and int((d.stdout or "0").strip() or 0) > 0,
        "fleet_tabs_known": 4,
        "fleet_roles": ["PLANNER", "RESEARCHER", "IMPLEMENTER", "CRITIC"],
        "note": "host-side digest; no credentials, no URLs, no tokens included",
    }

def mirror_stats():
    rows = sb("select=type&order=seq.desc&limit=100")
    from collections import Counter
    c = Counter(r.get("type") for r in rows)
    return {"kind": "MIRROR_STATS", "window": 100, "counts": dict(c)}

def execute(action, payload):
    if action == "SYSTEM_TELEMETRY":
        return "COMPLETED", telemetry_digest()
    if action == "MIRROR_STATS":
        return "COMPLETED", mirror_stats()
    if action == "TIME":
        return "COMPLETED", {"kind": "TIME",
                             "utc": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")}
    if action == "ECHO":
        blob = json.dumps(payload, ensure_ascii=False)[:500]
        return "COMPLETED", {"kind": "ECHO", "echo": blob}
    return "DENIED", {"kind": action, "reason": DENY_NOTE}

def cycle():
    events = sb("select=seq,type,payload&order=seq.desc&limit=60")
    answered = set()
    requests = []
    for e in events:
        p = e.get("payload") or {}
        if e["type"] == "AGENT_TOOL_RESULT_V1" and p.get("request_id"):
            answered.add(p["request_id"])
        elif e["type"] == "AGENT_TOOL_REQUEST_V1" and p.get("request_id"):
            requests.append((e["seq"], p))
    pending = [(s, p) for s, p in requests if p["request_id"] not in answered]
    print(f"harness: requests={len(requests)} answered={len(answered)} pending={len(pending)}", flush=True)
    for seq, p in sorted(pending):
        action = str(p.get("action") or p.get("kind") or "UNKNOWN").upper()
        status, result = execute(action, p)
        ok, ts = post_event("AGENT_TOOL_RESULT_V1", "fleet-agent",
                            {"request_id": p["request_id"], "action": action,
                             "status": status, "result": result,
                             "executed_at": ts, "harness": "v1",
                             "consumed_next_generation": True})
        print(f"harness: req={p['request_id']} action={action} -> {status} persist={ok}", flush=True)
        time.sleep(2)
    if not pending:
        now = datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")
        ok, _ = post_event("AGENT_HARNESS_HEARTBEAT", "host-harness",
                           {"ts": now, "harness": "v1", "pending": 0})
        print("harness: heartbeat persist=" + str(ok), flush=True)
    return len(pending)

if __name__ == "__main__":
    mode = sys.argv[1] if len(sys.argv) > 1 else "once"
    if mode == "loop":
        iv = int(sys.argv[2]) if len(sys.argv) > 2 else 120
        while True:
            cycle(); time.sleep(iv)
    else:
        cycle()
