#!/usr/bin/env python3
# r419718-1335-census.py — raw TAB_CENSUS + full DOWNLOAD_STATUS key map (schema calibration, reads only)
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "zai-419718-1330"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1335-census.json"
PE = PolicyEngine()
RECORDS = []

def load_env():
    env = {}
    with open(ENVF) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
SU, SJ = ENV["SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_JWT"]
URL = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22"

def hdr():
    return {"apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json"}

def enqueue(action, payload=None, ttl=75):
    d = PE.evaluate(action, {"tab_id": (payload or {}).get("tab_id"), "issuer": ISSUER})
    v = str(getattr(d, "verdict", None) or getattr(d, "decision", None) or d).upper()
    if v == "DENY":
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"r1335-{action}-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    return cid

def poll(cid, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2.5)
        q = urllib.request.Request(f"{URL}?command_id=eq.{cid}&select=status,receipt,error", headers=hdr())
        rr = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
        if rr and rr[0].get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            return rr[0]["status"], (rr[0].get("receipt") or {}).get("result") or {}, rr[0].get("error")
    return "TIMEOUT", {}, None

def run(action, payload=None):
    cid = enqueue(action, payload)
    if cid is None:
        return "POLICY_BLOCKED", {}, None
    st, res, err = poll(cid)
    print(f"{action}: {st}", flush=True)
    return st, res, err

st, cen, _ = run("TAB_CENSUS", {})
RECORDS.append({"action": "TAB_CENSUS", "status": st, "raw_result": cen, "error": str(err)[:200] if (err := None) is not None else None})
time.sleep(16)
st2, dl, _ = run("DOWNLOAD_STATUS", {})
keys = list(dl.keys()) if isinstance(dl, dict) else []
RECORDS.append({"action": "DOWNLOAD_STATUS", "status": st2, "top_keys": keys,
                "raw_result": dl})
json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)

# concise print
if isinstance(cen, dict):
    print("CENSUS keys:", list(cen.keys()))
    for k, v in cen.items():
        print(f"  {k}: {str(v)[:160]}")
else:
    print("CENSUS raw:", str(cen)[:300])
print("DL keys:", keys)
for k in keys:
    v = dl.get(k)
    print(f"  {k}: {type(v).__name__} {str(v)[:140]}")
