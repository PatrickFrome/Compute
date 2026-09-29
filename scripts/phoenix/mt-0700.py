#!/usr/bin/env python3
# mt-0700.py — fresh full mechanics test cycle (job 419203, 2026-09-28 ~07:00)
# Phases: R=read-only sweep, M=mutation basics, S=stop-generation, A=agent-tab flow,
#         F=supervisor/fleet, X=expected-broken re-verify
import importlib.util, sys, json, time, uuid, datetime

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
CTX = bmt.RESULTS + ".ctx"

def ctx_load():
    try: return json.load(open(CTX))
    except Exception: return {}

def ctx_save(d):
    c = ctx_load(); c.update(d); json.dump(c, open(CTX, "w"))

def find_target(cap, role=None, name=None, want_ref=True):
    if not cap.get("_result_full"): return None
    for t in (cap["_result_full"].get("semantic_targets") or []):
        if role and t.get("role") != role: continue
        if name is not None and t.get("name") != name: continue
        if want_ref and not t.get("semantic_ref"): continue
        return t
    return None

def direct_insert(action, payload, platform=P, ttl=75):
    """Direct INSERT path (for actions whose RPC v3 validator is broken, e.g. TYPED_CLICK)."""
    cid = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": action, "platform": platform,
           "payload": payload, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-mt0700-{uuid.uuid4().hex[:8]}"}
    code, ins = bmt.rest_insert(row)
    if code not in (200, 201):
        rec = {"id": f"{action}-INSERT", "action": action, "status": "INSERT_ERROR", "channel": "insert",
               "http": code, "err_body": str(ins)[:200]}
        bmt.save(rec); print(f"  [INSERT {action}] HTTP {code}: {str(ins)[:120]}", flush=True)
        return rec
    st = None
    t0 = time.time()
    while time.time() - t0 < 55:
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

def names_of(cap, limit=40):
    if not cap.get("_result_full"): return []
    out = []
    for t in (cap["_result_full"].get("semantic_targets") or []):
        nm = t.get("name")
        if nm: out.append(f"{t.get('role')}:{nm}")
    return out[:limit]

phase = sys.argv[1] if len(sys.argv) > 1 else "R"
print(f"=== PHASE {phase} ===", flush=True)

if phase == "R":
    # 1) read-only sweep — no budget pressure
    run_test("R01-CAPS", "CONTROL_CAPABILITIES")
    run_test("R02-TABCENSUS", "TAB_CENSUS")
    run_test("R03-FLEET", "FLEET_STATUS")
    run_test("R04-GATES", "GATE_STATUS")
    run_test("R05-SYS", "SYSTEM_TELEMETRY")
    run_test("R06-PROC", "PROCESS_CENSUS")
    run_test("R07-UPD", "SELF_UPDATE_STATUS")
    run_test("R08-DL", "DOWNLOAD_STATUS")
    run_test("R09-DEVPLANE", "DEV_PLANE_STATUS")
    run_test("R10-LAT", "CONTROL_LATENCY_STATUS")
    run_test("R11-SESSION", "SESSION_STATUS")   # expected 23514
    run_test("R12-WEBMCP", "WEBMCP_LIST")        # expected 23514
    run_test("R13-CHATGPT", "CHATGPT_STATUS")    # expected 23514

