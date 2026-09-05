import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserBrainRuntimeControlPlane } from '../src/browser-brain-runtime-control-plane.mjs';

const TAB_A = 'tab_00000000-0000-4000-8000-000000000001';
const COMMAND_A = '00000000-0000-4000-8000-000000000111';

function processSnapshot({ processKey = '200:1788640000100', targetId = 'A1B2C3D4E5', observedAt = '2026-09-06T00:00:00.000Z' } = {}) {
  return {
    observed_at: observedAt,
    processes: [{ pid: 200, process_key: processKey, process_identity_complete: true, type: 'Tab' }],
    web_contents: [{ web_contents_id: 7, os_pid: 200, process_key: processKey, tab_id: TAB_A }],
    semantic_plane: {
      targets: targetId ? [{ tab_id: TAB_A, target_id: targetId, document_generation: 4, semantic_revision: 12 }] : [],
    },
  };
}

function command(overrides = {}) {
  return {
    command_id: COMMAND_A,
    action: 'TYPED_CLICK',
    payload: { tab_id: TAB_A, role: 'button', accessible_name: 'Send' },
    ...overrides,
  };
}

function liveWebContents({ pid = 200, targetId = 'A1B2C3D4E5' } = {}) {
  return {
    id: 7,
    isDestroyed: () => false,
    getOSProcessId: () => pid,
    getOrCreateDevToolsTargetId: () => targetId,
  };
}

function readyPlane() {
  const plane = new BrowserBrainRuntimeControlPlane();
  plane.reconcile({
    tabs: [{ tab_id: TAB_A }],
    process_snapshot: processSnapshot(),
    cell_by_tab: new Map([[TAB_A, { cell_id: 'cell:a', cell_generation: 3, provider: 'CHATGPT', role: 'AUTHENTICATED_WORKER' }]]),
  });
  return plane;
}

test('exact mutation fence binds command to current BrowserCell/WebContents/process/CDP target', () => {
  const plane = readyPlane();
  const fence = plane.prepareMutation(command());
  assert.equal(fence.tab_id, TAB_A);
  assert.equal(fence.cell_id, 'cell:a');
  assert.equal(fence.web_contents_id, 7);
  assert.equal(fence.renderer_pid, 200);
  assert.equal(fence.renderer_process_key, '200:1788640000100');
  assert.equal(fence.target_id, 'A1B2C3D4E5');
  assert.equal(fence.exact_cdp_target_required, true);
  assert.equal(fence.execution_authority, false);

  const validated = plane.assertMutationTarget({ command: command(), fence, webContents: liveWebContents() });
  assert.equal(validated.validated_immediately_before_effect, true);
  assert.equal(validated.authority_effect, false);
});

test('mutations never fall back to selected/platform target and require an explicit tab', () => {
  const plane = readyPlane();
  assert.throws(() => plane.prepareMutation(command({ payload: { role: 'button', accessible_name: 'Send' } })), /explicit_tab_required/);
});

test('a synthetic webcontents fallback is observation identity only and cannot authorize mutation', () => {
  const plane = new BrowserBrainRuntimeControlPlane();
  plane.reconcile({ tabs: [{ tab_id: TAB_A }], process_snapshot: processSnapshot({ targetId: null }) });
  assert.equal(plane.bindingForTab(TAB_A).target_id, 'webcontents:7');
  assert.throws(() => plane.prepareMutation(command()), /exact_cdp_target_not_ready/);
});

test('AMBIGUOUS outcome becomes a same-cell mutation barrier until reconciliation', () => {
  const plane = readyPlane();
  plane.recordCommandOutcome({
    command_id: COMMAND_A,
    action: 'TYPED_CLICK',
    tab_id: TAB_A,
    status: 'AMBIGUOUS',
    effect_outcome: 'AMBIGUOUS',
    recorded_at: '2026-09-06T00:00:01.000Z',
  });
  assert.equal(plane.contextForTab(TAB_A).status, 'NEEDS_ATTENTION');
  assert.throws(() => plane.prepareMutation(command()), /reconciliation_required/);
});

test('renderer death invalidates the runtime binding synchronously before the next census', () => {
  const plane = readyPlane();
  const fence = plane.prepareMutation(command());
  const edge = plane.ingestProcessEvent({
    type: 'RENDER_PROCESS_GONE',
    tab_id: TAB_A,
    web_contents_id: 7,
    os_pid: 200,
    reason: 'crashed',
    observed_at: '2026-09-06T00:00:02.000Z',
  });
  assert.equal(edge.runtime_binding_invalidated, true);
  assert.equal(plane.bindingForTab(TAB_A), null);
  assert.throws(() => plane.assertMutationTarget({ command: command(), fence, webContents: liveWebContents() }), /target_not_live|reconciliation_required/);
});

test('renderer reincarnation fences a previously prepared mutation even with the same OS PID', () => {
  const plane = readyPlane();
  const fence = plane.prepareMutation(command());
  plane.reconcile({
    tabs: [{ tab_id: TAB_A }],
    process_snapshot: processSnapshot({
      processKey: '200:1788649999999',
      targetId: 'NEW-TARGET',
      observedAt: '2026-09-06T00:00:03.000Z',
    }),
  });
  assert.throws(() => plane.assertMutationTarget({
    command: command(),
    fence,
    webContents: liveWebContents({ targetId: 'NEW-TARGET' }),
  }), /generation_mismatch|process_incarnation_mismatch|target_id_mismatch/);
});

test('pressure governor can reduce capacity but never becomes scheduler or execution authority', () => {
  const plane = readyPlane();
  const pressure = plane.observePressure({
    event_loop_utilization: 0.99,
    event_loop_delay_p95_ms: 200,
    max_renderer_cpu_percent: 99,
    unresponsive_cells: 1,
  });
  assert.equal(pressure.pressure_band, 'RED');
  assert.equal(pressure.scheduler_authority, false);
  assert.equal(pressure.execution_authority, false);
  assert.equal(pressure.command_leasing, false);
  const snapshot = plane.snapshot();
  assert.equal(snapshot.ambiguous_effect_blocks_same_cell_mutation, true);
  assert.equal(snapshot.periodic_census_is_execution_authority, false);
});
