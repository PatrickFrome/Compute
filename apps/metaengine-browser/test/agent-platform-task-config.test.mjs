import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AGENT_HOME_CONTROLS,
  TASK_CONFIG_CONTROLS,
  agentPlatformTaskConfigSnapshot,
  classifyAgentPlatformTaskSurface,
  resolveAgentHomeControls,
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
    url: 'https://chatgpt.com/',
    semantic_targets: rows.map(([role, name]) => ({
      role,
      name,
      backend_node_id: 100 + Math.floor(Math.random() * 900),
      semantic_ref: { schema: 'metaengine.native-browser.semantic-ref.v1', semantic_ref_id: 'semref_x' },
    })),
  };
}


test('ChatGPT root is not admitted without the exact semantic composer', () => {
  const frame = frameWithTargets([
    ['button', 'Search'],
    ['textbox', 'Search'],
  ]);
  const surface = classifyAgentPlatformTaskSurface(frame);
  assert.equal(surface.stage, 'CHAT_ROOT');
  assert.equal(surface.proven, false);
  assert.equal(resolveAgentHomeControls(frame).ready, false);
});

test('ChatGPT root composer is the exact isolated-session bootstrap surface', () => {
  const frame = frameWithTargets([
    ['textbox', 'Message ChatGPT'],
    ['button', 'Search'],
  ]);
  const surface = classifyAgentPlatformTaskSurface(frame);
  assert.equal(surface.stage, 'AGENT_HOME');
  assert.equal(surface.proven, true);
  const controls = resolveAgentHomeControls(frame);
  assert.equal(controls.ready, true);
  assert.equal(controls.controls.root_composer.accessible_name, 'Message ChatGPT');
  assert.equal(controls.controls.new_task, null);
  assert.equal(controls.authority_effect, false);
});

test('R98: conversation URL alone never proves Agent origin', () => {
  const frame = frameWithTargets([
    ['textbox', 'Send a Message'],
  ]);
  frame.url = 'https://chatgpt.com/c/11111111-2222-3333-4444-555555555555';
  const surface = classifyAgentPlatformTaskSurface(frame);
  assert.equal(surface.stage, 'CONVERSATION_ORIGIN_UNPROVEN');
  assert.equal(surface.proven, false);
  assert.equal(surface.url_only_authority, false);
  assert.equal(surface.requires_durable_agent_origin_proof, true);
  assert.equal(resolveAgentHomeControls(frame).ready, false);
});

test('legacy z.ai-style controls do not grant ChatGPT root admission', () => {
  const frame = frameWithTargets([
    ['button', 'Agent'],
    ['button', 'New Task'],
    ['button', 'Full-Stack'],
  ]);
  const surface = classifyAgentPlatformTaskSurface(frame);
  assert.equal(surface.stage, 'CHAT_ROOT');
  assert.equal(surface.proven, false);
});

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

test('task-config snapshot exposes ChatGPT root bootstrap and fences legacy z.ai configuration', () => {
  const snap = agentPlatformTaskConfigSnapshot();
  assert.equal(snap.platform, 'CHATGPT');
  assert.equal(snap.task_creation_surface, 'CHATGPT_ROOT_COMPOSER');
  assert.equal(snap.ordinary_root_is_task_surface, true);
  assert.equal(snap.root_requires_exact_semantic_composer, true);
  assert.equal(snap.conversation_url_is_agent_surface_authority, false);
  assert.equal(snap.conversation_origin_requires_durable_agent_surface_proof, true);
  assert.equal(snap.agent_home_proof, 'EXACT_CHATGPT_ROOT_COMPOSER_SAME_REVISION');
  assert.equal(snap.legacy_task_config_active, false);
  assert.equal(snap.task_config_surface_state, 'LEGACY_COMPATIBILITY_ONLY');
  assert.equal(snap.database_visibility, 'LEGACY_ZAI_TASK_CONFIG_ONLY');
  assert.equal(snap.agent_home_controls.new_task.name, AGENT_HOME_CONTROLS.new_task.name);
  assert.equal(snap.authority_effect, false);
});
