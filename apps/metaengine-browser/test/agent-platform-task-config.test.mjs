import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TASK_CONFIG_CONTROLS,
  agentPlatformTaskConfigSnapshot,
  resolveTaskConfigControls,
  waitForAgentPlatformDatabaseVisibility,
} from '../src/agent-platform-task-config.mjs';

// Operator note (2026-09-19): new agents do not see all databases right
// away — the DB list of a fresh task populates asynchronously. The bounded
// wait contract below is the provisioning-side answer: perception-only
// polling until every required database is visible, failing closed with the
// exact missing set instead of assuming the first list is complete.

function frameWithTargets(rows) {
  return {
    url: 'https://chat.z.ai/',
    semantic_targets: rows.map(([role, name]) => ({
      role,
      name,
      backend_node_id: 100 + Math.floor(Math.random() * 900),
      semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_x' },
    })),
  };
}

test('task-config control contract is frozen and names are stable', () => {
  assert.equal(Object.isFrozen(TASK_CONFIG_CONTROLS), true);
  assert.equal(TASK_CONFIG_CONTROLS.full_stack_toggle.name, 'Full-Stack');
  assert.equal(TASK_CONFIG_CONTROLS.long_running_toggle.name, 'Long-running Tasks');
  assert.equal(TASK_CONFIG_CONTROLS.database_section.opens, 'DATABASE_ATTACHMENT_LIST');
  assert.deepEqual(
    ['full_stack_toggle', 'long_running_toggle', 'database_section'].map((k) => TASK_CONFIG_CONTROLS[k].address),
    ['ROLE_NAME_OR_SEMANTIC_REF', 'ROLE_NAME_OR_SEMANTIC_REF', 'ROLE_NAME_OR_SEMANTIC_REF'],
  );
});

test('resolveTaskConfigControls finds unique named controls and reports absent ones', () => {
  const projection = resolveTaskConfigControls(frameWithTargets([
    ['switch', 'Full-Stack'],
    ['switch', 'Long-running Tasks'],
    ['button', 'Databases'],
    ['button', 'Send'],
  ]));
  assert.equal(projection.controls.full_stack_toggle.present, true);
  assert.equal(projection.controls.full_stack_toggle.semantic_ref != null, true);
  assert.equal(projection.controls.long_running_toggle.present, true);
  assert.equal(projection.controls.database_section.present, true);
  assert.equal(projection.authority_effect, false);
});

test('resolveTaskConfigControls marks duplicate-named controls ambiguous, not addressable', () => {
  const projection = resolveTaskConfigControls(frameWithTargets([
    ['switch', 'Full-Stack'],
    ['switch', 'Full-Stack'],
  ]));
  assert.equal(projection.controls.full_stack_toggle.present, false);
  assert.equal(projection.controls.full_stack_toggle.ambiguous, true);
  assert.equal(projection.controls.full_stack_toggle.semantic_ref, null);
  assert.equal(projection.controls.long_running_toggle.present, false);
  assert.equal(projection.controls.long_running_toggle.ambiguous, false);
});

test('resolveTaskConfigControls requires the contract role, not just the name', () => {
  const projection = resolveTaskConfigControls(frameWithTargets([
    ['button', 'Full-Stack'],
  ]));
  assert.equal(projection.controls.full_stack_toggle.present, false);
});

function clock() {
  let t = 0;
  return { now: () => t, advance: (ms) => { t += ms; } };
}

test('database visibility: waits for a late-appearing required database', async () => {
  const c = clock();
  let call = 0;
  const list = async () => {
    call += 1;
    if (call < 3) return ['alpha'];
    return ['alpha', 'beta', 'gamma'];
  };
  const sleeps = [];
  const out = await waitForAgentPlatformDatabaseVisibility({
    listDatabases: list,
    required: ['beta', 'gamma'],
    deadlineMs: 30000,
    intervalMs: 1000,
    now: c.now,
    sleep: async (ms) => { sleeps.push(ms); c.advance(ms); },
  });
  assert.equal(out.complete, true);
  assert.deepEqual(out.missing, []);
  assert.equal(out.attempts, 3);
  assert.equal(out.automatic_retry_allowed, false);
  assert.equal(out.authority_effect, false);
  assert.deepEqual(sleeps, [1000, 1000]);
});

test('database visibility: the first non-empty list is recorded as first_visible_at', async () => {
  const c = clock();
  let call = 0;
  const list = async () => {
    call += 1;
    if (call === 1) return null; // adapter not ready
    if (call === 2) return [];
    return ['metaengine'];
  };
  const out = await waitForAgentPlatformDatabaseVisibility({
    listDatabases: list,
    required: ['metaengine'],
    deadlineMs: 30000,
    intervalMs: 500,
    now: c.now,
    sleep: async (ms) => c.advance(ms),
  });
  assert.equal(out.complete, true);
  assert.equal(out.first_visible_at, 1000);
});

test('database visibility: times out with the exact missing set, case-insensitive', async () => {
  const c = clock();
  const out = await waitForAgentPlatformDatabaseVisibility({
    listDatabases: async () => ['Alpha', 'Beta'],
    required: ['  ALPHA  ', 'delta'],
    deadlineMs: 5000,
    intervalMs: 1000,
    now: c.now,
    sleep: async (ms) => c.advance(ms),
  });
  assert.equal(out.complete, false);
  assert.equal(out.timed_out, true);
  assert.deepEqual(out.missing, ['delta']);
  assert.deepEqual(out.visible, ['alpha', 'beta']);
});

test('database visibility: adapter exceptions keep polling without failing the wait', async () => {
  const c = clock();
  let call = 0;
  const list = async () => {
    call += 1;
    if (call < 3) throw new Error('dialog not readable yet');
    return ['metaengine'];
  };
  const out = await waitForAgentPlatformDatabaseVisibility({
    listDatabases: list,
    required: ['metaengine'],
    deadlineMs: 30000,
    intervalMs: 1000,
    now: c.now,
    sleep: async (ms) => c.advance(ms),
  });
  assert.equal(out.complete, true);
  assert.equal(out.attempts, 3);
});

test('database visibility: no adapter is a hard contract error', async () => {
  await assert.rejects(
    () => waitForAgentPlatformDatabaseVisibility({ required: ['x'] }),
    /task_config_database_list_adapter_required/,
  );
});

test('database visibility: empty required set completes on the first readable snapshot', async () => {
  const c = clock();
  let calls = 0;
  const out = await waitForAgentPlatformDatabaseVisibility({
    listDatabases: async () => { calls += 1; return ['anything']; },
    required: [],
    deadlineMs: 30000,
    intervalMs: 1000,
    now: c.now,
    sleep: async (ms) => c.advance(ms),
  });
  assert.equal(out.complete, true);
  assert.equal(calls, 1);
});

test('task-config snapshot documents the async DB visibility requirement', () => {
  const snap = agentPlatformTaskConfigSnapshot();
  assert.equal(snap.database_visibility, 'ASYNC_POPULATED_BOUNDED_WAIT_REQUIRED');
  assert.equal(snap.composer_ignores_synthetic_editing_keys, true);
  assert.equal(snap.composer_enter_submits, true);
  assert.equal(snap.replace_gesture_root_surface, 'CLICK_SELECT');
  assert.equal(snap.authority_effect, false);
});
