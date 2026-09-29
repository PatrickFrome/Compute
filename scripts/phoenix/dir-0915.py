#!/usr/bin/env python3
# dir-0915.py — directive tick 09:15 (Job 419718):
# (1) fleet drift check + reconcile, (2) re-prompt loop #2 on critic thread (de-facto swarm autonomy)
import importlib.util, json, time, uuid, datetime
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-d0915.json"
bmt._results = []
run_test, P, TAB = bmt.run_test, "GLM_ZAI", "tab_6924b587-8aa4-44ad-af7b-c7e4f814a6c6"
CONV = "/c/cfefd09f"
CRITIC_TITLE = "Top Risks & Missing Requirement for Swarm Task-Board"

def direct_insert(action, payload, ttl=75, poll=55):
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": "zai-directive-419718", "action": action, "platform": P,
           "payload": payload, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-dir-0915-{uuid.uuid4().hex[:8]}"}
    code, ins = bmt.rest_insert(row)
    if code not in (200, 201):
        print(f"  [INSERT {action}] HTTP {code}", flush=True)
        return None
    st = None; t0 = time.time()
    while time.time() - t0 < poll:
        st = bmt.get_command(cid)
        if st and st.get("status") in ("COMPLETED", "FAILED", "EXPIRED"): break
        time.sleep(2.5)
    rc = ((st or {}).get("receipt") or {})
    print(f"  [{action}] {(st or {}).get('status')} err={str((st or {}).get('error'))[:80]}", flush=True)
    return rc.get("result") or {}

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
            return "HAS_TEXT:" + t[:60]
    return "EMPTY(placeholder)"

print("=== 1) FLEET DRIFT CHECK ===", flush=True)
f1 = run_test("F1-FLEET", "FLEET_STATUS", timeout=60)
agents = ((f1.get("_result_full") or {}).get("agents")) or []
drift = []
for a in agents:
    tp = a.get("transport_proof") or {}
    drift.append({"role": a.get("role"), "state": a.get("lifecycle_state"),
                  "conv_url": str(tp.get("conversation_url") or "")[:60],
                  "proven_at": tp.get("proven_at"), "epoch": a.get("generation_epoch")})
    print(f"  {a.get('role')}: {a.get('lifecycle_state')} conv={str(tp.get('conversation_url') or '')[:50]} proven_at={tp.get('proven_at')}", flush=True)
bmt.save({"id": "F1-ANALYSIS", "action": "FLEET-DRIFT", "status": "COMPLETED", "channel": "local", "agents": drift})

time.sleep(20)
print("=== 2) FLEET_RECONCILE (target 4) ===", flush=True)
run_test("F2-RECONCILE", "FLEET_RECONCILE", payload={"target_agents": 4}, mutating=True, timeout=70)
f2 = run_test("F3-FLEET", "FLEET_STATUS", timeout=60)
counts = {}
for a in ((f2.get("_result_full") or {}).get("agents")) or []:
    counts[a.get("lifecycle_state")] = counts.get(a.get("lifecycle_state"), 0) + 1
print(f"  post-reconcile states: {counts}", flush=True)
bmt.save({"id": "F3-ANALYSIS", "action": "POST-RECONCILE", "status": "COMPLETED", "channel": "local", "states": counts})

print("=== 3) RE-PROMPT LOOP #2 (critic thread) ===", flush=True)
cap0 = run_test("R1-CAP0", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
url0 = (cap0.get("_result_full") or {}).get("url", "")
print(f"  tab url: {url0[:80]}", flush=True)
if CONV not in url0:
    btn = find_btn(cap0, "Top Risks")
    print(f"  critic title button: {bool(btn)}", flush=True)
    if btn:
        time.sleep(20)
        direct_insert("TYPED_CLICK", {"role": "button", "tab_id": TAB,
                      "semantic_ref": btn["semantic_ref"], "accessible_name": CRITIC_TITLE})
        time.sleep(8)
        cap0 = run_test("R1b-CAP0b", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
        url0 = (cap0.get("_result_full") or {}).get("url", "")
        print(f"  post-click url: {url0[:80]} on_critic={CONV in url0}", flush=True)
        bmt.save({"id": "R1b-ANALYSIS", "action": "NAV-BACK", "status": "COMPLETED", "channel": "local",
                  "url": url0, "on_critic": CONV in url0})

if CONV in url0:
    tb = None
    for t in (cap0.get("_result_full") or {}).get("semantic_targets") or []:
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            tb = t; break
    if tb:
        time.sleep(20)
        BRIEF2 = ("CONTINUATION TASK 2 (role: CRITIC): convert your 5 mitigations into a prioritized "
                  "checklist (P0/P1/P2) for building the swarm task-board HTML v1. Output only the checklist.")
        st = {"tab_id": TAB, "role": "textbox", "semantic_ref": tb["semantic_ref"],
              "text": BRIEF2, "submit_after_type": True, "replace_existing": False}
        r = run_test("R2-RETYPE2", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
        eff = (r.get("result_summary") or {}).get("effect_state")
        time.sleep(8)
        cap1 = run_test("R3-CAP1", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
        url1 = (cap1.get("_result_full") or {}).get("url", "")
        ds = draft_state(cap1)
        sent = ds.startswith("EMPTY")
        bmt.save({"id": "R3-ANALYSIS", "action": "RE-PROMPT-2", "status": "COMPLETED", "channel": "local",
                  "effect_state": eff, "url": url1, "same_thread": CONV in url1,
                  "draft_state": ds, "delivered": sent})
        print(f"  effect={eff} same_thread={CONV in url1} draft={ds[:50]} delivered={sent}", flush=True)
else:
    bmt.save({"id": "R-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "could_not_reach_critic_thread"})

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("tick 0915 done", flush=True)
