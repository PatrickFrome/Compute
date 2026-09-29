#!/usr/bin/env python3
# battery2.py — remaining mechanics tests that don't require exact-tab binding.
import json, uuid, datetime, urllib.request, time, sys, ast
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env

su, sj = env()
BASE = su + "/rest/v1/"
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ERRTAB = "tab_4251b4e9-e4da-4dc7-bcbb-fa912a8f257a"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def cmd(action, payload, idem, ttl=150, wait=100):
    now = datetime.datetime.now(datetime.timezone.utc)
    cid = str(uuid.uuid4())
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": CLIENT,
           "issued_by": "zai-live-test-419203", "action": action,
           "platform": "GLM_ZAI" if payload else None,
           "payload": payload if isinstance(payload, str) else (str(payload) if payload else "{}"),
           "status": "PENDING", "issued_at": iso(now),
           "expires_at": iso(now + datetime.timedelta(seconds=ttl)),
           "idempotency_key": idem}
    r = urllib.request.Request(f"{BASE}{TBL}", data=json.dumps(row).encode(),
        headers={"apikey": sj, "Authorization": f"Bearer {sj}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp: code = resp.status
    except urllib.error.HTTPError as e:
        return {"status": f"INSERT-{e.code}", "error": e.read().decode()[:120]}, cid
    if code not in (200, 201): return {"status": f"INSERT-{code}"}, cid
    t = time.time() + wait
    while time.time() < t:
        rr = urllib.request.Request(f"{BASE}{TBL}?select=status,receipt,error&command_id=eq.{cid}",
             headers={"apikey": sj, "Authorization": f"Bearer {sj}"})
        with urllib.request.urlopen(rr, timeout=20) as resp: rows = json.loads(resp.read())
        if rows and rows[0]["status"] not in ("PENDING", None):
            return rows[0], cid
        time.sleep(5)
    return {"status": "LEASED/TIMEOUT"}, cid

TESTS = [
    ("NAVIGATE", str({"url": "https://chat.z.ai/", "tab_id": ERRTAB}), "btest-20260928-l1-nav-errtab"),
    ("GATE_STATUS", None, "btest-20260928-l2-gate"),
    ("WORKTREE_LIST", None, "btest-20260928-l3-worktree"),
    ("PROCESS_CENSUS", None, "btest-20260928-l4-procensus"),
    ("SYSTEM_TELEMETRY", None, "btest-20260928-l5-systel"),
    ("CAPTURE_VIEW", str({"tab_id": ERRTAB}), "btest-20260928-l6-captureview"),
    ("FLEET_SET_PROFILE", str({"profile": "BALANCED"}), "btest-20260928-l7-fleetprof"),
    ("SELF_UPDATE_CHECK", None, "btest-20260928-l8-updcheck"),
    ("CONTROL_CAPABILITIES", None, "btest-20260928-l9-ctlcaps"),
    ("DOWNLOAD_STATUS", None, "btest-20260928-l10-dlstat"),
]
for action, payload, idem in TESTS:
    res, cid = cmd(action, payload, idem)
    err = str(res.get("error"))[:110]
    print(f"{action:22} {res.get('status'):10} err={err}")
    rc = str(res.get("receipt") or "")
    if rc and action in ("NAVIGATE", "SELF_UPDATE_CHECK", "FLEET_SET_PROFILE", "GATE_STATUS", "WORKTREE_LIST"):
        print("   rc:", rc[:260].replace("\n", " "))
    time.sleep(10)
print("DONE battery2")
