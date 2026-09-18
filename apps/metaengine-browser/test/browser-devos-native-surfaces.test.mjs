import test from 'node:test';
import assert from 'node:assert/strict';
import { attachDevOSNativeSurfaces } from '../src/metaengine-devos-native-surfaces.mjs';

const zero = Object.freeze({
  projection_is_authority: false,
  scheduler_authority: false,
  execution_authority: false,
  command_leasing: false,
  automatic_effect_retry_allowed: false,
  page_model_authority: false,
  authority_effect: false,
});

function baseDevOS() {
  return {
    schema: 'metaengine.devos.projection.v1',
    primary_object: 'SESSION',
    sessions: [{
      session_id: 'session:a',
      title: 'A',
      status: 'ACTIVE',
      task_count: 1,
      tasks: [{ task_id: 'task:1', objective: 'Ship installer', status: 'ACTIVE', updated_at: '2026-09-08T00:00:00Z', ...zero }],
      surface_ids: ['browser:tab-a'],
      ...zero,
    }],
    surfaces: [{
      surface_id: 'browser:tab-a', session_id: 'session:a', type: 'BROWSER', title: 'Browser', tab_id: 'tab-a', ...zero,
    }],
    artifacts: [{ artifact_id: 'artifact-1', session_id: 'session:a', ref: 'build/installer.exe', immutable_reference: true, ...zero }],
    navigation: {
      memory: { source_state: 'AVAILABLE', episode_count: 3, semantic_fact_count: 5, procedural_playbook_count: 2, ...zero },
    },
    selected: { session_id: 'session:a', surface_id: 'browser:tab-a' },
    active_session: { session_id: 'session:a', surface_count: 1, ...zero },
    counts: { sessions: 1, surfaces: 1, artifacts: 1 },
    ...zero,
  };
}

test('canonical Session receives Browser plus shell-native Timeline Artifact and Memory surfaces', () => {
  const out = attachDevOSNativeSurfaces(baseDevOS());
  assert.equal(out.surfaces.length, 4);
  assert.deepEqual(out.sessions[0].surface_ids, [
    'browser:tab-a',
    'timeline:session:a',
    'artifact:session:a:artifact-1',
    'memory:session:a',
  ]);
  assert.equal(out.active_session.surface_count, 4);
  assert.equal(out.counts.surfaces, 4);
  assert.equal(out.native_surface_attachment.native_surface_count, 3);
  assert.equal(out.native_surface_attachment.absent_runtime_types_are_not_invented, true);
  assert.equal(out.authority_effect, false);
});

test('native surfaces never become runtime-bound or execution authority', () => {
  const out = attachDevOSNativeSurfaces(baseDevOS());
  for (const row of out.surfaces.filter((surface) => surface.type !== 'BROWSER')) {
    assert.equal(row.runtime_bound, false);
    assert.equal(row.presentation_only, true);
    assert.equal(row.execution_authority, false);
    assert.equal(row.scheduler_authority, false);
    assert.equal(row.authority_effect, false);
  }
});

test('invalid authority-bearing DevOS is returned untouched instead of laundered', () => {
  const source = { ...baseDevOS(), execution_authority: true };
  assert.equal(attachDevOSNativeSurfaces(source), source);
});
