#!/usr/bin/env python3
"""BROWSER-TEST-20260929-0000 — фаза 2: mutation-цепочка на scratch-табе.
NEW_TAB→READ_TRANSCRIPT→TAB_TELEMETRY→CAPTURE_VIEW→CAPTURE→NAVIGATE→SEMANTIC_CENSUS
→FOCUS/TYPE(ref?)→BACK→FORWARD→RELOAD→CAPTURE→CLOSE_TAB→census-верификация уборки.
Дисциплина: mutating=True (16s+ pacing), readback после каждого, abort при стене (§4)."""
import sys, json, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bt2900-phase2.json"
bmt.load_results()
bmt.ISSUER = "zai-419203-0000"

R = bmt._results
def last(action):
    for r in reversed(R):
        if r.get("action") == action and r.get("status") == "COMPLETED":
            return r
    return None

# M01 NEW_TAB (если стена — честный abort цепи)
bmt.run_test("M01", "NEW_TAB", payload={}, platform="GLM_ZAI", mutating=True, timeout=60)
m1 = last("NEW_TAB")
tab = ((m1 or {}).get("_result_full") or {}).get("tab_id")
if not tab:
    bmt.save({"id": "M01-verdict", "action": "CHAIN_ABORT", "status": "NO_TAB",
              "note": f"NEW_TAB не дал tab_id — стена ёмкости/отказ: {str(m1)[:160]}"})
    print("CHAIN ABORT (no tab) — фиксирую и выхожу", flush=True)
    sys.exit(0)
print("scratch tab:", tab, flush=True)

# M02-M05 read-механики, требующие таб (0pts, но идут в общем темпе)
bmt.run_test("M02", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 8}, platform="GLM_ZAI", timeout=60)
bmt.run_test("M03", "TAB_TELEMETRY", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
bmt.run_test("M04", "CAPTURE_VIEW", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
bmt.run_test("M05", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)

# M06 NAVIGATE на форму с <input>
bmt.run_test("M06", "NAVIGATE", payload={"tab_id": tab, "url": "https://httpbin.org/forms/post"},
             platform="GLM_ZAI", mutating=True, timeout=70)

# M07 SEMANTIC_CENSUS (событийный поток телеметрии в этой сборке — refs может не дать)
bmt.run_test("M07", "SEMANTIC_CENSUS", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
m7 = last("SEMANTIC_CENSUS")
res = (m7 or {}).get("_result_full") or {}
ref = None
for key in ("refs", "elements", "controls", "items"):
    lst = res.get(key) if isinstance(res, dict) else None
    if isinstance(lst, list) and lst:
        first = lst[0]
        ref = (first.get("ref") or first.get("id") or first.get("selector")) if isinstance(first, dict) else first
        break
print("census ref:", ref, "census_keys:", list(res.keys())[:10] if isinstance(res, dict) else "?", flush=True)

if ref:
    bmt.run_test("M08", "SEMANTIC_FOCUS", payload={"tab_id": tab, "ref": ref}, platform="GLM_ZAI", mutating=True, timeout=60)
    bmt.run_test("M09", "SEMANTIC_TYPE", payload={"tab_id": tab, "ref": ref, "text": "bt2900-mechanics-probe"},
                 platform="GLM_ZAI", mutating=True, timeout=60)
else:
    bmt.save({"id": "M08-09", "action": "SEMANTIC_FOCUS/TYPE", "status": "SKIPPED",
              "note": "census не отдал element-ref (событийный поток — известная форма 15:25)",
              "census_keys": list(res.keys())[:10] if isinstance(res, dict) else None})

# M10-M13 история/состояние
bmt.run_test("M10", "BACK", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)
bmt.run_test("M11", "FORWARD", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)
bmt.run_test("M12", "RELOAD", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)
bmt.run_test("M13", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)

# M14 уборка
bmt.run_test("M14", "CLOSE_TAB", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)

# M15 верификация уборки (census: таб вернулся в стендоун)
bmt.run_test("M15", "TAB_CENSUS", payload={}, platform="GLM_ZAI", timeout=60)

from collections import Counter
print("PHASE2 TALLY:", dict(Counter(r.get("status") for r in R)), flush=True)
