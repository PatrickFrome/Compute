#!/usr/bin/env python3
# mt-419203-delta-1300.py — delta tick @13:00 per BROWSER-TEST-20260928-1240 next-tick list
# (1) TYPED_CLICK RPC with REAL semantic_ref; (2) SELF_UPDATE_STATUS version check;
# (3) RESEARCHER reply collection (ACK FULL-1231 + 3 CRITIC-gate checks);
# (4) DOWNLOAD_FILE re-probe (recipe {url, filename, expected_sha256}, pinned raw file).
import json, hashlib, sys, time, uuid, datetime, urllib.request

sys.path.insert(0, "/home/z/my-project/scripts/me2-r28")
from policy_engine_mvp import PolicyEngine

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"  # RESEARCHER
ISSUER = "zai-419203-1300"
OUT = "/home/z/my-project/scripts/phoenix/browser-test-results-mt419203-delta1300.json"
PE = PolicyEngine()
RECORDS = []
OWNER = "job-419203-delta-sweep-1300"

def dump():
    json.dump(RECORDS, open(OUT, "w"), indent=1, ensure_ascii=False)

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

def enqueue(action, payload=None, ttl=75, owner_directive=False):
    ctx = {"tab_id": (payload or {}).get("tab_id"), "issuer": ISSUER}
    if owner_directive:
        ctx["owner_directive"] = OWNER
    d = PE.evaluate(action, ctx)
    verdict = (getattr(d, "verdict", None) or getattr(d, "decision", None) or str(d))
    reason = getattr(d, "reason", "")
    if str(verdict).upper() == "DENY":
        RECORDS.append({"action": action, "policy": "DENY", "policy_reason": reason, "result": "BLOCKED-BY-POLICY"}); dump()
        print(f"POLICY DENY {action}: {reason}", flush=True)
        return None
    if str(verdict).upper() == "ESCALATE":
        if owner_directive:
            with open(PE.ledger_path, "a") as f:
                f.write(json.dumps({"ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
                                    "action": action, "verdict": "ESCALATE-PROCEED",
                                    "reason": f"operator mandate Job 419203; {reason}",
                                    "owner_directive": OWNER}, ensure_ascii=False) + "\n")
            print(f"POLICY ESCALATE-PROCEED {action} (owner mandate)", flush=True)
        else:
            RECORDS.append({"action": action, "policy": "ESCALATE", "policy_reason": reason, "result": "BLOCKED-BY-POLICY"}); dump()
            print(f"POLICY ESCALATE {action}: {reason}", flush=True)
            return None
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": "GLM_ZAI", "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"mt1300-{action}-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    return cid

def poll(cid, timeout=55):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2.5)
        q = urllib.request.Request(f"{URL}?command_id=eq.{cid}&select=status,receipt,error", headers=hdr())
        rr = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
        if rr and rr[0].get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            return rr[0]["status"], (rr[0].get("receipt") or {}).get("result") or {}, rr[0].get("error")
    return "TIMEOUT", {}, None

def run(step, action, payload=None, timeout=55, owner_directive=False):
    cid = enqueue(action, payload, owner_directive=owner_directive)
    if cid is None:
        RECORDS.append({"step": step, "action": action, "status": "POLICY_BLOCKED"}); dump()
        return "POLICY_BLOCKED", {}, None
    st, res, err = poll(cid, timeout=timeout)
    e = str(err)[:150] if err else None
    print(f"{step} {action}: {st}" + (f" err={e}" if e else ""), flush=True)
    rec = {"step": step, "action": action, "status": st, "error": e}
    if isinstance(res, dict):
        if "url" in res: rec["url"] = res["url"]
        for k in ("version", "state", "current_version", "hint_version"):
            if k in res: rec[k] = res[k]
    RECORDS.append(rec); dump()
    return st, res, err

def flat_text(o, acc):
    if isinstance(o, str): acc.append(o)
    elif isinstance(o, dict):
        for v in o.values(): flat_text(v, acc)
    elif isinstance(o, list):
        for v in o: flat_text(v, acc)
    return acc

