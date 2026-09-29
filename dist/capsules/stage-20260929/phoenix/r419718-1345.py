#!/usr/bin/env python3
# r419718-1345.py — TYPED_CLICK probe v2: full link-target dump + precise selection (href/name),
# effect-proof via iana.org URL; RESEARCHER marker-readback; discipline: gaps >=18s, no blind retry.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"
ISSUER = "zai-419718-1345"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1345.json"
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
           "idempotency_key": f"r1345-{action}-{uuid.uuid4().hex[:8]}"}
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

def r1_researcher():
    st, tr, _ = run("R1-transcript", "READ_TRANSCRIPT", {"tab_id": RES_TAB}, timeout=60)
    text = (tr or {}).get("text", "") if isinstance(tr, dict) else ""
    tlen = (tr or {}).get("total_chars") if isinstance(tr, dict) else None
    if not text:
        RECORDS.append({"step": "R1-verdict", "total_chars": tlen, "verdict": "NO-TEXT"}); save(); return
    idx = text.rfind("TOOL_REQUEST")
    zone = text[idx:] if idx >= 0 else ""
    ack = "CONNECTED-TOOLRESULT-FULL-1231" in zone
    gates = [w for w in ("spoof", "replay", "inject", "CRITIC") if w.lower() in zone.lower()]
    verdict = "REPLIED" if (ack and len(zone) > 400) else "SILENT"
    RECORDS.append({"step": "R1-verdict", "total_chars": tlen, "toolreq_count": text.count("TOOL_REQUEST"),
                    "reply_zone_chars": len(zone), "ack_in_zone": ack, "gates": gates, "verdict": verdict,
                    "zone_head": zone[:500]})
    save()
    print(f"R1: {verdict} chars={tlen} zone={len(zone)}B ack={ack}", flush=True)

def pick_link(targets):
    """Priority: iana-href > more-information name > named link > any link. Log all candidates."""
    cands = []
    for t in targets:
        if t.get("role") != "link":
            continue
        blob = json.dumps(t, ensure_ascii=False).lower()
        cands.append(t)
        if "iana" in blob:
            return t, "href-iana"
    for t in cands:
        blob = json.dumps(t, ensure_ascii=False).lower()
        if "more information" in blob:
            return t, "name-moreinfo"
    for t in cands:
        if t.get("accessible_name"):
            return t, "named-link"
    return (cands[0] if cands else None), ("any-link" if cands else "none")

def m_lane():
    st, res, _ = run("M1-newtab", "NEW_TAB", {})
    tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
    if not tab:
        RECORDS.append({"step": "M1", "status": "NO-TABID"}); save(); return None
    time.sleep(18)
    run("M2-navigate", "NAVIGATE", {"tab_id": tab, "url": "https://www.example.com/"})
    time.sleep(18)
    st, cap, _ = run("M3-capture-pre", "CAPTURE", {"tab_id": tab})
    targets = (cap or {}).get("semantic_targets") or []
    # FULL dump of ALL targets (schema calibration for link selection)
    RECORDS.append({"step": "M3-targets-dump", "url": (cap or {}).get("url", ""),
                    "target_count": len(targets),
                    "targets": [{k: (str(v)[:120] if not isinstance(v, (dict, list)) else v)
                                 for k, v in t.items()} for t in targets]})
    save()
    link, why = pick_link(targets)
    if not link:
        RECORDS.append({"step": "M3", "status": "NO-LINK-ON-PAGE"}); save()
        run("M9-cleanup", "CLOSE_TAB", {"tab_id": tab}); return tab
    RECORDS.append({"step": "M3-pick", "why": why, "picked": {k: (str(v)[:150] if not isinstance(v, (dict, list)) else v)
                                                             for k, v in link.items()}})
    save(); time.sleep(18)
    st, _, err = run("M4-typed-click", "TYPED_CLICK",
                     {"tab_id": tab, "role": link.get("role"), "semantic_ref": link.get("semantic_ref"),
                      "accessible_name": link.get("accessible_name")}, timeout=70)
    time.sleep(25)
    st2, cap2, _ = run("M5-capture-post", "CAPTURE", {"tab_id": tab})
    url1 = (cap or {}).get("url", ""); url2 = (cap2 or {}).get("url", "")
    effect = ("iana.org" in url2)
    verdict = ("WORKS-EFFECT-PROVEN" if (st == "COMPLETED" and effect)
               else ("RPC-OK-NO-EFFECT" if st == "COMPLETED" else f"STILL-{st}"))
    RECORDS.append({"step": "M-verdict", "click_status": st, "url_pre": url1, "url_post": url2,
                    "effect_iana": effect, "TYPED_CLICK_STATIC_V2": verdict,
                    "err": str(err)[:180] if err else None})
    save()
    print(f"M: pick={why} click={st} url_post={url2} -> {verdict}", flush=True)
    return tab

def main():
    r1_researcher()
    tab = m_lane()
    if tab:
        time.sleep(16)
        run("M9-cleanup", "CLOSE_TAB", {"tab_id": tab})
    time.sleep(14)
    st, cen, _ = run("M10-census", "TAB_CENSUS")
    RECORDS.append({"step": "final", "total_tabs": (cen or {}).get("total_tabs"),
                    "fleet": (cen or {}).get("fleet_tab_ids")})
    save()
    print(f"FINAL: total_tabs={(cen or {}).get('total_tabs')}", flush=True)

if __name__ == "__main__":
    main()
