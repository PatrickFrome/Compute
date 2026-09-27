#!/usr/bin/env python3
# a2s4-0700.py — Agent-path Stage 4: CREATE agent task in Agent-space
# Path A: type task brief into "Send a Message" textbox + submit -> readback
# Path B (fallback): "New Task" button -> modal -> fill -> submit
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"

def insert_click(tgt, label, tab_id=tab):
    pl = {"role": tgt.get("role") or "button", "tab_id": tab_id,
          "semantic_ref": tgt["semantic_ref"], "accessible_name": tgt.get("name") or label}
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl,
           "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-a2s4-{uuid.uuid4().hex[:8]}"}
    code, _ = bmt.rest_insert(row)
    if code not in (200, 201):
        print(f"  [CLICK {label}] insert HTTP {code}", flush=True)
        return None
    st = None
    for _ in range(18):
        c = bmt.get_command(cid)
        if c and c.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            st = c; break
        time.sleep(2.5)
    st = st or {"status": "POLL_TIMEOUT"}
    bmt.save({"id": f"CLICK-{label}", "action": "TYPED_CLICK", "command_id": cid,
              "status": st.get("status"), "error": st.get("error"), "channel": "insert", "target": label})
    print(f"  [CLICK {label}] {st.get('status')} err={st.get('error')}", flush=True)
    return st.get("status")

def cap(label):
    c = run_test(label, "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    return c.get("_result_full") or {}

def named(f):
    return [(t.get("role"), t.get("name")) for t in (f.get("semantic_targets") or []) if t.get("name")]

def find_tb(f, name=None):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            if name is None or (t.get("name") or "") == name:
                return t
    return None

def find_btn(f, pred):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "button" and t.get("semantic_ref") and pred(t.get("name") or ""):
            return t
    return None

BRIEF = ("AGENT TASK: Create a swarm task-board web page (single HTML file) listing goals, agents, statuses for our "
         "METAENGINE agent swarm. Plan briefly, then build it, then show the result. Work autonomously.")

print("=== AGENT-PATH S4 create ===", flush=True)
f = cap("S4-CAP0")
u0 = f.get("url") or ""
print(f"start url={u0[:80]} names={named(f)[:14]}", flush=True)

# PATH A: direct type+submit into Send a Message
tb = find_tb(f, "Send a Message") or find_tb(f)
nt = find_btn(f, lambda n: "new task" in n.strip().lower())
print(f"textbox={'yes' if tb else 'no'} newtask={'yes' if nt else 'no'}", flush=True)

created = False
if tb:
    st = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": BRIEF, "submit_after_type": True, "replace_existing": False}
    time.sleep(18)
    r = run_test("S4-TYPEA", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    rs = r.get("result_summary") or {}
    print(f"pathA type-submit: {r['status']} err={r.get('error')} effect={rs.get('effect_state')} chars={rs.get('inserted_chars')}", flush=True)
    time.sleep(12)
    f = cap("S4-CAPA")
    u1 = f.get("url") or ""
    print(f"postA url={u1[:90]}", flush=True)
    created = (u1 != u0 and ("/c/" in u1 or "/agent" in u1.lower() or "/task" in u1.lower() or "/chat" in u1))
    if not created and rs.get("effect_state") == "AMBIGUOUS_AFTER_ENTER":
        # draft may not have submitted; check draft content
        tb2 = find_tb(f, "Send a Message") or find_tb(f)
        draft_len = (tb2 or {}).get("value_length") or 0
        print(f"postA draft_len={draft_len}", flush=True)
        if draft_len and draft_len > 40:
            # text stayed in draft: click send/submit button if present
            send = find_btn(f, lambda n: n.strip().lower() in ("send", "submit") or "send" in n.strip().lower())
            print(f"send button: {send.get('name') if send else None}", flush=True)
            if send:
                time.sleep(16)
                insert_click(send, "Send-S4")
                time.sleep(10)
                f = cap("S4-CAP-SEND")
                u2 = f.get("url") or ""
                created = (u2 != u0)
                print(f"post-send url={u2[:90]} created={created}", flush=True)

bmt.save({"id": "S4-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "path": "A" if tb else "none", "agent_task_created": bool(created),
          "start_url": u0, "final_url": (f.get("url") or ""), "names": named(f)[:30]})
print(f"AGENT TASK CREATED (pathA): {bool(created)}", flush=True)

# PATH B fallback: New Task modal
if not created and nt:
    print("fallback: New Task modal", flush=True)
    time.sleep(16)
    r = insert_click(nt, "NewTask-S4")
    time.sleep(7)
    f = cap("S4-CAP-MODAL")
    tbs = [t for t in (f.get("semantic_targets") or []) if t.get("role") == "textbox" and t.get("semantic_ref")]
    print(f"modal textboxes: {len(tbs)} names={[t.get('name') for t in tbs]}", flush=True)
    print(f"modal names: {named(f)[:26]}", flush=True)
    if tbs:
        tbm = tbs[0]
        st = {"tab_id": tab, "role": "textbox", "semantic_ref": tbm["semantic_ref"],
              "text": BRIEF, "submit_after_type": True, "replace_existing": False}
        time.sleep(16)
        r2 = run_test("S4-TYPEB", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
        print(f"pathB type: {r2['status']} err={r2.get('error')}", flush=True)
        time.sleep(10)
        f = cap("S4-CAPB")
        ub = f.get("url") or ""
        created_b = (ub != (f.get("url") or "")) or "/agent" in ub.lower()
        bmt.save({"id": "S4-ANALYSIS-B", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "modal_textboxes": len(tbs), "final_url": ub, "names": named(f)[:30]})
        print(f"pathB url={ub[:90]}", flush=True)

print("stage4 done", flush=True)
