#!/usr/bin/env python3
# mt-419203c5.py — TYPED_CLICK via INSERT (RPC validator broken) + type-submit retry + STOP_GENERATION retry
import json, time, uuid, sys, os, datetime, importlib.util

spec = importlib.util.spec_from_file_location("c3", "/home/z/my-project/scripts/phoenix/mt-419203c3.py")
c3 = importlib.util.module_from_spec(spec); spec.loader.exec_module(c3)
c3.load_results()

def direct_insert(action, payload, ttl=60):
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": c3.WS, "target_client_id": c3.TARGET,
           "issued_by": c3.ISSUER, "action": action, "platform": "GLM_ZAI",
           "payload": payload, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now+datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"mt419203c5-{uuid.uuid4().hex[:8]}"}
    code, ins = c3.rest_insert(row)
    if code not in (200, 201):
        c3.save({"id": f"X-{action}", "action": action, "status": "INSERT_ERROR", "channel": "insert",
                 "http": code, "err_body": str(ins)[:200]})
        print(f"  [{action}] INSERT_ERROR {code}: {str(ins)[:120]}", flush=True)
        return None
    t0 = time.time()
    while time.time()-t0 < 50:
        time.sleep(2.5)
        r = c3.get_command(cid)
        if r and r.get("status") in ("COMPLETED","FAILED","EXPIRED"):
            rec = {"id": f"X-{action}", "action": action, "command_id": cid, "status": r["status"],
                   "channel": "insert", "error": r.get("error"), "ms": int((time.time()-t0)*1000),
                   "receipt_schema": (r.get("receipt") or {}).get("schema")}
            rc = (r.get("receipt") or {}).get("result") or {}
            if rc: rec["_result_full"] = rc
            c3.save(rec)
            print(f"  [{action}] {r['status']} ({rec['ms']}ms)" + (f" err={str(r.get('error'))[:90]}" if r.get("error") else ""), flush=True)
            return rec
    c3.save({"id": f"X-{action}", "action": action, "status": "POLL_TIMEOUT", "channel": "insert"})
    print(f"  [{action}] POLL_TIMEOUT", flush=True)
    return None

tab = c3.ctx_load().get("own_tab2")
print(f"=== C5: TYPED_CLICK(INSERT) + TYPE(submit) + STOP_GENERATION on {tab} ===", flush=True)
if not tab:
    print("no own tab"); sys.exit(1)

# 1) TYPED_CLICK via INSERT on a stable named button
cap = c3.run_test("R28", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
btn = c3.find_sem(cap, role="button", name_contains="New Task") or c3.find_sem(cap, role="button")
if btn:
    print(f"  click target: {btn.get('name')!r}", flush=True)
    time.sleep(20)
    direct_insert("TYPED_CLICK", {"role": "button", "tab_id": tab,
                  "semantic_ref": btn["semantic_ref"], "accessible_name": btn.get("name") or ""})
    time.sleep(6)
else:
    c3.save({"id": "R29-ANALYSIS", "action": "ANALYSIS", "status": "FAILED", "note": "no button"})

# 2) fresh capture -> type with submit_after_type=True
cap2 = c3.run_test("R30", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
tb = c3.find_sem(cap2, role="textbox")
if tb:
    st = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": ("Write a very long essay (at least 3000 words) about the history of computing. "
                   "Do not stop early. Mechanics test of stop-generation. Job 419203 run 2."),
          "submit_after_type": True, "replace_existing": False}
    c3.run_test("R31", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True, timeout=50)
    time.sleep(14)
    capg = c3.run_test("R32", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    stop = None; buttons = []
    url_g = (capg.get("_result_full") or {}).get("url", "")
    if capg.get("_result_full"):
        for t in (capg["_result_full"].get("semantic_targets") or []):
            if t.get("role") == "button" and t.get("semantic_ref"):
                nm = str(t.get("name") or ""); buttons.append(nm[:36])
                if any(k in nm.lower() for k in ("stop", "останов", "generating", "pause")):
                    stop = t; break
    print(f"  gen url={url_g[:70]} | buttons: {buttons[:8]} | stop={bool(stop)}", flush=True)
    c3.save({"id": "R32-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
             "url": url_g, "conversation_url": "/c/" in url_g, "buttons": buttons[:10], "stop_found": bool(stop)})
    if stop:
        c3.run_test("R33", "STOP_GENERATION", payload={"tab_id": tab, "role": "button",
                    "semantic_ref": stop["semantic_ref"], "accessible_name": stop.get("name")},
                    platform="GLM_ZAI", mutating=True, timeout=50)
        time.sleep(4)
        c3.run_test("R34", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    else:
        c3.run_test("R33", "STOP_GENERATION", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=50)
else:
    c3.save({"id": "R31-ANALYSIS", "action": "ANALYSIS", "status": "FAILED", "note": "no textbox after click"})
print("phase C5 done", flush=True)
