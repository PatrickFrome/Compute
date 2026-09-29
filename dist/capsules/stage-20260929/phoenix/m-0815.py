#!/usr/bin/env python3
# m-0815.py — directive cycle 08:15: (1) agent-session readback probe, (2) Select-model -> GLM-5.3-Flash
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-m0815.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
CTX = bmt.RESULTS + ".ctx"
TAB = "tab_6924b587-8aa4-44ad-af7b-c7e4f814a6c6"  # agent-space tab (session /c/94fd04de essay)

def direct_insert(action, payload, platform=P, ttl=75, poll=55):
    cid = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": "zai-directive-419718", "action": action, "platform": platform,
           "payload": payload, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-dir-m0815-{uuid.uuid4().hex[:8]}"}
    code, ins = bmt.rest_insert(row)
    if code not in (200, 201):
        rec = {"id": f"{action}-INSERT", "action": action, "status": "INSERT_ERROR", "channel": "insert",
               "http": code, "err_body": str(ins)[:200]}
        bmt.save(rec); print(f"  [INSERT {action}] HTTP {code}", flush=True)
        return rec
    st = None; t0 = time.time()
    while time.time() - t0 < poll:
        c = bmt.get_command(cid)
        if c and c.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            st = c; break
        time.sleep(2.5)
    st = st or {"status": "POLL_TIMEOUT"}
    rc = (st.get("receipt") or {}) if isinstance(st.get("receipt"), dict) else {}
    rec = {"id": f"{action}-INSERT", "action": action, "command_id": cid, "status": st.get("status"),
           "channel": "insert", "error": st.get("error"), "result_summary": bmt.summarize(rc.get("result"))}
    if st.get("status") == "COMPLETED" and rc.get("result") is not None:
        rec["_result_full"] = rc.get("result")
    bmt.save(rec)
    print(f"  [INSERT {action}] {rec['status']} err={str(rec.get('error'))[:90]}", flush=True)
    return rec

def find(cap, role=None, name_contains=None, name_exact=None):
    if not cap.get("_result_full"): return None
    for t in (cap["_result_full"].get("semantic_targets") or []):
        if role and t.get("role") != role: continue
        nm = (t.get("name") or "").strip()
        if name_exact is not None and nm != name_exact: continue
        if name_contains is not None and name_contains.lower() not in nm.lower(): continue
        if not t.get("semantic_ref"): continue
        return t
    return None

def names(cap, limit=40):
    if not cap.get("_result_full"): return []
    return [f"{t.get('role')}:{t.get('name')}" for t in (cap["_result_full"].get("semantic_targets") or []) if t.get("name")][:limit]

phase = sys.argv[1] if len(sys.argv) > 1 else "R"
print(f"=== M-PHASE {phase} ===", flush=True)

if phase == "R":
    # readback-gap probe: essay session /c/94fd04de known to contain a long assistant response
    tr = run_test("R01-TR-ESSAY", "READ_TRANSCRIPT", payload={"tab_id": TAB, "limit": 20}, platform=P)
    f = tr.get("_result_full") or {}
    txt = f.get("text") or ""
    print(f"  transcript len={len(txt)}", flush=True)
    print(f"  head: {txt[:250]}", flush=True)
    # does it contain essay-body markers rather than only sidebar labels?
    markers = ["history of computing", "essay", "3000", "mechanics test"]
    hits = [m for m in markers if m.lower() in txt.lower()]
    print(f"  content markers hit: {hits}", flush=True)
    bmt.save({"id": "R01-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "transcript_len": len(txt), "marker_hits": hits,
              "verdict": "READBACK_OK" if len(hits) >= 1 and len(txt) > 1200 else "READBACK_SIDEBAR_ONLY"})
    cap = run_test("R02-CAP", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
    u = (cap.get("_result_full") or {}).get("url", "")
    print(f"  url={u[:100]}", flush=True)
    print(f"  names: {names(cap, 25)}", flush=True)
    bmt.save({"id": "R02-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "url": u, "names": names(cap, 30)})

elif phase == "M":
    # Select-model -> GLM-5.3-Flash (semantic click path, readback after each step)
    cap = run_test("M01-CAP", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
    sel = find(cap, role="button", name_contains="Select")
    if not sel:
        bmt.save({"id": "M-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "select_model_button_not_found", "names": names(cap, 30)})
        print("  ABORT: no Select a model", flush=True); sys.exit(1)
    print(f"  select button: {sel.get('name')}", flush=True)
    time.sleep(20)
    cl = direct_insert("TYPED_CLICK", {"role": "button", "tab_id": TAB,
                       "semantic_ref": sel["semantic_ref"], "accessible_name": sel.get("name") or "Select a model"})
    time.sleep(6)
    cap2 = run_test("M02-CAP-MENU", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
    nm2 = names(cap2, 40)
    print(f"  menu names: {nm2}", flush=True)
    bmt.save({"id": "M02-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "names_after_select_click": nm2})
    target = find(cap2, role="button", name_contains="5.3") or find(cap2, role="menuitem", name_contains="5.3") \
             or find(cap2, role="button", name_contains="Flash") or find(cap2, role="menuitem", name_contains="Flash")
    if not target:
        bmt.save({"id": "M-ABORT2", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "glm53flash_option_not_found", "names": nm2})
        print("  ABORT: GLM-5.3-Flash option not in tree", flush=True); sys.exit(1)
    print(f"  target option: {target.get('role')}:{target.get('name')}", flush=True)
    time.sleep(20)
    cl2 = direct_insert("TYPED_CLICK", {"role": target.get("role") or "button", "tab_id": TAB,
                        "semantic_ref": target["semantic_ref"], "accessible_name": target.get("name") or "GLM-5.3-Flash"})
    time.sleep(6)
    cap3 = run_test("M03-CAP-VERIFY", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
    nm3 = names(cap3, 40)
    model_now = [n for n in nm3 if "GLM" in n.upper() or "Flash" in n]
    print(f"  model markers now: {model_now}", flush=True)
    changed = any("5.3" in n for n in model_now)
    bmt.save({"id": "M03-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "names_after": nm3, "model_markers": model_now,
              "model_selected_53flash": changed,
              "click_receipts": [cl.get("status"), cl2.get("status")]})
    print(f"  MODEL_SELECT_53FLASH={'OK' if changed else 'UNVERIFIED'}", flush=True)

print(f"m-phase {phase} done", flush=True)
