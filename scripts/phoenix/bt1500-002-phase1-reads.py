#!/usr/bin/env python3
"""Job 419203 @15:00 — фаза 1: read-only sweep через командный канал (12 reads).
Результаты -> browser-test-results-bt1500-phase1.json"""
import sys, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bt1500-phase1.json"
bmt.load_results()
bmt.ISSUER = "zai-419203-1500"
# reads не мутируют: budget-паузы не нужны, но run_test ставит их только для mutating

READS = [
    ("R01", "CONTROL_CAPABILITIES", None),
    ("R02", "TAB_CENSUS", None),
    ("R03", "DEV_PLANE_CAPABILITIES", None),
    ("R04", "DEV_PLANE_STATUS", None),
    ("R05", "DEV_PLANE_HEALTH", None),
    ("R06", "FLEET_STATUS", None),
    ("R07", "GATE_STATUS", None),
    ("R08", "SYSTEM_TELEMETRY", None),
    ("R09", "PROCESS_CENSUS", None),
    ("R10", "CONTROL_LATENCY_STATUS", None),
    ("R11", "DOWNLOAD_STATUS", None),
    ("R12", "SELF_UPDATE_STATUS", None),
]
for tid, action, payload in READS:
    bmt.run_test(tid, action, payload=payload, platform="GLM_ZAI", timeout=50)

from collections import Counter
c = Counter(r.get("status") for r in bmt._results)
print("PHASE1 TALLY:", dict(c), flush=True)
fails = [(r["id"], r["action"], str(r.get("error"))[:80]) for r in bmt._results if r.get("status") != "COMPLETED"]
print("NON-COMPLETED:", fails if fails else "none", flush=True)
