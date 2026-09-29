#!/usr/bin/env python3
# r419718-1415-reads.py — reads only: SELF_UPDATE_STATUS (build-pin check) + RESEARCHER readback
# Per 1408 next-tick: (1) effect-plane re-probe ONLY if build changed; (2) RESEARCHER marker readback.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
ISSUER = "zai-419718-1415"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1415-reads.json"
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

def save():
    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)

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
           "idempotency_key": f"r1415-{action}-{uuid.uuid4().hex[:8]}"}
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
    print(f"{step} {action}: {st}", flush=True)
    RECORDS.append({"step": step, "action": action, "status": st, "result": res if action != "READ_TRANSCRIPT" else None})
    save()
    return st, res, err

st, upd, _ = run("S1", "SELF_UPDATE_STATUS", {})
ver = (upd or {}).get("current_version") if isinstance(upd, dict) else None
state = (upd or {}).get("state") if isinstance(upd, dict) else None
st, tr, _ = run("S2", "READ_TRANSCRIPT", {"tab_id": RES_TAB})
text = (tr or {}).get("text", "") if isinstance(tr, dict) else ""
tlen = (tr or {}).get("total_chars") if isinstance(tr, dict) else None
idx = text.rfind("TOOL_REQUEST")
zone = text[idx:] if idx >= 0 else ""
ack = "CONNECTED-TOOLRESULT-FULL-1231" in zone
# 1415-маркер: новый маркер доставки для следующего потребления RESEARCHER'ом на его генерации
marker = "CONNECTED-TOOLRESULT-R28-1415"
verdict = "REPLIED" if (ack and len(zone) > 400) else "SILENT"
RECORDS.append({"step": "verdict", "self_update": {"version": ver, "state": state},
                "researcher": {"total_chars": tlen, "zone_chars": len(zone), "ack": ack, "verdict": verdict,
                               "marker_armed": marker in text}})
save()
print(f"SELF_UPDATE: {state} v={ver} | RESEARCHER: {verdict} chars={tlen}", flush=True)
