import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const migration = fs.readFileSync(new URL('../../../supabase/migrations/20261005110000_browser_computer_authority_plane_v2_fast_actions.sql', import.meta.url), 'utf8');
const visualFenceMigration = fs.readFileSync(new URL('../../../supabase/migrations/20261005123000_browser_computer_visual_fence_target_binding_v1.sql', import.meta.url), 'utf8');
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

test('Computer V2 visual fallback requires exact target binding at issuer and executor boundaries', () => {
  assert.match(visualFenceMigration, /'POINTER_CLICK'/);
  assert.match(visualFenceMigration, /computer_authority_v2_not_attested/);
  assert.match(visualFenceMigration, /v_subaction in \('UIA_SNAPSHOT','CAPTURE_WINDOW','VERIFY_TARGET'\)/);
  assert.match(visualFenceMigration, /computer_target_identity_digest_required/);
  assert.match(visualFenceMigration, /<> '2\.0\.0'/);
  assert.equal(/create\s+table/i.test(visualFenceMigration), false);
  assert.equal(/create\s+or\s+replace\s+function\s+public\.h205f22_a2_browser_supervisor_lease/i.test(visualFenceMigration), false);
  assert.ok(executor.includes('computer_visual_frame_target_unbound'));
  assert.ok(executor.includes('computer_visual_frame_target_mismatch'));
  assert.ok(executor.includes('computer_visual_frame_geometry_required'));
  assert.ok(executor.includes('computer_visual_frame_geometry_drift'));
  assert.ok(plane.includes('visual_pointer_requires_target_bound_window_capture: true'));
  assert.ok(plane.includes('visual_pointer_requires_unchanged_window_geometry: true'));
});

test('Computer V2 does not confuse dispatch confirmation with effect proof', () => {
  assert.match(executor, /'UIA_INVOKE'[\s\S]{0,1800}readback_proven = \$false/);
  assert.match(executor, /'KEY_PRESS'[\s\S]{0,2600}readback_proven = \$false/);
  assert.match(executor, /'POINTER_CLICK'[\s\S]{0,3200}readback_proven = \$false/);
  assert.match(executor, /'TYPE_TEXT'[\s\S]{0,4200}ValuePattern/);
  assert.match(executor, /'TYPE_TEXT'[\s\S]{0,5200}value_readback_proven = \$readback/);
  assert.ok(plane.includes('computer_type_append_mode_unproven'));
  assert.ok(plane.includes('dispatch_only_mutations_never_claim_effect_proven: true'));
  assert.ok(plane.includes('type_text_requires_value_readback_for_effect_proof: true'));
});

test('Computer V2 crosses the ambiguity barrier before foreground, focus or pointer side effects', () => {
  for (const action of ['TYPE_TEXT','KEY_PRESS','POINTER_CLICK']) {
    const start = executor.indexOf("    '" + action + "' {");
    assert.ok(start >= 0, action);
    const next = executor.indexOf("\n    '", start + 8);
    const block = executor.slice(start, next > start ? next : executor.length);
    const barrier = block.indexOf('$effectStarted = $true');
    const foreground = block.indexOf('SetForegroundWindow');
    assert.ok(barrier >= 0 && foreground >= 0 && barrier < foreground, action + ':foreground');
    if (action === 'TYPE_TEXT') {
      const focus = block.indexOf('$element.SetFocus()');
      assert.ok(focus >= 0 && barrier < focus, action + ':focus');
    }
    if (action === 'POINTER_CLICK') {
      const cursor = block.indexOf('SetCursorPos');
      assert.ok(cursor >= 0 && barrier < cursor, action + ':pointer');
    }
  }
  assert.ok(plane.includes('effect_barrier_precedes_foreground_focus_pointer_side_effects: true'));
});

test('Computer V2 visual click never brings a stale frame to foreground and revalidates raw pixels', () => {
  const start = executor.indexOf("    'POINTER_CLICK' {");
  const end = executor.indexOf("\n    default {", start);
  const block = executor.slice(start, end);
  assert.ok(start >= 0 && end > start);
  assert.ok(block.includes('computer_visual_foreground_drift'));
  assert.equal(block.includes('SetForegroundWindow'), false);
  assert.ok(block.includes('Get-BitmapPixelSha256'));
  assert.ok(block.includes('computer_visual_frame_changed_before_click'));
  assert.ok(block.includes('computer_visual_frame_geometry_drift_after_pointer_move'));
  assert.ok(executor.includes('foreground = $foregroundAtCapture'));
  assert.ok(executor.includes('pixel_sha256 = $pixelHash'));
  assert.ok(plane.includes('visual_pointer_requires_foreground_capture: true'));
  assert.ok(plane.includes('visual_pointer_revalidates_pixels_after_cursor_move: true'));
  assert.ok(plane.includes('visual_pointer_never_foregrounds_stale_frame: true'));
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
