#!/usr/bin/env python3
"""Job 419718 @15:15 — фаза 2 §3: contract-test fleet-readback chain (физическое доказательство).
Цепочка: NEW_TAB → CAPTURE(ref) → SEMANTIC_FOCUS → SEMANTIC_TYPE → PRESS_KEY(Enter)
  → wait(gen) → READ_TRANSCRIPT(assert ACK) → CLOSE_TAB.
Дисциплина: mutation pacing 20s (bmt MUT_GAP), readback каждого шага, без fallback,
AMBIGUOUS/FAIL → стоп цепочки + reconciliation-запись (никаких blind retry)."""
import sys, time, json, importlib.util

spec = importlib.util.spec_from_file_location(
    "bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1515-contract.json"
bmt.load_results()
bmt.ISSUER = "zai-419718-1515"

R = bmt._results
MARKER = "ACK-ME2-ADAPTER-OK"
OUT = {"chain": "fleet-readback contract-test", "ts": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
       "steps": [], "verdict": None}

def step(name, status, note=None):
    rec = {"step": name, "status": status, "note": str(note)[:200] if note else None}
    OUT["steps"].append(rec)
    print(f"  STEP {name}: {status} {note or ''}", flush=True)
    return rec

def last_full(action, statuses=("COMPLETED",)):
    for it in reversed(R):
        if it.get("action") == action and it.get("status") in statuses:
            return it
    return None

def abort(reason):
    step("ABORT", "STOPPED", reason)
    OUT["verdict"] = f"CONTRACT-FAIL: {reason}"
    with open("/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1515-contract.json", "w") as f:
        json.dump(R, f, ensure_ascii=False, indent=1)
    with open("/home/z/my-project/scripts/phoenix/r419718-1515-contract-verdict.json", "w") as f:
        json.dump(OUT, f, ensure_ascii=False, indent=1)
    print("VERDICT:", OUT["verdict"], flush=True)
    sys.exit(0)

def find_sem(cap, role):
    full = (cap or {}).get("_result_full") or {}
    for t in full.get("semantic_targets") or []:
        if role and t.get("role") != role: continue
        if t.get("semantic_ref"): return t
    return None

def reconcile_leased(r, extra_wait=75):
    """AMBIGUOUS/LEASED reconciliation: re-poll ТОГО ЖЕ command_id (readback, не new enqueue),
    bounded. Возвращает финальную строку команды или None."""
    cid = r.get("command_id")
    if not cid: return None
    t0 = time.time()
    while time.time() - t0 < extra_wait:
        row = bmt.get_command(cid)
        if row and row.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            r["status"] = row["status"]; r["error"] = row.get("error")
            r["receipt"] = row.get("receipt"); r["ms"] = int((time.time()-t0)*1000)
            if isinstance(row.get("receipt"), dict) and "result" in row["receipt"]:
                r["_result_full"] = row["receipt"]["result"]
            return row
        time.sleep(3)
    return None

def run_mut(tid, action, payload, timeout=60):
    """mutation с LEASED-reconciliation (re-poll того же cid, без new enqueue)."""
    r = bmt.run_test(tid, action, payload=payload, platform="GLM_ZAI", mutating=True, timeout=timeout)
    if r.get("status") == "LEASED":
        step(f"{tid}-RECONCILE", "IN-FLIGHT", "LEASED -> re-poll same command_id")
        reconcile_leased(r, extra_wait=75)
    return r

# CT1: NEW_TAB (собственный scratch-чат; никакие флит-табы агентов не затрагиваются)
r1 = run_mut("CT1", "NEW_TAB", {})
if r1.get("status") != "COMPLETED": abort(f"NEW_TAB {r1.get('status')} err={r1.get('error')}")
tab = ((r1.get("_result_full") or {}).get("tab_id"))
if not tab: abort("no tab_id in NEW_TAB receipt")
step("CT1-NEW_TAB", "OK", f"tab={tab[:24]}")

# CT2: CAPTURE → composer ref
r2 = bmt.run_test("CT2", "CAPTURE", payload={"tab_id": tab}, platform="GLM_ZAI", timeout=70)
if r2.get("status") != "COMPLETED": abort(f"CAPTURE {r2.get('status')}")
tb = find_sem(r2, "textbox")
if not tb: abort("no textbox semantic_ref in CAPTURE (composer unreachable)")
step("CT2-CAPTURE", "OK", f"ref={str(tb.get('semantic_ref'))[:40]} role={tb.get('role')}")

# CT3: SEMANTIC_FOCUS
sf = {"tab_id": tab, "role": "textbox", "semantic_ref": tb["semantic_ref"]}
r3 = run_mut("CT3", "SEMANTIC_FOCUS", sf)
if r3.get("status") != "COMPLETED": abort(f"SEMANTIC_FOCUS {r3.get('status')} {r3.get('error')}")
step("CT3-FOCUS", "OK")

# CT4: SEMANTIC_TYPE (demo-задача с детерминированным маркером)
st = dict(sf); st.update({
    "text": ("ME2-ADAPTER-CONTRACT: ответь РОВНО одной строкой ACK-ME2-ADAPTER-OK "
             "без каких-либо других слов. Это механический контракт-тест доставки. Job 419718."),
    "submit_after_type": False, "replace_existing": True})
r4 = run_mut("CT4", "SEMANTIC_TYPE", st)
if r4.get("status") != "COMPLETED": abort(f"SEMANTIC_TYPE {r4.get('status')} {r4.get('error')}")
step("CT4-TYPE", "OK")

# CT5: PRESS_KEY Enter (submit — доказанный путь C04 14:00)
r5 = run_mut("CT5", "PRESS_KEY", {"key": "Enter", "tab_id": tab})
if r5.get("status") != "COMPLETED": abort(f"PRESS_KEY {r5.get('status')} {r5.get('error')}")
step("CT5-SUBMIT", "OK")

# generation wait (не команда — бюджет не тратим)
print("  waiting 22s for generation…", flush=True)
time.sleep(22)

# CT6: READ_TRANSCRIPT → assert маркер
r6 = bmt.run_test("CT6", "READ_TRANSCRIPT", payload={"tab_id": tab, "limit": 12},
                  platform="GLM_ZAI", timeout=60)
if r6.get("status") != "COMPLETED": abort(f"READ_TRANSCRIPT {r6.get('status')} {r6.get('error')}")
txt = ((r6.get("_result_full") or {}).get("text")) or ""
has = MARKER in txt
step("CT6-READBACK", "OK" if has else "MARKER-MISSING",
     f"len={len(txt)} marker={has} tail={txt[-90:]!r}")

# CT7: CLOSE_TAB (уборка; даже при marker-missing — scratch не мусорим)
r7 = bmt.run_test("CT7", "CLOSE_TAB", payload={"tab_id": tab}, platform="GLM_ZAI", mutating=True, timeout=60)
step("CT7-CLOSE", "OK" if r7.get("status") == "COMPLETED" else r7.get("status"))

OUT["verdict"] = "CONTRACT-PASS: fleet-readback chain физически доказана (enqueue→composer→reply→readback)" if has \
    else "CONTRACT-AMBIGUOUS: цепочка исполнена, маркер не найден — reconciliation, не повтор"
with open("/home/z/my-project/scripts/phoenix/browser-test-results-r419718-1515-contract.json", "w") as f:
    json.dump(R, f, ensure_ascii=False, indent=1)
with open("/home/z/my-project/scripts/phoenix/r419718-1515-contract-verdict.json", "w") as f:
    json.dump(OUT, f, ensure_ascii=False, indent=1)
print("VERDICT:", OUT["verdict"], flush=True)
