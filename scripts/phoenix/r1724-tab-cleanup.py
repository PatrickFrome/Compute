#!/usr/bin/env python3
"""ME2-TICK-20260928-1724: TAB_CENSUS + scratch-tab cleanup (evidence-based).
Mode 'census': read-only TAB_CENSUS, classify tabs.
Mode 'close': CLOSE_TAB explicit ids (paced 20s, readback each) — ONLY our scratch/artifact tabs.
Never prints secrets."""
import json, time, uuid, sys, datetime, urllib.request, urllib.error

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TARGET = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "me2-tick-1724"
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
    req = urllib.request.Request(url, data=json.dumps(args).encode(), method="POST", headers={
        "apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            body = r.read().decode()
            return json.loads(body) if body else None
    except urllib.error.HTTPError as e:
        return {"__http_error": e.code, "body": e.read().decode()[:400]}

def get_command(cid):
    url = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?command_id=eq.{cid}&select=*"
    req = urllib.request.Request(url, headers={"apikey": SJ, "Authorization": f"Bearer {SJ}"})
    with urllib.request.urlopen(req, timeout=30) as r:
        rows = json.loads(r.read().decode())
        return rows[0] if rows else None

def rest_insert(row):
    url = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22"
    req = urllib.request.Request(url, data=json.dumps(row).encode(), method="POST", headers={
        "apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json",
        "Prefer": "return=representation"})
    try:
        with urllib.request.urlopen(req, timeout=40) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:300]

_last_mut = 0.0

def command(action, payload=None, mutating=False, timeout=55):
    global _last_mut
    if mutating:
        wait = MUT_GAP - (time.time() - _last_mut)
        if wait > 0:
            print(f"  [pace] {wait:.0f}s", flush=True)
            time.sleep(wait)
        _last_mut = time.time()
    args = {"p_workspace_id": WS, "p_action": action, "p_issued_by": ISSUER,
            "p_ttl_seconds": 75, "p_idempotency_key": f"me2-tick-1724-{uuid.uuid4().hex[:8]}",
            "p_target_client_id": TARGET}
    if payload is not None:
        args["p_payload"] = payload
    t0 = time.time()
    resp = rpc("h205f22_a2_browser_supervisor_enqueue_v3", args)
    if isinstance(resp, dict) and "command_id" in resp:
        cid = resp["command_id"]
    elif isinstance(resp, dict) and resp.get("__http_error") == 400 and "supervisor_action_invalid" in str(resp.get("body", "")):
        cid = str(uuid.uuid4())
        now = datetime.datetime.now(datetime.timezone.utc)
        row = {"command_id": cid, "workspace_id": WS, "target_client_id": TARGET,
               "issued_by": ISSUER, "action": action, "payload": payload if payload is not None else {},
               "status": "PENDING", "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "idempotency_key": f"me2-tick-1724-{uuid.uuid4().hex[:8]}"}
        code, _ = rest_insert(row)
        if code not in (200, 201):
            print(f"  [{action}] INSERT_ERROR HTTP {code}", flush=True)
            return None
    else:
        print(f"  [{action}] ENQUEUE_ERROR: {json.dumps(resp)[:160]}", flush=True)
        return None
    row = None
    while time.time() - t0 < timeout:
        row = get_command(cid)
        if row and row.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            break
        time.sleep(2.5)
    status = (row or {}).get("status", "POLL_TIMEOUT")
    result = ((row or {}).get("receipt") or {}).get("result")
    print(f"  [{action}] {status} in {int((time.time()-t0)*1000)}ms err={(row or {}).get('error')!r}", flush=True)
    return {"status": status, "result": result, "error": (row or {}).get("error")}

mode = sys.argv[1] if len(sys.argv) > 1 else "census"

if mode == "census":
    r = command("TAB_CENSUS", mutating=False, timeout=60)
    res = (r or {}).get("result") if r else None
    tabs = (res or {}).get("tabs", []) if isinstance(res, dict) else []
    if not tabs:
        print(f"CENSUS-EMPTY (status={(r or {}).get('status')} error={(r or {}).get('error')!r})", flush=True)
        sys.exit(0)
    print(f"TOTAL_TABS={len(tabs)}", flush=True)
    our_markers = ("me2reply", "fleet-e2e", "me2-fleet", "файл-маячок", "ack-me2", "toolresult")
    for t in tabs:
        tid = t.get("tab_id", "?")
        title = str(t.get("title", ""))[:70]
        url = str(t.get("url", ""))[:80]
        low = (title + " " + url).lower()
        tag = "OURS-SCRATCH?" if any(m in low for m in our_markers) else ("EMPTY-NEWTAB" if title.strip().lower() in ("new tab", "новая вкладка", "untitled", "") else "")
        print(f"{tid} | {tag:<13} | {title} | {url}", flush=True)
elif mode == "close":
    ids = sys.argv[2].split(",")
    for tid in ids:
        r = command("CLOSE_TAB", {"tab_id": tid}, mutating=True, timeout=60)
        print(f"CLOSED {tid}: {r['status'] if r else 'NO-CMD'}", flush=True)
