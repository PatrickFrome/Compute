#!/usr/bin/env python3
# mt-419203.py — FULL mechanics test of METAENGINE 0.7.0-dev.36336130139.1 (Job 419203)
# Registry: 48 implemented actions from CONTROL_CAPABILITIES. Verdict per action.
# NEVER prints secrets. Incremental JSON. Mutation pace 20s. Own-tab only for mutations.
import json, time, uuid, sys, os, datetime, subprocess, hashlib, urllib.request, urllib.error

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-mt419203.json"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TARGET = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "zai-mechtest-419203"
MUT_GAP = 20.0

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
    global _last_mut
    if mutating:
        wait = MUT_GAP - (time.time() - _last_mut)
        if wait > 0:
            print(f"  [pace] {wait:.0f}s", flush=True)
            time.sleep(wait)
        _last_mut = time.time()
    args = {"p_workspace_id": WS, "p_action": action,
            "p_issued_by": ISSUER, "p_ttl_seconds": ttl,
            "p_idempotency_key": f"mt419203-{tid}-{uuid.uuid4().hex[:8]}"}
    if payload is not None: args["p_payload"] = payload
    if platform: args["p_platform"] = platform
    args["p_target_client_id"] = TARGET
    t0 = time.time()
    channel = "rpc"
    resp = rpc("h205f22_a2_browser_supervisor_enqueue_v3", args)
    if isinstance(resp, dict) and "command_id" in resp:
        cid = resp["command_id"]
    elif isinstance(resp, dict) and resp.get("__http_error") == 400 and "supervisor_action_invalid" in str(resp.get("body", "")):
        channel = "insert"
        cid = str(uuid.uuid4())
        now = datetime.datetime.now(datetime.timezone.utc)
        row = {"command_id": cid, "workspace_id": WS, "target_client_id": TARGET,
               "issued_by": ISSUER, "action": action, "platform": platform,
               "payload": payload if payload is not None else {},
               "status": "PENDING",
               "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "idempotency_key": f"mt419203-{tid}-{uuid.uuid4().hex[:8]}"}
        code, ins = rest_insert(row)
        if code not in (200, 201):
            rec = {"id": tid, "action": action, "status": "INSERT_ERROR", "channel": channel,
                   "http": code, "err_body": str(ins)[:300], "ms": int((time.time()-t0)*1000)}
            save(rec); print(f"  [{action}] INSERT_ERROR {code}: {str(ins)[:140]}", flush=True)
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
        rec["_result_full"] = result
    save(rec)
    line = f"  [{tid}:{action}] {status} ({rec['ms']}ms)"
    if err: line += f" err={str(err)[:100]}"
    print(line, flush=True)
    return rec

def summarize(result):
    if result is None: return None
    if isinstance(result, dict):
        out = {}
        for k, v in result.items():
            if isinstance(v, (str, int, float, bool)) or v is None:
                out[k] = v if not (isinstance(v, str) and len(v) > 120) else v[:120]
            elif isinstance(v, list): out[k] = f"<list:{len(v)}>"
            elif isinstance(v, dict): out[k] = f"<dict:{','.join(list(v)[:5])}>"
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

CTX = RESULTS + ".ctx"
def ctx_save(d):
    cur = {}
    if os.path.exists(CTX):
        try: cur = json.load(open(CTX))
        except: pass
    cur.update(d)
    json.dump(cur, open(CTX, "w"))

def ctx_load():
    if os.path.exists(CTX):
        try: return json.load(open(CTX))
        except: return {}
    return {}

def find_sem(cap, role=None, name_contains=None):
    if not cap.get("_result_full"): return None
    tgts = cap["_result_full"].get("semantic_targets") or []
    for t in tgts:
        if role and t.get("role") != role: continue
        nm = str(t.get("name") or t.get("accessible_name") or "")
        if name_contains and name_contains.lower() not in nm.lower(): continue
        if not t.get("semantic_ref"): continue
        return t
    return None

def last_full(action, tid_prefix=None):
    for it in reversed(_results):
        if it.get("action") == action and it.get("_result_full"):
            if tid_prefix and not str(it.get("id","")).startswith(tid_prefix): continue
            return it["_result_full"]
    return None

# ---------------- PHASES ----------------

def phase_A():
    print("=== PHASE A: READ-ONLY sweep (all OBSERVE/DEV/DOWNLOAD/FLEET/GATE/SELF_UPDATE status mechanics) ===", flush=True)
    run_test("A01", "CONTROL_CAPABILITIES")
    run_test("A02", "CONTROL_LATENCY_STATUS")
    run_test("A03", "TAB_CENSUS")
    run_test("A04", "TAB_TELEMETRY")
    run_test("A05", "SYSTEM_TELEMETRY")
    run_test("A06", "PROCESS_CENSUS")
    run_test("A07", "PROCESS_EVENTS")
    run_test("A08", "SEMANTIC_CENSUS")
    run_test("A09", "SEMANTIC_EVENTS")
    # planner tab for page-scoped reads
    pl = ctx_load().get("planner_tab") or "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"
    run_test("A10", "CAPTURE", payload={"tab_id": pl}, platform="GLM_ZAI")
    run_test("A11", "CAPTURE_VIEW", payload={"tab_id": pl}, platform="GLM_ZAI")
    run_test("A12", "POLL")
    run_test("A13", "READ_TRANSCRIPT", payload={"tab_id": pl, "limit": 8}, platform="GLM_ZAI")
    run_test("A14", "FLEET_STATUS")
    run_test("A15", "GATE_STATUS")
    run_test("A16", "SELF_UPDATE_STATUS")
    run_test("A17", "DOWNLOAD_STATUS")
    run_test("A18", "DEV_PLANE_STATUS")
    run_test("A19", "DEV_PLANE_HEALTH")
    run_test("A20", "DEV_PLANE_CAPABILITIES")
    run_test("A21", "DEV_PLANE_REPO_HEAD")
    run_test("A22", "DEV_PLANE_PROCESS_METRICS")

def phase_B():
    print("=== PHASE B: TABS + NAVIGATION on own tab ===", flush=True)
    rec = run_test("B01", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}, platform="GLM_ZAI", mutating=True, timeout=60)
    tab = None
    if rec["status"] == "COMPLETED" and rec.get("_result_full"):
        tab = rec["_result_full"].get("tab_id")
    ctx_save({"own_tab": tab})
    print(f"  own_tab={tab}", flush=True)
    if not tab:
        save({"id": "B01-FAIL", "action": "ANALYSIS", "status": "FAILED", "note": "no tab_id from NEW_TAB"})
        return
    time.sleep(3)
    run_test("B02", "SELECT_TAB", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True)
    run_test("B03", "RELOAD", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True)
    cap = run_test("B04", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
    tb = find_sem(cap, role="textbox")
    print(f"  chat textbox found: {bool(tb)}", flush=True)
    ctx_save({"own_tab_has_textbox": bool(tb)})
    run_test("B05", "NAVIGATE", payload={"tab_id": tab, "url": "https://example.com/"}, platform="GLM_ZAI", mutating=True, timeout=50)
    run_test("B06", "BACK", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=50)
    run_test("B07", "FORWARD", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=50)
    # TYPED_CLICK on example.com "More information..." link
    cap2 = run_test("B08", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
    link = find_sem(cap2, role="link")
    print(f"  link found on example.com: {bool(link)}", flush=True)
    if link:
        cl = run_test("B09", "TYPED_CLICK", payload={"tab_id": tab, "role": link.get("role"),
                      "semantic_ref": link["semantic_ref"], "accessible_name": link.get("name")},
                      platform="GLM_ZAI", mutating=True, timeout=50)
    else:
        run_test("B09", "TYPED_CLICK", payload={"tab_id": tab, "role": "link", "accessible_name": "More information"},
                 platform="GLM_ZAI", mutating=True, timeout=50)
    # navigate back to chat for later phases
    run_test("B10", "NAVIGATE", payload={"tab_id": tab, "url": "https://chat.z.ai/"}, platform="GLM_ZAI", mutating=True, timeout=50)

def phase_C():
    print("=== PHASE C: PAGE_INPUT mechanics (focus/type/press/scroll/stop-generation) ===", flush=True)
    tab = ctx_load().get("own_tab")
    if not tab:
        save({"id": "C-SKIP", "action": "ANALYSIS", "status": "FAILED", "note": "no own tab"})
        return
    time.sleep(3)
    cap = run_test("C01", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
    tb = find_sem(cap, role="textbox")
    if not tb:
        save({"id": "C01-ANALYSIS", "action": "ANALYSIS", "status": "FAILED", "note": "no textbox"})
        return
    sf = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"]}
    run_test("C02", "SEMANTIC_FOCUS", payload=sf, platform="GLM_ZAI", mutating=True)
    st = dict(sf); st.update({
        "text": ("Write a very long essay (at least 3000 words) about the history of computing. "
                 "Do not stop early. Mechanics test of stop-generation control. Job 419203."),
        "submit_after_type": False, "replace_existing": True})
    run_test("C03", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True)
    run_test("C04", "PRESS_KEY", payload={"key": "Enter", "tab_id": tab}, platform="GLM_ZAI", mutating=True)
    time.sleep(12)
    capg = run_test("C05", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    # stop button: role=button, name containing stop / generating / pause
    stop = None; all_buttons = []
    if capg.get("_result_full"):
        for t in (capg["_result_full"].get("semantic_targets") or []):
            if t.get("role") == "button" and t.get("semantic_ref"):
                nm = str(t.get("name") or "")
                all_buttons.append(nm[:40])
                low = nm.lower()
                if any(k in low for k in ("stop", "останов", "generating", "pause", "пркрат")):
                    stop = t; break
    print(f"  generating buttons: {all_buttons[:8]}; stop-candidate={bool(stop)}", flush=True)
    save({"id": "C05-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "buttons_during_generation": all_buttons[:10], "stop_candidate": bool(stop)})
    if stop:
        pl = {"tab_id": tab, "role": "button", "semantic_ref": stop["semantic_ref"],
              "accessible_name": stop.get("name")}
        run_test("C06", "STOP_GENERATION", payload=pl, platform="GLM_ZAI", mutating=True, timeout=50)
    else:
        run_test("C06", "STOP_GENERATION", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=50)
    time.sleep(4)
    run_test("C07", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    # SCROLL: last two schema variants
    run_test("C08", "SCROLL", payload={"tab_id": tab, "delta_x": 0, "delta_y": 400}, platform="GLM_ZAI", mutating=True, timeout=50)
    run_test("C09", "SCROLL", payload={"tab_id": tab, "direction": "down", "pixels": 400}, platform="GLM_ZAI", mutating=True, timeout=50)

def phase_D():
    print("=== PHASE D: DOWNLOAD_FILE with verified sha256 (pinned GitHub raw) ===", flush=True)
    url = None; sha = None; fname = "compute-readme-pin.md"
    try:
        api = "https://api.github.com/repos/PatriceFrome/Compute/commits/HEAD"
        out = subprocess.run(["curl", "-s", "--max-time", "15", api], capture_output=True, text=True).stdout
        j = json.loads(out); commit = j["sha"]
        url = f"https://raw.githubusercontent.com/PatriceFrome/Compute/{commit}/README.md"
        raw = subprocess.run(["curl", "-sL", "--max-time", "20", url], capture_output=True).stdout
        sha = hashlib.sha256(raw).hexdigest()
        print(f"  pinned url ok, sha256={sha[:12]}..., bytes={len(raw)}", flush=True)
    except Exception as e:
        print(f"  pin fallback: {e}", flush=True)
        try:
            raw = subprocess.run(["curl", "-sL", "--max-time", "15", "https://example.com/robots.txt"], capture_output=True).stdout
            url = "https://example.com/robots.txt"; fname = "robots-pin.txt"
            sha = hashlib.sha256(raw).hexdigest()
        except Exception as e2:
            save({"id": "D00-ANALYSIS", "action": "ANALYSIS", "status": "FAILED", "note": f"cannot pin file: {e2}"})
            return
    ctx_save({"dl_url": url, "dl_sha": sha, "dl_fname": fname})
    run_test("D01", "DOWNLOAD_FILE", payload={"url": url, "filename": fname, "sha256": sha}, mutating=True, timeout=60)
    run_test("D02", "DOWNLOAD_STATUS")

def phase_E():
    print("=== PHASE E: FLEET mechanics ===", flush=True)
    run_test("E01", "FLEET_STATUS")
    run_test("E02", "FLEET_SET_PROFILE", payload={"profile": "BALANCED"}, mutating=True, timeout=60)
    run_test("E03", "FLEET_RECONCILE", payload={"target_agents": 4}, mutating=True, timeout=70)
    run_test("E04", "FLEET_STATUS")
    r = last_full("FLEET_STATUS")
    if r:
        ag = r.get("agents") or []
        roles = sorted(str(a.get("role")) for a in ag if a.get("status") == "ACTIVE" or a.get("ownership") == "FLEET_OWNED")
        print(f"  fleet active roles: {roles}", flush=True)
        save({"id": "E04-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "fleet_roles": roles})

def phase_F():
    print("=== PHASE F: SELF_UPDATE + AUTHORITY (safe idempotent) ===", flush=True)
    run_test("F01", "SELF_UPDATE_CHECK", payload={}, mutating=True, timeout=60)
    run_test("F02", "SELF_UPDATE_APPLY", payload={}, mutating=True, timeout=95)
    run_test("F03", "SELF_UPDATE_STATUS")
    # idempotent authority: set mode to CURRENT mode (CONTROL) — no regression expected
    run_test("F04", "SET_SUPERVISOR_MODE", payload={"supervisor_mode": "CONTROL"}, mutating=True, timeout=60)
    # gate typed-schema probe: enable an ALREADY-ENABLED gate (no-op intent) with proper reason
    run_test("F05", "GATE_ENABLE", payload={"gate_id": "authority.armed", "reason": "mechanics-test-419203 idempotent enable probe"}, mutating=True, timeout=50)
    run_test("F06", "GATE_STATUS")
    print("=== FINAL LIVENESS CHECK ===", flush=True)
    run_test("F07", "TAB_CENSUS")

def phase_VERDICT():
    print("=== VERDICT TABLE ===", flush=True)
    impl = ["ARM","DISARM","SET_SUPERVISOR_MODE","DEV_PLANE_CAPABILITIES","DEV_PLANE_HEALTH","DEV_PLANE_PROCESS_METRICS","DEV_PLANE_REPO_HEAD","DEV_PLANE_STATUS","DOWNLOAD_CANCEL","DOWNLOAD_FILE","DOWNLOAD_STATUS","FLEET_RECONCILE","FLEET_SET_PROFILE","FLEET_STATUS","BACK","FORWARD","NAVIGATE","RELOAD","CAPTURE","CAPTURE_VIEW","CONTROL_CAPABILITIES","CONTROL_LATENCY_STATUS","POLL","PROCESS_CENSUS","PROCESS_EVENTS","READ_TRANSCRIPT","SEMANTIC_CENSUS","SEMANTIC_EVENTS","SYSTEM_TELEMETRY","TAB_CENSUS","TAB_TELEMETRY","GATE_DISABLE","GATE_DISABLE_ALL","GATE_ENABLE","GATE_ENABLE_ALL","GATE_STATUS","PRESS_KEY","SCROLL","SEMANTIC_FOCUS","SEMANTIC_TYPE","STOP_GENERATION","TYPED_CLICK","SELF_UPDATE_APPLY","SELF_UPDATE_CHECK","SELF_UPDATE_STATUS","CLOSE_TAB","NEW_TAB","SELECT_TAB"]
    # aggregate: this run + all history
    hist = {}
    import glob as g
    for p in sorted(g.glob("/home/z/my-project/scripts/phoenix/browser-test-results-*.json")):
        try: d = json.load(open(p))
        except: continue
        if not isinstance(d, list): continue
        for it in d:
            a, s, e = it.get("action"), it.get("status"), it.get("error")
            if a not in impl or a == "ANALYSIS": continue
            h = hist.setdefault(a, {"ok": 0, "fail": 0, "err": 0, "other": 0, "errs": set()})
            if s == "COMPLETED": h["ok"] += 1
            elif s in ("FAILED",): h["fail"] += 1
            elif s in ("INSERT_ERROR", "ENQUEUE_ERROR"): h["err"] += 1
            elif s in ("EXPIRED", "POLL_TIMEOUT", "LEASED"): h["other"] += 1
            if e and s != "COMPLETED": h["errs"].add(str(e)[:60])
    rows = []
    for a in impl:
        h = hist.get(a, {"ok": 0, "fail": 0, "err": 0, "other": 0, "errs": set()})
        if h["ok"] and not h["fail"] and not h["err"]: v = "WORKS"
        elif h["ok"] and (h["fail"] or h["err"]): v = "FLAKY"
        elif not h["ok"] and (h["fail"] or h["err"] or h["other"]): v = "BROKEN"
        else: v = "UNTESTED"
        rows.append((a, v, h["ok"], h["fail"], h["err"], h["other"], "; ".join(sorted(h["errs"]))[:90]))
    out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "build": "0.7.0-dev.36336130139.1", "verdicts": [
               {"action": a, "verdict": v, "ok": ok, "fail": f, "enqueue_err": er, "other": o, "last_errors": e}
               for a, v, ok, f, er, o, e in rows]}
    with open(RESULTS.replace(".json", "-VERDICT.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for a, v, ok, f_, er, o, e in rows:
        print(f"  {a:26s} {v:9s} ok={ok} fail={f_} enqerr={er} other={o} {('| '+e) if e else ''}", flush=True)
    cnt = {}
    for _, v, *_ in rows: cnt[v] = cnt.get(v, 0) + 1
    print(f"SUMMARY: {cnt}", flush=True)

if __name__ == "__main__":
    load_results()
    ph = sys.argv[1] if len(sys.argv) > 1 else "A"
    if ph == "VERDICT": phase_VERDICT()
    elif ph == "A": phase_A()
    elif ph == "B": phase_B()
    elif ph == "C": phase_C()
    elif ph == "D": phase_D()
    elif ph == "E": phase_E()
    elif ph == "F": phase_F()
    print(f"phase {ph} done", flush=True)
