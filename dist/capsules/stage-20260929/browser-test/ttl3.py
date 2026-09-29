#!/usr/bin/env python3
# ttl3.py — A/B ttl constraint test + NEW_TAB receipt + SEMANTIC_TYPE final + keepalive state.
import json, uuid, datetime, urllib.request, time, sys, re
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env, req

su, sj = env()
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
TAG = "h33"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def insert(action, ttl, idem, platform=None, payload=None):
    now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": str(uuid.uuid4()), "workspace_id": WS, "target_client_id": CLIENT,
           "issued_by": "zai-live-test-419203", "action": action, "platform": platform,
           "payload": payload or "{}", "status": "PENDING", "issued_at": iso(now),
           "expires_at": iso(now + datetime.timedelta(seconds=ttl)),
           "idempotency_key": idem}
    r = urllib.request.Request(f"{su}/rest/v1/{TBL}", data=json.dumps(row).encode(),
        headers={"apikey": sj, "Authorization": f"Bearer {sj}", "Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(r, timeout=30) as resp:
            resp.read(); return resp.status, ""
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:260]

# A/B: ttl 170 vs 150 on CONTROL_CAPABILITIES (no execution needed; delete after)
c170, e170 = insert("CONTROL_CAPABILITIES", 170, f"btest3-{TAG}-ttl170")
print(f"ttl=170 -> HTTP {c170} {e170[:160]}")
c150, e150 = insert("CONTROL_CAPABILITIES", 150, f"btest3-{TAG}-ttl150")
print(f"ttl=150 -> HTTP {c150} {e150[:160]}")
# cleanup probe rows (keep command table tidy; only my own PENDING inserts)
if c150 == 201 or c170 == 201:
    req(f"{su}/rest/v1/{TBL}?idempotency_key=in.(btest3-{TAG}-ttl170,btest3-{TAG}-ttl150)&status=eq.PENDING", method="DELETE")
print("cleanup done")

# NEW_TAB receipt
code, data = req(f"{su}/rest/v1/{TBL}?select=status,receipt&issued_by=eq.zai-live-test-419203&action=eq.NEW_TAB&order=issued_at.desc&limit=1")
if code == 200 and data:
    print("=== NEW_TAB rc ===")
    print(str(data[0].get("receipt") or "")[:600].replace("\n", " "))

# SEMANTIC_TYPE final
code, data = req(f"{su}/rest/v1/{TBL}?select=status,error,effect_key&issued_by=eq.zai-live-test-419203&action=eq.SEMANTIC_TYPE&order=issued_at.desc&limit=1")
if code == 200 and data:
    print("SEMANTIC_TYPE final:", data[0])

# supervisor keepalive state (live client)
code, data = req(f"{su}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&client_id=eq.{CLIENT}&limit=1")
if code == 200 and data:
    st = data[0].get("state") or {}
    s = json.dumps(st)
    print("=== KEEPALIVE/cycle keys in state ===")
    for k in ["cycle_seq", "keepalive", "last_wake", "rollover", "wake"]:
        for m in re.finditer(rf'"([^"]*{k}[^"]*)":\s*("?[^",}}]*"?)', s):
            print(" ", m.group(1), "=", m.group(2)[:60])
