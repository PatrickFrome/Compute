#!/usr/bin/env python3
# dir-0907.py — directive tick 09:07 (Job 419718): thread re-prompt experiment
# Re-prompt EXISTING critic session (/c/cfefd09f) in-place on agent-space tab.
# Proves: agent sessions can receive follow-up tasks -> swarm continuous loop ingredient (§12).
import importlib.util, json, time
spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-d0907.json"
bmt._results = []
run_test = bmt.run_test
P = "GLM_ZAI"
TAB = "tab_6924b587-8aa4-44ad-af7b-c7e4f814a6c6"
CONV = "/c/cfefd09f"

def find(cap, role=None, name_contains=None):
    if not cap.get("_result_full"): return None
    for t in (cap["_result_full"].get("semantic_targets") or []):
        if role and t.get("role") != role: continue
        nm = (t.get("name") or "").strip()
        if name_contains is not None and name_contains.lower() not in nm.lower(): continue
        if not t.get("semantic_ref"): continue
        return t
    return None

def count_blocks(cap):
    els = ((cap.get("_result_full") or {}).get("interaction_tree") or {}).get("elements") or []
    return [str(e.get("text")) for e in els
            if e.get("role") in ("paragraph", "listitem", "article", "text") and e.get("text")]

print("=== RE-PROMPT EXPERIMENT 09:07 ===", flush=True)
# 1) baseline capture (read)
cap0 = run_test("R1-CAP0", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
url0 = (cap0.get("_result_full") or {}).get("url", "")
blocks0 = count_blocks(cap0)
on_target = CONV in url0
print(f"baseline url={url0[:80]} blocks={len(blocks0)} on_target={on_target}", flush=True)
bmt.save({"id": "R1-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "url": url0, "n_blocks": len(blocks0), "on_target": on_target,
          "last_block": (blocks0[-1][:150] if blocks0 else None)})

if not on_target:
    bmt.save({"id": "R1-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "reason": "tab_not_on_critic_session"})
    print("ABORT: tab not on critic session", flush=True)
else:
    # 2) mutation: follow-up brief into EXISTING thread (SEMANTIC_TYPE submit=True, replace=False)
    tb = find(cap0, role="textbox", name_contains="Message") or find(cap0, role="textbox")
    if not tb:
        bmt.save({"id": "R2-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "no_textbox"})
        print("ABORT: no textbox", flush=True)
    else:
        time.sleep(20)  # mutation pace
        BRIEF = ("CONTINUATION TASK (role: CRITIC): expand your previous answer - for each of the "
                 "top-5 risks give one concrete mitigation for the swarm task-board HTML. "
                 "One line each. Be concise.")
        st = {"tab_id": TAB, "role": "textbox", "semantic_ref": tb["semantic_ref"],
              "text": BRIEF, "submit_after_type": True, "replace_existing": False}
        r = run_test("R2-RETYPE", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
        print(f"retype effect={((r.get('result_summary') or {}).get('effect_state'))}", flush=True)

        # 3) readback: same thread (url must NOT change -> no new conversation)
        time.sleep(10)
        cap1 = run_test("R3-CAP1", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
        url1 = (cap1.get("_result_full") or {}).get("url", "")
        blocks1 = count_blocks(cap1)
        same_thread = CONV in url1
        bmt.save({"id": "R3-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "url": url1, "same_thread": same_thread, "n_blocks": len(blocks1),
                  "blocks_delta": len(blocks1) - len(blocks0),
                  "effect_state": (r.get("result_summary") or {}).get("effect_state")})
        print(f"readback url={url1[:80]} same_thread={same_thread} blocks {len(blocks0)}->{len(blocks1)}", flush=True)

        # 4) wait for assistant reply, then verify continuation evidence
        print("  waiting 75s for assistant reply...", flush=True)
        time.sleep(75)
        cap2 = run_test("R4-CAP2", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
        url2 = (cap2.get("_result_full") or {}).get("url", "")
        blocks2 = count_blocks(cap2)
        tail = " ".join(blocks2[-4:])[:300] if blocks2 else ""
        continued = CONV in url2 and ("mitigation" in tail.lower() or len(blocks2) > len(blocks1))
        bmt.save({"id": "R4-ANALYSIS", "action": "RE-PROMPT-E2E", "status": "COMPLETED", "channel": "local",
                  "url": url2, "same_thread": CONV in url2, "n_blocks": len(blocks2),
                  "blocks_delta_2": len(blocks2) - len(blocks1), "tail": tail,
                  "thread_continued": continued})
        print(f"final url={url2[:80]} blocks {len(blocks1)}->{len(blocks2)} continued={continued}", flush=True)
        print(f"tail: {tail[:220]}", flush=True)

for r in bmt._results:
    r.pop("_result_full", None)
with open(bmt.RESULTS, "w") as f:
    json.dump(bmt._results, f, ensure_ascii=False, indent=1)
print("re-prompt experiment done", flush=True)