elif phase == "M":
    # 2) mutation basics on a fresh probe tab
    nt = run_test("M01-NEWTAB", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"},
                  platform=P, mutating=True, timeout=60)
    tab = None
    if nt.get("status") == "COMPLETED" and nt.get("_result_full"):
        tab = nt["_result_full"].get("tab_id")
    print(f"  probe tab={tab}", flush=True)
    ctx_save({"probe_tab": tab})
    if not tab:
        print("  abort M: no tab", flush=True); sys.exit(1)
    time.sleep(5)
    cap = run_test("M02-CAPTURE", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    sem = find_target(cap, role="textbox")
    print(f"  textbox semref: {bool(sem)}", flush=True)
    # conversation-creation recipe (canonical, 3rd confirmation)
    if sem:
        st = {"tab_id": tab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
              "text": "MT0700 mechanics probe: reply with a single word ACK.",
              "submit_after_type": True, "replace_existing": True}
        run_test("M03-TYPESUBMIT", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    time.sleep(6)
    cap2 = run_test("M04-CAPTURE2", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    url = (cap2.get("_result_full") or {}).get("url", "")
    conv = "/c/" in url
    print(f"  post-submit url={url[:80]} conversation_created={conv}", flush=True)
    bmt.save({"id": "M04-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "url": url, "conversation_created": conv})
    # navigation family
    run_test("M05-NAVIGATE", "NAVIGATE", payload={"tab_id": tab, "url": "https://chat.z.ai/"}, platform=P, mutating=True)
    run_test("M06-RELOAD", "RELOAD", payload={"tab_id": tab}, platform=P, mutating=True)
    run_test("M07-BACK", "BACK", payload={"tab_id": tab}, platform=P, mutating=True)
    run_test("M08-FORWARD", "FORWARD", payload={"tab_id": tab}, platform=P, mutating=True)
    run_test("M09-SCROLL", "SCROLL", payload={"tab_id": tab, "delta_y": 400}, platform=P, mutating=True)
    run_test("M10-SELECT", "SELECT_TAB", payload={"tab_id": tab}, platform=P, mutating=True)
    run_test("M11-READTR", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 5}, platform=P)
    run_test("M12-FIND", "FIND_IN_PAGE", payload={"tab_id": tab, "query": "ACK"}, platform=P)  # expected 23514
    run_test("M13-ZOOM", "SET_ZOOM", payload={"tab_id": tab, "zoom": 1.1}, platform=P, mutating=True)  # expected 23514
    # TYPED_CLICK via INSERT on a named button (send button or any stable button)
    cap3 = run_test("M14-CAPTURE3", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    btn = find_target(cap3, role="button")  # first named button with ref
    if btn:
        print(f"  click target: {btn.get('role')}:{btn.get('name')}", flush=True)
        pl = {"role": "button", "tab_id": tab, "semantic_ref": btn["semantic_ref"],
              "accessible_name": btn.get("name") or ""}
        direct_insert("TYPED_CLICK", pl)
    else:
        print("  no button semref found for TYPED_CLICK test", flush=True)

elif phase == "S":
    # 3) STOP_GENERATION: start a generation then stop it via stop-button semref
    tab = ctx_load().get("probe_tab")
    if not tab:
        print("  abort S: no probe tab", flush=True); sys.exit(1)
    cap = run_test("S01-CAPTURE", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    sem = find_target(cap, role="textbox")
    if not sem:
        print("  abort S: no textbox", flush=True); sys.exit(1)
    st = {"tab_id": tab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
          "text": "Write a very long essay about the history of computing, at least 3000 words. Do not stop early.",
          "submit_after_type": True, "replace_existing": True}
    run_test("S02-TYPEGEN", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    time.sleep(12)  # let generation start
    cap2 = run_test("S03-CAPTURE-GEN", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    stop = None
    for t in (cap2.get("_result_full") or {}).get("semantic_targets") or []:
        nm = (t.get("name") or "")
        if t.get("role") == "button" and ("stop" in nm.lower() or "стоп" in nm.lower()) and t.get("semantic_ref"):
            stop = t; break
    print(f"  stop button found: {bool(stop)} name={stop.get('name') if stop else None}", flush=True)
    if stop:
        pl = {"tab_id": tab, "role": "button", "semantic_ref": stop["semantic_ref"],
              "accessible_name": stop.get("name") or "stop"}
        run_test("S04-STOPGEN", "STOP_GENERATION", payload=pl, platform=P, mutating=True, timeout=45)
    else:
        # try no-semref variant to record canonical error
        run_test("S04-STOPGEN", "STOP_GENERATION", payload={"tab_id": tab}, platform=P, mutating=True, timeout=45)
    time.sleep(4)
    cap3 = run_test("S05-CAPTURE-POST", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    tr = run_test("S06-TRANSCRIPT", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 4}, platform=P)
    bmt.save({"id": "S06-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "stop_btn_found": bool(stop),
              "transcript_len": len(json.dumps(tr.get("_result_full") or {}))})

elif phase == "A":
    # 4) Agent-tab flow: Agent button -> New Task -> modal -> create
    tab = ctx_load().get("probe_tab")
    if not tab:
        print("  abort A: no probe tab", flush=True); sys.exit(1)
    cap = run_test("A01-CAPTURE", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    agent_btn = None
    for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
        if t.get("role") == "button" and (t.get("name") or "").strip() == "Agent" and t.get("semantic_ref"):
            agent_btn = t; break
    print(f"  Agent button semref: {bool(agent_btn)}", flush=True)
    if not agent_btn:
        print("  abort A", flush=True); sys.exit(1)
    pl = {"role": "button", "tab_id": tab, "semantic_ref": agent_btn["semantic_ref"], "accessible_name": "Agent"}
    direct_insert("TYPED_CLICK", pl)
    time.sleep(8)
    cap2 = run_test("A02-CAP-AGENT", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    print(f"  agent-space names: {names_of(cap2)}", flush=True)
    newtask = None
    for t in (cap2.get("_result_full") or {}).get("semantic_targets") or []:
        nm = (t.get("name") or "").strip().lower()
        if t.get("role") == "button" and ("new task" in nm or nm == "new" or "new" == nm.split()[0] if nm else False) and t.get("semantic_ref"):
            newtask = t; break
    if not newtask:
        # fallback: any button whose name contains 'new'
        for t in (cap2.get("_result_full") or {}).get("semantic_targets") or []:
            nm = (t.get("name") or "").lower()
            if t.get("role") == "button" and "new" in nm and t.get("semantic_ref"):
                newtask = t; break
    print(f"  New Task button: {bool(newtask)} name={newtask.get('name') if newtask else None}", flush=True)
    if not newtask:
        bmt.save({"id": "A02-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "agent_space_reached": True, "new_task_found": False, "names": names_of(cap2)})
        print("  abort A: New Task not found", flush=True); sys.exit(1)
    pl2 = {"role": "button", "tab_id": tab, "semantic_ref": newtask["semantic_ref"],
           "accessible_name": newtask.get("name") or "New Task"}
    direct_insert("TYPED_CLICK", pl2)
    time.sleep(7)
    cap3 = run_test("A03-CAP-MODAL", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    tbs = []
    for t in (cap3.get("_result_full") or {}).get("semantic_targets") or []:
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            tbs.append(t)
    print(f"  modal textboxes: {len(tbs)} names={[t.get('name') for t in tbs]}", flush=True)
    print(f"  modal buttons: {names_of(cap3)}", flush=True)
    if not tbs:
        bmt.save({"id": "A03-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "modal_opened": True, "textboxes": 0, "names": names_of(cap3)})
        print("  abort A: no textbox in modal", flush=True); sys.exit(1)
    tb = tbs[0]
    brief = ("Build a self-improving swarm task board: a single HTML page listing tasks for our agent swarm. "
             "GLM-5.3-Flash agents pick tasks, mark progress, and add new tasks. Start now and keep iterating autonomously.")
    st = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": brief, "submit_after_type": True, "replace_existing": True}
    run_test("A04-TYPE-MODAL", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    time.sleep(8)
    cap4 = run_test("A05-CAP-POST", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    url = (cap4.get("_result_full") or {}).get("url", "")
    print(f"  post-submit url={url[:100]}", flush=True)
    print(f"  post names: {names_of(cap4)}", flush=True)
    bmt.save({"id": "A05-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "url": url, "names": names_of(cap4)[:30],
              "modal_textboxes": len(tbs)})

elif phase == "F":
    # 5) supervisor/fleet mechanics
    run_test("F01-SUPMODE", "SET_SUPERVISOR_MODE", payload={"mode": "CONTROL"}, mutating=True, timeout=75)
    run_test("F02-RECONCILE", "FLEET_RECONCILE", payload={"target_agents": 4}, mutating=True, timeout=70)
    run_test("F03-FLEET", "FLEET_STATUS")
    run_test("F04-GATEDIS", "GATE_DISABLE", payload={"gate_id": "nonexistent-gate-probe"}, mutating=True, timeout=45)  # expected id_invalid
    run_test("F05-UPDCHECK", "SELF_UPDATE_CHECK", payload={}, mutating=True, timeout=60)
    run_test("F06-DEVHEALTH", "DEV_PLANE_HEALTH")
    run_test("F07-DEVCAPS", "DEV_PLANE_CAPABILITIES")
    run_test("F08-REPOHEAD", "DEV_PLANE_REPO_HEAD")
    run_test("F09-SEMROLL", "SEMANTIC_CENSUS")

elif phase == "X":
    # 6) expected-broken: TYPED_CLICK via RPC validator + DOWNLOAD_FILE + DISARM probe (constitution, expect reject)
    tab = ctx_load().get("probe_tab")
    if tab:
        run_test("X01-CLICKRPC", "TYPED_CLICK", payload={"role": "button", "tab_id": tab, "accessible_name": "Agent"},
                 platform=P, mutating=True, timeout=45)
    run_test("X02-DLFILE", "DOWNLOAD_FILE", payload={"url": "https://example.com/f.bin",
              "filename": "f.bin", "sha256": "0" * 64}, mutating=True, timeout=45)
    run_test("X03-WEBMCPINVOKE", "WEBMCP_INVOKE", payload={"tool": "probe"}, mutating=True, timeout=45)
    run_test("X04-POINTER", "POINTER_CLICK", payload={"tab_id": tab, "x": 10, "y": 10}, platform=P, mutating=True, timeout=45)

print(f"phase {phase} done", flush=True)
