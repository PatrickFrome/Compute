#!/usr/bin/env python3
# u-0800.py — Job 419203 tick 08:00: close "NOT VERIFIED" gaps
# Phases: V=verify+read-only untested, G=gate/self-update/fleet-profile, S=stop-generation flow
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0800.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
CTX = bmt.RESULTS + ".ctx"

def ctx_load():
    try: return json.load(open(CTX))
    except Exception: return {}

def ctx_save(d):
    c = ctx_load(); c.update(d); json.dump(c, open(CTX, "w"))

def direct_insert(action, payload, platform=P, ttl=75, poll=55):
    """Direct INSERT path (TYPED_CLICK and friends — RPC v3 validator broken)."""
    cid = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": action, "platform": platform,
           "payload": payload, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-u0800-{uuid.uuid4().hex[:8]}"}
    code, ins = bmt.rest_insert(row)
    if code not in (200, 201):
        rec = {"id": f"{action}-INSERT", "action": action, "status": "INSERT_ERROR", "channel": "insert",
               "http": code, "err_body": str(ins)[:200]}
        bmt.save(rec); print(f"  [INSERT {action}] HTTP {code}: {str(ins)[:120]}", flush=True)
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
           "channel": "insert", "error": st.get("error"),
           "result_summary": bmt.summarize(rc.get("result"))}
    if st.get("status") == "COMPLETED" and rc.get("result") is not None:
        rec["_result_full"] = rc.get("result")
    bmt.save(rec)
    print(f"  [INSERT {action}] {rec['status']} err={str(rec.get('error'))[:90]}", flush=True)
    return rec

def find(cap, role=None, name_contains=None, name_exact=None, want_ref=True):
    if not cap.get("_result_full"): return None
    for t in (cap["_result_full"].get("semantic_targets") or []):
        if role and t.get("role") != role: continue
        nm = (t.get("name") or "").strip()
        if name_exact is not None and nm != name_exact: continue
        if name_contains is not None and name_contains.lower() not in nm.lower(): continue
        if want_ref and not t.get("semantic_ref"): return None  # unnamed ref-less targets unusable
        return t
    return None

phase = sys.argv[1] if len(sys.argv) > 1 else "V"
print(f"=== U-PHASE {phase} ===", flush=True)

if phase == "V":
    # verify alive + read-only untested mechanics
    run_test("V01-CAPS", "CONTROL_CAPABILITIES")
    run_test("V02-FLEET", "FLEET_STATUS")
    run_test("V03-GATES", "GATE_STATUS")
    run_test("V04-DEVHEALTH", "DEV_PLANE_HEALTH")
    run_test("V05-DEVCAPS", "DEV_PLANE_CAPABILITIES")
    run_test("V06-REPOHEAD", "DEV_PLANE_REPO_HEAD")
    run_test("V07-SEMCENSUS", "SEMANTIC_CENSUS")
    run_test("V08-SEMEVENTS", "SEMANTIC_EVENTS", payload={"limit": 10})

elif phase == "G":
    # SELF_UPDATE_CHECK (mutating, trusted updater)
    run_test("G01-UPDCHECK", "SELF_UPDATE_CHECK", payload={}, mutating=True, timeout=70)
    # FLEET_SET_PROFILE — re-set CURRENT profile (safe no-op intent), verify after
    prof = None
    for r in bmt._results:
        if r.get("id") == "V02-FLEET" and r.get("_result_full"):
            f = r["_result_full"]
            prof = f.get("profile") or (f.get("fleet") or {}).get("profile") if isinstance(f, dict) else None
    prof = prof or "ELASTIC_BACKLOG_DRIVEN"
    print(f"  fleet profile target: {prof}", flush=True)
    run_test("G02-SETPROFILE", "FLEET_SET_PROFILE", payload={"profile": prof}, mutating=True, timeout=60)
    run_test("G03-FLEET-VERIFY", "FLEET_STATUS")
    # GATE_ENABLE — enable a disabled gate if any (then restore), else canonical-error probe
    disabled_gate = None
    for r in bmt._results:
        if r.get("id") == "V03-GATES" and r.get("_result_full"):
            f = r["_result_full"]
            gates = f.get("gates") or f.get("gate_list") or []
            if isinstance(f, dict):
                for g in gates:
                    if isinstance(g, dict) and g.get("enabled") is False and g.get("gate_id"):
                        disabled_gate = g; break
    if disabled_gate:
        gid = disabled_gate["gate_id"]
        print(f"  enabling disabled gate {gid}", flush=True)
        run_test("G04-GATEEN", "GATE_ENABLE", payload={"gate_id": gid}, mutating=True, timeout=50)
        run_test("G05-GATEDIS-RESTORE", "GATE_DISABLE", payload={"gate_id": gid}, mutating=True, timeout=50)
    else:
        print("  no disabled gate found — canonical-error probe", flush=True)
        run_test("G04-GATEEN-PROBE", "GATE_ENABLE", payload={"gate_id": "nonexistent-gate-probe-u0800"}, mutating=True, timeout=50)

