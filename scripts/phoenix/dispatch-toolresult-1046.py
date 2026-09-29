#!/usr/bin/env python3
# dispatch-toolresult-1046.py — close the fleet tool-feedback loop E2E:
#   d = deliver TOOL_RESULT brief to RESEARCHER (result of its SYSTEM_TELEMETRY request)
#   e = deliver task-only briefs to CRITIC + IMPLEMENTER
#   f = delayed readback (markers + ACK replies)
# Task-only briefs: NO secrets, NO URLs, NO tokens (fleet verdicts accepted).
import importlib.util, json, sys, time

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
RUN = sys.argv[1] if len(sys.argv) > 1 else "d"
bmt.RESULTS = f"/home/z/my-project/scripts/phoenix/browser-test-results-tr1046-{RUN}.json"
bmt._results = []
run_test, P = bmt.run_test, "GLM_ZAI"
TABS = {
    "RESEARCHER":  "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa",
    "IMPLEMENTER": "tab_9f8b697d-dbdd-4424-9e43-465512b9fdf9",
    "CRITIC":      "tab_6f7ea6e9-d6ea-4ce6-8616-894fbb4d3314",
}
BRIEFS = {
    "RESEARCHER":  ("/home/z/my-project/scripts/swarm/briefs/result-researcher-1046.txt",
                    "TOOL_RESULT-1046-RESEARCHER", "RESULT-ACK-RESEARCHER"),
    "CRITIC":      ("/home/z/my-project/scripts/swarm/briefs/task-critic-1046.txt",
                    "TASK-1046-CRITIC", "CRITIQUE-ACK-CRITIC"),
    "IMPLEMENTER": ("/home/z/my-project/scripts/swarm/briefs/task-implementer-1046.txt",
                    "TASK-1046-IMPLEMENTER", "SPEC-ACK-IMPLEMENTER"),
}

def dispatch(role, tab_id):
    path, marker, _ack = BRIEFS[role]
    brief = open(path).read().strip()
    cap = run_test(f"CAP-{role}", "CAPTURE", payload={"tab_id": tab_id}, platform=P, timeout=70)
    tb = None
    for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            tb = t; break
    if not tb:
        bmt.save({"id": f"D-{role}", "status": "NO_TEXTBOX"}); return False
    time.sleep(20)  # inter-mutation pace (>=15-20s budget)
    st = {"tab_id": tab_id, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": brief, "submit_after_type": True, "replace_existing": False}
    r = run_test(f"D-{role}", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    eff = (r.get("result_summary") or {}).get("effect_state")
    bmt.save({"id": f"D-{role}", "status": r.get("status"), "effect": eff, "brief_len": len(brief),
              "marker": marker})
    time.sleep(15)
    return True

def transcript(tab_id):
    rt = run_test("TR", "READ_TRANSCRIPT", payload={"tab_id": tab_id, "limit": 10}, platform=P, timeout=60)
    if rt.get("status") != "COMPLETED" or not rt.get("command_id"):
        return None
    row = bmt.get_command(rt["command_id"])
    return str((((row.get("receipt") or {}).get("result")) or {}).get("text") or "")

if RUN == "d":
    dispatch("RESEARCHER", TABS["RESEARCHER"])
elif RUN == "e":
    dispatch("CRITIC", TABS["CRITIC"])
    dispatch("IMPLEMENTER", TABS["IMPLEMENTER"])
elif RUN == "f":
    time.sleep(60)  # give agents time to think+reply
    for role, tab_id in TABS.items():
        t = transcript(tab_id)
        _path, marker, ack = BRIEFS[role]
        bmt.save({"id": f"RB-{role}", "action": "READBACK", "status": "COMPLETED", "channel": "local",
                  "len": len(t) if t is not None else -1,
                  "marker_visible": marker in (t or ""),
                  "ack_reply": (t or "").count(ack) >= 1})

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print(f"run {RUN} done", flush=True)
