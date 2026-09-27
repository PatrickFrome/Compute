#!/usr/bin/env python3
# last3.py — close remaining probes: 23514 mystery, CAPTURE retarget check, mesh ACTIVE.
import json, uuid, datetime, urllib.request, time, sys, re
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env, req

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
TAG = "h34"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def insert_raw(action, payload, idem, ttl=150, wait=70):
    now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": str(uuid.uuid4()), "workspace_id": WS, "target_client_id": CLIENT,
           "issued_by": "zai-live-test-419203", "action": action, "platform": "GLM_ZAI" if payload else None,
           "payload": payload if isinstance(payload, str) else (str(payload) if payload else "{}"),
           "status": "PENDING", "issued_at": iso(now),
           "expires_at": iso(now + datetime.timedelta(seconds=ttl)),
           "idempotency_key": idem}
    r = urllib.request.Request(f"{su}/rest/v1/{TBL}", data=json.dumps(row).encode(),
        headers={"apikey": sj, "Authorization": f"Bearer {sj}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            resp.read(); cid = json.loads(json.dumps(row))["command_id"]
    except urllib.error.HTTPError as e:
        return {"status": f"INSERT-{e.code}"}, e.read().decode()[:200]
    t = time.time() + wait
    while time.time() < t:
        rr = urllib.request.Request(f"{su}/rest/v1/{TBL}?select=status,receipt,error&command_id=eq.{cid}",
             headers={"apikey": sj, "Authorization": f"Bearer {sj}"})
        with urllib.request.urlopen(rr, timeout=20) as resp: rows = json.loads(resp.read())
        if rows and rows[0]["status"] not in ("PENDING", None):
            return rows[0], cid
        time.sleep(6)
    return {"status": "LEASED/TIMEOUT"}, cid

# 1. CAPTURE on fleet tab PLANNER (check silent retargeting: does receipt's perception match requested tab?)
res, cid = insert_raw("CAPTURE", str({"tab_id": "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"}), f"btest3-{TAG}-capture-fleet")
print("CAPTURE->PLANNER:", res.get("status"), str(res.get("error"))[:100])
rc = str(res.get("receipt") or "")
m = re.search(r"'target_id': '(webcontents:\d+)'", rc)
m2 = re.search(r"'tab_id': '(tab_[0-9a-f-]+)'", rc)
mu = re.search(r"'url': '([^']*)'", rc)
print("  captured tab_id:", m2.group(1) if m2 else "?", "| target:", m.group(1) if m else "?", "| url:", (mu.group(1)[:70] if mu else "?"))
print("  requested: tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f (webcontents:4 per fleet receipt)")
match = "MATCH" if (m2 and m2.group(1) == "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f") else "RETARGETED"
print("  verdict:", match)

# 2. mesh ACTIVE instance
code, data = req(f"{su}/rest/v1/compute_fabric_a2_supervisor_mesh_instance_h205f22?select=supervisor_instance_id,status,last_seen_at,tab_id,capabilities&status=eq.ACTIVE&limit=3")
print("=== MESH ACTIVE ===")
if code == 200:
    for r in data:
        print(" ", r.get("supervisor_instance_id"), r.get("status"), "seen:", r.get("last_seen_at"), "tab:", r.get("tab_id"))
else:
    print(" HTTP", code, str(data)[:120])