elif phase == "S":
    # STOP_GENERATION with active generation + 2nd independent replication of agent-creation recipe
    ctx = ctx_load()
    tab = ctx.get("agent_space_tab") or ctx.get("probe_tab")
    print(f"  target tab: {tab}", flush=True)
    cap = run_test("S01-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    f = cap.get("_result_full") or {}
    url0 = f.get("url", "")
    print(f"  start url={url0[:100]}", flush=True)
    newtask = find(cap, role="button", name_exact="New Task")
    if not newtask:
        # sidebar may be collapsed on a fresh surface — try Toggle Sidebar first
        tg = find(cap, role="button", name_exact="Toggle Sidebar")
        if tg:
            time.sleep(20)
            direct_insert("TYPED_CLICK", {"role": "button", "tab_id": tab,
                          "semantic_ref": tg["semantic_ref"], "accessible_name": "Toggle Sidebar"})
            time.sleep(6)
            cap = run_test("S01b-CAP2", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
            newtask = find(cap, role="button", name_exact="New Task")
    if not newtask:
        bmt.save({"id": "S-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "new_task_button_not_found", "url": url0})
        print("  ABORT: New Task not found", flush=True); sys.exit(1)
    time.sleep(20)
    cl = direct_insert("TYPED_CLICK", {"role": "button", "tab_id": tab,
                       "semantic_ref": newtask["semantic_ref"], "accessible_name": "New Task"})
    time.sleep(8)
    cap2 = run_test("S02-CAP-FRESH", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    f2 = cap2.get("_result_full") or {}
    url1 = f2.get("url", "")
    print(f"  fresh url={url1[:100]} new_conversation={'/c/' not in url1}", flush=True)
    tb = find(cap2, role="textbox", name_contains="Message") or find(cap2, role="textbox")
    if not tb:
        bmt.save({"id": "S-ABORT2", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "no_textbox_on_fresh_surface", "url": url1})
        print("  ABORT: no textbox", flush=True); sys.exit(1)
    print(f"  textbox: name={tb.get('name')}", flush=True)
    st = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": ("Write a very long essay (at least 3000 words) about the history of computing. "
                   "Do not stop early. This is a mechanics test of the stop-generation control."),
          "submit_after_type": True, "replace_existing": False}
    r = run_test("S03-TYPE-SUBMIT", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    rs = r.get("result_summary") or {}
    print(f"  type receipt: effect={rs.get('effect_state')}", flush=True)
    time.sleep(14)
    cap3 = run_test("S04-CAP-GEN", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    url2 = (cap3.get("_result_full") or {}).get("url", "")
    generating = "/c/" in url2
    print(f"  generating url={url2[:100]}", flush=True)
    stop = find(cap3, role="button", name_contains="stop")
    print(f"  stop button found: {bool(stop)} name={stop.get('name') if stop else None}", flush=True)
    if stop:
        pl = {"tab_id": tab, "role": "button", "semantic_ref": stop["semantic_ref"],
              "accessible_name": stop.get("name") or "stop"}
        run_test("S05-STOPGEN", "STOP_GENERATION", payload=pl, platform=P, mutating=True, timeout=50)
    else:
        # canonical-error record: no named stop target
        run_test("S05-STOPGEN-NOTARGET", "STOP_GENERATION", payload={"tab_id": tab}, platform=P, mutating=True, timeout=50)
    time.sleep(4)
    cap4 = run_test("S06-CAP-POSTSTOP", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    stop_after = find(cap4, role="button", name_contains="stop")
    tr = run_test("S07-TRANSCRIPT", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 6}, platform=P)
    trtxt = ((tr.get("_result_full") or {}).get("text") or "")
    bmt.save({"id": "S07-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "url_before": url1, "url_generating": url2,
              "new_conversation_created": "/c/" in url2 and "/c/" not in url1,
              "stop_btn_before": bool(stop), "stop_btn_after": bool(stop_after),
              "type_effect": rs.get("effect_state"),
              "transcript_len": len(trtxt), "transcript_head": trtxt[:200]})

print(f"u-phase {phase} done", flush=True)
