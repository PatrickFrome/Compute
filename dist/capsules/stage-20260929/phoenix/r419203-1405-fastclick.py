#!/usr/bin/env python3
# r419203-1405-fastclick.py — fast-path: CAPTURE -> TYPED_CLICK immediately (no pause between
# read and mutation) to beat semantic_ref staleness on dynamic pages. Effect: CAPTURE delta.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "zai-419203-1400"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-mt419203-1405-fastclick.json"
PE = PolicyEngine()
RECORDS = []

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
URL = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22"

def hdr():
    return {"apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json"}

def save():
    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)

def enqueue(action, payload=None, ttl=75):
    d = PE.evaluate(action, {"tab_id": (payload or {}).get("tab_id"), "issuer": ISSUER})
    v = str(getattr(d, "verdict", None) or getattr(d, "decision", None) or d).upper()
    if v == "DENY":
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"r1405-{action}-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    return cid

def poll(cid, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2.0)
        q = urllib.request.Request(f"{URL}?command_id=eq.{cid}&select=status,receipt,error", headers=hdr())
        rr = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
        if rr and rr[0].get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            return rr[0]["status"], (rr[0].get("receipt") or {}).get("result") or {}, rr[0].get("error")
    return "TIMEOUT", {}, None

def run(step, action, payload=None, timeout=60):
    cid = enqueue(action, payload)
    if cid is None:
        RECORDS.append({"step": step, "action": action, "status": "POLICY_BLOCKED"}); save()
        return "POLICY_BLOCKED", {}, None
    t_enq = time.time()
    st, res, err = poll(cid, timeout=timeout)
    latency = round(time.time() - t_enq, 1)
    print(f"{step} {action}: {st} ({latency}s)" + (f" err={str(err)[:110]}" if err else ""), flush=True)
    RECORDS.append({"step": step, "action": action, "status": st, "latency_s": latency,
                    "error": str(err)[:180] if err else None})
    save()
    return st, res, err

def sig(cap):
    t = (cap or {}).get("semantic_targets") or []
    return (cap or {}).get("url", ""), len(t), sorted(str(x.get("name"))[:24] for x in t)

def main():
    st, res, _ = run("F1-newtab", "NEW_TAB", {})
    tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
    if not tab:
        save(); return
    time.sleep(18)
    st, cap, _ = run("F2-capture-pre", "CAPTURE", {"tab_id": tab})
    url0, cnt0, names0 = sig(cap)
    targets = (cap or {}).get("semantic_targets") or []
    prio = ("glm", "model", "settings", "search", "library", "projects", "menu", "sidebar")
    btn = None
    for kw in prio:
        btn = next((t for t in targets if t.get("role") == "button" and kw in str(t.get("name", "")).lower()), None)
        if btn: break
    if not btn:
        btn = next((t for t in targets if t.get("role") == "button" and t.get("semantic_ref")), None)
    if not btn:
        RECORDS.append({"step": "F2", "status": "NO-BUTTON"}); save()
        run("F9-cleanup", "CLOSE_TAB", {"tab_id": tab}); return
    RECORDS.append({"step": "F2-pick", "name": str(btn.get("name"))[:50], "count_pre": cnt0})
    save()
    # FAST PATH: click immediately after capture (no sleep)
    st, _, err = run("F3-typed-click-fast", "TYPED_CLICK",
                     {"tab_id": tab, "role": btn.get("role"), "semantic_ref": btn.get("semantic_ref"),
                      "accessible_name": btn.get("name")}, timeout=70)
    click_status = st
    time.sleep(20)
    st, cap2, _ = run("F4-capture-post", "CAPTURE", {"tab_id": tab})
    url1, cnt1, names1 = sig(cap2)
    new_names = [n for n in names1 if n not in names0][:14]
    effect = bool(url0 != url1 or abs(cnt1 - cnt0) >= 3 or new_names)
    verdict = ("IN-APP-CLICK-EFFECT-OK" if (click_status == "COMPLETED" and effect)
               else ("IN-APP-CLICK-NO-EFFECT" if click_status == "COMPLETED" else f"CLICK-{click_status}"))
    RECORDS.append({"step": "F-verdict", "click_status": click_status,
                    "url_pre": url0, "url_post": url1, "cnt_pre": cnt0, "cnt_post": cnt1,
                    "new_targets": new_names, "effect": effect,
                    "EFFECT_PLANE_INAPP_FAST": verdict, "err": str(err)[:150] if err else None})
    save()
    print(f"F: click={click_status} cnt {cnt0}->{cnt1} new={len(new_names)} -> {verdict}", flush=True)
    time.sleep(16)
    run("F5-escape", "PRESS_KEY", {"tab_id": tab, "key": "Escape"})
    time.sleep(16)
    run("F9-cleanup", "CLOSE_TAB", {"tab_id": tab})

if __name__ == "__main__":
    main()
