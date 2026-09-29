#!/usr/bin/env python3
# dir-0907b.py — indirect readback of re-prompt: READ_TRANSCRIPT (sidebar single mode)
import importlib.util, json, time
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-d0907b.json"
bmt._results = []
run_test = bmt.run_test
P = "GLM_ZAI"
TAB = "tab_6924b587-8aa4-44ad-af7b-c7e4f814a6c6"

rt = run_test("R5-TRANSCRIPT", "READ_TRANSCRIPT", payload={"tab_id": TAB, "limit": 8}, platform=P, timeout=60)
full = rt.get("_result_full") or {}
msgs = full.get("messages") or full.get("transcript") or full.get("entries") or []
print("transcript keys:", sorted(full.keys())[:12], flush=True)
print("n messages:", len(msgs), flush=True)
out = []
for m in msgs[-6:]:
    role = m.get("role") or m.get("speaker")
    txt = str(m.get("text") or m.get("content") or "")[:180]
    out.append({"role": role, "text": txt})
    print(f"  [{role}] {txt[:140]}", flush=True)
bmt.save({"id": "R5-ANALYSIS", "action": "TRANSCRIPT-READBACK", "status": "COMPLETED", "channel": "local",
          "n_messages": len(msgs), "last_messages": out,
          "continuation_evidence": any("mitigation" in (m.get("text") or "").lower() for m in out)})
for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("readback done", flush=True)
