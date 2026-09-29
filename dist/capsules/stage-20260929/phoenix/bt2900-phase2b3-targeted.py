#!/usr/bin/env python3
"""BROWSER-TEST-20260929-0000 — фаза 2b/3 (стена стоит, scratch невозможен):
2b: tab-зависимые READ-механики на живом bound fleet-табе (read-only 0pts, без мутаций)
3:  STOP_GENERATION / ESCALATE-семейство = offline PolicyEngine verdicts (dispatch НЕ отправлять),
    DOWNLOAD_CANCEL = один честный dispatch-проб (без активной загрузки — проверка честности отказа),
    TYPED_CLICK = SKIP (census не отдаёт refs — нет семантического источника цели)"""
import sys, json, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bt2900-phase2b3.json"
bmt.load_results()
bmt.ISSUER = "zai-419203-0000"

R = bmt._results
def last(action):
    for r in reversed(R):
        if r.get("action") == action and r.get("status") == "COMPLETED":
            return r
    return None

# --- 2b: census → выбрать bound fleet-таб (protected, read-only probes) ---
bmt.run_test("P2B-01", "TAB_CENSUS", payload={}, platform="GLM_ZAI", timeout=60)
c = last("TAB_CENSUS")
cres = (c or {}).get("_result_full") or {}
fleet_ids = cres.get("fleet_tab_ids") or []
tab = fleet_ids[0] if fleet_ids else None
print("bound fleet tab for read probes:", tab, "fleet_ids:", len(fleet_ids), flush=True)

if tab:
    bmt.run_test("P2B-02", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 8}, platform="GLM_ZAI", timeout=60)
    bmt.run_test("P2B-03", "TAB_TELEMETRY", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
    bmt.run_test("P2B-04", "CAPTURE_VIEW", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
    bmt.run_test("P2B-05", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
    bmt.run_test("P2B-06", "SEMANTIC_CENSUS", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=60)
else:
    bmt.save({"id": "P2B-02..06", "action": "tab-reads", "status": "SKIPPED", "note": "нет fleet_tab_ids в census"})

# --- 3a: offline PolicyEngine verdicts (guard-тест; dispatch НЕ отправляется) ---
sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine
PE = PolicyEngine()
for tid, action in [("T01", "STOP_GENERATION"), ("T04a", "SELF_UPDATE_APPLY"),
                    ("T04b", "DISARM"), ("T04c", "GATE_DISABLE")]:
    try:
        d = PE.evaluate(action, {"issuer": bmt.ISSUER})
        v = str(getattr(d, "verdict", None) or getattr(d, "decision", None) or d).upper()
        reason = str(getattr(d, "reason", "") or "")[:120]
    except Exception as e:
        v, reason = "ERROR", str(e)[:120]
    bmt.save({"id": tid, "action": action, "status": v, "error": reason,
              "note": "offline PolicyEngine verdict — live dispatch намеренно НЕ отправлялся"})
    print(f"{tid} {action}: {v} {reason}", flush=True)

# --- 3b: DOWNLOAD_CANCEL — один честный dispatch (без активной загрузки) ---
bmt.run_test("T02", "DOWNLOAD_CANCEL", payload={}, platform="GLM_ZAI", mutating=True, timeout=60)

# --- 3c: TYPED_CLICK — skip (нет ref-источника) ---
bmt.save({"id": "T03", "action": "TYPED_CLICK", "status": "SKIPPED",
          "note": "census в этой сборке не отдаёт element-refs (событийный поток) — нет семантической цели; требует live ref от CAPTURE интерактивного элемента (возможно при свободном scratch-табе)"})

from collections import Counter
print("PHASE2b/3 TALLY:", dict(Counter(r.get("status") for r in R)), flush=True)
