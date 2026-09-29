#!/usr/bin/env python3
# blocker3.py — root-blocker re-test: SELECT_TAB on supervisor tab, paced.
import json, uuid, datetime, urllib.request, time, sys
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
SUP = "tab_d255519c-a0d3-4f51-8b73-c47929de6d28"
FLEET0 = "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"
TAG = "h31"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def cmd(action, payload, lane, idem, platform="GLM_ZAI", ttl=150, wait=90):
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
    except urllib.error.HTTPError as e:
        return {"status": f"INSERT-{e.code}", "error": e.read().decode()[:150]}, cid
    if code not in (200, 201): return {"status": f"INSERT-{code}"}, cid
    t = time.time() + wait
    while time.time() < t:
        rr = urllib.request.Request(f"{su}/rest/v1/{TBL}?select=status,receipt,error,effect_key,effect_binding&command_id=eq.{cid}",
             headers={"apikey": sj, "Authorization": f"Bearer {sj}"})
        with urllib.request.urlopen(rr, timeout=20) as resp: rows = json.loads(resp.read())
        if rows and rows[0]["status"] not in ("PENDING", None):
            return rows[0], cid
        time.sleep(6)
    return {"status": "LEASED/TIMEOUT"}, cid

def show(name, res):
    st = str(res.get("status"))
    err = str(res.get("error"))[:140]
    ek = str(res.get("effect_key"))[:48]
    eb = str(res.get("effect_binding"))[:90]
    print(f"{name:24} {st:10} err={err}")
    if ek != "None": print(f"  effect_key={ek}")
    if eb != "None": print(f"  binding={eb}")
    rc = str(res.get("receipt") or "")
    if rc: print(f"  rc: {rc[:300].replace(chr(10),' ')}")
    return st, rc

# TEST 1: SELECT_TAB on SUPERVISOR tab (root blocker re-check)
res, _ = cmd("SELECT_TAB", str({"tab_id": SUP}), "TAB_MUTATION", f"btest3-{TAG}-sel-sup")
show("SELECT_TAB->SUPERVISOR", res)
time.sleep(25)

# TEST 2: SELECT_TAB on FLEET tab
res, _ = cmd("SELECT_TAB", str({"tab_id": FLEET0}), "TAB_MUTATION", f"btest3-{TAG}-sel-fleet")
show("SELECT_TAB->FLEET0", res)
print("DONE blocker3")
