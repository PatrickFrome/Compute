#!/usr/bin/env python3
# mt-0700c.py — type (no submit) -> find Send button -> INSERT TYPED_CLICK -> verify /c/
import importlib.util, json, time, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open(bmt.RESULTS + ".ctx")).get("probe_tab")
print(f"tab={tab}", flush=True)

cap = run_test("M30-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
sem = None
for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "textbox" and t.get("semantic_ref"):
        sem = t; break
if not sem:
    print("no textbox", flush=True); sys.exit(1)
st = {"tab_id": tab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
      "text": "MT0700 mechanics probe: reply with a single word ACK.",
      "submit_after_type": False, "replace_existing": False}
r = run_test("M31-TYPE-NOSUB", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
print(f"type: {r['status']} err={r.get('error')}", flush=True)
time.sleep(3)
cap2 = run_test("M32-CAP-DRAFT", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
els = ((cap2.get("_result_full") or {}).get("interaction_tree") or {}).get("elements") or []
for e in els:
    if e.get("role") == "textbox":
        print(f"  draft now: len={len(str(e.get('text') or ''))} repr={str(e.get('text'))[:60]!r}", flush=True)
btns = []
for t in (cap2.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "button" and t.get("semantic_ref"):
        btns.append(t)
print(f"buttons with semref: {len(btns)}: {[b.get('name') for b in btns][:20]}", flush=True)
send = None
for b in btns:
    nm = (b.get("name") or "").lower()
    if nm in ("send", "submit") or "send" in nm:
        send = b; break
if not send:
    print("no Send button found — abort", flush=True); sys.exit(1)
pl = {"role": "button", "tab_id": tab, "semantic_ref": send["semantic_ref"], "accessible_name": send.get("name") or "Send"}
cid = None
import uuid, datetime
c = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
row = {"command_id": c, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
       "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl, "status": "PENDING",
       "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
       "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
       "idempotency_key": f"glm-diag-mt0700c-{uuid.uuid4().hex[:8]}"}
code, ins = bmt.rest_insert(row)
print(f"send-click insert http={code}", flush=True)
if code in (200, 201):
    stt = None
    for _ in range(20):
        cc = bmt.get_command(c)
        if cc and cc.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            stt = cc; break
        time.sleep(2.5)
    stt = stt or {"status": "POLL_TIMEOUT"}
    print(f"send-click: {stt.get('status')} err={stt.get('error')}", flush=True)
    bmt.save({"id": "M33-SEND-CLICK", "action": "TYPED_CLICK", "command_id": c, "status": stt.get("status"),
              "error": stt.get("error"), "channel": "insert"})
time.sleep(8)
cap3 = run_test("M34-CAP-POST", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
url = (cap3.get("_result_full") or {}).get("url", "")
conv = "/c/" in url
print(f"post url={url[:80]} conversation_created={conv}", flush=True)
bmt.save({"id": "M34-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "url": url, "conversation_created": conv, "chain": "type-nosub -> TYPED_CLICK Send"})
print("done", flush=True)
