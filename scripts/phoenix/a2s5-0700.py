#!/usr/bin/env python3
# a2s5-0700.py — submit attempts in Agent-space: focus+type, PRESS_KEY+semref, template click
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"

def cap(label):
    c = run_test(label, "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    return c.get("_result_full") or {}

def named(f):
    return [(t.get("role"), t.get("name")) for t in (f.get("semantic_targets") or []) if t.get("name")]

def find_tb(f, named_only=False):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            if named_only and not t.get("name"):
                continue
            return t
    return None

def find_btn(f, pred):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "button" and t.get("semantic_ref") and pred(t.get("name") or ""):
            return t
    return None

BRIEF = ("AGENT TASK: build a swarm task-board HTML page listing goals, agents, statuses. "
         "Plan briefly, build it, show result. Work autonomously.")

print("=== S5 submit attempts ===", flush=True)
f = cap("S5-CAP0")
u0 = f.get("url") or ""
tb = find_tb(f, named_only=True)
print(f"start url={u0[:70]} textbox={'yes' if tb else 'no'} draft_len={ (tb or {}).get('value_length') }", flush=True)

# --- Attempt 1: FOCUS -> TYPE(submit) ---
created = False
if tb:
    sf = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"]}
    time.sleep(18)
    r = run_test("S5-FOCUS", "SEMANTIC_FOCUS", payload=sf, platform=P, mutating=True, timeout=45)
    print(f"focus: {r['status']} err={r.get('error')}", flush=True)
    st = dict(sf); st.update({"text": BRIEF, "submit_after_type": True, "replace_existing": False})
    time.sleep(18)
    r = run_test("S5-TYPE", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    rs = r.get("result_summary") or {}
    print(f"focus+type-submit: {r['status']} effect={rs.get('effect_state')} chars={rs.get('inserted_chars')}", flush=True)
    time.sleep(10)
    f = cap("S5-CAP1")
    u1 = f.get("url") or ""
    created = u1 != u0 and "/c/" in u1
    print(f"post url={u1[:80]} conv={created}", flush=True)

# --- Attempt 2: PRESS_KEY Enter with semref fields ---
if not created and tb:
    pk = {"key": "Enter", "tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"]}
    time.sleep(18)
    r = run_test("S5-PK", "PRESS_KEY", payload=pk, platform=P, mutating=True, timeout=45)
    print(f"press_key+semref: {r['status']} err={r.get('error')}", flush=True)
    time.sleep(10)
    f = cap("S5-CAP2")
    u2 = f.get("url") or ""
    created = u2 != u0 and "/c/" in u2
    print(f"post-pk url={u2[:80]} conv={created}", flush=True)

# --- Attempt 3: template click (Landing Page) ---
if not created:
    tpl = find_btn(f, lambda n: n.strip() == "Landing Page")
    if tpl:
        time.sleep(18)
        pl = {"role": "button", "tab_id": tab, "semantic_ref": tpl["semantic_ref"], "accessible_name": "Landing Page"}
        cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
        row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
               "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl, "status": "PENDING",
               "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
               "idempotency_key": f"glm-diag-s5-{uuid.uuid4().hex[:8]}"}
        code, _ = bmt.rest_insert(row)
        stt = None
        if code in (200, 201):
            for _ in range(18):
                c = bmt.get_command(cid)
                if c and c.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
                    stt = c; break
                time.sleep(2.5)
        stt = stt or {"status": f"HTTP{code}"}
        bmt.save({"id": "CLICK-Template-LandingPage", "action": "TYPED_CLICK", "command_id": cid,
                  "status": stt.get("status"), "error": stt.get("error"), "channel": "insert"})
        print(f"template click: {stt.get('status')} err={stt.get('error')}", flush=True)
        time.sleep(12)
        f = cap("S5-CAP3")
        u3 = f.get("url") or ""
        print(f"post-template url={u3[:90]}", flush=True)
        print(f"post-template names: {named(f)[:18]}", flush=True)
        bmt.save({"id": "S5-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "start_url": u0, "template_url": u3, "names": named(f)[:34],
                  "focus_type_effect": rs.get("effect_state")})
else:
    bmt.save({"id": "S5-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "start_url": u0, "final_url": f.get("url"), "created": True})
print("stage5 done", flush=True)