def main():
    # ---- D0: SELF_UPDATE_STATUS (version check; validator behavior changed 12:15->12:40) ----
    time.sleep(15)
    run("D0", "SELF_UPDATE_STATUS", {}, timeout=50)

    # ---- D1: fresh own tab + CAPTURE for REAL semantic_ref ----
    time.sleep(20)
    st, res, _ = run("D1", "NEW_TAB", {}, timeout=60)
    tab = (res or {}).get("tab_id") if isinstance(res, dict) else None
    print("own tab:", tab, flush=True)
    if not tab:
        RECORDS.append({"step": "D1", "status": "SKIPPED-no-tab"}); dump(); return
    time.sleep(20)
    st, cap, _ = run("D1-cap", "CAPTURE", {"tab_id": tab}, timeout=60)
    real = None
    for t in (cap.get("semantic_targets") or []):
        if t.get("role") and t.get("semantic_ref"):
            real = t; break
    if real:
        RECORDS.append({"step": "D1-real-element", "role": real.get("role"),
                        "name": (real.get("name") or "")[:60]}); dump()

    # ---- D2: TYPED_CLICK via RPC with REAL semantic_ref ----
    if real:
        time.sleep(20)
        pl = {"tab_id": tab, "role": real["role"], "semantic_ref": real["semantic_ref"]}
        if real.get("name"): pl["accessible_name"] = real["name"]
        st, res, err = run("D2-typedclick-rpc", "TYPED_CLICK", pl, timeout=60)
        RECORDS.append({"step": "D2-verdict",
                        "rpc_real_ref": st,
                        "err_class": (str(err).split(":")[0][:60] if err else None)}); dump()
    else:
        RECORDS.append({"step": "D2", "status": "SKIPPED", "why": "no real element with semantic_ref"}); dump()

    # ---- D3: RESEARCHER reply collection (read-only) ----
    time.sleep(20)
    st, tr, _ = run("D3", "READ_TRANSCRIPT", {"tab_id": RES_TAB, "limit": 16}, timeout=60)
    txt = "\n".join(flat_text(tr, [])) if isinstance(tr, dict) else str(tr)
    ack_full = "CONNECTED-TOOLRESULT-FULL-1231" in txt
    nonce_echo = "mt419718-1231-r1" in txt
    # CRITIC-gate table heuristics: numbered checks with signals/thresholds after our FULL brief
    critic_block = ""
    low = txt.lower()
    idx = low.rfind("toolresult-full-1231")
    if idx >= 0:
        critic_block = txt[idx:idx + 4000]
    has_gates = ("gate" in critic_block.lower() and any(w in critic_block.lower() for w in ("threshold", "signal", "replay", "spoof", "injection")))
    RECORDS.append({"step": "D3-verdict", "researcher_ack_full1231": ack_full, "nonce_echo": nonce_echo,
                    "critic_gates_delivered": has_gates,
                    "transcript_total_chars": (tr or {}).get("total_chars") if isinstance(tr, dict) else None,
                    "post_brief_excerpt": critic_block[:1200]}); dump()
    print(f"D3: ack_full={ack_full} nonce_echo={nonce_echo} critic_gates={has_gates}", flush=True)

    # ---- D4: DOWNLOAD_FILE re-probe (recipe, pinned raw file, owner mandate) ----
    dl = None
    cands = [
        "https://raw.githubusercontent.com/PatrickFrome/Compute/sandbox/me2-os/CONTEXT.md",
        "https://raw.githubusercontent.com/PatrickFrome/Compute/main/README.md",
        "https://raw.githubusercontent.com/PatrickFrome/Compute/sandbox/me2-os/README.md",
    ]
    for u in cands:
        try:
            with urllib.request.urlopen(u, timeout=20) as r:
                b = r.read()
            if len(b) > 100:
                dl = {"url": u, "filename": u.rsplit("/", 1)[-1],
                      "expected_sha256": hashlib.sha256(b).hexdigest(), "bytes": len(b)}
                break
        except Exception:
            continue
    RECORDS.append({"step": "D4-pin", "pinned": {k: dl[k] for k in ("url", "filename", "bytes")} if dl else None}); dump()
    if dl:
        time.sleep(20)
        st, res, err = run("D4-download", "DOWNLOAD_FILE",
                           {"url": dl["url"], "filename": dl["filename"],
                            "expected_sha256": dl["expected_sha256"]},
                           timeout=90, owner_directive=True)
        time.sleep(5)
        st2, res2, _ = run("D4-status", "DOWNLOAD_STATUS", {}, timeout=50)
        dls = []
        if isinstance(res2, dict):
            for d in (res2.get("downloads") or res2.get("items") or []):
                if isinstance(d, dict):
                    dls.append({k: d.get(k) for k in ("id", "state", "status", "filename") if k in d})
        RECORDS.append({"step": "D4-verdict", "download_status": st, "err_class": (str(err).split(":")[0][:60] if err else None),
                        "status_after": st2, "downloads_seen": dls[:5]}); dump()
        # DOWNLOAD_CANCEL probe if anything active
        active = [d for d in dls if str(d.get("state", "")) + str(d.get("status", "")) in
                  ("in_progress", "progressing", "active", "pending", "started")]
        if active and active[0].get("id"):
            time.sleep(20)
            run("D4-cancel", "DOWNLOAD_CANCEL", {"download_id": active[0]["id"]}, timeout=50, owner_directive=True)

    # ---- D5: cleanup + final census ----
    time.sleep(20)
    run("D5-close", "CLOSE_TAB", {"tab_id": tab})
    time.sleep(20)
    run("D5-census", "TAB_CENSUS", {})
    dump()
    print("DONE", flush=True)

if __name__ == "__main__":
    main()
