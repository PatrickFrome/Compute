#!/usr/bin/env python3
# retry-0230.py — short recovery window: 6 attempts x 15s on real-JWT REST + 2 RPC probes.
# Secrets never printed. Output: retry-0230.json
import json, time, sys, urllib.request, urllib.error

sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env

SU, SJ = env()
STATE = "compute_fabric_a2_browser_supervisor_state_h205f22"

def timed_req(url, body=None, timeout=15):
    t0 = time.time()
    rq = urllib.request.Request(url, headers={"apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json", "Prefer": "return=representation"})
    if body is not None:
        rq.data = json.dumps(body).encode(); method = "POST"
    else:
        method = "GET"
    rq.get_method = lambda: method
    try:
        with urllib.request.urlopen(rq, timeout=timeout) as r:
            return r.status, round(time.time()-t0, 2), r.read().decode()[:150]
    except urllib.error.HTTPError as e:
        return e.code, round(time.time()-t0, 2), e.read().decode()[:150]
    except Exception as e:
        return 0, round(time.time()-t0, 2), str(e)[:150]

attempts = []
for i in range(6):
    code, sec, head = timed_req(f"{SU}/rest/v1/{STATE}?select=client_id&limit=1")
    attempts.append({"n": i+1, "code": code, "sec": sec})
    print(f"attempt {i+1}: HTTP {code} in {sec}s")
    if code == 200:
        break
    time.sleep(15)

# RPC path probe (independent endpoint)
rpc_url = f"{SU}/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1"
rpc_body = {"p_client_id": "probe-nonexistent-client", "p_action": "GATE_STATUS", "p_payload": {}, "p_ttl_seconds": 30, "p_issued_by": "reprobe-0230", "p_platform": "probe", "p_idempotency_key": f"reprobe-{int(time.time())}"}
code, sec, head = timed_req(rpc_url, body=rpc_body)
print(f"RPC probe: HTTP {code} in {sec}s head={head[:80]}")

out = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    "rest_attempts": attempts,
    "rest_final": attempts[-1]["code"],
    "rpc_probe": {"code": code, "sec": sec, "head": head[:120]},
}
with open("/home/z/my-project/scripts/browser-test/retry-0230.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
print(json.dumps({"rest_final": out["rest_final"], "rpc": code}, indent=1))
