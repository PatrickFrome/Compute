import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../../supabase/migrations/20261005110000_browser_computer_authority_plane_v2_fast_actions.sql', import.meta.url), 'utf8');
const executor = fs.readFileSync(new URL('../src/windows-local-computer-executor.mjs', import.meta.url), 'utf8');
const plane = fs.readFileSync(new URL('../src/computer-authority-plane.mjs', import.meta.url), 'utf8');

test('Computer V2 issuer adds only typed UIA/display subactions and requires V2 attestation', () => {
  for (const action of [
    'OBSERVE_DISPLAYS','FOREGROUND_STATUS','CAPTURE_WINDOW',
    'UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL',
  ]) assert.ok(migration.includes("'" + action + "'"), action);

  assert.match(migration, /computer_authority_v2_not_attested/);
  assert.match(migration, /computer_authority,version/);
  assert.ok(migration.includes("<> '2.0.0'"));
  assert.match(migration, /h205f22_a2_browser_supervisor_issue_computer_v1/);
  assert.match(migration, /insert\s+into\s+public\.compute_fabric_a2_browser_supervisor_command_h205f22/i);
  assert.equal(/create\s+table/i.test(migration), false);
  assert.equal(/create\s+or\s+replace\s+function\s+public\.h205f22_a2_browser_supervisor_lease/i.test(migration), false);
  assert.ok(migration.includes("'scheduler_authority',false"));
  assert.ok(migration.includes("'execution_authority',false"));
});

test('Computer V2 executor implements every newly admitted action without raw shell expansion', () => {
  for (const action of [
    'OBSERVE_DISPLAYS','FOREGROUND_STATUS','CAPTURE_WINDOW',
    'UIA_SET_VALUE','UIA_TOGGLE','UIA_SELECT','UIA_EXPAND_COLLAPSE','UIA_SCROLL',
  ]) assert.ok(executor.includes("'" + action + "'"), action);

  for (const pattern of [/ValuePattern/,/TogglePattern/,/SelectionItemPattern/,/ExpandCollapsePattern/,/ScrollPattern/,/GetSupportedPatterns/])
    assert.match(executor, pattern);

  assert.doesNotMatch(executor, /Invoke-Expression/);
  assert.doesNotMatch(executor, /-EncodedCommand/);
  assert.ok(executor.includes('raw_shell_input: false'));
  assert.ok(executor.includes('automatic_retry_allowed: false'));
});

test('Computer V2 policy still routes Browser semantic before UIA before visual fallback', () => {
  assert.ok(plane.includes("version: '2.0.0'"));
  assert.ok(plane.includes("router_order: Object.freeze(['BROWSER_SEMANTIC', 'WINDOWS_UIA', 'COMPUTER_VISUAL'])"));
  assert.match(plane, /direct_uia_patterns:/);
  assert.ok(plane.includes('multi_monitor_observation: true'));
  assert.ok(plane.includes('arbitrary_shell: false'));
  assert.ok(plane.includes('automatic_retry_allowed: false'));
});
