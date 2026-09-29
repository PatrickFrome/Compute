#!/usr/bin/env python3
"""BROWSER-TEST-20260929-0000 — фаза 1: read-only sweep через командный канал (15 reads, 0pts).
Результаты -> browser-test-results-bt2900-phase1.json"""
import sys, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bt2900-phase1.json"
bmt.load_results()
bmt.ISSUER = "zai-419203-0000"

READS = [
    ("R01", "CONTROL_CAPABILITIES", None),
    ("R02", "TAB_CENSUS", None),
    ("R03", "DEV_PLANE_CAPABILITIES", None),
    ("R04", "DEV_PLANE_STATUS", None),
    ("R05", "DEV_PLANE_HEALTH", None),
    ("R06", "DEV_PLANE_REPO_HEAD", None),
    ("R07", "FLEET_STATUS", None),
    ("R08", "GATE_STATUS", None),
    ("R09", "SYSTEM_TELEMETRY", None),
    ("R10", "PROCESS_CENSUS", None),
    ("R11", "CONTROL_LATENCY_STATUS", None),
    ("R12", "DOWNLOAD_STATUS", None),
    ("R13", "SELF_UPDATE_STATUS", None),
    ("R14", "PROCESS_EVENTS", None),
    ("R15", "SEMANTIC_EVENTS", None),
]
for tid, action, payload in READS:
    bmt.run_test(tid, action, payload=payload, platform="GLM_ZAI", timeout=50)

from collections import Counter
c = Counter(r.get("status") for r in bmt._results)
print("PHASE1 TALLY:", dict(c), flush=True)
fails = [(r["id"], r["action"], str(r.get("error"))[:80]) for r in bmt._results if r.get("status") != "COMPLETED"]
print("NON-COMPLETED:", fails if fails else "none", flush=True)

# DEV_PLANE_REPO_HEAD — ключ для GitHub-аудита (сравнение с live клиентом)
for r in bmt._results:
    if r["action"] == "DEV_PLANE_REPO_HEAD" and r.get("status") == "COMPLETED":
        print("REPO_HEAD_RESULT:", json.dumps((r.get("_result_full") or {}), ensure_ascii=False)[:600], flush=True)
import json
