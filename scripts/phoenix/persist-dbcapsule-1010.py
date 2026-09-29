#!/usr/bin/env python3
# persist-dbcapsule-1010.py — store AGENT DB CONNECT CAPSULE V1 into me2_event_mirror (pull channel)
import json, subprocess, hashlib, datetime

SB = "/home/z/my-project/scripts/swarm/sb.sh"
CAPSULE_FILE = "/home/z/my-project/scripts/swarm/swarm-secrets.env"

# 1) last chain row -> prev_hash, next seq
last = json.loads(subprocess.run(["bash", SB, "me2_event_mirror_h205f22",
    "select=seq,hash&order=seq.desc&limit=1"], capture_output=True, text=True).stdout or "[]")
prev_hash, next_seq = ("", 0)
if last:
    prev_hash = last[0].get("hash") or ""
    next_seq = int(last[0].get("seq") or 0) + 1

capsule = open(CAPSULE_FILE).read()
now = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
payload = {
    "capsule_name": "AGENT_DB_CONNECT_CAPSULE_V1",
    "operator_order": "distribute scripts with ALL secrets (Supabase + GitHub) to all swarm agents; one shared DB",
    "issued_at": now,
    "secrets_bundle": capsule,
    "scripts": ["agent-connect.env.sh", "sb.sh", "gh.sh", "agent-bootstrap.sh", "README-AGENTS.md"],
    "host_dir": "/home/z/my-project/scripts/swarm/",
    "github_repo": "PatrickFrome/Compute", "github_sync_branch": "sandbox/me2-os",
    "tables_suffix": "_h205f22",
    "rules": "never print/log/commit secrets; repo PUBLIC; use sb.sh/gh.sh",
}
body = {
    "ts": now, "type": "AGENT_DB_CONNECT_CAPSULE_V1", "actor": "supervisor-im-cron",
    "subject": "swarm-all-agents", "payload": payload,
    "prev_hash": prev_hash,
    "hash": "sv-" + hashlib.sha256((prev_hash + now + "AGENT_DB_CONNECT_CAPSULE_V1").encode()).hexdigest(),
    "daemon_version": "supervisor-minted-v1",
}
r = subprocess.run(["bash", SB, "me2_event_mirror_h205f22", "", "POST", json.dumps(body)],
                   capture_output=True, text=True)
out = (r.stdout or "").strip()
ok = out.startswith("[") and "AGENT_DB_CONNECT_CAPSULE_V1" in out
print("insert:", "OK" if ok else f"RAW={out[:200]} ERR={r.stderr[:200]}")
if not ok and "seq" in out.lower():
    body["seq"] = next_seq
    r = subprocess.run(["bash", SB, "me2_event_mirror_h205f22", "", "POST", json.dumps(body)],
                       capture_output=True, text=True)
    out = (r.stdout or "").strip()
    ok = out.startswith("[") and "AGENT_DB_CONNECT_CAPSULE_V1" in out
    print("insert(retry with seq):", "OK" if ok else f"RAW={out[:200]}")

# 2) verify pull path (agent view: select capsule event)
chk = json.loads(subprocess.run(["bash", SB, "me2_event_mirror_h205f22",
    "select=seq,type,subject&order=seq.desc&limit=1"], capture_output=True, text=True).stdout or "[]")
print("pull-check:", chk if chk else "EMPTY")
