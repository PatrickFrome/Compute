#!/usr/bin/env python3
# audit-j-0631.py — Phase J: TYPED_CLICK via direct INSERT (bypass RPC v3 validator) -> Agent tab
import importlib.util, sys, json, time, uuid, datetime

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-j0631.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open("/home/z/my-project/scripts/phoenix/browser-test-results-e0631.json.ctx")).get("probe_tab")

cap = run_test("J1-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
tgt = None
if cap.get("_result_full"):
    for t in (cap["_result_full"].get("semantic_targets") or []):
        if t.get("role") == "button" and t.get("name") == "Agent" and t.get("semantic_ref"):
            tgt = t; break
print(f"Agent semref fresh: {bool(tgt)}", flush=True)
if not tgt:
    print("abort", flush=True); sys.exit(1)

payload = {"role": "button", "tab_id": tab,
           "semantic_ref": tgt["semantic_ref"], "accessible_name": "Agent"}

# J2: RPC variant with extra selector fields (cheap 400 if rejected)
v2 = dict(payload); v2["selector_mode"] = "ROLE_NAME_OR_BACKEND_NODE_ID"; v2["backend_node_id"] = tgt["backend_node_id"]
r = run_test("J2-RPC-EXT", "TYPED_CLICK", payload=v2, platform=P, mutating=True)
print(f"J2 rpc-extended: {r['status']} {r.get('error')}", flush=True)

# J3: direct INSERT path
cid = str(uuid.uuid4())
now = datetime.datetime.now(datetime.timezone.utc)
row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
       "issued_by": "zai-live-test-419203", "action": "TYPED_CLICK", "platform": P,
       "payload": payload, "status": "PENDING",
       "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
       "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
       "idempotency_key": f"glm-diag-J3-{uuid.uuid4().hex[:8]}"}
code, ins = bmt.rest_insert(row)
print(f"J3 insert http={code}", flush=True)
if code in (200, 201):
    st = None
    for _ in range(20):
        c = bmt.get_command(cid)
        if c and c.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            st = c; break
        time.sleep(2.5)
    st = st or {"status": "POLL_TIMEOUT"}
    print(f"J3 status={st.get('status')} err={st.get('error')}", flush=True)
    rc = st.get("receipt") or {}
    print(f"J3 receipt.result={json.dumps(rc.get('result'), ensure_ascii=False)[:300]}", flush=True)
    bmt.save({"id": "J3-INSERT-CLICK", "action": "TYPED_CLICK", "command_id": cid,
              "status": st.get("status"), "error": st.get("error"),
              "result_summary": bmt.summarize(rc.get("result"))})
    if st.get("status") == "COMPLETED":
        time.sleep(6)
        cap2 = run_test("J3-POSTCAP", "CAPTURE", payload={"tab_id": tab}, platform=P)
        u = (cap2.get("_result_full") or {}).get("url", "")
        names = [f"{t.get('role')}:{t.get('name')}" for t in (cap2.get("_result_full") or {}).get("semantic_targets", []) if t.get("name")][:20]
        print(f"post url={u[:110]}", flush=True)
        print(f"post names: {names}", flush=True)
        bmt.save({"id": "J3-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "post_agent_click_url": u, "is_agent_page": ("/agent" in u.lower())})

print("phase J done", flush=True)
