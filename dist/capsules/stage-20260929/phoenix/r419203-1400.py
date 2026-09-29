#!/usr/bin/env python3
# r419203-1400.py — effect-plane isolation: TYPED_CLICK on IN-APP element with verifiable
# non-nav effect (model-selector dropdown -> CAPTURE delta). Splits "activation dead everywhere"
# vs "cross-origin nav swallowed". Plus RESEARCHER marker-readback. No fleet-tab mutations.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
ISSUER = "zai-419203-1400"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-mt419203-1400.json"
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
        print(f"POLICY DENY {action}", flush=True)
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"r1400-{action}-{uuid.uuid4().hex[:8]}"}
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

def sig(cap):
    t = (cap or {}).get("semantic_targets") or []
    return (cap or {}).get("url", ""), len(t), sorted(str(x.get("name"))[:24] for x in t)

def r1_researcher():
    st, tr, _ = run("R1-transcript", "READ_TRANSCRIPT", {"tab_id": RES_TAB})
    text = (tr or {}).get("text", "") if isinstance(tr, dict) else ""
    tlen = (tr or {}).get("total_chars") if isinstance(tr, dict) else None
    idx = text.rfind("TOOL_REQUEST")
    zone = text[idx:] if idx >= 0 else ""
    ack = "CONNECTED-TOOLRESULT-FULL-1231" in zone
    verdict = "REPLIED" if (ack and len(zone) > 400) else "SILENT"
    RECORDS.append({"step": "R1-verdict", "total_chars": tlen, "zone_chars": len(zone),
                    "ack": ack, "verdict": verdict})
    save()
    print(f"R1: {verdict} chars={tlen}", flush=True)

def m_lane():
    st, res, _ = run("M1-newtab", "NEW_TAB", {})
    tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
    if not tab:
        RECORDS.append({"step": "M1", "status": "NO-TABID"}); save(); return
    time.sleep(18)
    st, cap, _ = run("M2-capture-pre", "CAPTURE", {"tab_id": tab})
    url0, cnt0, names0 = sig(cap)
    targets = (cap or {}).get("semantic_targets") or []
    RECORDS.append({"step": "M2-pre", "url": url0, "target_count": cnt0,
                    "buttons": [str(t.get("name"))[:40] for t in targets if t.get("role") == "button"][:20],
                    "roles": sorted(set(str(t.get("role")) for t in targets))})
    save()
    # pick in-app effect-verifiable button: model selector / panel opener (NOT a link, NOT nav)
    prio = ("glm", "model", "settings", "search", "library", "projects", "menu", "sidebar")
    btn = None
    for kw in prio:
        for t in targets:
            nm = str(t.get("name", "")).lower()
            if t.get("role") == "button" and kw in nm:
                btn = t; break
        if btn: break
    if not btn:
        btn = next((t for t in targets if t.get("role") == "button" and t.get("semantic_ref")), None)
    if not btn:
        RECORDS.append({"step": "M2", "status": "NO-BUTTON"}); save()
        run("M8-cleanup", "CLOSE_TAB", {"tab_id": tab}); return
    RECORDS.append({"step": "M2-pick", "name": str(btn.get("name"))[:60],
                    "ref_keys": list(btn["semantic_ref"].keys()) if isinstance(btn.get("semantic_ref"), dict) else None})
    save(); time.sleep(18)
    st, _, err = run("M3-typed-click-inapp", "TYPED_CLICK",
                     {"tab_id": tab, "role": btn.get("role"), "semantic_ref": btn.get("semantic_ref"),
                      "accessible_name": btn.get("name")}, timeout=70)
    click_status = st
    time.sleep(20)
    st, cap2, _ = run("M4-capture-post", "CAPTURE", {"tab_id": tab})
    url1, cnt1, names1 = sig(cap2)
    delta_urls = url0 != url1
    delta_cnt = cnt1 - cnt0
    new_names = [n for n in names1 if n not in names0][:12]
    effect = bool(delta_urls or abs(delta_cnt) >= 3 or new_names)
    verdict = ("IN-APP-CLICK-EFFECT-OK" if (click_status == "COMPLETED" and effect)
               else ("IN-APP-CLICK-NO-EFFECT" if click_status == "COMPLETED" else f"CLICK-{click_status}"))
    RECORDS.append({"step": "M-verdict", "click_status": click_status,
                    "url_pre": url0, "url_post": url1, "url_delta": delta_urls,
                    "cnt_pre": cnt0, "cnt_post": cnt1, "cnt_delta": delta_cnt,
                    "new_targets": new_names, "effect": effect,
                    "EFFECT_PLANE_INAPP": verdict, "err": str(err)[:150] if err else None})
    save()
    print(f"M: click={click_status} url_delta={delta_urls} cnt {cnt0}->{cnt1} new={len(new_names)} -> {verdict}", flush=True)
    # close any opened panel
    time.sleep(16)
    run("M5-escape", "PRESS_KEY", {"tab_id": tab, "key": "Escape"})
    time.sleep(16)
    run("M8-cleanup", "CLOSE_TAB", {"tab_id": tab})

def main():
    r1_researcher()
    m_lane()
    time.sleep(14)
    st, cen, _ = run("M10-census", "TAB_CENSUS")
    RECORDS.append({"step": "final", "total_tabs": (cen or {}).get("total_tabs"),
                    "fleet_n": len((cen or {}).get("fleet_tab_ids") or [])})
    save()
    print(f"FINAL: tabs={(cen or {}).get('total_tabs')} fleet={len((cen or {}).get('fleet_tab_ids') or [])}/4", flush=True)

if __name__ == "__main__":
    main()
