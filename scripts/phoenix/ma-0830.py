#!/usr/bin/env python3
# ma-0830.py — directive cycle 08:30: multi-agent E2E (§14.6-7)
# Create 2 agent sessions with DIFFERENT role briefs via proven recipe; title-readback both.
import importlib.util, json, time, uuid, datetime, sys

spec = importlib.util.spec_from_file_location("bmt", "/home/z/my-project/scripts/phoenix/browser-mechanics-test.py")
bmt = importlib.util.module_from_spec(spec)
spec.loader.exec_module(bmt)
bmt.RESULTS = "/home/z/my-project/scripts/phoenix/browser-test-results-ma0830.json"
bmt.load_results()

run_test = bmt.run_test
P = "GLM_ZAI"
TAB = "tab_6924b587-8aa4-44ad-af7b-c7e4f814a6c6"  # agent-space tab

def direct_insert(action, payload, platform=P, ttl=75, poll=55):
    cid = str(uuid.uuid4())
    now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": bmt.WS, "target_client_id": bmt.TARGET,
           "issued_by": "zai-directive-419718", "action": action, "platform": platform,
           "payload": payload, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"glm-dir-ma0830-{uuid.uuid4().hex[:8]}"}
    code, ins = bmt.rest_insert(row)
    if code not in (200, 201):
        rec = {"id": f"{action}-INSERT", "action": action, "status": "INSERT_ERROR", "channel": "insert",
               "http": code, "err_body": str(ins)[:200]}
        bmt.save(rec); print(f"  [INSERT {action}] HTTP {code}", flush=True)
        return rec
    st = None; t0 = time.time()
    while time.time() - t0 < poll:
        c = bmt.get_command(cid)
        if c and c.get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            st = c; break
        time.sleep(2.5)
    st = st or {"status": "POLL_TIMEOUT"}
    rc = (st.get("receipt") or {}) if isinstance(st.get("receipt"), dict) else {}
    rec = {"id": f"{action}-INSERT", "action": action, "command_id": cid, "status": st.get("status"),
           "channel": "insert", "error": st.get("error"), "result_summary": bmt.summarize(rc.get("result"))}
    if st.get("status") == "COMPLETED" and rc.get("result") is not None:
        rec["_result_full"] = rc.get("result")
    bmt.save(rec)
    print(f"  [INSERT {action}] {rec['status']} err={str(rec.get('error'))[:90]}", flush=True)
    return rec

def find(cap, role=None, name_contains=None, name_exact=None):
    if not cap.get("_result_full"): return None
    for t in (cap["_result_full"].get("semantic_targets") or []):
        if role and t.get("role") != role: continue
        nm = (t.get("name") or "").strip()
        if name_exact is not None and nm != name_exact: continue
        if name_contains is not None and name_contains.lower() not in nm.lower(): continue
        if not t.get("semantic_ref"): continue
        return t
    return None

def side_titles(cap):
    """Sidebar conversation title buttons (contain 'More' suffix or history titles)."""
    out = []
    for t in (cap.get("_result_full") or {}).get("semantic_targets") or []:
        nm = (t.get("name") or "").strip()
        if t.get("role") == "button" and nm and ("More" in nm or len(nm) > 12):
            out.append(nm)
    return out

def create_session(tag, brief):
    """One full proven recipe: New Task click -> Send a Message -> submit. Returns url/effect."""
    cap = run_test(f"{tag}-CAP0", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
    nt = find(cap, role="button", name_exact="New Task")
    if not nt:
        bmt.save({"id": f"{tag}-ABORT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "new_task_not_found"})
        print(f"  {tag}: ABORT New Task", flush=True); return None
    time.sleep(20)
    direct_insert("TYPED_CLICK", {"role": "button", "tab_id": TAB,
                  "semantic_ref": nt["semantic_ref"], "accessible_name": "New Task"})
    time.sleep(7)
    cap2 = run_test(f"{tag}-CAP1", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
    tb = find(cap2, role="textbox", name_contains="Message") or find(cap2, role="textbox")
    if not tb:
        bmt.save({"id": f"{tag}-ABORT2", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
                  "reason": "no_textbox"})
        print(f"  {tag}: ABORT textbox", flush=True); return None
    st = {"tab_id": TAB, "role": "textbox", "semantic_ref": tb["semantic_ref"],
          "text": brief, "submit_after_type": True, "replace_existing": False}
    r = run_test(f"{tag}-SUBMIT", "SEMANTIC_TYPE", payload=st, platform=P, mutating=True, timeout=45)
    rs = r.get("result_summary") or {}
    time.sleep(10)
    cap3 = run_test(f"{tag}-CAP2", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
    url = (cap3.get("_result_full") or {}).get("url", "")
    conv = "/c/" in url
    bmt.save({"id": f"{tag}-RESULT", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
              "effect": rs.get("effect_state"), "url": url, "conversation_created": conv})
    print(f"  {tag}: effect={rs.get('effect_state')} url={url[:80]}", flush=True)
    return {"tag": tag, "url": url, "effect": rs.get("effect_state")}

print("=== MULTI-AGENT E2E 08:30 ===", flush=True)
# 0) baseline sidebar titles
cap0 = run_test("MA0-BASELINE", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
base_titles = side_titles(cap0)
print(f"  baseline titles: {len(base_titles)}", flush=True)
bmt.save({"id": "MA0-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "base_titles": base_titles})

BRIEF_A = ("RESEARCH TASK (role: RESEARCHER): investigate what makes a good autonomous agent task-board. "
           "List 5 key features of effective swarm task boards (columns, card metadata, statuses, WIP limits, priorities), "
           "one line each, then propose a minimal HTML structure. Be concise.")
BRIEF_B = ("CRITIC TASK (role: CRITIC): a swarm task-board plan exists: single HTML page, columns Backlog/In Progress/Done, "
           "cards with goal+role+status, GLM agents pick tasks autonomously. List the top 5 risks of this design and "
           "the single most important missing requirement. Be concise.")

s1 = create_session("MA1-RESEARCH", BRIEF_A)
s2 = create_session("MA2-CRITIC", BRIEF_B)

# title readback after pause (auto-title appears once assistant responds)
print("  waiting 75s for auto-titles...", flush=True)
time.sleep(75)
cap4 = run_test("MA3-CAP-TITLES", "CAPTURE", payload={"tab_id": TAB}, platform=P, timeout=70)
now_titles = side_titles(cap4)
new_titles = [t for t in now_titles if t not in base_titles]
print(f"  new titles: {new_titles}", flush=True)
bmt.save({"id": "MA3-ANALYSIS", "action": "ANALYSIS", "status": "COMPLETED", "channel": "local",
          "sessions": [s1, s2], "new_titles": new_titles,
          "multi_agent_created": bool(s1 and s1.get("conversation_created") and s2 and s2.get("conversation_created")),
          "both_distinct_urls": bool(s1 and s2 and s1.get("url") and s2.get("url") and s1["url"] != s2["url"])})
print("done", flush=True)
