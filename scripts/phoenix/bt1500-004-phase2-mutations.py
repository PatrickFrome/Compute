#!/usr/bin/env python3
"""Job 419203 @15:00 — фаза 2: mutation-цепочка на scratch-табе (20s pacing, readback).
NEW_TAB→NAVIGATE→CENSUS→FOCUS/TYPE→BACK→FORWARD→RELOAD→CAPTURE→CLOSE_TAB"""
import sys, time, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bt1500-phase2.json"
bmt.load_results()
bmt.ISSUER = "zai-419203-1500"

R = bmt._results
def last(action):
    for r in reversed(R):
        if r.get("action") == action and r.get("status") == "COMPLETED":
            return r
    return None

# M01 NEW_TAB
bmt.run_test("M01", "NEW_TAB", payload={}, platform="GLM_ZAI", mutating=True, timeout=60)
m1 = last("NEW_TAB")
tab = ((m1 or {}).get("_result_full") or {}).get("tab_id")
if not tab:
    print("NO TAB ID — abort chain", flush=True)
    bmt.save({"id": "M01-verdict", "action": "CHAIN_ABORT", "status": "NO_TAB", "note": str(m1)[:200]})
    sys.exit(0)
print("scratch tab:", tab, flush=True)

# M02 NAVIGATE -> form page (есть <input> для semantic-теста)
bmt.run_test("M02", "NAVIGATE", payload={"tab_id": tab, "url": "https://httpbin.org/forms/post"},
             platform="GLM_ZAI", mutating=True, timeout=70)

# M03 SEMANTIC_CENSUS (read — найти ref инпута)
bmt.run_test("M03", "SEMANTIC_CENSUS", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
m3 = last("SEMANTIC_CENSUS")
ref = None
res = (m3 or {}).get("_result_full") or {}
# ref может лежать в res['refs'] / res['elements'] / res['controls']
for key in ("refs", "elements", "controls", "items"):
    lst = res.get(key) if isinstance(res, dict) else None
    if isinstance(lst, list) and lst:
        first = lst[0]
        ref = (first.get("ref") or first.get("id") or first.get("selector")) if isinstance(first, dict) else first
        break
print("census ref:", ref, flush=True)

if ref:
    bmt.run_test("M04", "SEMANTIC_FOCUS", payload={"tab_id": tab, "ref": ref}, platform="GLM_ZAI", mutating=True, timeout=60)
    bmt.run_test("M05", "SEMANTIC_TYPE", payload={"tab_id": tab, "ref": ref, "text": "bt1500-mechanics-probe"},
                 platform="GLM_ZAI", mutating=True, timeout=60)
else:
    bmt.save({"id": "M04-05", "action": "SEMANTIC_FOCUS/TYPE", "status": "SKIPPED",
              "note": "no input ref from census", "census_keys": list(res.keys()) if isinstance(res, dict) else None})

# M06-M09 BACK/FORWARD/RELOAD/CAPTURE на scratch-табе
bmt.run_test("M06", "BACK", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)
bmt.run_test("M07", "FORWARD", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)
bmt.run_test("M08", "RELOAD", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)
bmt.run_test("M09", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)

# M10 CLOSE_TAB (уборка)
bmt.run_test("M10", "CLOSE_TAB", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)

from collections import Counter
print("PHASE2 TALLY:", dict(Counter(r.get("status") for r in R)), flush=True)
