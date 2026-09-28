#!/usr/bin/env python3
# dir-0945.py — directive tick 09:45 (Job 419718): transcript archaeology of all 4 fleet tabs
import importlib.util, json, time
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-d0945.json"
bmt._results = []
run_test, P = bmt.run_test, "GLM_ZAI"

TABS = {
    "PLANNER":     "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f",
    "RESEARCHER":  "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa",
    "IMPLEMENTER": "tab_9f8b697d-dbdd-4424-9e43-465512b9fdf9",
    "CRITIC":      "tab_6f7ea6e9-d6ea-4ce6-8616-894fbb4d3314",
}

def fetch_transcript(role, tid):
    rt = run_test(f"T-{role}", "READ_TRANSCRIPT", payload={"tab_id": tid, "limit": 10}, platform=P, timeout=60)
    if rt.get("status") != "COMPLETED" or not rt.get("command_id"):
        return {"role": role, "status": rt.get("status"), "error": str(rt.get("error"))[:100]}
    row = bmt.get_command(rt["command_id"])
    res = ((row.get("receipt") or {}).get("result")) or {}
    txt = str(res.get("text") or "")
    return analyze(role, txt)

def analyze(role, txt):
    a = {"role": role, "len": len(txt), "status": "COMPLETED"}
    low = txt.lower()
    a["has_tool_request_v1"] = low.count("tool_request_v1")
    a["has_tool_result_v1"] = low.count("tool_result_v1")
    a["has_next_task_message"] = low.count("next_task_message")
    a["has_thought_process"] = low.count("thought process")
    a["lease_generations"] = sorted(set(__import__("re").findall(r"lease_generation=(\d+)", txt)))
    a["branches"] = sorted(set(__import__("re").findall(r"target_branch=(\S+)", txt)))[:4]
    a["roles_tagged"] = sorted(set(__import__("re").findall(r"role=([A-Z]+)", txt)))
    a["tail"] = txt[-400:]
    return a

print("=== TRANSCRIPT ARCHAEOLOGY 4 FLEET TABS ===", flush=True)
out = []
for role, tid in TABS.items():
    a = fetch_transcript(role, tid)
    bmt.save({"id": f"T-{role}-ANALYSIS", "action": "TRANSCRIPT-ARCH", "status": "COMPLETED", "channel": "local", **a})
    out.append(a)
    print(f"  {role}: len={a.get('len')} TOOL_REQ={a.get('has_tool_request_v1')} TOOL_RES={a.get('has_tool_result_v1')} "
          f"NEXT_TASK={a.get('has_next_task_message')} thought={a.get('has_thought_process')} "
          f"gen={a.get('lease_generations')} branch={a.get('branches')}", flush=True)
    time.sleep(4)

bmt.save({"id": "T-SUMMARY", "action": "ARCH-SUMMARY", "status": "COMPLETED", "channel": "local",
          "agents": [{k: v for k, v in a.items() if k != "tail"} for a in out],
          "tool_result_ever_answered": any((a.get("has_tool_result_v1") or 0) > 0 for a in out),
          "tool_requests_present": any((a.get("has_tool_request_v1") or 0) > 0 for a in out)})

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("archaeology done", flush=True)
