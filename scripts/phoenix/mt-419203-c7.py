#!/usr/bin/env python3
# mt-419203-c7.py — TYPED_CLICK payload variants: semantic_ref_id string / backend_node_id
import importlib.util, time, json
spec = importlib.util.spec_from_file_location("mt", "/home/z/my-project/scripts/phoenix/mt-419203.py")
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
mt.load_results()
tab = mt.ctx_load().get("own_tab2")
cap = mt.run_test("C22", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
tg = None
for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "button" and str(t.get("name") or "") == "Chat":
        tg = t; break
if not tg:
    print("no Chat target", flush=True); raise SystemExit
ref = tg["semantic_ref"]
srid = ref.get("semantic_ref_id")
# Variant 1: semantic_ref as string id
v1 = {"role": "button", "tab_id": tab, "semantic_ref": srid, "accessible_name": "Chat"}
r1 = mt.run_test("C23", "TYPED_CLICK", payload=v1, platform="GLM_ZAI", mutating=True, timeout=60)
if r1.get("status") != "COMPLETED":
    # Variant 2: + backend_node_id and frame_id
    v2 = {"role": "button", "tab_id": tab, "semantic_ref": srid, "accessible_name": "Chat",
          "backend_node_id": tg.get("backend_node_id"), "frame_id": tg.get("frame_id")}
    r2 = mt.run_test("C24", "TYPED_CLICK", payload=v2, platform="GLM_ZAI", mutating=True, timeout=60)
    if r2.get("status") != "COMPLETED":
        # Variant 3: whole ref object under key semantic_target
        v3 = {"role": "button", "tab_id": tab, "semantic_target": tg, "accessible_name": "Chat"}
        r3 = mt.run_test("C25", "TYPED_CLICK", payload=v3, platform="GLM_ZAI", mutating=True, timeout=60)
ok = [x for x in ("C23","C24","C25") if any(i.get("id")==x and i.get("status")=="COMPLETED" for i in mt._results)]
if ok:
    time.sleep(4)
    cap2 = mt.run_test("C26", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    u = ((cap2.get("_result_full") or {}).get("url")) or ""
    print(f"  post-click url={u[:90]}", flush=True)
print("C7 done", flush=True)
