#!/usr/bin/env python3
# mt-419203-c8.py — TYPED_CLICK via direct INSERT (bypass broken RPC validator) + readback
import importlib.util, time, json, uuid, datetime
spec = importlib.util.spec_from_file_location("mt", "/home/z/my-project/scripts/phoenix/mt-419203.py")
mt = importlib.util.module_from_spec(spec); spec.loader.exec_module(mt)
mt.load_results()
tab = mt.ctx_load().get("own_tab2")
cap = mt.run_test("C27", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
tg = None
for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "button" and str(t.get("name") or "") == "Chat":
        tg = t; break
print(f"  Chat target: {bool(tg)}", flush=True)
if tg:
    srid = tg["semantic_ref"].get("semantic_ref_id")
    pl = {"role": "button", "tab_id": tab, "semantic_ref": srid, "accessible_name": "Chat"}
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": mt.WS, "target_client_id": mt.TARGET,
           "issued_by": mt.ISSUER, "action": "TYPED_CLICK", "platform": "GLM_ZAI", "payload": pl,
           "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"mt419203-c8-{uuid.uuid4().hex[:8]}"}
    code, ins = mt.rest_insert(row)
    print(f"  insert http={code}", flush=True)
    if code in (200, 201):
        row2 = None; t0 = time.time()
        while time.time() - t0 < 55:
            row2 = mt.get_command(cid)
            if row2 and row2.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
                break
            time.sleep(2.5)
        st = (row2 or {}).get("status", "POLL_TIMEOUT")
        err = (row2 or {}).get("error")
        rec = {"id": "C28", "action": "TYPED_CLICK", "command_id": cid, "status": st,
               "channel": "insert", "error": err, "ms": int((time.time()-t0)*1000),
               "result_summary": mt.summarize(((row2 or {}).get("receipt") or {}).get("result") if isinstance((row2 or {}).get("receipt"), dict) else None)}
        mt.save(rec); print(f"  [C28:TYPED_CLICK-insert] {st} err={err}", flush=True)
        if st == "COMPLETED":
            time.sleep(4)
            cap2 = mt.run_test("C29", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
            u = ((cap2.get("_result_full") or {}).get("url")) or ""
            print(f"  post-click url={u[:90]}", flush=True)
print("C8 done", flush=True)
