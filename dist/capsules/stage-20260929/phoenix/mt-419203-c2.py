#!/usr/bin/env python3
# mt-419203-c2.py — resume Phase C from C04 (draft already typed by C03) + TYPED_CLICK minimal retry
import importlib.util, time, json
spec = importlib.util.spec_from_file_location("mt", "/home/z/my-project/scripts/phoenix/mt-419203.py")
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
mt.load_results()

tab = mt.ctx_load().get("own_tab")
print(f"own_tab={tab}", flush=True)
if not tab:
    raise SystemExit("no own tab in ctx")

# C04: submit the typed draft with Enter
mt.run_test("C04", "PRESS_KEY", payload={"key": "Enter", "tab_id": tab}, platform="GLM_ZAI", mutating=True)
time.sleep(12)
# C05: capture during generation, find stop button
capg = mt.run_test("C05", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
stop = None; all_buttons = []
if capg.get("_result_full"):
    for t in (capg["_result_full"].get("semantic_targets") or []):
        if t.get("role") == "button" and t.get("semantic_ref"):
            nm = str(t.get("name") or "")
            all_buttons.append(nm[:40])
            low = nm.lower()
            if any(k in low for k in ("stop", "останов", "generating", "pause", "прerкрат")):
                stop = t; break
print(f"  buttons_during_gen={all_buttons[:10]}; stop_candidate={bool(stop)}", flush=True)
mt.save({"id": "C05-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
         "buttons_during_generation": all_buttons[:10], "stop_candidate": bool(stop)})
if stop:
    pl = {"tab_id": tab, "role": "button", "semantic_ref": stop["semantic_ref"],
          "accessible_name": stop.get("name")}
    mt.run_test("C06", "STOP_GENERATION", payload=pl, platform="GLM_ZAI", mutating=True, timeout=50)
else:
    mt.run_test("C06", "STOP_GENERATION", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=50)
time.sleep(4)
mt.run_test("C07", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
# C08/C09: SCROLL last schema variants
mt.run_test("C08", "SCROLL", payload={"tab_id": tab, "delta_x": 0, "delta_y": 400}, platform="GLM_ZAI", mutating=True, timeout=50)
mt.run_test("C09", "SCROLL", payload={"tab_id": tab, "direction": "down", "pixels": 400}, platform="GLM_ZAI", mutating=True, timeout=50)

# B09 retry: TYPED_CLICK minimal typed schema (no semantic_ref) on own tab
cap2 = mt.run_test("C10", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
link = mt.find_sem(cap2, role="link")
tb2 = mt.find_sem(cap2, role="textbox")
target = link or tb2
print(f"  typed_click target: role={target.get('role') if target else None} name={str(target.get('name'))[:30] if target else None}", flush=True)
if target:
    mt.run_test("C11", "TYPED_CLICK", payload={"tab_id": tab, "role": target.get("role"),
                "accessible_name": target.get("name")}, platform="GLM_ZAI", mutating=True, timeout=50)
else:
    mt.run_test("C11", "TYPED_CLICK", payload={"tab_id": tab, "role": "textbox", "accessible_name": "Ask Chat"},
                platform="GLM_ZAI", mutating=True, timeout=50)
print("C-resume done", flush=True)
