#!/usr/bin/env python3
# a2c-0750.py — Agent-path E2E v3: tight capture->click coupling (L16: semref TTL ~60s)
# Strategy: probe candidate USER tabs for Agent button; click IMMEDIATELY after capture (no waits).
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"

def insert_click(tgt, tab, label):
    pl = {"role": tgt.get("role") or "button", "tab_id": tab,
          "semantic_ref": tgt["semantic_ref"], "accessible_name": tgt.get("name") or label}
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": bmt.ISSUER, "action": "TYPED_CLICK", "platform": P, "payload": pl,
           "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=60)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-diag-a2c-{uuid.uuid4().hex[:8]}"}
    code, _ = bmt.rest_insert(row)
    if code not in (200, 201):
        print(f"  [CLICK {label}] insert HTTP {code}", flush=True); return None
    st = None
    for _ in range(16):
        c = bmt.get_command(cid)
        if c and c.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            st = c; break
        time.sleep(2.0)
    st = st or {"status": "POLL_TIMEOUT"}
    bmt.save({"id": f"CLICK-{label}", "action": "TYPED_CLICK", "command_id": cid,
              "status": st.get("status"), "error": st.get("error"), "channel": "insert", "target": label, "tab": tab})
    print(f"  [CLICK {label}] {st.get('status')} err={st.get('error')}", flush=True)
    return st.get("status")

def cap(tab, label):
    c = run_test(label, "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
    return c.get("_result_full") or {}

def named(f):
    return [(t.get("role"), t.get("name")) for t in (f.get("semantic_targets") or []) if t.get("name")]

def agent_btn(f):
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "button" and (t.get("name") or "").strip() == "Agent" and t.get("semantic_ref"):
            return t
    return None

# candidates: e-phase probe (had 96-element sidebar) + current probe tab
CANDIDATES = []  # filled from e-ctx below
try:
    ectx = json.load(open("/home/z/my-project/scripts/phoenix/browser-test-results-e0631.json.ctx"))
    if ectx.get("probe_tab"): CANDIDATES.insert(0, ectx["probe_tab"])
except Exception:
    pass
ctx = json.load(open(bmt.RESULTS + ".ctx"))
if ctx.get("probe_tab") and ctx["probe_tab"] not in CANDIDATES:
    CANDIDATES.append(ctx["probe_tab"])
print(f"=== AGENT-PATH E2E-3 candidates={CANDIDATES} ===", flush=True)

found_tab, btn = None, None
for t in CANDIDATES:
    f = cap(t, f"C-{t[-12:]}")
    els = len((f.get("interaction_tree") or {}).get("elements") or [])
    print(f"tab {t[-12:]}: els={els} names={named(f)[:10]}", flush=True)
    b = agent_btn(f)
    if b:
        found_tab, btn = t, b
        break

if not found_tab:
    bmt.save({"id": "C-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "no Agent button on any candidate tab"})
    print("ABORT: no Agent button found on candidates", flush=True)
    sys.exit(1)

print(f"Agent button found on {found_tab} — clicking IMMEDIATELY (L16)", flush=True)
r = insert_click(btn, found_tab, "Agent-Tab")
time.sleep(8)
f = cap(found_tab, "C2-CAP-AGENTSPACE")
els = len((f.get("interaction_tree") or {}).get("elements") or [])
print(f"agent-space: els={els} names={named(f)[:20]}", flush=True)
bmt.save({"id": "C2-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "agent_space_names": named(f)[:30], "els": els, "tab": found_tab})
ctx_save = json.load(open(bmt.RESULTS + ".ctx")); ctx_save["agent_space_tab"] = found_tab
json.dump(ctx_save, open(bmt.RESULTS + ".ctx", "w"))
print("E2E-3 phase-1 done", flush=True)
