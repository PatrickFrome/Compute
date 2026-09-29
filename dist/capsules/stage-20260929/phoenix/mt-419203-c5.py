#!/usr/bin/env python3
# mt-419203-c5.py — re-capture after hydration pause, TYPED_CLICK on named safe button
import importlib.util, time
spec = importlib.util.spec_from_file_location("mt", "/home/z/my-project/scripts/phoenix/mt-419203.py")
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
mt.load_results()
tab = mt.ctx_load().get("own_tab2")
print(f"own_tab2={tab}", flush=True)
time.sleep(8)
cap = mt.run_test("C16", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
named = []
if cap.get("_result_full"):
    els = (cap["_result_full"].get("interaction_tree") or {}).get("elements") or []
    named = [(e.get("role"), str(e.get("name") or e.get("accessible_name") or "")) for e in els
             if e.get("semantic_ref") and (e.get("name") or e.get("accessible_name"))]
print(f"  named elements: {len(named)}: {[(r,n[:24]) for r,n in named[:8]]}", flush=True)
mt.save({"id": "C16-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
         "named_count": len(named), "sample": [(r, n[:24]) for r, n in named[:8]]})
# pick safe target: button named 'Chat' > any named button not containing settings/close/menu
tgt = None
for e in (cap.get("_result_full") or {}).get("interaction_tree", {}).get("elements", []):
    nm = str(e.get("name") or e.get("accessible_name") or "")
    if e.get("role") == "button" and e.get("semantic_ref") and nm == "Chat":
        tgt = e; break
if not tgt:
    for e in (cap.get("_result_full") or {}).get("interaction_tree", {}).get("elements", []):
        nm = str(e.get("name") or e.get("accessible_name") or "")
        if e.get("role") == "button" and e.get("semantic_ref") and nm and not any(k in nm.lower() for k in ("setting", "close", "menu", "user")):
            tgt = e; break
print(f"  click target: {tgt.get('name') if tgt else None}", flush=True)
if tgt:
    mt.run_test("C17", "TYPED_CLICK", payload={
        "role": "button", "tab_id": tab, "semantic_ref": tgt["semantic_ref"],
        "accessible_name": str(tgt.get("name") or tgt.get("accessible_name"))},
        platform="GLM_ZAI", mutating=True, timeout=60)
    time.sleep(4)
    mt.run_test("C18", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
else:
    mt.save({"id": "C17-ANALYSIS", "action": "ANALYSIS", "status": "FAILED",
             "channel": "local", "note": "no named button available"})
print("C5 done", flush=True)
