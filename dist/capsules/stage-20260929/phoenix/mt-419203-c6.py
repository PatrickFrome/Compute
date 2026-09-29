#!/usr/bin/env python3
# mt-419203-c6.py — TYPED_CLICK via semantic_targets (correct source) + readback
import importlib.util, time
spec = importlib.util.spec_from_file_location("mt", "/home/z/my-project/scripts/phoenix/mt-419203.py")
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
mt.load_results()
tab = mt.ctx_load().get("own_tab2")
cap = mt.run_test("C19", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
tgt = None
for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "button" and t.get("semantic_ref") and str(t.get("name") or "") == "Chat":
        tgt = t; break
print(f"  Chat button: {bool(tgt)} ref={str(tgt.get('semantic_ref'))[:40] if tgt else None}", flush=True)
if tgt:
    mt.run_test("C20", "TYPED_CLICK", payload={
        "role": "button", "tab_id": tab, "semantic_ref": tgt["semantic_ref"],
        "accessible_name": "Chat"}, platform="GLM_ZAI", mutating=True, timeout=60)
    time.sleep(4)
    cap2 = mt.run_test("C21", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    u = ((cap2.get("_result_full") or {}).get("url")) or ""
    print(f"  post-click url={u[:100]}", flush=True)
    mt.save({"id": "C21-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
             "post_click_url": u})
print("C6 done", flush=True)
