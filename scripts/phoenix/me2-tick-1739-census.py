#!/usr/bin/env python3
# me2-tick-1739-census.py — ME2-TICK-20260928-1739, post-storm-guard verification:
# (1) supervisor circuit state after the NEW_TAB storm was stopped (COMPLETED = reset)
# (2) fresh tab capacity for the swarm's declared cleanup work package
# READ_ONLY 0pts, paced, policy-filtered. NO mutations, NO blind retry, no secrets.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "zai-me2tick-1739"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-me2tick-1739-census.json"
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
STATE_URL = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&client_id=eq.{TGT}&limit=1"

def hdr():
    return {"apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json"}

def save():
    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)

# ---- S0: state blob (protected set, REST — no command budget) ----
bound = {}
try:
    q = urllib.request.Request(STATE_URL, headers=hdr())
    blob = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
    st = blob[0]["state"] if blob else {}
    fleet = st.get("fleet", {})
    for a in fleet.get("agents", []) or []:
        aid = a.get("id") or a.get("agent_id") or "?"
        bt = a.get("bound_tab") or a.get("tab_id") or a.get("bound_tab_id")
        status = a.get("status") or a.get("state")
        if bt:
            bound[str(bt)] = {"agent": aid, "status": status}
    RECORDS.append({"step": "S0-state", "agents": len(fleet.get("agents", []) or []),
                    "bound_tabs": bound})
    print(f"S0 state: agents={len(fleet.get('agents', []) or [])} bound_tabs={list(bound.keys())}", flush=True)
except Exception as e:
    RECORDS.append({"step": "S0-state", "error": str(e)[:200]})
    print(f"S0 state error: {e}", flush=True)

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
           "idempotency_key": f"tick1739-{action}-{uuid.uuid4().hex[:8]}"}
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

def run(step, action, payload=None):
    cid = enqueue(action, payload)
    if cid is None:
        RECORDS.append({"step": step, "action": action, "status": "POLICY_BLOCKED"}); save()
        return "POLICY_BLOCKED", {}, None
    st, res, err = poll(cid)
    print(f"{step} {action}: {st} err={err!r}", flush=True)
    RECORDS.append({"step": step, "action": action, "status": st, "error": err, "result": res})
    save()
    return st, res, err

# ---- S1: TAB_CENSUS (circuit probe + capacity) ----
st, tc, err = run("S1", "TAB_CENSUS", {})

# ---- analysis ----
tabs = (tc or {}).get("tabs") or []
kinds = {}
protected, reclaim_candidates = [], []
for t in tabs:
    k = str(t.get("kind") or t.get("role") or "?")
    kinds[k] = kinds.get(k, 0) + 1
    tid = str(t.get("tab_id") or "")
    if tid in bound:
        protected.append(tid)
    elif k == "GLM_CHAT":
        reclaim_candidates.append(tid)
verdict = {
    "circuit_state_after_storm_guard": st,
    "circuit_error": err,
    "tab_census": {"status": st, "total": (tc or {}).get("count", len(tabs)), "kinds": kinds},
    "protected_bound_tabs": protected,
    "reclaim_candidates_glm_unbound": {"count": len(reclaim_candidates), "ids": reclaim_candidates[:40]},
    "note": "READ-ONLY — reclamation belongs to swarm work package / owner decision",
}
RECORDS.append({"step": "VERDICT", "verdict": verdict})
save()
print(json.dumps(verdict, ensure_ascii=False, indent=1))
