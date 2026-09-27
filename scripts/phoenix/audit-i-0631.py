#!/usr/bin/env python3
# audit-i-0631.py — Phase I: Agent-tab entry via semantic_targets[].semantic_ref (the proven field path)
import importlib.util, sys, json, time

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-i0631.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open("/home/z/my-project/scripts/phoenix/browser-test-results-e0631.json.ctx")).get("probe_tab")

cap = run_test("I1-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
tgt = None
chat_tgt = None
if cap.get("_result_full"):
    st = cap["_result_full"].get("semantic_targets") or []
    print(f"semantic_targets total={len(st)}", flush=True)
    print("all names:", [f"{t.get('role')}:{t.get('name')}" for t in st if t.get('name')][:25], flush=True)
    for t in st:
        if t.get("role") == "button" and t.get("semantic_ref"):
            nm = str(t.get("name") or "")
            if nm == "Agent": tgt = t
            if nm == "Chat": chat_tgt = t
print(f"Agent semref: {bool(tgt)} | Chat semref: {bool(chat_tgt)}", flush=True)

if tgt:
    ck = run_test("I1-AGENT-CLICK", "TYPED_CLICK", payload={"role": "button", "tab_id": tab,
                  "semantic_ref": tgt["semantic_ref"], "accessible_name": "Agent"}, platform=P, mutating=True, timeout=60)
    print(f"click status={ck['status']} err={ck.get('error')}", flush=True)
    time.sleep(6)
    cap2 = run_test("I1-POSTCAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
    if cap2.get("_result_full"):
        u = cap2["_result_full"].get("url", "")
        st2 = cap2["_result_full"].get("semantic_targets") or []
        names2 = [f"{t.get('role')}:{t.get('name')}" for t in st2 if t.get("name")][:25]
        print(f"post url={u[:110]}", flush=True)
        print(f"post names: {names2}", flush=True)
        bmt.save({"id": "I1-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "post_agent_click_url": u, "is_agent_page": ("/agent" in u.lower())})
else:
    print("no Agent semref this capture", flush=True)

print("phase I done", flush=True)
