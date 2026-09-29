#!/usr/bin/env python3
# tick-probe.py — Job 419203 tick 03:30: root-blocker re-probe + provisioning flow if clean
import json, time, sys, os
sys.path.insert(0, "/home/z/my-project/scripts/phoenix")
import importlib.util
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
sys.argv = ["bmt", "NONE"]
sys.modules["bmt"] = bmt
spec.loader.exec_module(bmt)

RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0330.json"
bmt.RESULTS = RESULTS
bmt._results = []

print("=== TICK PROBE 03:30 ===", flush=True)
# 1) NEW_TAB
r = bmt.run_test("T02", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}, platform="GLM_ZAI", mutating=True, timeout=60)
newtab = (r.get("_result_full") or {}).get("tab_id")
print(f"newtab={newtab}", flush=True)
if not newtab:
    print("PROBE ABORT: no newtab", flush=True); sys.exit(0)
json.dump({"newtab": newtab}, open(RESULTS + ".ctx", "w"))

# 2) CAPTURE + draft state
cap = bmt.run_test("T03", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
draft_state, draft_len, has_flush = "unknown", 0, False
if cap.get("_result_full"):
    els = (cap["_result_full"].get("interaction_tree") or {}).get("elements") or []
    tbs = [e for e in els if e.get("role") == "textbox"]
    for e in tbs:
        t = str(e.get("text") or "")
        if "FLEET BOOTSTRAP FLUSH" in t or "SUPERVISOR CONVERSATION SEED" in t:
            has_flush = True
        if len(t) > draft_len: draft_len = len(t)
    draft_state = "FLUSH_DRAFT" if has_flush else ("CLEAN" if all(len(str(e.get('text') or '')) < 60 for e in tbs) else "DRAFT_%d" % draft_len)
    print(f"draft_state={draft_state} textboxes={len(tbs)} max_text_len={draft_len}", flush=True)
    bmt.save({"id": "T03-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "draft_state": draft_state, "max_text_len": draft_len, "has_flush": has_flush})

# 3) submit chain (immediately, fresh ref)
sem = None
if cap.get("_result_full"):
    for t in (cap["_result_full"].get("semantic_targets") or []):
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            sem = t; break
if sem:
    st = {"tab_id": newtab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
          "text": "METAENGINE tick probe (GLM diag 0330)", "submit_after_type": True, "replace_existing": False}
    bmt.run_test("T04", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True, timeout=45)
    bmt.run_test("T05", "PRESS_KEY", payload={"key": "Enter", "tab_id": newtab}, platform="GLM_ZAI", mutating=True, timeout=45)
cap2 = bmt.run_test("T06", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
conv = False
if cap2.get("_result_full"):
    u = cap2.get("_result_full").get("url", "")
    conv = "/c/" in u
    print(f"post-submit url={u[:70]} conversation_created={conv}", flush=True)
    bmt.save({"id": "T06-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "url": u, "conversation_created": conv})
rt = bmt.run_test("T07", "READ_TRANSCRIPT", payload={"tab_id": newtab, "limit": 15}, platform="GLM_ZAI")
if rt.get("_result_full"):
    txt = rt.get("_result_full").get("text") or ""
    print("transcript: probe_text_present=", "tick probe (GLM diag 0330)" in txt, " len=", len(txt), flush=True)
print(f"TICK PROBE DONE: draft={draft_state} conversation_created={conv}", flush=True)
