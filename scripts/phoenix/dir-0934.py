#!/usr/bin/env python3
# dir-0934.py — directive tick 09:34 (Job 419718):
# (a) SELECT_TAB on fleet tab as proof-mint candidate; (b) RESEARCHER live-thread /c/00868e19 work-product readback
import importlib.util, json, time
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-d0934.json"
bmt._results = []
run_test, P = bmt.run_test, "GLM_ZAI"
RTAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"  # RESEARCHER fleet tab

def proofs():
    r = run_test("PROBE-FLEET", "FLEET_STATUS", timeout=60)
    out = {}
    for a in ((r.get("_result_full") or {}).get("agents")) or []:
        tp = a.get("transport_proof") or {}
        out[a.get("role")] = {"proven_at": tp.get("proven_at"), "conv": str(tp.get("conversation_url") or "")[-16:]}
    return out

print("=== 1) RESEARCHER live thread readback ===", flush=True)
cap = run_test("R1-CAP-RES", "CAPTURE", payload={"tab_id": RTAB}, platform=P, timeout=70)
full = cap.get("_result_full") or {}
url = str(full.get("url") or "")
els = ((full.get("interaction_tree") or {}).get("elements")) or []
texts = [str(e.get("text")) for e in els if e.get("role") in ("paragraph", "listitem", "article", "text", "heading") and e.get("text")]
btns = [(e.get("name") or "").strip() for e in els if e.get("role") == "button" and (e.get("name") or "").strip()]
tbs = [e for e in els if e.get("role") == "textbox"]
bmt.save({"id": "R1-ANALYSIS", "action": "RES-THREAD-READBACK", "status": "COMPLETED", "channel": "local",
          "url": url, "n_named_buttons": len(btns), "button_sample": btns[:15],
          "n_text_nodes": len(texts), "text_sample": texts[:10],
          "n_textboxes": len(tbs), "draft": (str(tbs[0].get('text'))[:60] if tbs and tbs[0].get('text') else None)})
print(f"  url={url[:80]}", flush=True)
print(f"  named_buttons={len(btns)} sample={btns[:8]}", flush=True)
print(f"  text_nodes={len(texts)} sample={[t[:60] for t in texts[:5]]}", flush=True)
print(f"  textboxes={len(tbs)}", flush=True)

print("=== 2) SELECT_TAB proof-mint test ===", flush=True)
before = proofs()
print(f"  before: RESEARCHER proven_at={before.get('RESEARCHER', {}).get('proven_at')}", flush=True)
time.sleep(20)
r = run_test("R2-SELECT", "SELECT_TAB", payload={"tab_id": RTAB}, platform=P, mutating=True, timeout=45)
print(f"  SELECT_TAB -> {(r.get('status'))} err={str(r.get('error'))[:80]}", flush=True)
after = proofs()
print(f"  after:  RESEARCHER proven_at={after.get('RESEARCHER', {}).get('proven_at')}", flush=True)
minted = before.get("RESEARCHER", {}).get("proven_at") != after.get("RESEARCHER", {}).get("proven_at")
bmt.save({"id": "R2-ANALYSIS", "action": "SELECT-PROOF-MINT", "status": "COMPLETED", "channel": "local",
          "before": before, "after": after, "proof_minted": minted,
          "select_status": r.get("status")})
print(f"  PROOF MINTED: {minted}", flush=True)

for x in bmt._results:
    x.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("tick 0934 done", flush=True)
