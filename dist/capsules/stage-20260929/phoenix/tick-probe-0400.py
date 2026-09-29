#!/usr/bin/env python3
# tick-probe-0400.py — Job 419203 tick 04:00: NON-POLLUTING monitoring probe.
# Protocol (per worklog BROWSER-TEST-20260928-0330): NO typing commands until
# operator clears the accumulative account-level composer draft.
# 1) FLEET_STATUS + TAB_CENSUS (read-only)
# 2) CAPTURE existing chat tab -> draft state via textbox text
# 3) ONLY IF CLEAN -> full unlock chain (NEW_TAB -> CAPTURE -> SEMANTIC_TYPE submit -> verify /c/)
import json, sys
sys.path.insert(0, "/home/z/my-project/scripts/phoenix")
import importlib.util
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
sys.argv = ["bmt", "NONE"]
sys.modules["bmt"] = bmt
spec.loader.exec_module(bmt)

RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0400.json"
bmt.RESULTS = RESULTS
bmt._results = []

MARKERS = ["FLEET BOOTSTRAP FLUSH", "SUPERVISOR CONVERSATION SEED",
           "METAENGINE mechanic test (GLM diagnosis)", "METAENGINE tick probe (GLM diag 0330)"]

print("=== TICK PROBE 04:00 (non-polluting) ===", flush=True)

# 1) FLEET_STATUS
fl = bmt.run_test("T01", "FLEET_STATUS", payload={}, platform="GLM_ZAI", timeout=45)
fls = fl.get("_result_full") or {}
agents = fls.get("agents") or []
print(f"fleet: n_agents={len(agents)} lifecycle={[a.get('lifecycle_state') for a in agents]} roles={[a.get('role') for a in agents]}", flush=True)

# 2) TAB_CENSUS
tc = bmt.run_test("T02", "TAB_CENSUS", payload={}, platform="GLM_ZAI", timeout=45)
rfc = tc.get("_result_full") or {}
by_kind = rfc.get("by_kind") or {}
fleet_tabs = rfc.get("fleet_tab_ids") or []
print(f"census: total={rfc.get('total_tabs')} by_kind={by_kind} fleet_tabs={[t[:14] for t in fleet_tabs]}", flush=True)

# 3) CAPTURE fleet PLANNER tab (account-level draft is visible on any chat.z.ai tab; read-only)
target = fleet_tabs[0] if fleet_tabs else None
draft_state, max_len, found = "NO_CHAT_TAB", 0, []
if target:
    cap = bmt.run_test("T03", "CAPTURE", payload={"tab_id": target}, platform="GLM_ZAI", timeout=60)
    rf = cap.get("_result_full") or {}
    els = (rf.get("interaction_tree") or {}).get("elements") or []
    tbs = [e for e in els if e.get("role") == "textbox"]
    for e in tbs:
        t = str(e.get("text") or "")
        if len(t) > max_len: max_len = len(t)
        for m in MARKERS:
            if m in t and m not in found: found.append(m)
    if not tbs:
        draft_state = "NO_TEXTBOX"
    elif found:
        draft_state = "DIRTY_DRAFT"
    elif max_len < 60:
        draft_state = "CLEAN"
    else:
        draft_state = "TEXT_%d" % max_len
    print(f"capture tab={str(target)[:14]} textboxes={len(tbs)} max_len={max_len} markers_found={found} -> draft_state={draft_state}", flush=True)
    bmt.save({"id": "T03-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "tab": str(target), "draft_state": draft_state, "max_len": max_len, "markers_found": found})

# 4) UNLOCK CHAIN only if clean
conv_created = None
if draft_state == "CLEAN":
    print("DRAFT CLEAN -> running unlock chain", flush=True)
    r = bmt.run_test("T04", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}, platform="GLM_ZAI", mutating=True, timeout=60)
    newtab = (r.get("_result_full") or {}).get("tab_id")
    print(f"newtab={newtab}", flush=True)
    if newtab:
        cap2 = bmt.run_test("T05", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI", timeout=60)
        sem = None
        for t in (cap2.get("_result_full") or {}).get("semantic_targets") or []:
            if t.get("role") == "textbox" and t.get("semantic_ref"):
                sem = t; break
        if sem:
            st = {"tab_id": newtab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
                  "text": "METAENGINE tick probe (GLM diag 0400)", "submit_after_type": True, "replace_existing": False}
            bmt.run_test("T06", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True, timeout=45)
            bmt.run_test("T07", "PRESS_KEY", payload={"key": "Enter", "tab_id": newtab}, platform="GLM_ZAI", mutating=True, timeout=45)
            cap3 = bmt.run_test("T08", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI", timeout=60)
            u = (cap3.get("_result_full") or {}).get("url", "")
            conv_created = "/c/" in u
            print(f"post-submit url={u[:70]} conversation_created={conv_created}", flush=True)
            bmt.save({"id": "T08-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                      "url": u, "conversation_created": conv_created})
else:
    print(f"NO UNLOCK CHAIN (draft_state={draft_state}) — zero pollution maintained", flush=True)

print(f"TICK PROBE 04:00 DONE: draft={draft_state} fleet={len(agents)} conversation_created={conv_created}", flush=True)
