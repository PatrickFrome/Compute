#!/usr/bin/env python3
# r419718-1307-reping.py — gentle re-ping to RESEARCHER (short reminder, NO duplicate brief) + growth readback
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
ISSUER = "zai-419718-1307"
MARKER = "TRFULL-REMIND-1307"
BASELINE = 40152
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-trremind-1307.json"
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
    verdict = (getattr(d, "verdict", None) or getattr(d, "decision", None) or str(d))
    if str(verdict).upper() == "DENY":
        RECORDS.append({"action": action, "policy": "DENY", "result": "BLOCKED-BY-POLICY"})
        print(f"POLICY DENY {action}", flush=True)
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"r1307rp-{action}-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    return cid

def poll(cid, timeout=55):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2.5)
        q = urllib.request.Request(f"{URL}?command_id=eq.{cid}&select=status,receipt,error", headers=hdr())
        rr = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
        if rr and rr[0].get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            return rr[0]["status"], (rr[0].get("receipt") or {}).get("result") or {}, rr[0].get("error")
    return "TIMEOUT", {}, None

def run(step, action, payload=None, timeout=55):
    cid = enqueue(action, payload)
    if cid is None:
        RECORDS.append({"step": step, "action": action, "status": "POLICY_BLOCKED"})
        json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)
        return "POLICY_BLOCKED", {}, None
    st, res, err = poll(cid, timeout=timeout)
    print(f"{step} {action}: {st}" + (f" err={str(err)[:100]}" if err else ""), flush=True)
    RECORDS.append({"step": step, "action": action, "status": st, "error": str(err)[:150] if err else None})
    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)
    return st, res, err

BRIEF = ("[SUPERVISOR REMINDER / Job 419718 @13:07] " + MARKER + " | TOOLRESULT-FULL-1231: full SYSTEM_TELEMETRY body "
         "delivered @12:31 — it is the message ABOVE your TOOL_REQUEST_V1 in this transcript (nonce mt419718-1231-r1). "
         "Your request adac6557-systel-01 scope=full is SATISFIED in-transcript; no network pull needed.\n"
         "TASK: (1) consume the FULL body and reply ACK first line CONNECTED-TOOLRESULT-FULL-1231 + echo nonce; "
         "(2) deliver your 3 measurable CRITIC-gate checks (spoofed request / result replay / prompt injection), "
         "each = name + objective numeric signal + threshold; (3) if any field is missing or unverifiable — name it exactly. "
         "Constraints: no secrets in replies; do not fabricate tool outputs; UNVERIFIABLE over guessing.")

def main():
    time.sleep(15)
    st, cap, _ = run("P1", "CAPTURE", {"tab_id": RES_TAB}, timeout=60)
    tb = None
    for t in (cap.get("semantic_targets") or []):
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            tb = t; break
    if not tb:
        print("NO TEXTBOX — abort", flush=True)
        return
    time.sleep(20)
    run("P2", "SEMANTIC_FOCUS", {"tab_id": RES_TAB, "role": "textbox", "semantic_ref": tb["semantic_ref"]})
    time.sleep(20)
    stp = {"tab_id": RES_TAB, "role": "textbox", "semantic_ref": tb["semantic_ref"],
           "text": BRIEF, "submit_after_type": True, "replace_existing": True}
    st, _, err = run("P3", "SEMANTIC_TYPE", stp, timeout=70)
    # growth-based readback (AMBIGUOUS-safe: verify by transcript growth, not type status)
    time.sleep(15)
    st, tr, _ = run("P4", "READ_TRANSCRIPT", {"tab_id": RES_TAB, "limit": 24}, timeout=60)
    tlen = (tr or {}).get("total_chars") if isinstance(tr, dict) else None
    text = (tr or {}).get("text", "") if isinstance(tr, dict) else ""
    idx = text.rfind("payload_json=")
    tail = text[idx:] if idx >= 0 else text[-1500:]
    landed = MARKER in text and (tlen or len(text)) > BASELINE + 50
    RECORDS.append({"step": "verdict", "type_status": st, "total_chars": tlen, "baseline": BASELINE,
                    "grown": bool(tlen and tlen > BASELINE + 50), "reminder_landed": landed,
                    "tail_after_toolreq": tail[:600]})
    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)
    print(f"VERDICT: total_chars={tlen} grown={bool(tlen and tlen > BASELINE + 50)} reminder_landed={landed}", flush=True)

if __name__ == "__main__":
    main()
