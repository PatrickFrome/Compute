#!/usr/bin/env python3
# bmt-m0930.py — tick 09:30 (Job 419203): transport-proof minting per fleet agent + PLANNER dispatch E2E
import importlib.util, json, time, uuid, datetime
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-m0930.json"
bmt._results = []
run_test, P = bmt.run_test, "GLM_ZAI"

def direct_insert(action, payload, tab, ttl=75, poll=55):
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": "zai-live-test-419203", "action": action, "platform": P,
           "payload": payload, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-bt-0930-{uuid.uuid4().hex[:8]}"}
    code, ins = bmt.rest_insert(row)
    if code not in (200, 201):
        print(f"  [INSERT {action}] HTTP {code}", flush=True); return None
    st = None; t0 = time.time()
    while time.time() - t0 < poll:
        st = bmt.get_command(cid)
        if st and st.get("status") in ("COMPLETED", "FAILED", "EXPIRED"): break
        time.sleep(2.5)
    rc = ((st or {}).get("receipt") or {})
    print(f"  [{action}] {(st or {}).get('status')} err={str((st or {}).get('error'))[:80]}", flush=True)
    return rc.get("result") or {}

def fleet_snapshot(tag):
    r = run_test(tag, "FLEET_STATUS", timeout=60)
    out = []
    for a in ((r.get("_result_full") or {}).get("agents")) or []:
        tp = a.get("transport_proof") or {}
        out.append({"role": a.get("role"), "state": a.get("lifecycle_state"),
                    "tab_id": a.get("tab_id"), "conv": str(tp.get("conversation_url") or "")[-20:],
                    "proven_at": tp.get("proven_at")})
    return out

def find_btn(cap, contains):
    for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
        nm = (t.get("name") or "").strip()
        if t.get("role") == "button" and contains.lower() in nm.lower() and t.get("semantic_ref"):
            return t
    return None

def draft_state(cap):
    els = ((cap.get("_result_full") or {}).get("interaction_tree") or {}).get("elements") or []
    tbs = [e for e in els if e.get("role") == "textbox"]
    if not tbs: return "NO_TEXTBOX"
    for e in tbs:
        t = str(e.get("text") or "")
        if t.strip() and "Send a Message" not in t and len(t) > 3:
            return "HAS_TEXT:" + t[:50]
    return "EMPTY(placeholder)"

print("=== 1) FLEET BEFORE ===", flush=True)
before = fleet_snapshot("M1-FLEET-BEFORE")
for a in before: print("  ", a, flush=True)
bmt.save({"id": "M1-ANALYSIS", "action": "FLEET-BEFORE", "status": "COMPLETED", "channel": "local", "agents": before})

print("=== 2) PROOF MINT: CAPTURE each fleet tab ===", flush=True)
tabs = {a["role"]: a["tab_id"] for a in before if a.get("tab_id")}
for role, tid in tabs.items():
    r = run_test(f"M2-CAP-{role}", "CAPTURE", payload={"tab_id": tid}, platform=P, timeout=70)
    full = r.get("_result_full") or {}
    print(f"  {role}: url={str(full.get('url') or '')[:60]}", flush=True)
    bmt.save({"id": f"M2-{role}-NOTE", "action": "PROOF-MINT", "status": "COMPLETED", "channel": "local",
              "role": role, "tab_id": tid, "url": str(full.get("url") or "")[:100]})
    time.sleep(4)
run_test("M3-FLEET-AFTER", "FLEET_STATUS", timeout=60)
after_r = None
for x in bmt._results:
    if x.get("id") == "M3-FLEET-AFTER" and x.get("_result_full"): after_r = x["_result_full"]
after = []
for a in (after_r or {}).get("agents") or []:
    tp = a.get("transport_proof") or {}
    after.append({"role": a.get("role"), "conv": str(tp.get("conversation_url") or "")[-20:], "proven_at": tp.get("proven_at")})
print("=== AFTER captures ===", flush=True)
for a in after: print("  ", a, flush=True)
bmt.save({"id": "M3-ANALYSIS", "action": "FLEET-AFTER", "status": "COMPLETED", "channel": "local", "agents": after})

print("=== 3) PLANNER DISPATCH E2E ===", flush=True)
ptid = tabs.get("PLANNER")
if ptid:
    cap = run_test("M4-CAP-PLANNER", "CAPTURE", payload={"tab_id": ptid}, platform=P, timeout=70)
    url0 = (cap.get("_result_full") or {}).get("url", "")
    print(f"  planner tab url: {url0[:80]}", flush=True)
    ok_path = None
    if "/c/4d04c632" in url0:
        ok_path = "already_on_thread"
    else:
        btn = find_btn(cap, "4d04c632") or find_btn(cap, "METAENGINE SUPERVISOR")
        print(f"  planner thread button found: {bool(btn)} name={(btn or {}).get('name', '')[:40]}", flush=True)
        if btn:
            time.sleep(20)
            direct_insert("TYPED_CLICK", {"role": "button", "tab_id": ptid,
                          "semantic_ref": btn["semantic_ref"],
                          "accessible_name": (btn.get("name") or "").strip()}, ptid)
            time.sleep(8)
            cap = run_test("M5-CAP-PLANNER2", "CAPTURE", payload={"tab_id": ptid}, platform=P, timeout=70)
            url0 = (cap.get("_result_full") or {}).get("url", "")
            ok_path = "sidebar_click"
            print(f"  post-click url: {url0[:80]} on_thread={'/c/4d04c632' in url0}", flush=True)
            bmt.save({"id": "M5-ANALYSIS", "action": "NAV-PLANNER", "status": "COMPLETED", "channel": "local",
                      "url": url0, "on_thread": "/c/4d04c632" in url0, "path": ok_path})
    if "/c/4d04c632" in url0:
        tb = None
        for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
            if t.get("role") == "textbox" and t.get("semantic_ref"):
                tb = t; break
        if tb:
            time.sleep(20)
            BRIEF = ("PLANNER DISPATCH (role: PLANNER, from supervisor): decompose 'swarm task-board HTML v1' "
                     "into 4 concrete build tasks (columns/UI, card model, agent pickup protocol, status sync). "
                     "Output the 4 tasks one line each. Be concise.")
            st = {"tab_id": ptid, "role": "textbox", "semantic_ref": tb["semantic_ref"],
                  "text": BRIEF, "submit_after_type": True, "replace_existing": False}
            r = run_test("M6-DISPATCH", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
            eff = (r.get("result_summary") or {}).get("effect_state")
            time.sleep(8)
            cap2 = run_test("M7-CAP-VERIFY", "CAPTURE", payload={"tab_id": ptid}, platform=P, timeout=70)
            url1 = (cap2.get("_result_full") or {}).get("url", "")
            ds = draft_state(cap2)
            bmt.save({"id": "M7-ANALYSIS", "action": "PLANNER-DISPATCH", "status": "COMPLETED", "channel": "local",
                      "effect_state": eff, "url": url1, "same_thread": "/c/4d04c632" in url1,
                      "draft_state": ds, "delivered": ds.startswith("EMPTY")})
            print(f"  dispatch: effect={eff} same_thread={'/c/4d04c632' in url1} draft={ds[:40]}", flush=True)
else:
    bmt.save({"id": "M4-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "no_planner_tab"})

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("tick 0930 done", flush=True)
