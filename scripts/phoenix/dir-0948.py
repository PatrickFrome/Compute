#!/usr/bin/env python3
# dir-0948.py — marker dispatch to fleet PLANNER: confirm background thread creation
import importlib.util, json, time
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-d0948.json"
bmt._results = []
run_test, P = bmt.run_test, "GLM_ZAI"
PTAB = "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"
MARK = "X7K2-0948"

def transcript():
    rt = run_test("TR-PLANNER", "READ_TRANSCRIPT", payload={"tab_id": PTAB, "limit": 10}, platform=P, timeout=60)
    if rt.get("status") != "COMPLETED" or not rt.get("command_id"):
        return None
    row = bmt.get_command(rt["command_id"])
    return str((((row.get("receipt") or {}).get("result")) or {}).get("text") or "")

print("=== 1) baseline transcript ===", flush=True)
base = transcript()
base_len = len(base) if base is not None else -1
base_has_mark = MARK in (base or "")
print(f"  baseline len={base_len} has_marker={base_has_mark}", flush=True)
bmt.save({"id": "B1-ANALYSIS", "action": "BASELINE", "status": "COMPLETED", "channel": "local",
          "len": base_len, "has_marker": base_has_mark})

print("=== 2) marker dispatch ===", flush=True)
cap = run_test("C1-CAP", "CAPTURE", payload={"tab_id": PTAB}, platform=P, timeout=70)
url0 = str((cap.get("_result_full") or {}).get("url") or "")
tb = None
for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
    if t.get("role") == "textbox" and t.get("semantic_ref"):
        tb = t; break
print(f"  url={url0[:60]} textbox={bool(tb)}", flush=True)
if tb:
    time.sleep(20)
    BRIEF = (f"PLANNER DISPATCH {MARK} (supervisor): reply with the single word ACKMARK and nothing else.")
    st = {"tab_id": PTAB, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": BRIEF, "submit_after_type": True, "replace_existing": False}
    r = run_test("C2-MARK-DISPATCH", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    eff = (r.get("result_summary") or {}).get("effect_state")
    print(f"  dispatch effect={eff}", flush=True)

    # proof check right after (real transport action may mint proof)
    time.sleep(10)
    f1 = run_test("C3-FLEET", "FLEET_STATUS", timeout=60)
    plat = {}
    for a in ((f1.get("_result_full") or {}).get("agents")) or []:
        if a.get("role") == "PLANNER":
            tp = a.get("transport_proof") or {}
            plat = {"proven_at": tp.get("proven_at"), "conv": str(tp.get("conversation_url") or "")[-16:]}
    print(f"  PLANNER proof after dispatch: {plat}", flush=True)

    print("=== 3) wait 80s then transcript readback ===", flush=True)
    time.sleep(80)
    t2 = transcript()
    len2 = len(t2) if t2 is not None else -1
    marker_in = MARK in (t2 or "")
    ack_in = "ACKMARK" in (t2 or "")
    print(f"  after len={len2} (baseline {base_len}) marker_brief_visible={marker_in} assistant_ackmark={ack_in}", flush=True)
    bmt.save({"id": "C4-ANALYSIS", "action": "MARKER-E2E", "status": "COMPLETED", "channel": "local",
              "baseline_len": base_len, "after_len": len2, "marker_visible": marker_in,
              "assistant_ackmark": ack_in, "dispatch_effect": eff,
              "proof_after": plat,
              "verdict": ("CONFIRMED-background-thread+reply" if (marker_in and ack_in)
                          else "CONFIRMED-delivery-only" if marker_in
                          else "NOT-CONFIRMED")})
else:
    bmt.save({"id": "C1-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "no_textbox_on_planner_tab"})

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("marker experiment done", flush=True)
