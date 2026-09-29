#!/usr/bin/env python3
# audit-g-0631.py — Phase G: recover probe tab, Agent-tab retry, SCROLL/DOWNLOAD schema finals
import importlib.util, sys, json, time

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-g0631.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open("/home/z/my-project/scripts/phoenix/browser-test-results-e0631.json.ctx")).get("probe_tab")
print(f"probe tab = {tab}", flush=True)

def find_btn(caprec, name, contains=False):
    if not caprec.get("_result_full"): return None
    for e in (caprec["_result_full"].get("interaction_tree") or {}).get("elements") or []:
        if e.get("role") == "button" and e.get("semantic_ref"):
            nm = str(e.get("name") or e.get("accessible_name") or "")
            if (nm == name) if not contains else (name.lower() in nm.lower()):
                return e
    return None

print("=== G0: recover degraded capture via RELOAD ===", flush=True)
run_test("G0-RELOAD", "RELOAD", payload={"tab_id": tab}, platform=P, mutating=True)
time.sleep(3)
cap = run_test("G0-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
named = 0
if cap.get("_result_full"):
    els = (cap["_result_full"].get("interaction_tree") or {}).get("elements") or []
    named = len([e for e in els if e.get("name")])
    print(f"  elements={len(els)} named={named} url={cap['_result_full'].get('url','')[:80]}", flush=True)

print("=== G1: sidebar retry ===", flush=True)
tbtn = find_btn(cap, "Toggle Sidebar")
print(f"  Toggle Sidebar: {bool(tbtn)}", flush=True)
if tbtn:
    run_test("G1-TOGGLE", "TYPED_CLICK", payload={"role": "button", "tab_id": tab,
             "semantic_ref": tbtn["semantic_ref"], "accessible_name": "Toggle Sidebar"}, platform=P, mutating=True, timeout=60)
    time.sleep(3)
cap2 = run_test("G1-CAP2", "CAPTURE", payload={"tab_id": tab}, platform=P)
ag = find_btn(cap2, "Agent")
print(f"  Agent btn: {bool(ag)}", flush=True)
if ag:
    run_test("G1-AGENT", "TYPED_CLICK", payload={"role": "button", "tab_id": tab,
             "semantic_ref": ag["semantic_ref"], "accessible_name": "Agent"}, platform=P, mutating=True, timeout=60)
    time.sleep(6)
cap3 = run_test("G1-CAP3", "CAPTURE", payload={"tab_id": tab}, platform=P)
if cap3.get("_result_full"):
    u = cap3["_result_full"].get("url", "")
    els = (cap3["_result_full"].get("interaction_tree") or {}).get("elements") or []
    btns = [str(e.get("name"))[:30] for e in els if e.get("role") == "button" and e.get("name")]
    tbs = len([e for e in els if e.get("role") == "textbox"])
    print(f"  post url={u[:100]} textboxes={tbs}", flush=True)
    print(f"  named buttons: {btns[:15]}", flush=True)
    bmt.save({"id": "G1-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "post_agent_click_url": u, "is_agent_page": ("/agent" in u.lower())})

print("=== G2: SCROLL schema variants ===", flush=True)
r1 = run_test("G2-SCROLL-DY", "SCROLL", payload={"tab_id": tab, "delta_y": -600}, platform=P, mutating=True)
if r1["status"] != "COMPLETED":
    r2 = run_test("G2-SCROLL-AMT", "SCROLL", payload={"tab_id": tab, "direction": "down", "amount": 600}, platform=P, mutating=True)
    if r2["status"] != "COMPLETED":
        run_test("G2-SCROLL-DY2", "SCROLL", payload={"tab_id": tab, "deltaY": 600}, platform=P, mutating=True)

print("=== G3: DOWNLOAD_FILE with sha256 ===", flush=True)
run_test("G3-DLF", "DOWNLOAD_FILE", payload={
    "url": "https://www.iana.org/robots.txt", "filename": "robots.txt",
    "sha256": "e5c4b84484ee4216e9373be99380320c25dd94805f99f0a805846f087636553f"}, mutating=True)

print("=== G4: transcript + census ===", flush=True)
run_test("G4-TRANS", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 6}, platform=P)
run_test("G4-CENSUS", "TAB_CENSUS", payload={})

print("phase G done", flush=True)
