#!/usr/bin/env python3
# mt419203-1430.py — BROWSER-TEST-1430 delta sweep (Job 419203 @14:30)
# R-lane reads: SELF_UPDATE_STATUS (build pin), READ_TRANSCRIPT (RESEARCHER), TAB_CENSUS, FLEET_STATUS.
# M-lane: DOWNLOAD_CANCEL closure — единственный UNTESTED в талли 14:00.
#   NEW_TAB -> NAVIGATE (npm tarball, application/octet-stream -> download) -> poll DOWNLOAD_STATUS active
#   -> DOWNLOAD_CANCEL {download_id} -> DOWNLOAD_STATUS verify -> CLOSE_TAB. Mutation gaps >=18s.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
ISSUER = "zai-419203-1430"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-mt419203-1430.json"
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
        RECORDS.append({"step": "policy", "action": action, "verdict": v, "reason": str(getattr(d, "reason", ""))})
        save(); return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"mt1430-{action}-{uuid.uuid4().hex[:8]}"}
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
    keep = None if action in ("READ_TRANSCRIPT",) else res
    rec = {"step": step, "action": action, "status": st, "result": keep}
    if err: rec["error"] = str(err)[:300]
    RECORDS.append(rec); save()
    return st, res, err

# ---------- R-lane ----------
st, upd, _ = run("R1", "SELF_UPDATE_STATUS", {})
ver = (upd or {}).get("current_version") if isinstance(upd, dict) else None
state = (upd or {}).get("state") if isinstance(upd, dict) else None
build_changed = ver != "0.7.0-dev.36336130139.1"
RECORDS.append({"step": "R1-verdict", "build_pin": ver, "state": state, "changed": build_changed,
                "note": "effect-plane re-probe SKIPPED unless changed (5 no-effect proofs stand)"})
save()
print(f"R1: pin={ver} state={state} changed={build_changed}", flush=True)

st, tr, _ = run("R2", "READ_TRANSCRIPT", {"tab_id": RES_TAB, "limit": 24})
text = (tr or {}).get("text", "") if isinstance(tr, dict) else ""
tlen = (tr or {}).get("total_chars") if isinstance(tr, dict) else None
idx = text.rfind("TOOL_REQUEST")
zone = text[idx:] if idx >= 0 else ""
ack = "CONNECTED-TOOLRESULT-FULL-1231" in zone
r_verdict = "REPLIED" if (ack and len(zone) > 400) else "SILENT"
RECORDS.append({"step": "R2-verdict", "total_chars": tlen, "zone_chars": len(zone), "ack": ack, "verdict": r_verdict})
save()
print(f"R2: RESEARCHER {r_verdict} chars={tlen}", flush=True)

run("R3", "TAB_CENSUS", {})
run("R4", "FLEET_STATUS", {})

# ---------- M-lane: DOWNLOAD_CANCEL closure ----------
st, res, _ = run("M1", "NEW_TAB", {}, mutation=True)
tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
if not tab:
    RECORDS.append({"step": "M1-verdict", "why": "no tab id, abort M-lane"}); save()
else:
    run("M2", "NAVIGATE", {"tab_id": tab, "url": "https://registry.npmjs.org/lodash/-/lodash-4.17.21.tgz"}, mutation=True)
    # poll DOWNLOAD_STATUS for an active entry (reads: no mutation gap needed)
    active = None
    for i in range(5):
        time.sleep(6)
        st, ds, _ = run(f"M3-status-{i}", "DOWNLOAD_STATUS", {})
        if isinstance(ds, dict):
            active = ds.get("active")
            if active:
                break
    RECODE = {"step": "M3-verdict", "active_type": type(active).__name__, "active": active if not isinstance(active, list) else [str(a)[:200] for a in active]}
    RECORDS.append(RECODE); save()
    dl_id = None
    if isinstance(active, dict):
        dl_id = active.get("id") or active.get("download_id") or active.get("downloadId")
    elif isinstance(active, list) and active:
        a0 = active[0]
        if isinstance(a0, dict):
            dl_id = a0.get("id") or a0.get("download_id") or a0.get("downloadId")
    if dl_id:
        st, _, err = run("M4", "DOWNLOAD_CANCEL", {"download_id": dl_id}, mutation=True)
        if st != "COMPLETED" and err:
            RECORDS.append({"step": "M4-schema-hint", "error": str(err)[:400]}); save()
        st2, ds2, _ = run("M5", "DOWNLOAD_STATUS", {})
        RECORDS.append({"step": "M5-verdict", "active_after": (ds2 or {}).get("active") if isinstance(ds2, dict) else None,
                        "cancel_status": st})
    else:
        RECORDS.append({"step": "M4-skip", "why": "no active download id in window (render-inline or too fast); DOWNLOAD_CANCEL stays UNTESTED"})
        save()
    run("M9", "CLOSE_TAB", {"tab_id": tab}, mutation=True)

run("R9", "TAB_CENSUS", {})
print("DONE", flush=True)
