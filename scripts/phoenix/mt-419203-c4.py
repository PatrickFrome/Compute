#!/usr/bin/env python3
# mt-419203-c4.py — fresh own tab + TYPED_CLICK proven recipe (Agent button) + readback
import importlib.util, time
spec = importlib.util.spec_from_file_location("mt", "/home/z/my-project/scripts/phoenix/mt-419203.py")
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
mt.load_results()
rec = mt.run_test("C12", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"},
                  platform="GLM_ZAI", mutating=True, timeout=60)
tab = (rec.get("_result_full") or {}).get("tab_id")
print(f"own_tab2={tab}", flush=True)
mt.ctx_save({"own_tab2": tab})
if not tab:
    raise SystemExit("no new tab")
time.sleep(3)
cap = mt.run_test("C13", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
ag = None
if cap.get("_result_full"):
    for e in (cap["_result_full"].get("interaction_tree") or {}).get("elements") or []:
        if e.get("role") == "button" and str(e.get("name") or e.get("accessible_name") or "") == "Agent" and e.get("semantic_ref"):
            ag = e; break
print(f"  Agent button: {bool(ag)}", flush=True)
if ag:
    mt.run_test("C14", "TYPED_CLICK", payload={
        "role": "button", "tab_id": tab, "semantic_ref": ag["semantic_ref"],
        "accessible_name": "Agent"}, platform="GLM_ZAI", mutating=True, timeout=60)
    time.sleep(4)
    cap3 = mt.run_test("C15", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    u = ((cap3.get("_result_full") or {}).get("url")) or ""
    print(f"  post-click url={u[:100]} agent_page={'/agent' in u.lower()}", flush=True)
    mt.save({"id": "C15-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
             "post_click_url": u, "is_agent_page": ("/agent" in u.lower())})
else:
    mt.save({"id": "C14-ANALYSIS", "action": "ANALYSIS", "status": "FAILED",
             "channel": "local", "note": "Agent button not found in interaction_tree"})
print("C4 done", flush=True)
