#!/usr/bin/env python3
# r419718-1330.py — tick: R0 commands-audit (attribute 27-tab event), R1 RESEARCHER marker-readback,
# M-lane: TYPED_CLICK static-element probe (example.com "More information" -> iana.org effect-proof),
# DOWNLOAD_STATUS full-receipt schema calibration, own-tab cleanup, final census.
# Discipline: mutation gap >=18s, readback after every mutation, NO blind retry after AMBIGUOUS.
import json, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"   # RESEARCHER (fleet, do not close)
ISSUER = "zai-419718-1330"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1330.json"
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
    verdict = (getattr(d, "verdict", None) or getattr(d, "decision", None) or str(d))
    if str(verdict).upper() == "DENY":
        RECORDS.append({"action": action, "policy": "DENY", "result": "BLOCKED-BY-POLICY"})
        save(); print(f"POLICY DENY {action}", flush=True)
        return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"r1330-{action}-{uuid.uuid4().hex[:8]}"}
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
    RECORDS.append({"step": step, "action": action, "status": st,
                    "result": res if action in ("DOWNLOAD_STATUS",) else None,
                    "error": str(err)[:180] if err else None})
    save()
    return st, res, err

# ---------- R0: recent commands audit (attribution of 27-tab census) ----------
def r0_audit():
    q = urllib.request.Request(
        f"{URL}?order=issued_at.desc&limit=40&select=command_id,action,issued_by,status,issued_at,payload",
        headers=hdr())
    rows = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
    brief = [{"action": r.get("action"), "by": r.get("issued_by"), "status": r.get("status"),
              "at": (r.get("issued_at") or "")[:19],
              "tab": str((r.get("payload") or {}).get("tab_id", ""))[:13],
              "url": str((r.get("payload") or {}).get("url", ""))[:40]} for r in rows]
    mine = [b for b in brief if str(b["by"]).startswith("zai-")]
    others = [b for b in brief if not str(b["by"]).startswith("zai-")]
    by_counts = {}
    for b in brief:
        by_counts[b["by"]] = by_counts.get(b["by"], 0) + 1
    RECORDS.append({"step": "R0-attribution", "recent40_total": len(rows),
                    "issued_by_counts": by_counts, "others_sample": others[:12]})
    save()
    print(f"R0: recent40 by={by_counts}", flush=True)
    return rows

# ---------- R1: RESEARCHER marker-based readback ----------
def r1_researcher():
    st, tr, _ = run("R1-transcript", "READ_TRANSCRIPT", {"tab_id": RES_TAB, "limit": 24}, timeout=60)
    text = (tr or {}).get("text", "") if isinstance(tr, dict) else ""
    tlen = (tr or {}).get("total_chars") if isinstance(tr, dict) else None
    TRQ = "TOOL_REQUEST"
    ACK = "CONNECTED-TOOLRESULT-FULL-1231"
    if not text:
        RECORDS.append({"step": "R1-verdict", "status": st, "total_chars": tlen, "reply": "NO-TEXT"}); save()
        return
    # reply zone = everything AFTER their LAST TOOL_REQUEST occurrence
    idx = text.rfind(TRQ)
    zone = text[idx:] if idx >= 0 else text
    zone_n = len(zone)
    ack_in_zone = ACK in zone
    gates_in_zone = [w for w in ("spoof", "replay", "inject", "CRITIC", "GATE") if w.lower() in zone.lower()]
    # how many TOOL_REQUESTs total (their looping behavior)
    trq_count = text.count(TRQ)
    # footer boundary sanity: my brief literals (always present)
    mybrief_present = "TRFULL-REMIND-1307" in text
    reply_verdict = "REPLIED" if (ack_in_zone and zone_n > 400) else "SILENT"
    RECORDS.append({"step": "R1-verdict", "type_status": st, "total_chars": tlen,
                    "toolreq_count": trq_count, "reply_zone_chars": zone_n,
                    "ack_in_reply_zone": ack_in_zone, "gate_words_in_zone": gates_in_zone,
                    "mybrief_present": mybrief_present, "verdict": reply_verdict,
                    "reply_zone_head": zone[:800]})
    save()
    print(f"R1: verdict={reply_verdict} total_chars={tlen} toolreq={trq_count} zone={zone_n}B ack={ack_in_zone} gates={gates_in_zone}", flush=True)

