#!/usr/bin/env python3
# r419718-1350-keyboard.py — directive §4 priority-5 activation path: SEMANTIC_FOCUS(link) + PRESS_KEY Enter.
# Different mechanism than TYPED_CLICK (not a blind retry). Effect readback: iana.org URL.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
ISSUER = "zai-419718-1345"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1350-kbd.json"
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
        RECORDS.append({"action": action, "policy": "DENY"}); save()
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"r1350-{action}-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    return cid

def poll(cid, timeout=60):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2.5)
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
    st, res, err = poll(cid, timeout=timeout)
    print(f"{step} {action}: {st}" + (f" err={str(err)[:120]}" if err else ""), flush=True)
    RECORDS.append({"step": step, "action": action, "status": st, "error": str(err)[:180] if err else None})
    save()
    return st, res, err

def main():
    st, res, _ = run("K1-newtab", "NEW_TAB", {})
    tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
    if not tab:
        RECORDS.append({"step": "K1", "status": "NO-TABID"}); save(); return
    time.sleep(18)
    run("K2-navigate", "NAVIGATE", {"tab_id": tab, "url": "https://www.example.com/"})
    time.sleep(18)
    st, cap, _ = run("K3-capture", "CAPTURE", {"tab_id": tab})
    targets = (cap or {}).get("semantic_targets") or []
    link = next((t for t in targets if t.get("role") == "link"), None)
    if not link:
        RECORDS.append({"step": "K3", "status": "NO-LINK"}); save()
        run("K9-cleanup", "CLOSE_TAB", {"tab_id": tab}); return
    ref = link.get("semantic_ref")
    name = link.get("name") or link.get("accessible_name")
    RECORDS.append({"step": "K3-link", "name": name, "ref_keys": list(ref.keys()) if isinstance(ref, dict) else str(type(ref))})
    save(); time.sleep(18)
    st, _, err = run("K4-semantic-focus", "SEMANTIC_FOCUS",
                     {"tab_id": tab, "role": "link", "semantic_ref": ref, "accessible_name": name})
    focus_status = st
    time.sleep(18)
    st, _, err = run("K5-press-enter", "PRESS_KEY", {"tab_id": tab, "key": "Enter"})
    key_status = st
    time.sleep(25)
    st, cap2, _ = run("K6-capture-post", "CAPTURE", {"tab_id": tab})
    url_post = (cap2 or {}).get("url", "")
    effect = "iana.org" in url_post
    verdict = ("KEYBOARD-ACTIVATION-WORKS" if effect else "NO-EFFECT")
    RECORDS.append({"step": "K-verdict", "focus": focus_status, "press": key_status,
                    "url_post": url_post, "effect_iana": effect,
                    "TYPED_CLICK_ALT_KEYBOARD": verdict})
    save()
    print(f"K: focus={focus_status} press={key_status} url={url_post} -> {verdict}", flush=True)
    time.sleep(16)
    run("K9-cleanup", "CLOSE_TAB", {"tab_id": tab})

if __name__ == "__main__":
    main()
