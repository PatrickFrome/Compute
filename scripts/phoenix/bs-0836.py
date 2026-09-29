#!/usr/bin/env python3
# bs-0836.py — Job 419203 tick 08:36 (read-only): result-extraction probes, session monitor, latency drift
import importlib.util, json, time, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-bs0836.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
TAB = "tab_6924b587-8aa4-44ad-af7b-c7e4f814a6c6"  # agent-space tab

print("=== BS 08:36 (read-only) ===", flush=True)

# 1) fleet health
fl = run_test("B01-FLEET", "FLEET_STATUS")
ff = fl.get("_result_full") or {}
print(f"  fleet: {ff.get('counts')}", flush=True)

# 2) latency drift vs 0758 baseline (p50 3.1 / p95 22.5 / p99 75.9)
lat = run_test("B02-LAT", "CONTROL_LATENCY_STATUS")
lf = lat.get("_result_full") or {}
print(f"  latency: {json.dumps(lf, ensure_ascii=False)[:300]}", flush=True)

# 3) result-extraction probes on essay session (known long content)
tr1 = run_test("B03-TR50", "READ_TRANSCRIPT", payload={"tab_id": TAB, "limit": 50}, platform=P)
t1 = (tr1.get("_result_full") or {}).get("text") or ""
print(f"  TR limit=50: len={len(t1)}", flush=True)

tr2 = run_test("B04-TRTHREAD", "READ_TRANSCRIPT", payload={"tab_id": TAB, "scope": "thread"}, platform=P)
st2 = tr2.get("status"); e2 = tr2.get("error")
t2 = (tr2.get("_result_full") or {}).get("text") or ""
print(f"  TR scope=thread: {st2} err={str(e2)[:80]} len={len(t2)}", flush=True)

tr3 = run_test("B05-TRHIST", "READ_TRANSCRIPT", payload={"tab_id": TAB, "include_history": True}, platform=P)
st3 = tr3.get("status"); e3 = tr3.get("error")
t3 = (tr3.get("_result_full") or {}).get("text") or ""
print(f"  TR include_history: {st3} err={str(e3)[:80]} len={len(t3)}", flush=True)

# 4) READ_STATE on tab (was listed working, never inspected in this cycle)
rs = run_test("B06-READSTATE", "READ_STATE", payload={"tab_id": TAB}, platform=P)
stt = rs.get("status"); rf = rs.get("_result_full") or {}
print(f"  READ_STATE: {stt} keys={list(rf.keys())[:10]}", flush=True)
print(f"  READ_STATE body: {json.dumps(rf, ensure_ascii=False)[:400]}", flush=True)

# 5) TAB_CENSUS full field dump (parse gap: earlier 'tabs' field was empty)
tc = run_test("B07-TABCENSUS", "TAB_CENSUS")
tf = tc.get("_result_full") or {}
print(f"  census keys: {list(tf.keys())[:12]}", flush=True)
for k, v in tf.items():
    if isinstance(v, list) and v:
        print(f"  {k}: n={len(v)} first={json.dumps(v[0], ensure_ascii=False)[:160]}", flush=True)

# 6) titles snapshot (session monitor)
cap = run_test("B08-CAP", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
titles = [t.get("name") for t in (cap.get("_result_full") or {}).get("semantic_targets") or []
          if t.get("role") == "button" and (t.get("name") or "") and ("More" in t.get("name") or len(t.get("name")) > 12)]
print(f"  titles now: {len(titles)}", flush=True)
for t in titles[:6]: print(f"    - {t[:80]}", flush=True)

bmt.save({"id": "BS-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "fleet": ff.get("counts"),
          "tr_limit50_len": len(t1), "tr_thread_status": st2, "tr_thread_len": len(t2),
          "tr_hist_status": st3, "tr_hist_len": len(t3),
          "read_state_status": stt, "read_state_keys": list(rf.keys())[:12],
          "census_keys": list(tf.keys())[:12],
          "titles": titles[:8]})
print("done", flush=True)
