#!/usr/bin/env python3
# r419718-1307-researcher-readback.py — growth-based readback of RESEARCHER transcript (read-only)
# Lesson from 13:00: verdict = transcript GROWTH (total_chars/text len vs 40152 baseline) + markers AFTER last footer boundary.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
ISSUER = "zai-419718-1307"
BASELINE = 40152
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-trfull-1307-readback.json"

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
    time.sleep(15)
    d = PE.evaluate("READ_TRANSCRIPT", {"tab_id": RES_TAB, "issuer": ISSUER})
    print("policy:", getattr(d, "verdict", d), flush=True)
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": "READ_TRANSCRIPT", "platform": "GLM_ZAI",
           "payload": {"tab_id": RES_TAB, "limit": 24}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"r1307-rb-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    t0 = time.time(); st = None; res = {}
    while time.time() - t0 < 60:
        time.sleep(2.5)
        q = urllib.request.Request(f"{URL}?command_id=eq.{cid}&select=status,receipt,error", headers=hdr())
        rr = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
        if rr and rr[0].get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            st = rr[0]["status"]; res = (rr[0].get("receipt") or {}).get("result") or {}; break
    text = res.get("text", "") if isinstance(res, dict) else str(res)
    tlen = len(text)
    grown = tlen > BASELINE + 50  # margin
    # content AFTER their last TOOL_REQUEST_V1 block = potential reply zone
    idx = text.rfind("payload_json=")
    reply_zone = text[idx:].split("\n", 1)[-1] if idx >= 0 else text[-2000:]
    reply_zone = reply_zone.replace("Z.ai - Advanced AI Chatbot & Agent powered by GLM-5.3-Flash", "") \
                           .replace("metaengine.native-browser.transcript.v1", "") \
                           .replace(str(RES_TAB), "").strip()
    verdict = {
        "status": st, "text_len": tlen, "baseline": BASELINE, "grown": grown,
        "total_chars_field": res.get("total_chars") if isinstance(res, dict) else None,
        "ack_full1231_in_text": "CONNECTED-TOOLRESULT-FULL-1231" in text,
        "ack_in_reply_zone": "CONNECTED-TOOLRESULT-FULL-1231" in reply_zone,
        "reply_zone_clean_len": len(reply_zone),
        "reply_zone": reply_zone[:2500],
    }
    json.dump(verdict, open(OUT, "w"), indent=1, ensure_ascii=False)
    print(json.dumps({k: v for k, v in verdict.items() if k != "reply_zone"}, ensure_ascii=False), flush=True)
    print("REPLY_ZONE:", verdict["reply_zone"][:900], flush=True)

if __name__ == "__main__":
    main()
