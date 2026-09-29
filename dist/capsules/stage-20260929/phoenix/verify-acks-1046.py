#!/usr/bin/env python3
# verify-acks-1046.py — strict ACK verification: occurrences AFTER brief text (not echo).
import importlib.util, json
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec); spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-tr1046-verify.json"
bmt._results = []
P = "GLM_ZAI"
TABS = {
    "RESEARCHER": ("tab_bc085d57-4e9d-4395-9e63-90afd921bdfa", "TOOL_RESULT-1046-RESEARCHER", "RESULT-ACK-RESEARCHER"),
    "CRITIC":     ("tab_6f7ea6e9-d6ea-4ce6-8616-894fbb4d3314", "TASK-1046-CRITIC", "CRITIQUE-ACK-CRITIC"),
    "IMPLEMENTER":("tab_9f8b697d-dbdd-4424-9e43-465512b9fdf9", "TASK-1046-IMPLEMENTER", "SPEC-ACK-IMPLEMENTER"),
}
def transcript(tab_id):
    rt = bmt.run_test("TR", "READ_TRANSCRIPT", payload={"tab_id": tab_id, "limit": 10}, platform=P, timeout=60)
    if rt.get("status") != "COMPLETED" or not rt.get("command_id"):
        return ""
    row = bmt.get_command(rt["command_id"])
    return str((((row.get("receipt") or {}).get("result")) or {}).get("text") or "")
out = []
for role, (tab, marker, ack) in TABS.items():
    t = transcript(tab)
    total_ack = t.count(ack)
    # occurrences after the marker (brief start): brief contains ack once; reply would add one more
    idx = t.find(marker)
    after = t[idx:] if idx >= 0 else ""
    after_ack = after.count(ack)
    tail = t[-400:]
    out.append({"role": role, "len": len(t), "marker_visible": idx >= 0,
                "ack_total": total_ack, "ack_after_marker": after_ack,
                "strict_reply": after_ack >= 2})
    print(role, "len", len(t), "marker", idx >= 0, "ack_total", total_ack,
          "ack_after", after_ack, "STRICT_REPLY", after_ack >= 2)
    print("tail:", repr(tail[:380]))
bmt.save_all = out
for r in out: bmt.save(r)
for r in bmt._results: r.pop("_result_full", None)
json.dump(bmt._results, open(bmt.RESULTS, "w"), ensure_ascii=False, indent=1)
