#!/usr/bin/env python3
"""Job 419203 @15:00 — фаза 1b: retry budget-exceeded reads с паузой 25s."""
import sys, time, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bt1500-phase1.json"
bmt.load_results()
bmt.ISSUER = "zai-419203-1500"

time.sleep(25)  # окно бюджета 60s — начинаем с запасом
for tid, action in [("R07b", "GATE_STATUS"), ("R10b", "CONTROL_LATENCY_STATUS"), ("R13", "CAPTURE_VIEW")]:
    bmt.run_test(tid, action, payload=None, platform="GLM_ZAI", timeout=50)
    time.sleep(22)  # щадящий интервал — не выжигать бюджет

from collections import Counter
tail = bmt._results[-3:]
print("PHASE1b:", [(r["action"], r["status"]) for r in tail], flush=True)
