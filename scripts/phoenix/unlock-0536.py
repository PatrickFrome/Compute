#!/usr/bin/env python3
# unlock-0536.py — operator reported cleanup ("Очистил"). Find the CLEAN tab (draft cleared
# on the tab operator sees) and fire the unlock chain THERE. Protocol v2: draft detection
# via READ_TRANSCRIPT only. Unlock = SEMANTIC_TYPE(submit_after_type) on a verified-clean tab.
import json, sys
sys.path.insert(0, "/home/z/my-project/scripts/phoenix")
import importlib.util
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
sys.argv = ["bmt", "NONE"]
sys.modules["bmt"] = bmt
spec.loader.exec_module(bmt)
RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0536.json"
bmt.RESULTS = RESULTS
bmt._results = []

MARKERS = ["FLEET BOOTSTRAP FLUSH", "SUPERVISOR CONVERSATION SEED",
           "METAENGINE mechanic test (GLM diagnosis)",
           "METAENGINE tick probe (GLM diag 0330)", "METAENGINE tick probe (GLM diag 0400)",
           "METAENGINE tick probe (GLM diag 0500)"]

# 1) fresh tab list w/ urls from Supabase state table (client 2a60d6a2)
import os, urllib.request
with open("/tmp/my-project/.a2-backup/me2.env.20260922") as fh:
    env = {}
    for line in fh:
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v
su, sj = env["SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_JWT"]
r = urllib.request.Request(
    su + "/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&client_id=eq.2a60d6a2-c7c2-4dcc-b4c9-99de768443c9&limit=1",
    headers={"apikey": sj, "Authorization": "Bearer " + sj})
with urllib.request.urlopen(r, timeout=20) as resp:
    blob = json.loads(resp.read())[0]["state"]
tabs = [t for t in blob.get("tabs", []) if t.get("kind") == "GLM_CHAT"]
newchat = [t for t in tabs if "/c/" not in (t.get("url") or "") and "/error" not in (t.get("url") or "")]
print(f"GLM_CHAT tabs={len(tabs)} new-chat (no /c/, no /error)={len(newchat)}", flush=True)
for t in newchat:
    print(f"  cand {t['tab_id'][:16]} sel={t.get('selected')} url={t['url'][:40]}", flush=True)

# 2) find a CLEAN tab via READ_TRANSCRIPT (limit small — empty draft => short text)
clean_tab, report = None, []
for t in newchat:
    tid = t["tab_id"]
    rt = bmt.run_test("U-RT", "READ_TRANSCRIPT", payload={"tab_id": tid, "limit": 10}, platform="GLM_ZAI", timeout=60)
    txt = (rt.get("_result_full") or {}).get("text") or ""
    hits = [m for m in MARKERS if m in txt]
    st = "NO_TXT" if not txt else ("DIRTY" if hits else "CLEAN")
    report.append((tid[:16], len(txt), st, txt[-120:]))
    print(f"scan {tid[:16]} len={len(txt)} state={st} tail={txt[-100:]!r}", flush=True)
    bmt.save({"id": f"U-SCAN-{tid[:12]}", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "tab": tid, "state": st, "len": len(txt)})
    if st == "CLEAN":
        clean_tab = tid
        break

if not clean_tab:
    print("NO CLEAN TAB FOUND — operator cleanup not visible in any new-chat tab", flush=True)
    for row in report:
        print("  ", row, flush=True)
    sys.exit(0)

print(f"CLEAN TAB FOUND: {clean_tab} -> unlock chain", flush=True)
cap = bmt.run_test("U-CAP", "CAPTURE", payload={"tab_id": clean_tab}, platform="GLM_ZAI", timeout=60)
sem = None
for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "textbox" and t.get("semantic_ref"):
        sem = t
        break
if not sem:
    print("NO TEXTBOX TARGET on clean tab — abort", flush=True)
    sys.exit(1)
st = {"tab_id": clean_tab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
      "text": "METAENGINE unlock probe (GLM diag 0536)", "submit_after_type": True, "replace_existing": False}
bmt.run_test("U-TYPE", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True, timeout=45)
bmt.run_test("U-ENTER", "PRESS_KEY", payload={"key": "Enter", "tab_id": clean_tab}, platform="GLM_ZAI", mutating=True, timeout=45)
cap3 = bmt.run_test("U-CAP2", "CAPTURE", payload={"tab_id": clean_tab}, platform="GLM_ZAI", timeout=60)
u = (cap3.get("_result_full") or {}).get("url", "")
conv_created = "/c/" in u
print(f"post-submit url={u[:80]} conversation_created={conv_created}", flush=True)
bmt.save({"id": "U-RESULT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "clean_tab": clean_tab, "url": u, "conversation_created": conv_created})
print(f"UNLOCK DONE: conversation_created={conv_created}", flush=True)
