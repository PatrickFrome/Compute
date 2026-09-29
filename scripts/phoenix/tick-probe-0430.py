#!/usr/bin/env python3
# tick-probe.py — Job 419203 recurring READ-ONLY monitoring probe (protocol v2).
# Draft-state detector = READ_TRANSCRIPT tail (CAPTURE is BLIND to invisible account draft).
# Typing probes FROZEN until transcript shows NO flush-seed AND NO accumulated texts.
# Usage: python3 tick-probe-0430.py <HHMM-tag>  (e.g. 0500) — results file gets the tag.
import json, sys
TAG = sys.argv[1] if len(sys.argv) > 1 else "manual"
sys.path.insert(0, "/home/z/my-project/scripts/phoenix")
import importlib.util
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
sys.argv = ["bmt", "NONE"]
sys.modules["bmt"] = bmt
spec.loader.exec_module(bmt)

RESULTS = f"/home/z/my-project/scripts/phoenix/browser-test-results-t{TAG}.json"
bmt.RESULTS = RESULTS
bmt._results = []

MARKERS = ["FLEET BOOTSTRAP FLUSH", "SUPERVISOR CONVERSATION SEED",
           "METAENGINE mechanic test (GLM diagnosis)",
           "METAENGINE tick probe (GLM diag 0330)", "METAENGINE tick probe (GLM diag 0400)"]
PROBE_TAB = "tab_a66fab40-2cf7-418b-8fa1-9148d31de8d7"  # own probe tab from 0400 tick

print(f"=== TICK PROBE {TAG} (read-only, protocol v2) ===", flush=True)

# 1) FLEET_STATUS
fl = bmt.run_test("T01", "FLEET_STATUS", payload={}, platform="GLM_ZAI", timeout=45)
agents = (fl.get("_result_full") or {}).get("agents") or []
print(f"fleet: n={len(agents)} lifecycle={[a.get('lifecycle_state') for a in agents]}", flush=True)

# 2) TAB_CENSUS
tc = bmt.run_test("T02", "TAB_CENSUS", payload={}, platform="GLM_ZAI", timeout=45)
rfc = tc.get("_result_full") or {}
print(f"census: total={rfc.get('total_tabs')} by_kind={rfc.get('by_kind')}", flush=True)
fleet_tabs = rfc.get("fleet_tab_ids") or []

# 3) draft state via READ_TRANSCRIPT (own probe tab, fallback fleet tab)
target = PROBE_TAB
rt = bmt.run_test("T03", "READ_TRANSCRIPT", payload={"tab_id": target, "limit": 15}, platform="GLM_ZAI", timeout=60)
rf = rt.get("_result_full") or {}
txt = rf.get("text") or ""
if not txt:
    target = fleet_tabs[0] if fleet_tabs else None
    if target:
        rt = bmt.run_test("T03b", "READ_TRANSCRIPT", payload={"tab_id": target, "limit": 15}, platform="GLM_ZAI", timeout=60)
        rf = rt.get("_result_full") or {}
        txt = rf.get("text") or ""

found = [m for m in MARKERS if m in txt]
draft_state = "UNKNOWN_NO_TRANSCRIPT" if not txt else ("DIRTY_DRAFT" if found else "CLEAN")
tail = txt[-400:] if txt else ""
print(f"transcript: tab={str(target)[:14]} len={len(txt)} markers_found={found}", flush=True)
print(f"-> draft_state={draft_state}", flush=True)
print(f"tail400: {tail!r}", flush=True)
bmt.save({"id": "T03-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "tab": str(target), "draft_state": draft_state, "transcript_len": len(txt), "markers_found": found,
          "overlay_diag": {m: (m in txt) for m in ["realtime_plane=", "conversation=unbound", "BOUND_UNVERIFIED"]}})

# 4) unlock chain ONLY if clean
conv_created = None
if draft_state == "CLEAN":
    print("DRAFT CLEAN (verified by transcript) -> unlock chain", flush=True)
    r = bmt.run_test("T04", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}, platform="GLM_ZAI", mutating=True, timeout=60)
    newtab = (r.get("_result_full") or {}).get("tab_id")
    if newtab:
        cap2 = bmt.run_test("T05", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI", timeout=60)
        sem = None
        for t in (cap2.get("_result_full") or {}).get("semantic_targets") or []:
            if t.get("role") == "textbox" and t.get("semantic_ref"):
                sem = t; break
        if sem:
            st = {"tab_id": newtab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
                  "text": f"METAENGINE tick probe (GLM diag {TAG})", "submit_after_type": True, "replace_existing": False}
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

print(f"TICK PROBE {TAG} DONE: draft={draft_state} fleet={len(agents)} conversation_created={conv_created}", flush=True)
