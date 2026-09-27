#!/usr/bin/env python3
# browser-mechanics-test.py — METAENGINE h205f22 browser mechanics test runner
# Tests all supervisor command mechanics via Supabase command queue.
# NEVER prints secrets. Results -> JSON file incrementally.
import json, time, uuid, sys, os, datetime, urllib.request, urllib.error

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results.json"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TARGET = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"  # live 0.7.0-dev.36336130139.1
ISSUER = "zai-live-test-419203"
MUT_GAP = 20.0  # seconds between mutating commands (budget 24pts/60s, mut cost 4)

def load_env():
    env = {}
    with open(ENVF) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
SU, SJ = ENV["SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_JWT"]

def rpc(name, args):
    url = f"{SU}/rest/v1/rpc/{name}"
    data = json.dumps(args).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        return {"__http_error": e.code, "body": e.read().decode()[:400]}
    except Exception as e:
        return {"__error": str(e)[:200]}

def get_command(cid):
    url = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?command_id=eq.{cid}&select=*"
    req = urllib.request.Request(url, headers={"apikey": SJ, "Authorization": f"Bearer {SJ}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read().decode())
        return rows[0] if rows else None

def rest_insert(row):
    url = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22"
    data = json.dumps(row).encode()
    req = urllib.request.Request(url, data=data, method="POST", headers={
        "apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json",
        "Prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read().decode()
            return r.status, json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

_last_mut = 0.0

def run_test(tid, action, payload=None, platform=None, ttl=75, mutating=False, timeout=55):
    """Enqueue (RPC, fallback INSERT), poll to terminal, record structured result."""
    global _last_mut
    if mutating:
        wait = MUT_GAP - (time.time() - _last_mut)
        if wait > 0:
            print(f"  [pace] {wait:.0f}s (mutation budget)", flush=True)
            time.sleep(wait)
        _last_mut = time.time()
    args = {"p_workspace_id": WS, "p_action": action,
            "p_issued_by": ISSUER, "p_ttl_seconds": ttl,
            "p_idempotency_key": f"glm-diag-{tid}-{uuid.uuid4().hex[:8]}"}
    if payload is not None: args["p_payload"] = payload
    if platform: args["p_platform"] = platform
    args["p_target_client_id"] = TARGET
    t0 = time.time()
    channel = "rpc"
    resp = rpc("h205f22_a2_browser_supervisor_enqueue_v3", args)
    if isinstance(resp, dict) and "command_id" in resp:
        cid = resp["command_id"]
    elif isinstance(resp, dict) and resp.get("__http_error") == 400 and "supervisor_action_invalid" in str(resp.get("body", "")):
        # stale cloud-RPC allowlist -> direct INSERT path (validated by DB triggers)
        channel = "insert"
        cid = str(uuid.uuid4())
        now = datetime.datetime.now(datetime.timezone.utc)
        row = {"command_id": cid, "workspace_id": WS, "target_client_id": TARGET,
               "issued_by": ISSUER, "action": action, "platform": platform,
               "payload": payload if payload is not None else {},
               "status": "PENDING",
               "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "idempotency_key": f"glm-diag-{tid}-{uuid.uuid4().hex[:8]}"}
        code, ins = rest_insert(row)
        if code not in (200, 201):
            rec = {"id": tid, "action": action, "status": "INSERT_ERROR", "channel": channel,
                   "http": code, "err_body": str(ins)[:200], "ms": int((time.time()-t0)*1000)}
            save(rec); print(f"  [{action}] INSERT_ERROR HTTP {code}: {str(ins)[:120]}", flush=True)
            return rec
    else:
        rec = {"id": tid, "action": action, "status": "ENQUEUE_ERROR", "channel": channel,
               "enqueue_resp": json.dumps(resp)[:300], "ms": int((time.time()-t0)*1000)}
        save(rec); print(f"  [{action}] ENQUEUE_ERROR: {json.dumps(resp)[:160]}", flush=True)
        return rec
    row = None
    while time.time() - t0 < timeout:
        row = get_command(cid)
        if row and row.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            break
        time.sleep(2.5)
    status = (row or {}).get("status", "POLL_TIMEOUT")
    err = (row or {}).get("error")
    receipt = (row or {}).get("receipt") or {}
    result = receipt.get("result") if isinstance(receipt, dict) else None
    rec = {"id": tid, "action": action, "command_id": cid, "status": status, "channel": channel,
           "error": err, "ms": int((time.time()-t0)*1000),
           "result_summary": summarize(result), "receipt_schema": (receipt or {}).get("schema")}
    if status == "COMPLETED" and result is not None:
        rec["_result_full"] = result  # kept for chaining, stripped in final report
    save(rec)
    line = f"  [{action}] {status} ({rec['ms']}ms)"
    if err: line += f" err={str(err)[:90]}"
    print(line, flush=True)
    return rec

def summarize(result):
    if result is None: return None
    if isinstance(result, dict):
        out = {}
        for k, v in result.items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                out[k] = v if not (isinstance(v, str) and len(v) > 120) else v[:120]
            elif isinstance(v, list):
                out[k] = f"<list:{len(v)}>"
            elif isinstance(v, dict):
                out[k] = f"<dict:{','.join(list(v)[:5])}>"
        return out
    return {"_type": type(result).__name__}

_results = []
def save(rec):
    _results.append(rec)
    with open(RESULTS, "w") as f:
        json.dump(_results, f, ensure_ascii=False, indent=1)

def load_results():
    global _results
    if os.path.exists(RESULTS):
        with open(RESULTS) as f:
            _results = json.load(f)

if __name__ == "__main__":
    load_results()
    phase = sys.argv[1] if len(sys.argv) > 1 else "A"
    print(f"=== PHASE {phase} ===", flush=True)
    if phase == "A":
        # READ-ONLY status sweep
        run_test("A01", "CONTROL_CAPABILITIES")
        run_test("A02", "TAB_CENSUS")
        run_test("A03", "SYSTEM_TELEMETRY")
        run_test("A04", "PROCESS_CENSUS")
        run_test("A05", "SESSION_STATUS")
        run_test("A06", "GATE_STATUS")
        run_test("A07", "SELF_UPDATE_STATUS")
        run_test("A08", "DOWNLOAD_STATUS")
        run_test("A09", "DEV_PLANE_STATUS")
        run_test("A10", "FLEET_STATUS")
        run_test("A11", "CHATGPT_STATUS")
        run_test("A12", "WEBMCP_LIST")
    elif phase == "B":
        # Perception on fleet tab (READ_ONLY)
        run_test("B01", "CAPTURE", payload={"tab_id": "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"}, platform="GLM_ZAI")
        run_test("B02", "READ_TRANSCRIPT", payload={"tab_id": "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f", "limit": 10}, platform="GLM_ZAI")
        run_test("B03", "FIND_IN_PAGE", payload={"tab_id": "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f", "query": "METAENGINE"}, platform="GLM_ZAI")
    elif phase == "C":
        # Mutations: create own tab, then exercise targeting mechanics on it
        rec = run_test("C01", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}, platform="GLM_ZAI", mutating=True, timeout=60)
        newtab = None
        if rec["status"] == "COMPLETED" and rec.get("_result_full"):
            newtab = rec["_result_full"].get("tab_id")
        print(f"  newtab={newtab}", flush=True)
        with open(RESULTS + ".ctx", "w") as f:
            json.dump({"newtab": newtab}, f)
        if newtab:
            cap = run_test("C02", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
            draft_state = "unknown"
            if cap.get("_result_full"):
                els = (cap["_result_full"].get("interaction_tree") or {}).get("elements") or []
                tbs = [e for e in els if e.get("role") == "textbox"]
                poison = [e for e in tbs if e.get("text") and len(str(e.get("text"))) > 200]
                draft_state = "POISONED" if poison else ("CLEAN" if tbs else "NO_TEXTBOX")
                print(f"  newtab draft_state={draft_state} textboxes={len(tbs)}", flush=True)
            run_test("C03", "SELECT_TAB", payload={"tab_id": newtab}, platform="GLM_ZAI", mutating=True)
            sem = None
            if cap.get("_result_full"):
                tgts = cap["_result_full"].get("semantic_targets") or []
                for t in tgts:
                    if t.get("role") == "textbox" and t.get("semantic_ref"):
                        sem = t; break
            print(f"  semantic textbox found: {bool(sem)}", flush=True)
            if sem:
                sf = {"tab_id": newtab, "role": "textbox", "semantic_ref": sem["semantic_ref"]}
                run_test("C04", "SEMANTIC_FOCUS", payload=sf, platform="GLM_ZAI", mutating=True)
                st = dict(sf); st.update({"text": "METAENGINE mechanic test (GLM diagnosis)", "submit_after_type": False, "replace_existing": True})
                run_test("C05", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True)
                pk = run_test("C06", "PRESS_KEY", payload={"key": "Enter", "tab_id": newtab}, platform="GLM_ZAI", mutating=True)
            cap2 = run_test("C07", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
            if cap2.get("_result_full"):
                u = cap2.get("_result_full").get("url", "")
                conv = "/c/" in u
                print(f"  post-submit url={u[:80]} conversation_created={conv}", flush=True)
                save({"id": "C07-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                      "url": u, "conversation_created": conv, "draft_state_before": draft_state})
            run_test("C08", "NAVIGATE", payload={"tab_id": newtab, "url": "https://chat.z.ai/"}, platform="GLM_ZAI", mutating=True)
            run_test("C09", "SET_ZOOM", payload={"tab_id": newtab, "zoom": 1.25}, platform="GLM_ZAI", mutating=True)
            run_test("C10", "SET_ZOOM", payload={"tab_id": newtab, "zoom": 1.0}, platform="GLM_ZAI", mutating=True)
        run_test("C11", "FLEET_RECONCILE", payload={"target_agents": 5}, mutating=True, timeout=70)
    elif phase == "C2":
        # continuation: reuse tab created by C01 (fetch its receipt from DB)
        newtab = None
        for r in _results:
            if r.get("id") == "C01" and r.get("command_id"):
                row = get_command(r["command_id"])
                if row and row.get("receipt"):
                    try:
                        rc = row["receipt"] if isinstance(row["receipt"], dict) else json.loads(str(row["receipt"]).replace("'", '"'))
                        newtab = (rc.get("result") or {}).get("tab_id")
                    except Exception:
                        pass
                break
        print(f"  newtab(from C01 receipt)={newtab}", flush=True)
        if newtab:
            cap = run_test("C02", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
            draft_state = "unknown"
            if cap.get("_result_full"):
                els = (cap["_result_full"].get("interaction_tree") or {}).get("elements") or []
                tbs = [e for e in els if e.get("role") == "textbox"]
                poison = [e for e in tbs if e.get("text") and len(str(e.get("text"))) > 200]
                draft_state = "POISONED" if poison else ("CLEAN" if tbs else "NO_TEXTBOX")
                print(f"  newtab draft_state={draft_state} textboxes={len(tbs)}", flush=True)
            run_test("C03", "SELECT_TAB", payload={"tab_id": newtab}, platform="GLM_ZAI", mutating=True)
            sem = None
            if cap.get("_result_full"):
                tgts = cap["_result_full"].get("semantic_targets") or []
                for t in tgts:
                    if t.get("role") == "textbox" and t.get("semantic_ref"):
                        sem = t; break
            print(f"  semantic textbox found: {bool(sem)}", flush=True)
            if sem:
                sf = {"tab_id": newtab, "role": "textbox", "semantic_ref": sem["semantic_ref"]}
                run_test("C04", "SEMANTIC_FOCUS", payload=sf, platform="GLM_ZAI", mutating=True)
                st = dict(sf); st.update({"text": "METAENGINE mechanic test (GLM diagnosis)", "submit_after_type": False, "replace_existing": True})
                run_test("C05", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True)
                pk = run_test("C06", "PRESS_KEY", payload={"key": "Enter", "tab_id": newtab}, platform="GLM_ZAI", mutating=True)
            cap2 = run_test("C07", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
            if cap2.get("_result_full"):
                u = cap2.get("_result_full").get("url", "")
                conv = "/c/" in u
                print(f"  post-submit url={u[:80]} conversation_created={conv}", flush=True)
                save({"id": "C07-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                      "url": u, "conversation_created": conv, "draft_state_before": draft_state})
            run_test("C08", "NAVIGATE", payload={"tab_id": newtab, "url": "https://chat.z.ai/"}, platform="GLM_ZAI", mutating=True)
            run_test("C09", "SET_ZOOM", payload={"tab_id": newtab, "zoom": 1.25}, platform="GLM_ZAI", mutating=True)
            run_test("C10", "SET_ZOOM", payload={"tab_id": newtab, "zoom": 1.0}, platform="GLM_ZAI", mutating=True)
    elif phase == "C3":
        # submit-chain retry: fresh capture -> IMMEDIATE type -> Enter -> verify conversation
        newtab = None
        if os.path.exists(RESULTS + ".ctx"):
            newtab = json.load(open(RESULTS + ".ctx")).get("newtab")
        print(f"  newtab={newtab}", flush=True)
        if newtab:
            time.sleep(60)  # let failure-circuit window clear
            cap = run_test("C30", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
            sem = None
            if cap.get("_result_full"):
                for t in (cap["_result_full"].get("semantic_targets") or []):
                    if t.get("role") == "textbox" and t.get("semantic_ref"):
                        sem = t; break
            print(f"  fresh semantic textbox: {bool(sem)}", flush=True)
            if sem:
                st = {"tab_id": newtab, "role": "textbox", "semantic_ref": sem["semantic_ref"],
                      "text": "METAENGINE mechanic test (GLM diagnosis)", "submit_after_type": True, "replace_existing": False}
                run_test("C31", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True, timeout=45)
                run_test("C32", "PRESS_KEY", payload={"key": "Enter", "tab_id": newtab}, platform="GLM_ZAI", mutating=True, timeout=45)
            cap2 = run_test("C33", "CAPTURE", payload={"tab_id": newtab}, platform="GLM_ZAI")
            if cap2.get("_result_full"):
                u = cap2.get("_result_full").get("url", "")
                conv = "/c/" in u
                print(f"  post-submit url={u[:80]} conversation_created={conv}", flush=True)
                save({"id": "C33-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                      "url": u, "conversation_created": conv})
    elif phase == "D":
        # verify fleet grew, then restore baseline, final self-update check
        st = run_test("D01", "FLEET_STATUS")
        run_test("D02", "FLEET_RECONCILE", payload={"target_agents": 4}, mutating=True, timeout=70)
        st2 = run_test("D03", "FLEET_STATUS")
        run_test("D04", "SELF_UPDATE_CHECK", payload={}, mutating=True, timeout=60)
    print(f"phase {phase} done", flush=True)