# ---------- M-lane: TYPED_CLICK static-element probe ----------
def m_lane():
    st, res, _ = run("M1-newtab", "NEW_TAB", {}, timeout=60)
    tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
    if not tab:
        RECORDS.append({"step": "M1", "status": "NO-TABID", "why": "abort mutation lane"}); save()
        return None
    time.sleep(18)
    run("M2-navigate", "NAVIGATE", {"tab_id": tab, "url": "https://www.example.com/"}, timeout=60)
    time.sleep(18)
    st, cap, _ = run("M3-capture-pre", "CAPTURE", {"tab_id": tab}, timeout=60)
    url1 = (cap or {}).get("url", "")
    link = None
    for t in (cap.get("semantic_targets") or []):
        nm = " ".join(str(t.get(k, "")) for k in ("accessible_name", "name", "text", "label")).lower()
        if t.get("role") == "link" and ("more information" in nm or nm.strip() == "link"):
            link = t; break
    if not link:
        for t in (cap.get("semantic_targets") or []):
            if t.get("role") == "link" and t.get("semantic_ref"):
                link = t; break
    if not link:
        RECORDS.append({"step": "M3", "status": "NO-LINK", "url": url1,
                        "targets": [(t.get("role"), str(t.get("accessible_name"))[:30]) for t in (cap.get("semantic_targets") or [])[:15]]})
        save(); run("M9-cleanup", "CLOSE_TAB", {"tab_id": tab}); return tab
    RECORDS.append({"step": "M3-link", "role": link.get("role"),
                    "accessible_name": str(link.get("accessible_name"))[:60],
                    "ref_is_object": isinstance(link.get("semantic_ref"), (dict, list))})
    save(); time.sleep(18)
    st, _, err = run("M4-typed-click", "TYPED_CLICK",
                     {"tab_id": tab, "role": link.get("role"), "semantic_ref": link.get("semantic_ref"),
                      "accessible_name": link.get("accessible_name")}, timeout=70)
    click_status = st
    time.sleep(18)
    st2, cap2, _ = run("M5-capture-post", "CAPTURE", {"tab_id": tab}, timeout=60)
    url2 = (cap2 or {}).get("url", "")
    effect = ("iana.org" in url2) and ("example.com" not in url2)
    verdict = ("WORKS-EFFECT-PROVEN" if (click_status == "COMPLETED" and effect)
               else ("RPC-OK-NO-EFFECT" if click_status == "COMPLETED" else f"STILL-{click_status}"))
    RECORDS.append({"step": "M-verdict", "click_status": click_status, "url_pre": url1,
                    "url_post": url2, "effect_iana": effect, "TYPED_CLICK_STATIC": verdict,
                    "err": str(err)[:180] if err else None})
    save()
    print(f"M: click={click_status} url_pre={url1} url_post={url2} effect={effect} -> {verdict}", flush=True)
    return tab

def main():
    r0_audit()
    r1_researcher()
    tab = m_lane()
    run("M6-download-status", "DOWNLOAD_STATUS", {}, timeout=60)
    if tab:
        time.sleep(16)
        run("M9-cleanup", "CLOSE_TAB", {"tab_id": tab})
    time.sleep(14)
    st, cen, _ = run("M10-census", "TAB_CENSUS", {}, timeout=60)
    cnt = (cen or {}).get("tab_count") or len((cen or {}).get("tabs") or [])
    fleet = [t for t in ((cen or {}).get("tabs") or []) if any(k in str(t.get("tab_id", "")) for k in
             ("tab_fe50ead8", "tab_bc085d57", "tab_9f8b697d", "tab_6f7ea6e9"))]
    RECORDS.append({"step": "final", "tab_count": cnt, "fleet_intact": len(fleet)})
    save()
    print(f"FINAL: census={cnt} fleet={len(fleet)}/4", flush=True)

if __name__ == "__main__":
    main()
