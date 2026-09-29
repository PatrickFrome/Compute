#!/usr/bin/env python3
# dispatch-toolresult-1215.py — deliver TOOL_RESULT_V1 (seq 90014610) to RESEARCHER + readback
import json, os, time, uuid, datetime, urllib.request

ENVF = "/tmp/my-project/.a2-backup/me2.env.20260922"
WS = "2de9f84b-7c0a-4091-911c-894ff1d6eaf4"
TGT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"
RES_TAB = "tab_bc085d57-4e9d-4395-9e63-90afd921bdfa"  # RESEARCHER
ISSUER = "zai-419718-1215"
NONCE = "mt419718-1215-r2"
MARKER = "TOOLRESULT-1215"

def load_env():
    env = {}
    with open(ENVF) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    return env

ENV = load_env()
SU, SJ = ENV["SUPABASE_URL"], ENV["SUPABASE_SERVICE_ROLE_JWT"]
URL = f"{SU}/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22"

def hdr():
    return {"apikey": SJ, "Authorization": f"Bearer {SJ}", "Content-Type": "application/json"}

def enqueue(action, payload=None, ttl=75, platform="GLM_ZAI"):
    cid = str(uuid.uuid4()); now = datetime.datetime.now(datetime.timezone.utc)
    row = {"command_id": cid, "workspace_id": WS, "target_client_id": TGT, "issued_by": ISSUER,
           "action": action, "platform": platform, "payload": payload or {}, "status": "PENDING",
           "issued_at": now.strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "expires_at": (now + datetime.timedelta(seconds=ttl)).strftime("%Y-%m-%dT%H:%M:%S.%f+00:00"),
           "idempotency_key": f"tr1215-{action}-{uuid.uuid4().hex[:8]}"}
    req = urllib.request.Request(URL, data=json.dumps(row).encode(), method="POST",
                                 headers={**hdr(), "Prefer": "return=representation"})
    urllib.request.urlopen(req, timeout=30)
    return cid

def poll(cid, timeout=55):
    t0 = time.time()
    while time.time() - t0 < timeout:
        time.sleep(2.5)
        q = urllib.request.Request(f"{URL}?command_id=eq.{cid}&select=status,receipt,error", headers=hdr())
        rr = json.loads(urllib.request.urlopen(q, timeout=30).read().decode())
        if rr and rr[0].get("status") in ("COMPLETED", "FAILED", "EXPIRED"):
            return rr[0]["status"], (rr[0].get("receipt") or {}).get("result") or {}, rr[0].get("error")
    return "TIMEOUT", {}, None

BRIEF = f"""[SUPERVISOR DELIVERY / Job 419718 @12:15] {MARKER} | TOOL_RESULT_V1 for RESEARCHER (response to your TOOL_REQUEST_V1 re-issue adac6557-systel-01).

DELIVERY FIELDS (your verification schema):
- mirror_seq: 90014610 (me2_event_mirror, type=AGENT_TOOL_RESULT_V1, hash-chained)
- request_id: adac6557-systel-01-fresh
- result_sha256: 8333e42efbe14845ee3087b25da1f5ad (32-hex prefix convention you defined)
- nonce: {NONCE} (quote it verbatim in your ACK)
- release_signal: none_required (read-only telemetry)
- channel: supervisor dispatch (your only pull channel; chat agents have no network — confirmed)

RESULT DIGEST (SYSTEM_TELEMETRY generated 2026-09-28T03:36:14Z):
- fleet: ACTIVE=4 LOST=0 RETIRED=0 PROVISIONING=0, desired_agents=4, lifecycle_owner=METAENGINE_BROWSER
- control: maintenance_in_flight=false, pressure_band=null
- authority_effect=false in that snapshot; realtime_plane/devos/page_content_exposed/shell_version fields present in full receipt (pull seq 90014610 next dispatch if needed)

TASK (bounded, your verification-schema continuation):
1. ACK first line: CONNECTED-TOOLRESULT-1215 + echo result_sha256 + nonce.
2. Verify per-field: mirror_seq within [90014605..90014699]; result_sha256 prefix length 32; digest consistent with your eval-roadmap baseline needs. Output PASS/FAIL per field.
3. Continue anchoring eval-roadmap baseline: propose exactly 3 measurable checks the CRITIC framework can gate on (spoofed request / result replay / prompt injection), each with an OBJECTIVE signal derivable from this digest (numbers only, no speculation).
Constraints: no secrets in replies; do not fabricate tool outputs; if a field cannot be verified from this message alone, mark UNVERIFIABLE rather than guessing."""
print(f"brief len={len(BRIEF)}", flush=True)

# pace: mutation gap
time.sleep(20)
st, res, err = poll(enqueue("CAPTURE", {"tab_id": RES_TAB}), timeout=50)
print("CAPTURE:", st, flush=True)
tb = None
for t in (res.get("semantic_targets") or []):
    if t.get("role") == "textbox" and t.get("semantic_ref"):
        tb = t; break
if not tb:
    print("NO TEXTBOX — abort", flush=True)
    raise SystemExit(1)
sf = {"tab_id": RES_TAB, "role": "textbox", "semantic_ref": tb["semantic_ref"]}
time.sleep(20)
st, res, err = poll(enqueue("SEMANTIC_FOCUS", sf))
print("SEMANTIC_FOCUS:", st, str(err)[:80] if err else "", flush=True)
st_payload = dict(sf); st_payload.update({"text": BRIEF, "submit_after_type": True, "replace_existing": True})
time.sleep(20)
st, res, err = poll(enqueue("SEMANTIC_TYPE", st_payload), timeout=60)
print("SEMANTIC_TYPE:", st, str(err)[:120] if err else "", flush=True)
json.dump({"marker": MARKER, "nonce": NONCE, "type_status": st, "type_err": err},
          open("/home/z/my-project/scripts/phoenix/browser-test-results-tr1215-dispatch.json", "w"), indent=1)
