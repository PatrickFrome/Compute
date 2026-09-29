#!/usr/bin/env python3
# caps3.py — full CONTROL_CAPABILITIES dump + fleet/typed/NEW_TAB probes, paced.
import json, uuid, datetime, urllib.request, time, sys
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
TAG = "h32"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def cmd(action, payload, idem, platform="GLM_ZAI", ttl=170, wait=100):
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
        rr = urllib.request.Request(f"{su}/rest/v1/{TBL}?select=status,receipt,error,effect_key&command_id=eq.{cid}",
             headers={"apikey": sj, "Authorization": f"Bearer {sj}"})
        with urllib.request.urlopen(rr, timeout=20) as resp: rows = json.loads(resp.read())
        if rows and rows[0]["status"] not in ("PENDING", None):
            return rows[0], cid
        time.sleep(6)
    return {"status": "LEASED/TIMEOUT"}, cid

def show(name, res, rclen=260):
    st = str(res.get("status")); err = str(res.get("error"))[:130]
    print(f"{name:26} {st:10} err={err}")
    rc = str(res.get("receipt") or "")
    if rc: print(f"  rc: {rc[:rclen].replace(chr(10),' ')}")
    return st, rc

# 1. Full capabilities list (fresh, cheap)
res, _ = cmd("CONTROL_CAPABILITIES", None, f"btest3-{TAG}-caps")
st, rc = show("CONTROL_CAPABILITIES", res, rclen=3000)
if rc:
    import re
    acts = re.findall(r"'action': '([A-Z_]+)'", rc)
    print("  ALL CAPABLE ACTIONS:", sorted(set(acts)))
time.sleep(30)

# 2. SEMANTIC_TYPE on fleet tab without semantic_ref (binding error check)
res, _ = cmd("SEMANTIC_TYPE", str({"role": "textbox", "text": "probe", "tab_id": "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f", "replace_existing": False, "submit_after_type": False}), f"btest3-{TAG}-stype-noref")
show("SEMANTIC_TYPE(no-ref)", res)
time.sleep(30)

# 3. FLEET_SET_PROFILE (worked at 02:15)
res, _ = cmd("FLEET_SET_PROFILE", str({"profile": "BALANCED"}), f"btest3-{TAG}-fleetprof")
st, rc = show("FLEET_SET_PROFILE", res, rclen=500)
time.sleep(30)

# 4. NEW_TAB (worked at 02:15; check status resolution)
res, _ = cmd("NEW_TAB", str({"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}), f"btest3-{TAG}-newtab")
st, rc = show("NEW_TAB", res, rclen=400)
print("DONE caps3")
