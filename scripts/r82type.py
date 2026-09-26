#!/usr/bin/env python3
"""R82 live repair: type+submit through the command fastlane."""
import json, subprocess, sys, time, urllib.request

ENV = {}
for line in open('/home/z/.a2/supabase-cloud.env'):
    line = line.strip()
    if '=' in line and not line.startswith('#'):
        k, v = line.split('=', 1)
        ENV[k] = v
URL = ENV['SUPABASE_URL']; KEY = ENV['SUPABASE_SERVICE_ROLE_KEY']
CLIENT = "2a60d6a2-c7c2-4dcc-b4c9-99de768443c9"

def req(path, method='GET', body=None):
    r = urllib.request.Request(URL + path, method=method, data=json.dumps(body).encode() if body is not None else None,
        headers={'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json'})
    with urllib.request.urlopen(r, timeout=15) as resp:
        return json.loads(resp.read())

def issue(action, payload, ttl=90):
    key = f"r82-type-{int(time.time()*1000)}-{action[:6]}"
    out = req('/rest/v1/rpc/h205f22_a2_browser_supervisor_issue_native_v1', 'POST', {
        'p_client_id': CLIENT, 'p_action': action, 'p_platform': 'GLM_ZAI' if action == 'SEMANTIC_TYPE' else None,
        'p_payload': payload, 'p_ttl_seconds': ttl, 'p_issued_by': 'R82_OPERATOR_SANDBOX', 'p_idempotency_key': key})
    if 'command_id' not in out:
        print('ISSUE FAILED:', json.dumps(out)[:300]); sys.exit(1)
    return out['command_id']

def wait(cmd_id, timeout_s=90):
    t0 = time.time()
    while time.time() - t0 < timeout_s:
        time.sleep(3)
        rows = req(f"/rest/v1/compute_fabric_a2_browser_supervisor_command_h205f22?command_id=eq.{cmd_id}&select=status,error,receipt")
        st = rows[0]['status']
        if st not in ('PENDING', 'LEASED'):
            return rows[0]
    raise SystemExit(f'TIMEOUT waiting {cmd_id}')

TAB = "tab_35845d0e-4103-499e-bc58-2e543ef43e4c"

def fresh_semref():
    """CAPTURE the tab and return (accessible_name, semantic_ref) of the composer."""
    cid = issue('CAPTURE', {"tab_id": TAB}, ttl=60)
    row = wait(cid)
    res = (row.get('receipt') or {}).get('result') or {}
    for t in (res.get('semantic_targets') or []):
        if t.get('role') == 'textbox':
            return t.get('name'), t.get('semantic_ref'), res
    raise SystemExit(f'no textbox target; url={res.get("url")} elements={(res.get("interaction_tree") or {}).get("element_count")}')

def type_submit(text, label, replace=False):
    name, semref, frame = fresh_semref()
    payload = {"tab_id": TAB, "role": "textbox", "accessible_name": name,
               "semantic_ref": semref, "text": text, "replace_existing": replace, "submit_after_type": True}
    cid = issue('SEMANTIC_TYPE', payload)
    row = wait(cid)
    rec = row.get('receipt') or {}
    res = rec.get('result') or {}
    print(f"[{label}] status={row['status']} effect_state={res.get('effect_state')} outcome={rec.get('effect_outcome')} err={str(row.get('error'))[:200]}")
    return rec

def capture(tab=TAB):
    cid = issue('CAPTURE', {"tab_id": tab})
    row = wait(cid)
    rec = row.get('receipt') or {}
    return rec.get('result') or {}

def keepalive():
    rows = req("/rest/v1/compute_fabric_a2_browser_supervisor_state_h205f22?select=state&order=last_seen_at.desc&limit=1")
    ka = rows[0]['state']['supervisor_lifecycle']['keepalive']
    return ka

