#!/usr/bin/env python3
# dispatch-dbcapsule-1012.py — deliver per-role DB CONNECT briefs to all 4 fleet tabs.
# usage: python3 dispatch-dbcapsule-1012.py a|b|c
#   a = dispatch PLANNER + RESEARCHER; b = dispatch IMPLEMENTER + CRITIC; c = readback all 4
# Secrets are read from briefs files and typed into fleet tabs ONLY (never printed here).
import importlib.util, json, sys, time

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
RUN = sys.argv[1] if len(sys.argv) > 1 else "a"
bmt.RESULTS = f"/home/z/my-project/scripts/phoenix/browser-test-results-dbcaps-{RUN}.json"
bmt._results = []
run_test, P = bmt.run_test, "GLM_ZAI"
TABS = {
    "PLANNER":     "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f",
    "RESEARCHER":  "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa",
    "IMPLEMENTER": "tab_9f8b697d-dbdd-4424-9e43-465512b9fdf9",
    "CRITIC":      "tab_6f7ea6e9-d6ea-4ce6-8616-894fbb4d3314",
}
BRIEFS = "/home/z/my-project/scripts/swarm/briefs"

def dispatch(role, tab_id):
    brief = open(f"{BRIEFS}/{role}.txt").read().strip()
    cap = run_test(f"CAP-{role}", "CAPTURE", payload={"tab_id": tab_id}, platform=P, timeout=70)
    tb = None
    for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
        if t.get("role") == "textbox" and t.get("semantic_ref"):
            tb = t; break
    if not tb:
        bmt.save({"id": f"D-{role}", "status": "NO_TEXTBOX"}); return False
    time.sleep(20)  # inter-mutation pace
    st = {"tab_id": tab_id, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": brief, "submit_after_type": True, "replace_existing": False}
    r = run_test(f"D-{role}", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    eff = (r.get("result_summary") or {}).get("effect_state")
    bmt.save({"id": f"D-{role}", "status": r.get("status"), "effect": eff,
              "brief_len": len(brief), "marker": f"CONNECT-CAPSULE-V1-{role}"})
    time.sleep(15)
    return True

def transcript(tab_id):
    rt = run_test("TR", "READ_TRANSCRIPT", payload={"tab_id": tab_id, "limit": 10}, platform=P, timeout=60)
    if rt.get("status") != "COMPLETED" or not rt.get("command_id"):
        return None
    row = bmt.get_command(rt["command_id"])
    return str((((row.get("receipt") or {}).get("result")) or {}).get("text") or "")

if RUN in ("a", "b"):
    roles = ["PLANNER", "RESEARCHER"] if RUN == "a" else ["IMPLEMENTER", "CRITIC"]
    for role in roles:
        print(f"=== dispatch {role} ===", flush=True)
        dispatch(role, TABS[role])
elif RUN == "c":
    time.sleep(45)
    for role, tab_id in TABS.items():
        t = transcript(tab_id)
        marker = f"CONNECT-CAPSULE-V1-{role}"
        ack = f"CONNECTED-{role}"
        bmt.save({"id": f"RB-{role}", "action": "READBACK", "status": "COMPLETED", "channel": "local",
                  "len": len(t) if t is not None else -1,
                  "capsule_visible": marker in (t or ""),
                  "ack_reply": ack in (t or "")})

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print(f"run {RUN} done", flush=True)
