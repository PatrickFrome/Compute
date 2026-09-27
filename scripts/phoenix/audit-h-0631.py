#!/usr/bin/env python3
# audit-h-0631.py — Phase H: read-only forensics (element structure, transcript, census, lease health)
import importlib.util, sys, json

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-h0631.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open("/home/z/my-project/scripts/phoenix/browser-test-results-e0631.json.ctx")).get("probe_tab")

cap = run_test("H1-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
if cap.get("_result_full"):
    full = cap["_result_full"]
    els = (full.get("interaction_tree") or {}).get("elements") or []
    btns = [e for e in els if e.get("role") == "button"][:6]
    print(f"url={full.get('url','')[:90]}", flush=True)
    print(f"elements={len(els)}", flush=True)
    for i, e in enumerate(btns):
        print(f"--- button[{i}] keys: {sorted(e.keys())}", flush=True)
        s = json.dumps(e, ensure_ascii=False)
        print(f"    {s[:360]}", flush=True)
    st = full.get("semantic_targets") or []
    print(f"semantic_targets={len(st)}", flush=True)
    for t in st[:4]:
        print("  T:", json.dumps({k: t.get(k) for k in ('role', 'name', 'accessible_name', 'text')}, ensure_ascii=False)[:160], flush=True)

tr = run_test("H2-TRANS", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 4}, platform=P)
if tr.get("_result_full"):
    evs = tr["_result_full"].get("events") or tr["_result_full"].get("transcript") or []
    print(f"transcript events={len(evs)}", flush=True)
    for e in evs[-4:]:
        s = json.dumps(e, ensure_ascii=False)
        print("  ", s[:220], flush=True)

run_test("H3-CENSUS", "TAB_CENSUS", payload={})
run_test("H4-LAT", "CONTROL_LATENCY_STATUS", payload={})
run_test("H5-DPH", "DEV_PLANE_HEALTH", payload={})

print("phase H done", flush=True)
