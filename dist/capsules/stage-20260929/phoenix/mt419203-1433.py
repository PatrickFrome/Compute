#!/usr/bin/env python3
# mt419203-1433.py — DOWNLOAD_CANCEL closure attempt #2 (Job 419203, calibrated follow-up to mt1430)
# mt1430 fact: registry.npmjs.org = LOAD_URL_REJECTED (network-selective); raw.githubusercontent.com = proven download source (13:04 receipt).
# Plan: slow download via httpbin drip (30s window, 200KB) -> poll active fast -> DOWNLOAD_CANCEL {request_id}
#       -> verify. Fallback (max 1 more): codeload tarball ~9MB. Mutation gaps >=18s. No blind retries —
#       each NAVIGATE uses a DIFFERENT source informed by the previous error (calibration).
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "zai-419203-1430"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-mt419203-1433.json"
PE = PolicyEngine()
RECORDS = []
LAST_MUT = [0.0]

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

def save():
    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)

def enqueue(action, payload=None, ttl=75):
    d = PE.evaluate(action, {"tab_id": (payload or {}).get("tab_id"), "issuer": ISSUER})
    v = str(getattr(d, "verdict", None) or getattr(d, "decision", None) or d).upper()
    if v != "ALLOW":
        RECORDS.append({"step": "policy", "action": action, "verdict": v}); save()
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"mt1433-{action}-{uuid.uuid4().hex[:8]}"}
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

def run(step, action, payload=None, mutation=False, timeout=60):
    if mutation:
        gap = time.time() - LAST_MUT[0]
        if LAST_MUT[0] and gap < 18:
            time.sleep(18 - gap + 1)
        LAST_MUT[0] = time.time()
    cid = enqueue(action, payload, ttl=timeout)
    if cid is None:
        RECORDS.append({"step": step, "action": action, "status": "POLICY_BLOCKED"}); save()
        return "POLICY_BLOCKED", {}, None
    st, res, err = poll(cid, timeout)
    print(f"{step} {action}: {st}", flush=True)
    rec = {"step": step, "action": action, "status": st, "result": res}
    if err: rec["error"] = str(err)[:300]
    RECORDS.append(rec); save()
    return st, res, err

def try_cancel_from_active(tag):
    """Poll DOWNLOAD_STATUS fast; if active entry found -> DOWNLOAD_CANCEL(request_id) -> verify. Returns True if cancelled."""
    for i in range(8):
        time.sleep(4)
        st, ds, _ = run(f"{tag}-status-{i}", "DOWNLOAD_STATUS", {})
        act = (ds or {}).get("active") if isinstance(ds, dict) else None
        entry = None
        if isinstance(act, dict) and act:
            entry = act
        elif isinstance(act, list) and act:
            entry = act[0]
        if entry:
            rid = entry.get("request_id") or entry.get("id") or entry.get("download_id")
            RECORDS.append({"step": f"{tag}-active", "entry": {k: str(v)[:120] for k, v in entry.items()}, "cancel_key": str(rid)[:80]})
            save()
            if rid:
                st, _, err = run(f"{tag}-cancel", "DOWNLOAD_CANCEL", {"request_id": rid}, mutation=True)
                st2, ds2, _ = run(f"{tag}-verify", "DOWNLOAD_STATUS", {})
                act2 = (ds2 or {}).get("active") if isinstance(ds2, dict) else None
                RECORDS.append({"step": f"{tag}-verdict", "cancel_status": st,
                                "cancel_error": str(err)[:200] if err else None,
                                "active_after": act2 if not isinstance(act2, list) else f"{len(act2)} entries",
                                "last_after": ((ds2 or {}).get("last") or {}).get("state") if isinstance(ds2, dict) else None})
                save()
                return True
            # active entry without id — dump and stop
            return False
    return False

st, res, _ = run("M1", "NEW_TAB", {}, mutation=True)
tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
if not tab:
    RECORDS.append({"step": "M1-verdict", "why": "no tab id"}); save(); sys.exit(0)

# Attempt 1: httpbin drip (30s window)
run("M2", "NAVIGATE", {"tab_id": tab, "url": "https://httpbin.org/drip?duration=30&numbytes=200000&code=200"}, mutation=True)
ok = try_cancel_from_active("A1")
if not ok:
    # Attempt 2 (calibrated, last): codeload tarball ~9MB (github family proven reachable)
    run("M3", "NAVIGATE", {"tab_id": tab, "url": "https://codeload.github.com/git/git/tar.gz/refs/tags/v2.9.0"}, mutation=True)
    ok = try_cancel_from_active("A2")

RECORDS.append({"step": "final", "download_cancel_closed": ok})
save()
run("M9", "CLOSE_TAB", {"tab_id": tab}, mutation=True)
print("DONE", flush=True)
