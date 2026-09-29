#!/usr/bin/env python3
# audit-f-0631.py — Phase F: Agent-tab entry via working TYPED_CLICK + schema retries + SELF_UPDATE_APPLY
import importlib.util, sys, json, time

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-f0631.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"

ctx = json.load(open("/home/z/my-project/scripts/phoenix/browser-test-results-e0631.json.ctx"))
tab = ctx.get("probe_tab")
print(f"probe tab = {tab}", flush=True)
if not tab:
    print("no probe tab", flush=True); sys.exit(1)

def find_btn(caprec, name):
    if not caprec.get("_result_full"): return None
    for e in (caprec["_result_full"].get("interaction_tree") or {}).get("elements") or []:
        if e.get("role") == "button" and e.get("semantic_ref"):
            nm = str(e.get("name") or e.get("accessible_name") or "")
            if nm == name:
                return e
    return None

print("=== F0: supervisor mode verify (after LEASED) ===", flush=True)
run_test("F0-FLEET", "FLEET_STATUS", payload={})

print("=== F1: sidebar -> Agent tab ===", flush=True)
cap = run_test("F1-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
tbtn = find_btn(cap, "Toggle Sidebar")
print(f"  Toggle Sidebar btn: {bool(tbtn)}", flush=True)
if tbtn:
    run_test("F1-TOGGLE", "TYPED_CLICK", payload={"role": "button", "tab_id": tab,
             "semantic_ref": tbtn["semantic_ref"], "accessible_name": "Toggle Sidebar"},
             platform=P, mutating=True, timeout=60)
    time.sleep(3)
cap2 = run_test("F1-CAP2", "CAPTURE", payload={"tab_id": tab}, platform=P)
ag = find_btn(cap2, "Agent")
print(f"  Agent btn: {bool(ag)}", flush=True)
if ag:
    run_test("F1-AGENT-CLICK", "TYPED_CLICK", payload={"role": "button", "tab_id": tab,
             "semantic_ref": ag["semantic_ref"], "accessible_name": "Agent"},
             platform=P, mutating=True, timeout=60)
    time.sleep(5)
cap3 = run_test("F1-POSTCAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
if cap3.get("_result_full"):
    u = cap3["_result_full"].get("url", "")
    els = (cap3["_result_full"].get("interaction_tree") or {}).get("elements") or []
    tbs = [e for e in els if e.get("role") == "textbox"]
    print(f"  post-agent-click url={u[:100]}", flush=True)
    print(f"  textboxes={len(tbs)} buttons={[str(e.get('name'))[:24] for e in els if e.get('role')=='button'][:12]}", flush=True)
    bmt.save({"id": "F1-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "post_agent_click_url": u, "is_agent_page": ("/agent" in u.lower()), "textbox_count": len(tbs)})

print("=== F2: SCROLL retry (budget cleared) ===", flush=True)
run_test("F2-SCROLL", "SCROLL", payload={"tab_id": tab, "direction": "down", "pixels": 600}, platform=P, mutating=True)

print("=== F3: STOP_GENERATION full chain (submit brief -> capture stop btn -> stop) ===", flush=True)
cap4 = run_test("F3-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
sem = None
if cap4.get("_result_full"):
    for t in (cap4["_result_full"].get("semantic_targets") or []):
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            sem = t; break
print(f"  textbox semref: {bool(sem)}", flush=True)
if sem:
    run_test("F3-TYPE", "SEMANTIC_TYPE", payload={"tab_id": tab, "role": "textbox",
             "semantic_ref": sem["semantic_ref"],
             "text": "FLEET BRIEF: swarm self-audit — inventory working mechanics, propose deletion list of useless/restrictive mechanics, draft swarm growth plan (backlog-driven). Reply in chat.",
             "submit_after_type": True, "replace_existing": True}, platform=P, mutating=True, timeout=45)
    time.sleep(6)
    cap5 = run_test("F3-CAP2", "CAPTURE", payload={"tab_id": tab}, platform=P)
    stop = None
    if cap5.get("_result_full"):
        for e in (cap5["_result_full"].get("interaction_tree") or {}).get("elements") or []:
            if e.get("role") == "button" and e.get("semantic_ref"):
                nm = str(e.get("name") or e.get("accessible_name") or "")
                if "stop" in nm.lower() or "стоп" in nm.lower():
                    stop = e; break
    print(f"  stop button: {bool(stop)}", flush=True)
    if stop:
        run_test("F3-STOPGEN", "STOP_GENERATION", payload={"tab_id": tab, "role": "button",
                 "semantic_ref": stop["semantic_ref"], "accessible_name": str(stop.get("name") or "Stop")},
                 platform=P, mutating=True, timeout=60)

print("=== F4: DOWNLOAD_FILE with filename ===", flush=True)
run_test("F4-DLF", "DOWNLOAD_FILE", payload={"url": "https://example.com/robots.txt", "filename": "robots.txt"}, mutating=True)

print("=== F5: SELF_UPDATE_APPLY (expect no-op: feed CURRENT) ===", flush=True)
run_test("F5-APPLY", "SELF_UPDATE_APPLY", payload={}, mutating=True, timeout=90)

print("phase F done", flush=True)
