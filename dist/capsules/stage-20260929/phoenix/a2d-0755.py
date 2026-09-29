#!/usr/bin/env python3
# a2d-0755.py — FINAL Agent-path step: submit task in Agent-space "Send a Message" -> readback
import importlib.util, json, time, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-t0700.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
tab = json.load(open(bmt.RESULTS + ".ctx")).get("agent_space_tab") or json.load(open(bmt.RESULTS + ".ctx")).get("probe_tab")
print(f"=== AGENT-TASK SUBMIT on {tab} ===", flush=True)

# capture -> find Send a Message textbox -> type+submit IMMEDIATELY (tight coupling, L16)
cap = run_test("D1-CAP", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
f = cap.get("_result_full") or {}
txt = None
for t in (f.get("semantic_targets") or []):
    if t.get("role") == "textbox" and t.get("semantic_ref") and (t.get("name") or "") in ("Send a Message", "How can I help you today?"):
        txt = t; break
if not txt:
    for t in (f.get("semantic_targets") or []):
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            txt = t; break
if not txt:
    print("ABORT: no textbox", flush=True); sys.exit(1)
print(f"textbox: name={txt.get('name')} ref=yes", flush=True)

BRIEF = ("AGENT TASK (swarm task-board): build a single-page HTML task board for our agent swarm: "
         "columns = Backlog / In Progress / Done; cards = goals, agent roles, statuses. "
         "Work autonomously: show plan, then produce the page code, then list improvements.")
st = {"tab_id": tab, "role": "textbox", "semantic_ref": txt["semantic_ref"],
      "text": BRIEF, "submit_after_type": True, "replace_existing": False}
r = run_test("D2-TYPE-SUBMIT", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
print(f"type-submit: {r['status']} err={r.get('error')}", flush=True)
rs = r.get("result_summary") or {}
print(f"receipt: effect={rs.get('effect_state')} inserted={rs.get('inserted_chars')}", flush=True)

time.sleep(14)
cap2 = run_test("D3-CAP-POST", "CAPTURE", payload={"tab_id": tab}, platform=P, timeout=70)
f2 = cap2.get("_result_full") or {}
u = f2.get("url") or ""
print(f"post url={u[:110]}", flush=True)
names2 = [(t.get("role"), t.get("name")) for t in (f2.get("semantic_targets") or []) if t.get("name")]
print(f"post names (first 16): {names2[:16]}", flush=True)
tr = run_test("D4-TRANSCRIPT", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 6}, platform=P)
fr = tr.get("_result_full") or {}
items = fr.get("entries") or fr.get("messages") or fr.get("items") or []
cnt = len(items) if isinstance(items, list) else 0
print(f"transcript entries: {cnt}", flush=True)
for it in (items if isinstance(items, list) else [])[:5]:
    print("  ", json.dumps(it, ensure_ascii=False)[:150], flush=True)
bmt.save({"id": "D4-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "post_url": u, "transcript_entries": cnt,
          "names_after": [f"{a}:{b}" for a, b in names2[:20]],
          "type_receipt": {"effect_state": rs.get("effect_state"), "inserted_chars": rs.get("inserted_chars")}})
print("AGENT-TASK SUBMIT done", flush=True)
