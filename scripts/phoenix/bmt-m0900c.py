#!/usr/bin/env python3
# bmt-m0900c.py — tick 09:00 title monitor: CAPTURE agent-space tab, diff sidebar titles
import importlib.util, json, time
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-m0900-title.json"
bmt._results = []
run_test = bmt.run_test
P = "GLM_ZAI"
TAB = "tab_6924b587-8aa4-44ad-af7b-c7e4f814a6c6"  # agent-space tab

KNOWN_BASE = ["3000-Word Computing History Essay", "Key Features of Swarm Task Boards",
              "Top Risks & Missing Requirement for Swarm Task-Board"]

def side_titles(cap):
    out = []
    for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
        nm = (t.get("name") or "").strip()
        if t.get("role") == "button" and nm and ("More" in nm or len(nm) > 12):
            if nm not in ("Open Settings", "Select a model", "Open User Menu"):
                out.append(nm)
    return out

cap = run_test("T1-CAP-AGENTSPACE", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
titles = side_titles(cap)
url = (cap.get("_result_full") or {}).get("url", "")
print("agent-space url:", url[:90], flush=True)
print(f"sidebar titles ({len(titles)}):", flush=True)
for t in titles:
    print("  -", t[:100], flush=True)

known_present = [kb for kb in KNOWN_BASE if any(kb in t for t in titles)]
new_titles = [t for t in titles if not any(kb in t for kb in KNOWN_BASE)]
bmt.save({"id": "T1-ANALYSIS", "action": "TITLE-MONITOR", "status": "COMPLETED", "channel": "local",
          "url": url, "n_titles": len(titles),
          "known_titles_present": known_present,
          "other_titles": new_titles[:20]})

# fleet self-learning readback: capture PLANNER fleet tab for assistant-reply evidence
FLEET_TAB = "tab_fe50ead8-dc4d-49d0-a8a0-d1060f662c4f"  # PLANNER
capf = run_test("T2-CAP-PLANNER", "CAPTURE", payload={"tab_id": FLEET_TAB}, platform=P, timeout=70)
full = capf.get("_result_full") or {}
furl = str(full.get("url") or "")
els = ((full.get("interaction_tree") or {}).get("elements")) or []
texts = [str(e.get("text")) for e in els if e.get("role") in ("paragraph", "listitem", "article", "text") and e.get("text")]
bmt.save({"id": "T2-ANALYSIS", "action": "PLANNER-READBACK", "status": "COMPLETED", "channel": "local",
          "url": furl, "n_text_blocks": len(texts), "last_text": (texts[-1][:200] if texts else None)})
print("planner url:", furl[:90], "| text blocks:", len(texts), flush=True)
if texts: print("planner last text:", texts[-1][:180], flush=True)

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("title monitor done", flush=True)
