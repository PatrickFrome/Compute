#!/usr/bin/env python3
# mt-419203-c3.py — final Phase C block: SCROLL variants + TYPED_CLICK minimal-schema retry
import importlib.util, time
spec = importlib.util.spec_from_file_location("mt", "/home/z/my-project/scripts/phoenix/mt-419203.py")
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
mt.load_results()
tab = mt.ctx_load().get("own_tab")
print(f"own_tab={tab}", flush=True)
mt.run_test("C08", "SCROLL", payload={"tab_id": tab, "delta_x": 0, "delta_y": 400}, platform="GLM_ZAI", mutating=True, timeout=50)
mt.run_test("C09", "SCROLL", payload={"tab_id": tab, "direction": "down", "pixels": 400}, platform="GLM_ZAI", mutating=True, timeout=50)
cap = mt.run_test("C10", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
tb = mt.find_sem(cap, role="textbox")
link = mt.find_sem(cap, role="link")
tgt = link or tb
print(f"  typed_click target: {tgt.get('role') if tgt else None} / {str(tgt.get('name'))[:30] if tgt else None}", flush=True)
if tgt:
    mt.run_test("C11", "TYPED_CLICK", payload={"tab_id": tab, "role": tgt.get("role"), "accessible_name": tgt.get("name")},
                platform="GLM_ZAI", mutating=True, timeout=50)
else:
    mt.run_test("C11", "TYPED_CLICK", payload={"tab_id": tab, "role": "textbox", "accessible_name": "Ask Chat"},
                platform="GLM_ZAI", mutating=True, timeout=50)
print("C3 done", flush=True)
