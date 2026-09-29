#!/usr/bin/env python3
# dir-0930.py — tick 0930: mint fresh transport proofs per fleet agent (CAPTURE per tab) + drift re-check
import importlib.util, json, time
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-d0930.json"
bmt._results = []
run_test, P = bmt.run_test, "GLM_ZAI"

print("=== 1) FLEET_STATUS baseline (tab_ids + stale proven_at) ===", flush=True)
f1 = run_test("F1-FLEET", "FLEET_STATUS", timeout=60)
agents = ((f1.get("_result_full") or {}).get("agents")) or []
tab_map = {}
before = {}
for a in agents:
    role = a.get("role")
    tab_map[role] = a.get("tab_id")
    before[role] = {"proven_at": (a.get("transport_proof") or {}).get("proven_at"),
                    "conv": str((a.get("transport_proof") or {}).get("conversation_url") or "")[:55],
                    "epoch": a.get("generation_epoch")}
    print(f"  {role}: tab={a.get('tab_id')} proven_at={before[role]['proven_at']} conv={before[role]['conv']}", flush=True)
bmt.save({"id": "F1-ANALYSIS", "action": "FLEET-BASELINE", "status": "COMPLETED", "channel": "local",
          "before": before, "tab_map": tab_map})

print("=== 2) CAPTURE each fleet tab (transport action -> mint proof) ===", flush=True)
caps = {}
for role, tid in tab_map.items():
    if not tid:
        print(f"  {role}: no tab_id, skip", flush=True)
        continue
    r = run_test(f"CAP-{role}", "CAPTURE", payload={"tab_id": tid}, platform=P, timeout=70)
    full = r.get("_result_full") or {}
    caps[role] = {"capture_status": r.get("status"), "url": str(full.get("url") or "")[:70]}
    print(f"  {role}: capture={r.get('status')} url={str(full.get('url') or '')[:60]}", flush=True)
    time.sleep(4)
bmt.save({"id": "CAP-ANALYSIS", "action": "PER-TAB-CAPTURE", "status": "COMPLETED", "channel": "local", "captures": caps})

print("=== 3) FLEET_STATUS after (proof freshness check) ===", flush=True)
time.sleep(15)
f2 = run_test("F2-FLEET", "FLEET_STATUS", timeout=60)
after = {}
minted = 0
for a in ((f2.get("_result_full") or {}).get("agents")) or []:
    role = a.get("role")
    tp = a.get("transport_proof") or {}
    after[role] = {"proven_at": tp.get("proven_at"), "conv": str(tp.get("conversation_url") or "")[:55]}
    if after[role]["proven_at"] != before.get(role, {}).get("proven_at"):
        minted += 1
    print(f"  {role}: proven_at {before.get(role,{}).get('proven_at')} -> {tp.get('proven_at')}", flush=True)
bmt.save({"id": "F2-ANALYSIS", "action": "PROOF-REFRESH-CHECK", "status": "COMPLETED", "channel": "local",
          "after": after, "proofs_refreshed": minted,
          "verdict": "CAPTURE-mints-proof" if minted > 0 else "proof-not-refreshed-by-CAPTURE"})

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print(f"tick 0930 done, proofs_refreshed={minted}", flush=True)
