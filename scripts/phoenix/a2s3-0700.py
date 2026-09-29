#!/usr/bin/env python3
# a2s3-0700.py — Agent-path Stage 3: use REAL-VIEWPORT fleet tab: NAVIGATE to z.ai home -> Toggle Sidebar -> click Agent -> verify
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
FTAB = "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"  # PLANNER, real window 950x577
tab = FTAB

def insert_click(tgt, label, tab_id):
    pl = {"role": tgt.get("role") or "button", "tab_id": tab_id,
          "semantic_ref": tgt["semantic_ref"], "accessible_name": tgt.get("name") or label}
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl,
           "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=75)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-a2s3-{uuid.uuid4().hex[:8]}"}
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

print(f"=== AGENT-PATH S3 on fleet tab {tab} ===", flush=True)

# 1) NAVIGATE to z.ai home in the real window
r = run_test("S3-NAV", "NAVIGATE", payload={"tab_id": tab, "url": "https://chat.z.ai/"}, platform=P, mutating=True, timeout=60)
print(f"navigate: {r['status']} err={r.get('error')}", flush=True)
time.sleep(8)
f = cap("S3-CAP0")
vp = f.get("viewport") or {}
print(f"home: viewport={vp.get('width')}x{vp.get('height')} els={len((f.get('interaction_tree') or {}).get('elements') or [])}", flush=True)
print(f"names: {named(f)[:16]}", flush=True)

# 2) expand sidebar if needed (valid geometry now)
tgl = find_btn(f, lambda n: n.strip() == "Toggle Sidebar")
if tgl:
    time.sleep(16)
    insert_click(tgl, "Toggle-S3", tab)
    time.sleep(8)
    f = cap("S3-CAP1")
    print(f"post-toggle: els={len((f.get('interaction_tree') or {}).get('elements') or [])}", flush=True)
    print(f"names: {named(f)[:20]}", flush=True)

agent = find_btn(f, lambda n: n.strip() == "Agent")
if not agent:
    print("still no Agent — trying 'More' overflow menu", flush=True)
    more = find_btn(f, lambda n: n.strip() == "More")
    if more:
        time.sleep(16)
        insert_click(more, "More-S3", tab)
        time.sleep(6)
        f = cap("S3-CAP2")
        print(f"post-more: names={named(f)[:24]}", flush=True)
        agent = find_btn(f, lambda n: n.strip() == "Agent")
    if not agent:
        bmt.save({"id": "S3-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "agent_not_found_real_window", "names": named(f)})
        print("ABORT", flush=True); sys.exit(1)

# 3) click Agent
time.sleep(16)
r = insert_click(agent, "Agent-Tab-S3", tab)
time.sleep(8)
f = cap("S3-CAP-AGENTSPACE")
nm2 = named(f)
els2 = len((f.get("interaction_tree") or {}).get("elements") or [])
print(f"agent-space: els={els2} names={nm2[:24]}", flush=True)
is_agent_space = any(n in ("New Task", "ZCode", "AutoClaw") for _, n in nm2)
bmt.save({"id": "S3-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "tab": tab, "agent_space_reached": bool(is_agent_space), "els": els2, "names": nm2[:30],
          "click_status": r})
print(f"AGENT-SPACE REACHED: {bool(is_agent_space)}", flush=True)
print("stage3 done", flush=True)