if __name__ == '__main__':
    mode = sys.argv[1] if len(sys.argv) > 1 else 'seed'
    if mode == 'seed':
        SEED = ("METAENGINE SUPERVISOR CONVERSATION SEED v1 — bootstrap message: the supervisor "
                 "continuation message arrives in the NEXT message of this conversation; ignore this "
                 "seed and reply with a single word: READY")
        type_submit(SEED, 'seed')
        time.sleep(4)
        f = capture()
        print('url after seed:', f.get('url'), '| excerpt head:', str(f.get('text_excerpt'))[:200].replace('\n', ' | '))
    elif mode == 'append':
        # Consume the poisoned account draft by appending the rollover marker message and submitting.
        ka = keepalive()
        att = ka.get('rollover_attempt') or {}
        attempt_id, prev, epoch = att.get('attempt_id'), ka.get('conversation_url'), ka.get('supervisor_epoch')
        print(f'attempt: {attempt_id} (started {att.get("started_at")})')
        msg = "\n".join([
            '— — — operator draft-clear + supervisor rollover (R82) — — —',
            'METAENGINE_SUPERVISOR_ROLLOVER_V1',
            'supervisor_id=METAENGINE_SUPERVISOR',
            f'supervisor_epoch={int(epoch) + 1}',
            f'previous_conversation={prev}',
            f'rollover_attempt_id={attempt_id}',
            'integration_line=integration/metaengine-development-os-v1',
            'legacy_convergence_line=integration/compute-unified-v1',
            '',
            'You are the continuing METAENGINE Compute supervisor, now operating as the METAENGINE Development OS supervisor service, not a fresh project or a user-driven chat.',
            'Reconstruct current state from authoritative GitHub/Supabase checkpoints, live Browser/fleet state, durable tasks/claims/evidence and convergence documents before acting.',
            'Resume supervisor, developer and coordinator work immediately. Keep the fleet productive, recover lost work from durable state, and continue autonomous coordination without waiting for a user message.',
            'Preserve the same hard authority, taint, lease, ambiguity and evidence invariants. Never repeat an ambiguous physical effect.',
        ])
        type_submit(msg, 'append+submit')
        time.sleep(5)
        f = capture()
        print('url after submit:', f.get('url'))
        print('excerpt:', str(f.get('text_excerpt'))[:400].replace('\n', ' | '))
    elif mode == 'roll':
        attempt_id = sys.argv[2]
        prev = sys.argv[3]
        epoch = sys.argv[4]
        msg = "\n".join([
            'METAENGINE_SUPERVISOR_ROLLOVER_V1',
            'supervisor_id=METAENGINE_SUPERVISOR',
            f'supervisor_epoch={int(epoch) + 1}',
            f'previous_conversation={prev}',
            f'rollover_attempt_id={attempt_id}',
            'integration_line=integration/metaengine-development-os-v1',
            'legacy_convergence_line=integration/compute-unified-v1',
            '',
            'You are the continuing METAENGINE Compute supervisor, now operating as the METAENGINE Development OS supervisor service, not a fresh project or a user-driven chat.',
            'Reconstruct current state from authoritative GitHub/Supabase checkpoints, live Browser/fleet state, durable tasks/claims/evidence and convergence documents before acting.',
            'Resume supervisor, developer and coordinator work immediately. Keep the fleet productive, recover lost work from durable state, and continue autonomous coordination without waiting for a user message.',
            'Preserve the same hard authority, taint, lease, ambiguity and evidence invariants. Never repeat an ambiguous physical effect.',
        ])
        type_submit(msg, 'rollover')
        time.sleep(4)
        f = capture()
        print('url after rollover:', f.get('url'), '| excerpt:', str(f.get('text_excerpt'))[:300].replace('\n', ' | '))
    elif mode == 'ka':
        ka = keepalive()
        att = ka.get('rollover_attempt') or {}
        print('state:', ka['state'], '| cycle_seq:', ka['cycle_seq'], '| attempt:', att.get('attempt_id'), '| started:', att.get('started_at'))
        print('reason:', ka.get('rollover_reason'), '| last_completed:', ka.get('last_completed_cycle_at'))
    elif mode == 'cap':
        f = capture()
        print('url:', f.get('url'), '| elements:', (f.get('interaction_tree') or {}).get('element_count'))
        print('excerpt:', str(f.get('text_excerpt'))[:400].replace('\n', ' | '))
