import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const wrapper = await readFile(new URL('../src/devos-native-task-cycle.mjs', import.meta.url), 'utf8');
const core = await readFile(new URL('../src/devos-native-task-cycle-core.mjs', import.meta.url), 'utf8');

test('R98 poisoned root recovery cannot execute inside a leased task dispatch', () => {
  assert.match(core, /devos_dispatch_requires_preexisting_agent_conversation/);
  assert.doesNotMatch(core, /CLOSE_TAB/);
  assert.doesNotMatch(core, /OVER_LIMIT_REPLACE_SEED/);
  assert.doesNotMatch(core, /POISONED_AGENT_TAB_CLOSED/);
});

test('R98 failed Agent bootstrap remains fail-closed in pre-admission wrapper', () => {
  assert.match(wrapper, /LOCAL_AGENT_NEW_TASK_AMBIGUOUS/);
  assert.match(wrapper, /LOCAL_AGENT_SESSION_BOOTSTRAP_AMBIGUOUS/);
  assert.match(wrapper, /write_ahead_barrier_persisted: true/);
  assert.match(wrapper, /automatic_retry_allowed: false/);
  assert.match(wrapper, /bound_unverified_dispatch_allowed: false/);
});

test('R98 scheduler cannot reinterpret preconversation proof as ACTIVE Agent transport', () => {
  assert.match(wrapper, /transport_stage !== 'PRECONVERSATION_ROOT'/);
  assert.match(wrapper, /EXACT_ACTIVE_PROOF_REQUIRED/);
  assert.match(wrapper, /agent_surface_sha256/);
  assert.match(wrapper, /AGENT_SURFACE_ORIGIN_PROOF_REQUIRED/);
});
