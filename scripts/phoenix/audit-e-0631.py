#!/usr/bin/env python3
# audit-e-0631.py — Phase E: complete mechanics audit (remaining untested) + TYPED_CLICK recipe re-validation
import importlib.util, sys, json, time

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-e0631.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"

print("=== E0: fresh probe tab ===", flush=True)
nt = run_test("E0-NEW_TAB", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}, platform=P, mutating=True, timeout=60)
tab = None
if nt["status"] == "COMPLETED" and nt.get("_result_full"):
    tab = nt["_result_full"].get("tab_id")
print(f"  probe tab = {tab}", flush=True)
json.dump({"probe_tab": tab}, open(bmt.RESULTS + ".ctx", "w"))
if not tab:
    print("no probe tab, abort", flush=True); sys.exit(1)

cap = run_test("E0-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
semref_btn = None
if cap.get("_result_full"):
    for e in (cap["_result_full"].get("interaction_tree") or {}).get("elements") or []:
        if e.get("role") == "button" and e.get("semantic_ref"):
            nm = str(e.get("name") or e.get("accessible_name") or "")
            if nm == "Agent":
                semref_btn = e
                break
    print(f"  Agent button element found: {bool(semref_btn)}", flush=True)

print("=== E1: read-only sweep (never tested) ===", flush=True)
run_test("E1-POLL", "POLL", payload={"tab_id": tab}, platform=P)
run_test("E1-TABTEL", "TAB_TELEMETRY", payload={"tab_id": tab}, platform=P)
run_test("E1-PROCEV", "PROCESS_EVENTS", payload={"limit": 20})
run_test("E1-LAT", "CONTROL_LATENCY_STATUS", payload={})
run_test("E1-SEMEV", "SEMANTIC_EVENTS", payload={"tab_id": tab, "limit": 20}, platform=P)
run_test("E1-CAPVIEW", "CAPTURE_VIEW", payload={"tab_id": tab}, platform=P)

print("=== E2: mutating mechanics ===", flush=True)
run_test("E2-SCROLL", "SCROLL", payload={"tab_id": tab, "direction": "down", "pixels": 800}, platform=P, mutating=True)
run_test("E2-BACK", "BACK", payload={"tab_id": tab}, platform=P, mutating=True)
run_test("E2-FWD", "FORWARD", payload={"tab_id": tab}, platform=P, mutating=True)
run_test("E2-STOPGEN", "STOP_GENERATION", payload={"tab_id": tab}, platform=P, mutating=True)
run_test("E2-SUPMODE", "SET_SUPERVISOR_MODE", payload={"mode": "CONTROL"}, mutating=True)
run_test("E2-DLF", "DOWNLOAD_FILE", payload={"url": "https://example.com/robots.txt"}, mutating=True)

print("=== E3: gates + authority cycle ===", flush=True)
gs = run_test("E3-GATES", "GATE_STATUS", payload={})
gate_id = None
if gs.get("_result_full"):
    gl = gs["_result_full"].get("gates") or gs["_result_full"].get("active_gates") or []
    if isinstance(gl, list) and gl:
        g0 = gl[0]
        gate_id = g0.get("gate_id") or g0.get("id") if isinstance(g0, dict) else None
print(f"  first gate id = {gate_id}", flush=True)
if gate_id:
    run_test("E3-GEN", "GATE_ENABLE", payload={"gate_id": gate_id}, mutating=True)
run_test("E3-DISARM", "DISARM", payload={}, mutating=True)
run_test("E3-REARM", "ARM", payload={}, mutating=True)

print("=== E4: self-update availability ===", flush=True)
run_test("E4-SUST", "SELF_UPDATE_STATUS", payload={})
run_test("E4-SUCHK", "SELF_UPDATE_CHECK", payload={}, mutating=True, timeout=90)

print("=== E5: TYPED_CLICK recipe re-validation (Agent sidebar button) ===", flush=True)
cap2 = run_test("E5-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
ag = None
if cap2.get("_result_full"):
    for e in (cap2["_result_full"].get("interaction_tree") or {}).get("elements") or []:
        if e.get("role") == "button" and str(e.get("name") or e.get("accessible_name") or "") == "Agent" and e.get("semantic_ref"):
            ag = e; break
print(f"  fresh Agent semref: {bool(ag)}", flush=True)
if ag:
    tc = run_test("E5-CLICK-AGENT", "TYPED_CLICK", payload={
        "role": "button", "tab_id": tab,
        "semantic_ref": ag["semantic_ref"],
        "accessible_name": "Agent"
    }, platform=P, mutating=True, timeout=60)
    time.sleep(4)
    cap3 = run_test("E5-POSTCAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
    if cap3.get("_result_full"):
        u = cap3["_result_full"].get("url", "")
        print(f"  post-click url = {u[:100]}", flush=True)
        bmt.save({"id": "E5-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "post_click_url": u, "is_agent_page": ("/agent" in u.lower())})

print("phase E done", flush=True)
