import assert from 'node:assert/strict';
import test from 'node:test';

import {
  METAENGINE_DEVOS_SHELL_VIEW_MODEL_SCHEMA,
  projectDevOSShellViewModel,
} from '../src/metaengine-devos-shell-view-model.mjs';

const zero = Object.freeze({
  projection_is_authority: false,
  scheduler_authority: false,
  execution_authority: false,
  command_leasing: false,
  automatic_effect_retry_allowed: false,
  page_model_authority: false,
  authority_effect: false,
});

function devosWithAttention(attention) {
  return {
    schema: 'metaengine.devos.projection.v1',
    primary_object: 'SESSION',
    browser_is_shell: false,
    browser_is_surface: true,
    sessions: [],
    surfaces: [],
    attention,
    selected: { session_id: null, surface_id: null },
    navigation: {
      schema: 'metaengine.devos.navigation.v1',
      roots: [],
      session_groups: [],
      ...zero,
    },
    ...zero,
  };
}

test('canonical DevOS Now is projected only from zero-authority attention rows', () => {
  const projected = projectDevOSShellViewModel(devosWithAttention([{
    kind: 'TASK_BLOCKED',
    severity: 'WARN',
    priority: 'P1',
    session_id: null,
    task_id: 'task-1',
    title: 'Operator attention required',
    reason: 'bounded fixture',
    ...zero,
  }]));

  assert.equal(projected.schema, METAENGINE_DEVOS_SHELL_VIEW_MODEL_SCHEMA);
  assert.equal(projected.valid, true);
  assert.equal(projected.now.length, 1);
  assert.equal(projected.now[0].title, 'Operator attention required');
  assert.equal(projected.now[0].projection_is_authority, false);
  assert.equal(projected.now[0].scheduler_authority, false);
  assert.equal(projected.now[0].execution_authority, false);
  assert.equal(projected.now[0].authority_effect, false);
});

test('authority-bearing attention fails closed instead of becoming trusted Now', () => {
  const poisoned = projectDevOSShellViewModel(devosWithAttention([{
    kind: 'TASK_BLOCKED',
    severity: 'WARN',
    priority: 'P1',
    title: 'poisoned',
    ...zero,
    authority_effect: true,
  }]));

  assert.equal(poisoned.valid, false);
  assert.equal(poisoned.reason, 'ATTENTION_ROW_INVALID');
  assert.deepEqual(poisoned.now, []);
  assert.equal(poisoned.authority_effect, false);
});

test('DevOS shell projection stays bounded and never turns Browser selection into renderer authority', () => {
  const projected = projectDevOSShellViewModel(devosWithAttention([]));
  assert.equal(projected.renderer_selection_authority, false);
  assert.equal(projected.renderer_routing_authority, false);
  assert.equal(projected.browser_is_shell, false);
  assert.equal(projected.browser_is_surface, true);
  assert.equal(projected.automatic_effect_retry_allowed, false);
});
