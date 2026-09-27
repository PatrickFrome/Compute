#!/usr/bin/env python3
# typed-seq.py — SELECT_TAB -> CAPTURE -> SEMANTIC_TYPE sequence with pacing.
# Tests the full GLM chat-agent creation mechanic end to end.
import json, uuid, datetime, urllib.request, time, sys, ast
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
TAB = "tab_d181450b-b7e2-47a1-8bfb-4a1b49b8b67d"
TAG = sys.argv[1] if len(sys.argv) > 1 else "h"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def cmd(action, payload, lane, idem, platform="GLM_ZAI", ttl=150):
    now = datetime.datetime.now(datetime.timezone.utc)
    cid = str(uuid.uuid4())
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": CLIENT,
           "issued_by": "zai-live-test-419203", "action": action, "platform": platform,
           "payload": payload if isinstance(payload, str) else str(payload),
           "status": "PENDING", "issued_at": iso(now),
           "expires_at": iso(now + datetime.timedelta(seconds=ttl)),
           "idempotency_key": idem}
    r = urllib.request.Request(f"{su}/rest/v1/{TBL}", data=json.dumps(row).encode(),
        headers={"apikey": sj, "Authorization": f"Bearer {sj}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp: code = resp.status
    except urllib.error.HTTPError as e: code = e.code; print("  issue body:", e.read()[:150])
    if code not in (200, 201): return None, code, None
    t = time.time() + 110
    while time.time() < t:
        rr = urllib.request.Request(f"{su}/rest/v1/{TBL}?select=status,receipt,error,effect_binding,effect_key&command_id=eq.{cid}",
             headers={"apikey": sj, "Authorization": f"Bearer {sj}"})
        with urllib.request.urlopen(rr, timeout=20) as resp: rows = json.loads(resp.read())
        if rows and rows[0]["status"] not in ("PENDING", None):
            return rows[0], code, cid
        time.sleep(5)
    return {"status": "TIMEOUT"}, code, cid

# step 1: SELECT_TAB
res, code, _ = cmd("SELECT_TAB", "{'tab_id': '%s'}" % TAB, "TAB_MUTATION", f"btest-20260928-{TAG}1-select")
print(f"SELECT_TAB -> {code} {res.get('status')} err={str(res.get('error'))[:100]} effect_key={str(res.get('effect_key'))[:40]}")
time.sleep(8)

# step 2: CAPTURE fresh
res, code, _ = cmd("CAPTURE", "{'tab_id': '%s'}" % TAB, "READ_ONLY", f"btest-20260928-{TAG}2-capture")
print(f"CAPTURE -> {code} {res.get('status')} err={str(res.get('error'))[:100]}")
rc = str(res.get("receipt") or "")
open("/tmp/capture-fresh.txt", "w").write(rc)
if res.get("status") != "COMPLETED" or not rc:
    print("ABORT: capture not usable"); sys.exit(1)
p = ast.literal_eval(rc)
rp = p["result"]
sem = [t for t in rp["semantic_targets"] if t.get("role") == "textbox" and t.get("name")][0]
semref = sem["semantic_ref"]
semref["state_revision_id"] = rp.get("state_revision_id")
print("  composer:", str(sem.get("name"))[:40], "backend:", semref["backend_node_id"], "target:", semref["target_id"], "rev:", str(semref["state_revision_id"])[:24])
time.sleep(3)

# step 3: SEMANTIC_TYPE immediately
payload = {"role": "textbox", "text": "BROWSER-TEST-419203: reply with exactly READY-419203.",
           "tab_id": TAB, "semantic_ref": semref,
           "accessible_name": str(sem.get("name")), "replace_existing": False, "submit_after_type": False}
res, code, cid = cmd("SEMANTIC_TYPE", str(payload), "TAB_MUTATION", f"btest-20260928-{TAG}3-type")
eb = str(res.get("effect_binding") or "")[:80]
print(f"SEMANTIC_TYPE -> {code} {res.get('status')} err={str(res.get('error'))[:120]}")
print(f"  effect_key={str(res.get('effect_key'))[:40]} binding={eb}")
print(f"  receipt={str(res.get('receipt'))[:400]}")
print("CID", cid)
