#!/usr/bin/env python3
# dispatch-toolresult-full-1231.py — Job 419718 @12:31 tick
# Deliver FULL SYSTEM_TELEMETRY receipt to RESEARCHER (their scope=full re-request).
# R28 wiring: policy_engine.evaluate() before EVERY enqueue -> JSONL ledger.
# Fix of PROCESS SLIP: all side effects inside main() guarded by __name__ entry.
import json, os, re, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"  # RESEARCHER
ISSUER = "zai-419718-1231"
NONCE = "mt419718-1231-r1"
MARKER = "TOOLRESULT-FULL-1231"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-trfull-1231.json"
RECORDS = []

PE = PolicyEngine()  # ledger /tmp/me2-policy-ledger.jsonl

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

def enqueue(action, payload=None, ttl=75, platform="GLM_ZAI"):
    """Mutation-gated enqueue: policy evaluate() first, ledger append, then RPC INSERT."""
    d = PE.evaluate(action, {"tab_id": (payload or {}).get("tab_id"), "issuer": ISSUER})
    rec = {"action": action, "decision": d.decision if hasattr(d, "decision") else str(d),
           "conditions": getattr(d, "conditions", None), "ts": datetime.datetime.now(datetime.timezone.utc).isoformat()}
    dec = rec["decision"]
    if isinstance(dec, str) and dec.upper() == "DENY":
        RECORDS.append({**rec, "result": "BLOCKED-BY-POLICY"})
        print(f"POLICY DENY {action} — abort per mandate", flush=True)
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": platform, "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"trfull1231-{action}-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    RECORDS.append({**rec, "command_id": cid})
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
    st, res, err = poll(enqueue(action, payload), timeout=timeout)
    print(f"{step} {action}: {st}" + (f" err={str(err)[:100]}" if err else ""), flush=True)
    RECORDS.append({"step": step, "action": action, "status": st, "error": str(err)[:200] if err else None})
    return st, res, err

SECRET_RE = re.compile(r"(sk-[A-Za-z0-9_\-]{8,}|ghp_[A-Za-z0-9]{10,}|gho_[A-Za-z0-9]{10,}|"
                       r"eyJ[A-Za-z0-9_\-]{20,}|xox[baprs]-[A-Za-z0-9\-]{10,}|"
                       r"AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY-----)")

def redact(obj):
    txt = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    txt = SECRET_RE.sub("[REDACTED]", txt)
    try:
        return json.loads(txt)
    except Exception:
        return {"redacted_text": txt[:6000]}

def main():
    # ---- STEP 1: fresh FULL SYSTEM_TELEMETRY (read-only) ----
    time.sleep(20)
    st, tel, err = run("S1", "SYSTEM_TELEMETRY", {}, timeout=60)
    if st != "COMPLETED" or not tel:
        print("SYSTEM_TELEMETRY not COMPLETED — abort delivery this tick", flush=True)
        json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)
        return
    tel_full = redact(tel)
    tel_compact = json.dumps(tel_full, ensure_ascii=False, separators=(",", ":"))
    if len(tel_compact) > 5200:
        tel_compact = tel_compact[:5200] + "…[TRUNCATED-full copy in mirror seq chain]"
    print(f"telemetry compact len={len(tel_compact)}", flush=True)

    # ---- STEP 2: CAPTURE RESEARCHER tab -> textbox (read-only) ----
    time.sleep(20)
    st, cap, err = run("S2", "CAPTURE", {"tab_id": RES_TAB}, timeout=60)
    tb = None
    for t in (cap.get("semantic_targets") or []):
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            tb = t; break
    if not tb:
        print("NO TEXTBOX on RESEARCHER tab — abort (no blind retry)", flush=True)
        json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)
        return

    BRIEF = (f"[SUPERVISOR DELIVERY / Job 419718 @12:31] {MARKER} | FULL receipt for RESEARCHER "
             f"(your scope=full re-request after TOOLRESULT-1215 digest).\n\n"
             f"DELIVERY FIELDS: nonce={NONCE} (quote verbatim in ACK); channel=supervisor dispatch; "
             f"mirror_seq chain: your seq 90014610 receipt stands; this is the FULL SYSTEM_TELEMETRY body.\n\n"
             f"FULL SYSTEM_TELEMETRY (fresh pull, redacted, verbatim JSON):\n{tel_compact}\n\n"
             f"TASK (bounded):\n"
             f"1. ACK first line: CONNECTED-TOOLRESULT-FULL-1231 + echo nonce.\n"
             f"2. Confirm scope=full SATISFIED (or name the exact missing field).\n"
             f"3. Deliver your 3 measurable CRITIC-gate checks (spoofed request / result replay / prompt injection) "
             f"if not already delivered after TOOLRESULT-1215 — each: name + objective numeric signal + threshold.\n"
             f"Constraints: no secrets in replies; do not fabricate tool outputs; mark UNVERIFIABLE rather than guessing.")
    print(f"brief len={len(BRIEF)}", flush=True)

    # ---- STEP 3: SEMANTIC_FOCUS (actuation) ----
    time.sleep(20)
    sf = {"tab_id": RES_TAB, "role": "textbox", "semantic_ref": tb["semantic_ref"]}
    st, _, err = run("S3", "SEMANTIC_FOCUS", sf)
    focus_ok = st == "COMPLETED"

    # ---- STEP 4: SEMANTIC_TYPE + submit (mutation) ----
    time.sleep(20)
    stp = dict(sf); stp.update({"text": BRIEF, "submit_after_type": True, "replace_existing": True})
    st, _, err = run("S4", "SEMANTIC_TYPE", stp, timeout=70)

    # ---- STEP 5: READBACK via READ_TRANSCRIPT (verdict even if type AMBIGUOUS) ----
    time.sleep(15)
    st, tr, err = run("S5", "READ_TRANSCRIPT", {"tab_id": RES_TAB, "limit": 14}, timeout=60)
    items = tr.get("items") or tr.get("messages") or tr.get("transcript") or []
    tail_txt = ""
    if isinstance(items, list):
        tail_txt = "\n".join(str(m.get("text") if isinstance(m, dict) else m) for m in items[-14:])
    else:
        tail_txt = str(items)
    marker_landed = MARKER in tail_txt
    ack_prev = "CONNECTED-TOOLRESULT-1215" in tail_txt
    critic_gates = ("CRITIC" in tail_txt.upper() and ("GATE" in tail_txt.upper() or "CHECK" in tail_txt.upper()))
    print(f"READBACK: marker={marker_landed} ack_prev={ack_prev} critic_content={critic_gates} tail_len={len(tail_txt)}", flush=True)
    RECORDS.append({"step": "S5-readback", "marker_landed": marker_landed, "ack_1215_present": ack_prev,
                    "critic_gate_content": critic_gates,
                    "transcript_tail": tail_txt[-2500:]})

    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)
    print("DONE", flush=True)

if __name__ == "__main__":
    main()
