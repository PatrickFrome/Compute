#!/usr/bin/env python3
# dispatch.py — issue commands to live METAENGINE client and collect receipts.
# Usage: dispatch.py <commands.json>
#  commands.json: [{"action":"POLL","payload":"{}","platform":null,"lane":"READ_ONLY","idem":"t1-poll","wait":60}, ...]
# Secrets never printed. Receipts truncated. Writes progress JSON to stdout.
import json, sys, uuid, time, datetime, urllib.request
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env, req

WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
TBL = "compute_fabric_a2_browser_supervisor_command_h205f22"

def iso(dt): return dt.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00")[:-3] + "0"

def issue(spec):
    cid = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc)
    exp = now + datetime.timedelta(seconds=int(spec.get("ttl", 120)))
    row = {
        "command_id": cid, "workspace_id": WS, "target_client_id": CLIENT,
        "issued_by": spec.get("issued_by", "zai-live-test-419203"),
        "action": spec["action"], "platform": spec.get("platform"),
        "payload": spec.get("payload", "{}"), "status": "PENDING",
        "issued_at": iso(now), "expires_at": iso(exp),
        "idempotency_key": spec["idem"],
    }
    code, data = req(f"{env()[0]}/rest/v1/{TBL}", "POST", row)
    return cid, code, (data if not isinstance(data, list) else "inserted")

def collect(cid, wait=90):
    su, _ = env()
    deadline = time.time() + wait
    last = None
    while time.time() < deadline:
        code, rows = req(f"{su}/rest/v1/{TBL}?select=status,receipt,error,completed_at,leased_at&command_id=eq.{cid}")
        if isinstance(rows, list) and rows:
            r = rows[0]
            if r.get("status") not in ("PENDING", None):
                return r
            last = r
        time.sleep(4)
    return (last or {"status": "TIMEOUT"})

def trunc(v, n=420):
    s = str(v)
    return s if len(s) <= n else s[:n] + f"...[{len(s)}B total]"

if __name__ == "__main__":
    specs = json.loads(open(sys.argv[1]).read())
    out = []
    for spec in specs:
        cid, code, res = issue(spec)
        print(f"ISSUE {spec['action']} idem={spec['idem']} -> HTTP {code}", flush=True)
        r = {"action": spec["action"], "idem": spec["idem"], "command_id": cid, "issue_http": code}
        if code in (200, 201):
            rec = collect(cid, int(spec.get("wait", 90)))
            r["status"] = rec.get("status")
            r["error"] = trunc(rec.get("error"), 200) if rec.get("error") else None
            recp = rec.get("receipt")
            if recp:
                try:
                    p = json.loads(str(recp).replace("'", '"').replace("None", "null").replace("True", "true").replace("False", "false"))
                    r["result_ok"] = p.get("result", {}).get("ok") if isinstance(p.get("result"), dict) else None
                except Exception:
                    r["result_ok"] = None
            r["receipt"] = trunc(recp, 600) if recp else None
        out.append(r)
        print(json.dumps(r, ensure_ascii=False)[:700], flush=True)
    print("=== SUMMARY ===")
    for r in out:
        print(f"{r['action']:28} {str(r.get('status')):10} ok={r.get('result_ok')} err={r.get('error')}")
