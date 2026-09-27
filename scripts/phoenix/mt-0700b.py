#!/usr/bin/env python3
# mt-0700b.py — retry SEMANTIC_TYPE with replace_existing=False (core recipe re-verify)
import importlib.util, sys, json, time

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open(bmt.RESULTS + ".ctx")).get("probe_tab")
print(f"probe tab={tab}", flush=True)
if not tab:
    sys.exit(1)

cap = run_test("M20-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
sem = None
for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "textbox" and t.get("semantic_ref"):
        sem = t; break
print(f"textbox: {bool(sem)} draft_text_len={len(str((sem or {}).get('text') or ''))}", flush=True)
if not sem:
    sys.exit(1)

st = {"tab_id": tab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
      "text": "MT0700 mechanics probe: reply with a single word ACK.",
      "submit_after_type": True, "replace_existing": False}
r = run_test("M21-TYPESUBMIT-REPLACE-FALSE", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
print(f"type-submit replace=False: {r['status']} err={r.get('error')}", flush=True)
time.sleep(6)
cap2 = run_test("M22-CAP-POST", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
url = (cap2.get("_result_full") or {}).get("url", "")
conv = "/c/" in url
print(f"post url={url[:80]} conversation_created={conv}", flush=True)
bmt.save({"id": "M22-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "url": url, "conversation_created": conv, "recipe": "replace_existing=False+submit=True"})
print("done", flush=True)
