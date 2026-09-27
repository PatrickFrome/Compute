#!/usr/bin/env python3
# a2s1-0700.py — Agent-path E2E Stage 1: revive capture (RELOAD), ensure sidebar, click Agent, verify Agent-space
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open(bmt.RESULTS + ".ctx")).get("probe_tab")

def insert_click(tgt, label, tab_id):
    pl = {"role": tgt.get("role") or "button", "tab_id": tab_id,
          "semantic_ref": tgt["semantic_ref"], "accessible_name": tgt.get("name") or label}
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl,
           "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-a2s1-{uuid.uuid4().hex[:8]}"}
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

def find_btn(f, pred):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "button" and t.get("semantic_ref") and pred(t.get("name") or ""):
            return t
    return None

print(f"=== AGENT-PATH S1 on {tab} ===", flush=True)

# 1) RELOAD to revive semantic plane (audit-G lesson)
run_test("S1-RELOAD", "RELOAD", payload={"tab_id": tab}, platform=P, mutating=True)
time.sleep(8)
f = cap("S1-CAP0")
els = len((f.get("interaction_tree") or {}).get("elements") or [])
print(f"post-reload: els={els} names={named(f)[:14]}", flush=True)

agent = find_btn(f, lambda n: n.strip() == "Agent")

# 2) if no Agent: try toggle sidebar once more after reload
if not agent:
    tgl = find_btn(f, lambda n: n.strip() == "Toggle Sidebar")
    if tgl:
        time.sleep(16)
        insert_click(tgl, "Toggle-after-Reload", tab)
        time.sleep(8)
        f = cap("S1-CAP1")
        els = len((f.get("interaction_tree") or {}).get("elements") or [])
        print(f"post-toggle: els={els} names={named(f)[:14]}", flush=True)
        agent = find_btn(f, lambda n: n.strip() == "Agent")

# 3) if still no Agent: fresh NEW_TAB (clean birth default-expanded sidebar)
if not agent:
    print("fresh NEW_TAB fallback", flush=True)
    nt = run_test("S1-NEWTAB", "NEW_TAB", payload={"url": "https://chat.z.ai/", "kind": "GLM_CHAT"},
                  platform=P, mutating=True, timeout=60)
    ntab = (nt.get("_result_full") or {}).get("tab_id") if nt.get("status") == "COMPLETED" else None
    print(f"  fresh tab={ntab}", flush=True)
    if not ntab:
        print("abort: cannot get tab", flush=True); sys.exit(1)
    tab = ntab
    ctx = json.load(open(bmt.RESULTS + ".ctx")); ctx["probe_tab"] = tab
    json.dump(ctx, open(bmt.RESULTS + ".ctx", "w"))
    time.sleep(6)
    f = cap("S1-CAP-NEWTAB")
    els = len((f.get("interaction_tree") or {}).get("elements") or [])
    print(f"newtab: els={els} names={named(f)[:14]}", flush=True)
    agent = find_btn(f, lambda n: n.strip() == "Agent")

if not agent:
    print("ABORT: Agent button still not found", flush=True)
    bmt.save({"id": "S1-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "agent_button_not_found_final", "els": els, "names": named(f)})
    sys.exit(1)

# 4) click Agent
time.sleep(16)
r = insert_click(agent, "Agent-Tab", tab)
time.sleep(8)
f = cap("S1-CAP-AGENTSPACE")
els2 = len((f.get("interaction_tree") or {}).get("elements") or [])
nm2 = named(f)
print(f"agent-space: els={els2} names={nm2[:22]}", flush=True)
is_agent_space = any(n == "New Task" for _, n in nm2) or any(n == "ZCode" for _, n in nm2)
bmt.save({"id": "S1-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "tab": tab, "agent_space_reached": bool(is_agent_space), "els": els2, "names": nm2[:30],
          "click_status": r})
print(f"AGENT-SPACE REACHED: {bool(is_agent_space)}", flush=True)
print("stage1 done", flush=True)
