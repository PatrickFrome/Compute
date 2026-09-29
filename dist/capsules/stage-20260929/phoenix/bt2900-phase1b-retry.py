#!/usr/bin/env python3
"""BROWSER-TEST-20260929-0000 — фаза 1b:
- re-poll LEASED PROCESS_CENSUS (тот ЖЕ command_id — L18, не новая команда)
- paced re-run FLEET_STATUS / SYSTEM_TELEMETRY после budget-окна 60s (25s старт + 22s интервал)"""
import sys, time, json, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bt2900-phase1.json"
bmt.load_results()
bmt.ISSUER = "zai-419203-0000"

# 1) re-poll LEASED R10 (same command_id — reconciliation, не blind retry)
CID = "657af461-bb1b-425e-b1f3-56936443a19d"
time.sleep(30)
row = bmt.poll_command(CID, timeout=90) if hasattr(bmt, "poll_command") else None
if row is None:
    # честный прямой re-poll через REST (дубль логики либы минимально)
    import urllib.request
    envf = "/tmp/my-project/.a2-backup/me2.env.20260922"
    env = {}
    for line in open(envf):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1); env[k.strip()] = v.strip().strip('"').strip("'")
    req = urllib.request.Request(
        f"{env['SUPABASE_URL']}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?command_id=eq.{CID}&select=status,receipt,error",
        headers={"apikey": env["SUPABASE_SERVICE_ROLE_JWT"], "Authorization": f"Bearer {env['SUPABASE_SERVICE_ROLE_JWT']}"})
    rr = json.loads(urllib.request.urlopen(req, timeout=30).read().decode())
    row = rr[0] if rr else {}
st = row.get("status")
res = ((row.get("receipt") or {}).get("result") or {})
bmt._results.append({"id": "R10-repoll", "action": "PROCESS_CENSUS", "command_id": CID,
                     "status": st, "error": row.get("error"),
                     "result_summary": json.dumps(res, ensure_ascii=False)[:300]})
print(f"R10-repoll: {st} err={row.get('error')!r} keys={list(res.keys())[:8] if isinstance(res, dict) else '?'}", flush=True)

# 2) paced re-run бюджетных reads
time.sleep(25)
for tid, action in [("R07b", "FLEET_STATUS"), ("R09b", "SYSTEM_TELEMETRY")]:
    bmt.run_test(tid, action, payload=None, platform="GLM_ZAI", timeout=50)
    time.sleep(22)

bmt.save()
from collections import Counter
c = Counter(r.get("status") for r in bmt._results)
print("PHASE1+1b TALLY:", dict(c), flush=True)
