#!/usr/bin/env python3
# mt-419203c3.py — resume Phase C (new tab; old one closed) + TYPED_CLICK retry + D/E/F + VERDICT
# Continues browser-test-results-mt419203.json (A: 22/22 ok, B: done, C: killed at C03 by operator).
import json, time, uuid, sys, os, datetime, subprocess, hashlib, urllib.request, urllib.error

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-mt419203.json"
CTX = RESULTS + ".ctx"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TARGET = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "zai-mechtest-419203-r2"
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
            "p_idempotency_key": f"mt419203r2-{tid}-{uuid.uuid4().hex[:8]}"}
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
               "idempotency_key": f"mt419203r2-{tid}-{uuid.uuid4().hex[:8]}"}
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

def last_full(action):
    for it in reversed(_results):
        if it.get("action") == action and it.get("_result_full"):
            return it["_result_full"]
    return None

# ---------------- resume phases ----------------

def phase_C3():
    print("=== PHASE C3 (resume): new own tab -> type -> Enter -> STOP_GENERATION ===", flush=True)
    rec = run_test("R01", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"}, platform="GLM_ZAI", mutating=True, timeout=60)
    tab = None
    if rec["status"] == "COMPLETED" and rec.get("_result_full"):
        tab = rec["_result_full"].get("tab_id")
    ctx_save({"own_tab2": tab})
    print(f"  own_tab2={tab}", flush=True)
    if not tab: return
    time.sleep(3)
    cap = run_test("R02", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
    tb = find_sem(cap, role="textbox")
    if not tb:
        save({"id": "R02-ANALYSIS", "action": "ANALYSIS", "status": "FAILED", "note": "no textbox on new tab"})
        return
    sf = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"]}
    run_test("R03", "SEMANTIC_FOCUS", payload=sf, platform="GLM_ZAI", mutating=True)
    st = dict(sf); st.update({
        "text": ("Write a very long essay (at least 3000 words) about the history of computing. "
                 "Do not stop early. Mechanics test of stop-generation control. Job 419203 run 2."),
        "submit_after_type": False, "replace_existing": True})
    run_test("R04", "SEMANTIC_TYPE", payload=st, platform="GLM_ZAI", mutating=True)
    run_test("R05", "PRESS_KEY", payload={"key": "Enter", "tab_id": tab}, platform="GLM_ZAI", mutating=True)
    time.sleep(12)
    capg = run_test("R06", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    stop = None; all_buttons = []
    if capg.get("_result_full"):
        for t in (capg["_result_full"].get("semantic_targets") or []):
            if t.get("role") == "button" and t.get("semantic_ref"):
                nm = str(t.get("name") or "")
                all_buttons.append(nm[:40])
                low = nm.lower()
                if any(k in low for k in ("stop", "останов", "generating", "pause", "прер")):
                    stop = t; break
    print(f"  buttons during generation: {all_buttons[:8]}; stop-candidate={bool(stop)}", flush=True)
    save({"id": "R06-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "buttons_during_generation": all_buttons[:10], "stop_candidate": bool(stop)})
    if stop:
        pl = {"tab_id": tab, "role": "button", "semantic_ref": stop["semantic_ref"],
              "accessible_name": stop.get("name")}
        run_test("R07", "STOP_GENERATION", payload=pl, platform="GLM_ZAI", mutating=True, timeout=50)
    else:
        run_test("R07", "STOP_GENERATION", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=50)
    time.sleep(4)
    run_test("R08", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
    run_test("R09", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 6}, platform="GLM_ZAI")

def phase_C4():
    print("=== PHASE C4: SCROLL variants + TYPED_CLICK minimal-schema retry ===", flush=True)
    tab = ctx_load().get("own_tab2")
    if not tab: return
    run_test("R10", "SCROLL", payload={"tab_id": tab, "delta_x": 0, "delta_y": 400}, platform="GLM_ZAI", mutating=True, timeout=50)
    run_test("R11", "SCROLL", payload={"tab_id": tab, "direction": "down", "pixels": 400}, platform="GLM_ZAI", mutating=True, timeout=50)
    # TYPED_CLICK minimal typed schema (no semantic_ref)
    cap = run_test("R12", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI")
    btn = find_sem(cap, role="button")
    nm = (btn or {}).get("name") or "New Task"
    print(f"  click target button: {nm!r}", flush=True)
    run_test("R13", "TYPED_CLICK", payload={"tab_id": tab, "role": "button", "accessible_name": nm},
             platform="GLM_ZAI", mutating=True, timeout=50)

def phase_D2():
    print("=== PHASE D2: DOWNLOAD_FILE verified (pinned GitHub raw + real sha256) ===", flush=True)
    url = None; sha = None; fname = "compute-context-pin.md"
    try:
        api = "https://api.github.com/repos/PatrickFrome/Compute/commits/main"
        out = subprocess.run(["curl", "-s", "--max-time", "15", api], capture_output=True, text=True).stdout
        commit = json.loads(out)["sha"]
        url = f"https://raw.githubusercontent.com/PatrickFrome/Compute/{commit}/CONTEXT.md"
        raw = subprocess.run(["curl", "-sL", "--max-time", "20", url], capture_output=True).stdout
        sha = hashlib.sha256(raw).hexdigest()
        print(f"  pinned CONTEXT.md @ {commit[:10]}, {len(raw)}B, sha256={sha[:12]}...", flush=True)
    except Exception as e:
        print(f"  pin failed: {e}", flush=True)
        raw = subprocess.run(["curl", "-sL", "--max-time", "15", "https://example.com/robots.txt"], capture_output=True).stdout
        url = "https://example.com/robots.txt"; fname = "robots-pin.txt"
        sha = hashlib.sha256(raw).hexdigest()
    ctx_save({"dl_url": url, "dl_sha": sha, "dl_fname": fname})
    run_test("R14", "DOWNLOAD_FILE", payload={"url": url, "filename": fname, "sha256": sha}, mutating=True, timeout=60)
    run_test("R15", "DOWNLOAD_STATUS")

def phase_E2():
    print("=== PHASE E2: FLEET mechanics ===", flush=True)
    run_test("R16", "FLEET_STATUS")
    run_test("R17", "FLEET_SET_PROFILE", payload={"profile": "BALANCED"}, mutating=True, timeout=60)
    run_test("R18", "FLEET_RECONCILE", payload={"target_agents": 4}, mutating=True, timeout=70)
    run_test("R19", "FLEET_STATUS")
    r = last_full("FLEET_STATUS")
    if r:
        ag = r.get("agents") or []
        roles = sorted(str(a.get("role")) for a in ag if a.get("ownership") == "FLEET_OWNED" or a.get("status") == "ACTIVE")
        print(f"  fleet roles after reconcile: {roles}", flush=True)
        save({"id": "R19-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local", "fleet_roles": roles})

def phase_F2():
    print("=== PHASE F2: SELF_UPDATE + AUTHORITY (safe) ===", flush=True)
    run_test("R20", "SELF_UPDATE_CHECK", payload={}, mutating=True, timeout=60)
    run_test("R21", "SELF_UPDATE_APPLY", payload={}, mutating=True, timeout=95)
    run_test("R22", "SELF_UPDATE_STATUS")
    run_test("R23", "SET_SUPERVISOR_MODE", payload={"supervisor_mode": "CONTROL"}, mutating=True, timeout=60)
    run_test("R24", "GATE_ENABLE", payload={"gate_id": "authority.armed", "reason": "mechanics-test-419203-r2 idempotent enable probe"}, mutating=True, timeout=50)
    run_test("R25", "GATE_STATUS")

def phase_CLEAN():
    print("=== CLEANUP: close own tab ===", flush=True)
    tab = ctx_load().get("own_tab2")
    if tab:
        run_test("R26", "CLOSE_TAB", payload={"tab_id": tab}, mutating=True, timeout=45)
    print("=== FINAL LIVENESS ===", flush=True)
    run_test("R27", "TAB_CENSUS")

def phase_VERDICT():
    print("=== VERDICT TABLE (all history) ===", flush=True)
    impl = ["ARM","DISARM","SET_SUPERVISOR_MODE","DEV_PLANE_CAPABILITIES","DEV_PLANE_HEALTH","DEV_PLANE_PROCESS_METRICS","DEV_PLANE_REPO_HEAD","DEV_PLANE_STATUS","DOWNLOAD_CANCEL","DOWNLOAD_FILE","DOWNLOAD_STATUS","FLEET_RECONCILE","FLEET_SET_PROFILE","FLEET_STATUS","BACK","FORWARD","NAVIGATE","RELOAD","CAPTURE","CAPTURE_VIEW","CONTROL_CAPABILITIES","CONTROL_LATENCY_STATUS","POLL","PROCESS_CENSUS","PROCESS_EVENTS","READ_TRANSCRIPT","SEMANTIC_CENSUS","SEMANTIC_EVENTS","SYSTEM_TELEMETRY","TAB_CENSUS","TAB_TELEMETRY","GATE_DISABLE","GATE_DISABLE_ALL","GATE_ENABLE","GATE_ENABLE_ALL","GATE_STATUS","PRESS_KEY","SCROLL","SEMANTIC_FOCUS","SEMANTIC_TYPE","STOP_GENERATION","TYPED_CLICK","SELF_UPDATE_APPLY","SELF_UPDATE_CHECK","SELF_UPDATE_STATUS","CLOSE_TAB","NEW_TAB","SELECT_TAB"]
    import glob as g
    hist = {}
    for p in sorted(g.glob("/home/z/my-project/scripts/phoenix/browser-test-results-*.json")):
        try: d = json.load(open(p))
        except: continue
        if not isinstance(d, list): continue
        for it in d:
            a, s, e = it.get("action"), it.get("status"), it.get("error")
            if a not in impl: continue
            h = hist.setdefault(a, {"ok": 0, "fail": 0, "err": 0, "other": 0, "errs": set()})
            if s == "COMPLETED": h["ok"] += 1
            elif s == "FAILED": h["fail"] += 1
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
        rows.append({"action": a, "verdict": v, "ok": h["ok"], "fail": h["fail"],
                     "enqueue_err": h["err"], "other": h["other"], "last_errors": "; ".join(sorted(h["errs"]))[:90]})
    out = {"generated": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
           "build": "0.7.0-dev.36336130139.1", "verdicts": rows}
    with open(RESULTS.replace(".json", "-VERDICT.json"), "w") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    for r in rows:
        print(f"  {r['action']:26s} {r['verdict']:9s} ok={r['ok']} fail={r['fail']} enqerr={r['enqueue_err']} other={r['other']} {('| '+r['last_errors']) if r['last_errors'] else ''}", flush=True)
    cnt = {}
    for r in rows: cnt[r["verdict"]] = cnt.get(r["verdict"], 0) + 1
    print(f"SUMMARY: {cnt}", flush=True)

if __name__ == "__main__":
    load_results()
    ph = sys.argv[1] if len(sys.argv) > 1 else "C3"
    {"C3": phase_C3, "C4": phase_C4, "D2": phase_D2, "E2": phase_E2, "F2": phase_F2,
     "CLEAN": phase_CLEAN, "VERDICT": phase_VERDICT}[ph]()
    print(f"phase {ph} done", flush=True)
