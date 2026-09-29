#!/usr/bin/env python3
# a2b-0745.py — Agent-path E2E continuation: RELOAD heals DOM -> find Agent -> click -> New Task -> submit -> readback
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open(bmt.RESULTS + ".ctx")).get("probe_tab")

def insert_click(tgt, label):
    pl = {"role": tgt.get("role") or "button", "tab_id": tab,
          "semantic_ref": tgt["semantic_ref"], "accessible_name": tgt.get("name") or label}
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl,
           "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-a2b-{uuid.uuid4().hex[:8]}"}
    code, _ = bmt.rest_insert(row)
    if code not in (200, 201):
        print(f"  [CLICK {label}] insert HTTP {code}", flush=True); return None
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

def find_btn(f, pred):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "button" and t.get("semantic_ref") and pred(t.get("name") or ""):
            return t
    return None

def wait_budget(sec=65):
    print(f"  [budget wait {sec}s]", flush=True); time.sleep(sec)

print(f"=== AGENT-PATH E2E-2 (reload-heal) on {tab} ===", flush=True)

# 1) RELOAD heals semantic plane
run_test("B01-RELOAD", "RELOAD", payload={"tab_id": tab}, platform=P, mutating=True)
time.sleep(9)
f = cap("B02-CAP-RELOADED")
print(f"reloaded: els={len((f.get('interaction_tree') or {}).get('elements') or [])} names={named(f)[:14]}", flush=True)

# 2) locate Agent (sidebar)
agent = find_btn(f, lambda n: n.strip() == "Agent")
if not agent:
    # maybe sidebar collapsed still; try one toggle AFTER reload
    tgl = find_btn(f, lambda n: n.strip() == "Toggle Sidebar")
    if tgl:
        wait_budget()
        insert_click(tgl, "Toggle-After-Reload")
        time.sleep(7)
        f = cap("B03-CAP-Toggled")
        print(f"toggled: els={len((f.get('interaction_tree') or {}).get('elements') or [])} names={named(f)[:14]}", flush=True)
        agent = find_btn(f, lambda n: n.strip() == "Agent")
if not agent:
    # fallback: NAVIGATE to conversation root with reload trick: navigate to / then capture again
    print("Agent still absent; NAVIGATE / + RELOOP", flush=True)
    run_test("B04-NAV", "NAVIGATE", payload={"tab_id": tab, "url": "https://chat.z.ai/"}, platform=P, mutating=True)
    time.sleep(6)
    run_test("B05-RELOAD2", "RELOAD", payload={"tab_id": tab}, platform=P, mutating=True)
    time.sleep(9)
    f = cap("B06-CAP2")
    agent = find_btn(f, lambda n: n.strip() == "Agent")
    print(f"final: els={len((f.get('interaction_tree') or {}).get('elements') or [])} names={named(f)[:14]}", flush=True)

if not agent:
    bmt.save({"id": "B-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "agent_button_not_found_after_reload", "names": named(f)})
    print("ABORT: Agent not found", flush=True); sys.exit(1)

# 3) click Agent
wait_budget()
r = insert_click(agent, "Agent-Tab")
time.sleep(9)
f = cap("B07-CAP-AGENTSPACE")
els = len((f.get("interaction_tree") or {}).get("elements") or [])
print(f"agent-space: els={els} names={named(f)[:20]}", flush=True)
bmt.save({"id": "B07-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "agent_space_names": named(f)[:30], "els": els})

# 4) submit task in agent space textbox
txt = None
for t in (f.get("semantic_targets") or []):
    if t.get("role") == "textbox" and t.get("semantic_ref"):
        txt = t; break
if not txt:
    print("no textbox in agent space", flush=True); sys.exit(1)
BRIEF = ("AGENT TASK: create a task-board page (single HTML) listing swarm goals, agents, statuses. "
         "Work autonomously: plan, build, iterate. Show plan first.")
st = {"tab_id": tab, "role": "textbox", "semantic_ref": txt["semantic_ref"],
      "text": BRIEF, "submit_after_type": True, "replace_existing": False}
wait_budget()
r = run_test("B08-TYPE", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
print(f"B08 type: {r['status']} err={r.get('error')}", flush=True)
rs = r.get("result_summary") or {}
print(f"B08 receipt: effect={rs.get('effect_state')} inserted={rs.get('inserted_chars')}", flush=True)

time.sleep(12)
f = cap("B09-CAP-POST")
u = f.get("url") or ""
print(f"post url={u[:110]}", flush=True)
tr = run_test("B10-TRANSCRIPT", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 6}, platform=P)
fr = tr.get("_result_full") or {}
items = fr.get("entries") or fr.get("messages") or fr.get("items") or []
cnt = len(items) if isinstance(items, list) else 0
print(f"transcript entries: {cnt}", flush=True)
for it in (items if isinstance(items, list) else [])[:4]:
    print("  ", json.dumps(it, ensure_ascii=False)[:140], flush=True)
created = bool(cnt) or ("/c/" in u) or ("agent" in u.lower())
bmt.save({"id": "B10-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "post_url": u, "transcript_entries": cnt, "agent_session_created": bool(created),
          "type_receipt": {"effect_state": rs.get("effect_state"), "inserted_chars": rs.get("inserted_chars")}})
print("E2E-2 done", flush=True)
