#!/usr/bin/env python3
# reprobe-0230.py — Job 419203 re-fire (13:00): channel recovery probe.
# Discriminator trio (same method as 12:30 run):
#   P1 no-auth  -> expect fast 401 if REST edge alive
#   P2 fake JWT -> expect fast 401 (signature check works)
#   P3 real JWT -> 200 = channel RECOVERED; hang/503 = still degraded
# Secrets never printed. Writes summary JSON to reprobe-1300.json
import json, time, urllib.request, urllib.error, ssl

import sys
sys.path.insert(0, "/home/z/my-project/scripts/browser-test")
from sbq import env

SU, SJ = env()
STATE = "compute_fabric_a2_browser_supervisor_state_h205f22"
CMD   = "compute_fabric_a2_browser_supervisor_command_h205f22"
MESH  = "compute_fabric_a2_supervisor_mesh_instance_h205f22"
DEV   = "compute_fabric_a2_browser_device_h205f22"

def timed_get(url, headers, timeout=20):
    t0 = time.time()
    try:
        rq = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(rq, timeout=timeout) as r:
            body = r.read().decode()
            return r.status, round(time.time()-t0, 2), body[:200]
    except urllib.error.HTTPError as e:
        return e.code, round(time.time()-t0, 2), e.read().decode()[:200]
    except Exception as e:
        return 0, round(time.time()-t0, 2), str(e)[:200]

base = f"{SU}/rest/v1/{STATE}?select=*&limit=1"
r1 = timed_get(base, {})                                             # no auth
r2 = timed_get(base, {"apikey": "fake.fake.fake", "Authorization": "Bearer fake.fake.fake"})  # fake jwt
r3 = timed_get(base, {"apikey": SJ, "Authorization": f"Bearer {SJ}"})  # real jwt

verdict = "RECOVERED" if r3[0] == 200 else ("DEGRADED" if r3[1] >= 15 or r3[0] in (0, 502, 503, 504) else f"OTHER({r3[0]})")
out = {
    "ts": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    "P1_noauth":  {"code": r1[0], "sec": r1[1]},
    "P2_fakejwt": {"code": r2[0], "sec": r2[1]},
    "P3_realjwt": {"code": r3[0], "sec": r3[1], "body_head": r3[2][:120]},
    "verdict": verdict,
}
print(json.dumps(out, ensure_ascii=False, indent=1))
with open("/home/z/my-project/scripts/browser-test/reprobe-1300.json", "w") as f:
    json.dump(out, f, ensure_ascii=False, indent=1)
