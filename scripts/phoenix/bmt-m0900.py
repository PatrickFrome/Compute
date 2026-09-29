#!/usr/bin/env python3
# bmt-m0900.py — tick 09:00 (Job 419203): baseline re-verify + title monitor of 4 agent sessions
import sys, json, time, importlib.util
_spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(bmt)

bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-m0900.json"
bmt._results = []

KNOWN = {
    "/c/36ce7b45": "task-board",
    "/c/94fd04de": "essay",
    "/c/b86be1da": "research",
    "/c/cfefd09f": "critic",
}

print("=== TICK 0900: baseline read-only sweep ===", flush=True)
bmt.run_test("M01", "CONTROL_CAPABILITIES")
bmt.run_test("M02", "TAB_CENSUS")
bmt.run_test("M03", "FLEET_STATUS")
bmt.run_test("M04", "GATE_STATUS")
bmt.run_test("M05", "SELF_UPDATE_STATUS")

# --- locate session tabs from TAB_CENSUS result ---
census = None
for r in bmt._results:
    if r.get("id") == "M02" and r.get("_result_full"):
        census = r["_result_full"]; break

tab_by_conv = {}
if census:
    tabs = census.get("tabs") or []
    print(f"census tabs={len(tabs)}", flush=True)
    for t in tabs:
        u = str(t.get("url") or "")
        for conv in KNOWN:
            if conv in u:
                tab_by_conv[conv] = t.get("tab_id")
print("session tab map:", json.dumps(tab_by_conv), flush=True)
bmt.save({"id": "M02-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "census_tabs": len((census or {}).get("tabs") or []),
          "session_tab_map": tab_by_conv})

# --- capture each session tab (read-only) -> title / reply evidence ---
print("=== TICK 0900: session title monitor (CAPTURE) ===", flush=True)
monitor = {}
for conv, tid in tab_by_conv.items():
    rec = bmt.run_test(f"MC-{conv[3:11]}", "CAPTURE", payload={"tab_id": tid}, platform="GLM_ZAI")
    ev = {"tab_id": tid, "capture_status": rec.get("status")}
    full = rec.get("_result_full")
    if full:
        ev["url"] = str(full.get("url") or "")[:100]
        els = ((full.get("interaction_tree") or {}).get("elements")) or []
        # page title evidence: heading nodes or document title field
        cand_title = full.get("title") or full.get("page_title")
        if not cand_title:
            heads = [e.get("text") for e in els
                     if e.get("role") in ("heading", "header") and e.get("text")]
            cand_title = heads[0] if heads else None
        ev["title_field"] = str(cand_title)[:120] if cand_title else None
        # assistant reply evidence: last non-empty text block
        texts = [str(e.get("text")) for e in els if e.get("role") in ("paragraph", "listitem", "article", "text") and e.get("text")]
        ev["text_blocks"] = len(texts)
        ev["last_text"] = texts[-1][:160] if texts else None
    monitor[conv] = ev
    time.sleep(3)  # gentle pace for read commands

bmt.save({"id": "MC-ANALYSIS", "action": "TITLE-MONITOR", "status": "COMPLETED", "channel": "local",
          "monitor": monitor, "known_roles": KNOWN})
print("monitor:", json.dumps(monitor, ensure_ascii=False)[:900], flush=True)

# compact: strip heavy _result_full for the JSON artifact
for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print(f"tick 0900 done, results={len(bmt._results)}", flush=True)
