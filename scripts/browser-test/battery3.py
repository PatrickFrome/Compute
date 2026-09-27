#!/usr/bin/env python3
# battery3.py — BROWSER-TEST tick 02:30 (+08). Full mechanics re-probe.
# Lane A (READ): TAB_CENSUS, SYSTEM_TELEMETRY, GATE_STATUS, CONTROL_CAPABILITIES,
#                SELF_UPDATE_STATUS, DEV_PLANE_STATUS, DOWNLOAD_STATUS, MIRROR_STATUS
# Lane B (root blocker): SELECT_TAB on supervisor tab
# Lane C (fleet): FLEET_STATUS + fleet snapshot receipt
import json, uuid, datetime, urllib.request, time, sys
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
TAG = "h30"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def cmd(action, payload, lane, idem, platform="GLM_ZAI", ttl=150, wait=100):
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
        time.sleep(5)
    return {"status": "LEASED/TIMEOUT"}, cid

def probe(action, payload, lane, idem, show_receipt=True, rc_len=240):
    res, cid = cmd(action, payload, lane, idem)
    st = str(res.get("status"))
    err = str(res.get("error"))[:130]
    ek = str(res.get("effect_key"))[:44]
    print(f"[{lane}] {action:22} {st:12} err={err}")
    if ek and ek != "None": print(f"     effect_key={ek}")
    rc = str(res.get("receipt") or "")
    if show_receipt and rc:
        print(f"     rc: {rc[:rc_len].replace(chr(10), ' ')}")
    return st, rc, res

print("=== LANE B: root blocker re-check (SELECT_TAB) ===")
# discover supervisor tab from census first
st, rc, _ = probe("TAB_CENSUS", None, "READ", f"btest-3-{TAG}-census", show_receipt=False)
sup_tab = None
if st == "COMPLETED" and rc:
    try:
        import ast as _ast
        tabs = _ast.literal_eval(rc).get("result", {}).get("tabs", [])
        print(f"     tabs={len(tabs)}")
        for t in tabs:
            print(f"     - {str(t.get('tab_id'))[:20]} role={t.get('role')} kind={t.get('kind')} url={str(t.get('url'))[:60]}")
            if t.get("role") == "SUPERVISOR": sup_tab = t.get("tab_id")
    except Exception as e:
        print("     parse-err:", str(e)[:100], "| rc head:", rc[:200])
else:
    probe("TAB_CENSUS", None, "READ", f"btest-3-{TAG}-census-r", rc_len=300)

if sup_tab:
    print(f"--- SELECT_TAB on SUPERVISOR tab {str(sup_tab)[:20]} ---")
    st, rc, _ = probe("SELECT_TAB", str({"tab_id": sup_tab}), "TAB_MUTATION", f"btest-3-{TAG}-select", rc_len=200)

print()
print("=== LANE A: READ plane ===")
for action, pl in [("SYSTEM_TELEMETRY", None), ("GATE_STATUS", None),
                   ("CONTROL_CAPABILITIES", None), ("SELF_UPDATE_STATUS", None),
                   ("DEV_PLANE_STATUS", None), ("DOWNLOAD_STATUS", None),
                   ("MIRROR_STATUS", None)]:
    probe(action, pl, "READ", f"btest-3-{TAG}-{action.lower()}", rc_len=200)
    time.sleep(6)

print()
print("=== LANE C: fleet ===")
probe("FLEET_STATUS", None, "FLEET", f"btest-3-{TAG}-fleet", rc_len=400)
time.sleep(6)
print("DONE battery3")
