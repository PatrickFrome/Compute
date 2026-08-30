import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const migrationUrl = new URL('../../../supabase/migrations/20260830065000_browser_control_command_contract_v1.sql', import.meta.url);
const sql = await fs.readFile(migrationUrl, 'utf8');

test('browser control DB contract is append-only versioned and includes new actions', () => {
  assert.match(sql, /h205f22_a2_browser_supervisor_issue_native_v2/);
  assert.match(sql, /h205f22_a2_browser_supervisor_lease_v4/);
  assert.match(sql, /h205f22_a2_browser_supervisor_complete_v6/);
  for (const action of ['CONTROL_CAPABILITIES','KEY_PRESS','SET_ZOOM']) assert.ok(sql.includes(`'${action}'`));
  assert.doesNotMatch(sql, /drop function\s+public\.h205f22_a2_browser_supervisor_(?:issue_native_v1|lease_v3|complete_v5)/i);
});

test('read-only capability discovery cannot carry payload or become authority effect', () => {
  assert.match(sql, /'SELF_UPDATE_APPLY','CONTROL_CAPABILITIES'\) then\s+if p_payload <> '\{\}'::jsonb/i);
  const complete = sql.slice(sql.indexOf('h205f22_a2_browser_supervisor_complete_v6'), sql.indexOf('h205f22_a2_browser_supervisor_lease_v4'));
  const effectList = complete.slice(complete.indexOf('v_effect :='), complete.indexOf('update public.compute_fabric_a2_browser_supervisor_command_h205f22'));
  assert.equal(effectList.includes("'CONTROL_CAPABILITIES'"), false);
  assert.ok(effectList.includes("'KEY_PRESS'"));
  assert.ok(effectList.includes("'SET_ZOOM'"));
});

test('KEY_PRESS validation is allowlisted and JSON type checks precede array operations', () => {
  assert.match(sql, /native_supervisor_key_not_allowlisted/);
  assert.match(sql, /'PRIMARY','CMDORCTRL','COMMANDORCONTROL','SHIFT','CTRL','CONTROL','ALT','META','COMMAND','CMD'/);
  const typeCheck = sql.indexOf("jsonb_typeof(p_payload->'modifiers') <> 'array'");
  const arrayLength = sql.indexOf("jsonb_array_length(p_payload->'modifiers') > 4");
  const elements = sql.indexOf("jsonb_array_elements_text(p_payload->'modifiers')");
  assert.ok(typeCheck > 0 && typeCheck < arrayLength && arrayLength < elements);
  assert.match(sql, /native_supervisor_key_payload_key_invalid/);
});

test('SET_ZOOM validates existence then number type then bounded numeric cast', () => {
  const exists = sql.indexOf("not (p_payload ? 'factor')");
  const typeCheck = sql.indexOf("jsonb_typeof(p_payload->'factor') <> 'number'");
  const cast = sql.indexOf("(p_payload->>'factor')::numeric < 0.5");
  assert.ok(exists > 0 && exists < typeCheck && typeCheck < cast);
  assert.match(sql, /::numeric > 3\.0/);
  assert.match(sql, /native_supervisor_zoom_payload_key_invalid/);
});

test('lease v4 budgets mutation and permits observation in MONITOR without free actuation', () => {
  const lease = sql.slice(sql.indexOf('h205f22_a2_browser_supervisor_lease_v4'));
  assert.match(lease, /'CONTROL_CAPABILITIES'.*then 0/s);
  assert.match(lease, /'KEY_PRESS','SET_ZOOM'\) then 1/);
  assert.match(lease, /v_mode='CONTROL' or action in \([\s\S]*'CONTROL_CAPABILITIES'/);
  assert.match(lease, /ACTION_BUDGET_EXCEEDED/);
  assert.match(lease, /FAILURE_CIRCUIT_OPEN/);
});

test('new RPCs remain service-role only', () => {
  for (const versioned of ['issue_native_v2','lease_v4','complete_v6']) {
    assert.match(sql, new RegExp(`revoke all on function public\\.h205f22_a2_browser_supervisor_${versioned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^;]+ from public`, 'i'));
    assert.match(sql, new RegExp(`grant execute on function public\\.h205f22_a2_browser_supervisor_${versioned.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^;]+ to service_role`, 'i'));
  }
});
