#!/usr/bin/env python3
# readback-trfull-1231.py — raw-structure readback of RESEARCHER transcript (read-only state check)
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
ISSUER = "zai-419718-1231"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-trfull-1231-readback.json"

PE = PolicyEngine()

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

def main():
    time.sleep(20)  # budget pacing from last command
    d = PE.evaluate("READ_TRANSCRIPT", {"tab_id": RES_TAB, "issuer": ISSUER})
    print("policy:", getattr(d, "decision", d), flush=True)
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": "READ_TRANSCRIPT", "platform": "GLM_ZAI",
           "payload": {"tab_id": RES_TAB, "limit": 20}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"trfull1231-rb-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    t0 = time.time(); st = None; receipt = {}
    while time.time() - t0 < 60:
        time.sleep(2.5)
        q = urllib.request.Request(f"{URL}?command_id=eq.{cid}&select=status,receipt,error", headers=hdr())
        rr = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
        if rr and rr[0].get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            st = rr[0]["status"]; receipt = rr[0].get("receipt") or {}; break
    print("READ_TRANSCRIPT:", st, flush=True)
    res = (receipt.get("result") or {})
    # dump raw structure (keys + types) for extractor calibration
    struct = {k: (type(v).__name__, len(v) if isinstance(v, (str, list, dict)) else None) for k, v in res.items()}
    print("result keys:", json.dumps(struct, ensure_ascii=False), flush=True)
    # flatten all str values recursively for marker search
    def flat(o, acc):
        if isinstance(o, str): acc.append(o)
        elif isinstance(o, dict):
            for v in o.values(): flat(v, acc)
        elif isinstance(o, list):
            for v in o: flat(v, acc)
        return acc
    parts = flat(res, [])
    all_txt = "\n".join(parts)
    verdict = {
        "status": st,
        "result_keys": struct,
        "total_text_len": len(all_txt),
        "marker_FULL_1231": "TOOLRESULT-FULL-1231" in all_txt,
        "nonce_1231": "mt419718-1231-r1" in all_txt,
        "ack_1215": "CONNECTED-TOOLRESULT-1215" in all_txt,
        "tool_request_pending": "TOOL_REQUEST_V1" in all_txt,
        "critic_signals": ("CRITIC" in all_txt.upper()),
        "tail_1800": all_txt[-1800:],
    }
    json.dump(verdict, open(OUT, "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in verdict.items() if k != "tail_1800"}, ensure_ascii=False), flush=True)
    print("TAIL:", verdict["tail_1800"][-700:], flush=True)

if __name__ == "__main__":
    main()
