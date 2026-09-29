#!/usr/bin/env python3
# a2-0700.py — FULL z.ai AGENT-PATH E2E (contract: create agent via Agent surface, NOT chat)
# Steps: expand sidebar -> verify -> click Agent (sidebar) -> verify Agent-space ->
#        type task into "Send a Message" (submit) -> readback; fallback: New Task modal
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open(bmt.RESULTS + ".ctx")).get("probe_tab")

def insert_click(tgt, label, tab_id=tab):
    pl = {"role": tgt.get("role") or "button", "tab_id": tab_id,
          "semantic_ref": tgt["semantic_ref"], "accessible_name": tgt.get("name") or label}
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl,
           "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-a2-{uuid.uuid4().hex[:8]}"}
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

def cap(label, timeout=70):
    c = run_test(label, "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=timeout)
    return c.get("_result_full") or {}

def named(f):
    return [(t.get("role"), t.get("name")) for t in (f.get("semantic_targets") or []) if t.get("name")]

def find_btn(f, name_pred):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "button" and t.get("semantic_ref") and name_pred((t.get("name") or "")):
            return t
    return None

def wait_budget(sec=110):
    print(f"  [budget wait {sec}s]", flush=True)
    time.sleep(sec)

print(f"=== AGENT-PATH E2E on {tab} ===", flush=True)

# Step 1: current state
f = cap("AG1-CAP0")
els = len((f.get("interaction_tree") or {}).get("elements") or [])
nm = named(f)
print(f"state0: els={els} names={nm[:12]}", flush=True)

# Step 2: ensure sidebar expanded (Agent button present?)
agent = find_btn(f, lambda n: n.strip() == "Agent")
if not agent:
    tgl = find_btn(f, lambda n: n.strip() == "Toggle Sidebar")
    if tgl:
        wait_budget(60)
        insert_click(tgl, "Toggle-Sidebar-Expand")
        time.sleep(6)
        f = cap("AG2-CAP1")
        print(f"state1: els={len((f.get('interaction_tree') or {}).get('elements') or [])} names={named(f)[:12]}", flush=True)
        agent = find_btn(f, lambda n: n.strip() == "Agent")

if not agent:
    print("AGENT BUTTON STILL NOT FOUND — abort", flush=True)
    bmt.save({"id": "AG-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "agent_button_not_found", "names": named(f)})
    sys.exit(1)

# Step 3: click Agent (sidebar)
wait_budget(60)
r = insert_click(agent, "Agent-Tab")
time.sleep(8)
f = cap("AG3-CAP-AGENTSPACE")
print(f"agent-space: els={len((f.get('interaction_tree') or {}).get('elements') or [])} names={named(f)[:20]}", flush=True)
bmt.save({"id": "AG3-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "agent_space_names": named(f)[:30], "url": f.get("url")})

# Step 4: type task into "Send a Message" textbox (submit_after_type=True)
txt = None
for t in (f.get("semantic_targets") or []):
    if t.get("role") == "textbox" and t.get("semantic_ref"):
        txt = t; break
if not txt:
    print("no textbox in agent space", flush=True); sys.exit(1)
BRIEF = ("SWARM TASK (Agent session): build a task-board page for our agent swarm: goals, agents, statuses. "
         "Work autonomously, iterate, show the plan first. Reply in English.")
st = {"tab_id": tab, "role": "textbox", "semantic_ref": txt["semantic_ref"],
      "text": BRIEF, "submit_after_type": True, "replace_existing": False}
wait_budget(60)
r = run_test("AG4-TYPE", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
print(f"AG4 type-submit: {r['status']} err={r.get('error')}", flush=True)
rs = r.get("result_summary") or {}
print(f"AG4 receipt: effect={rs.get('effect_state')} inserted={rs.get('inserted_chars')} url_sha_changed={rs.get('post_url_sha256') != rs.get('prompt_sha256')}", flush=True)

time.sleep(10)
f = cap("AG5-CAP-POST")
u = f.get("url") or ""
print(f"post: url={u[:100]}", flush=True)
print(f"post names: {named(f)[:20]}", flush=True)
created = ("/c/" in u) or ("/agent/" in u.lower()) or ("task" in u.lower())
# readback via transcript
tr = run_test("AG6-TRANSCRIPT", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 6}, platform=P)
fr = tr.get("_result_full") or {}
items = fr.get("entries") or fr.get("messages") or fr.get("items") or []
print(f"transcript entries: {len(items) if isinstance(items, list) else 'n/a'}", flush=True)
if isinstance(items, list):
    for it in items[:5]:
        print("  ", json.dumps(it, ensure_ascii=False)[:150], flush=True)
bmt.save({"id": "AG6-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "post_url": u, "agent_session_created": bool(created), "names": named(f)[:30],
          "type_receipt": {"effect_state": rs.get("effect_state"), "inserted_chars": rs.get("inserted_chars")}})
print("AGENT-PATH E2E done", flush=True)
