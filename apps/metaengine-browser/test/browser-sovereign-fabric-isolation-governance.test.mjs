import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BROWSER_CELL_SCHEMA, BROWSER_CELL_TYPES } from '../src/browser-fabric-browser-cell.mjs';
import { validateBrowserCellFleetIsolation } from '../src/browser-fabric-cell-fleet.mjs';
import { bindBrowserFabricTraceContext } from '../src/browser-fabric-trace-context.mjs';
import { BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS } from '../src/browser-fabric-effect-domain-policy.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');
const NOW = new Date('2026-09-05T04:00:30Z');
const BUDGET = Object.freeze({
  max_tabs: 2,
  max_targets: 4,
  max_memory_mb: 1024,
  max_wall_time_ms: 30 * 60_000,
});
const FLEET_OPTIONS = Object.freeze({
  now: NOW,
  resource_limits: Object.freeze({
    max_cells: 8,
    max_tabs: 16,
    max_targets: 32,
    max_memory_mb: 8192,
  }),
});

function runtime(cellId, generation, contextId, browserIncarnation, rendererIncarnation, partitionId = null) {
  return {
    cell_generation: generation,
    browser_process_incarnation: browserIncarnation,
    runtime_observed_at: '2026-09-05T04:00:20Z',
    runtime_readback: {
      schema: 'metaengine.browser-fabric.cell-runtime-readback.v1',
      observer_id: 'runtime-observer:01',
      observer_independent: true,
      observed_at: '2026-09-05T04:00:20Z',
      cell_id: cellId,
      cell_generation: generation,
      browser_context_id: contextId,
      browser_process_incarnation: browserIncarnation,
      renderer_process_incarnation: rendererIncarnation,
      storage_partition_id: partitionId,
    },
  };
}

function cells() {
  return [
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.HUMAN,
      cell_id: 'cell:human-01',
      browser_context_id: 'context:human-01',
      ...runtime('cell:human-01', 1, 'context:human-01', 'browser-process:01', 'renderer:human-01', 'partition:human-01'),
      isolated_from_human: true,
      fleet_capacity: false,
      active_claim_count: 0,
      persistent_partition: true,
      storage_partition_id: 'partition:human-01',
      expires_at: null,
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.AUTHENTICATED_WORKER,
      cell_id: 'cell:worker-a',
      browser_context_id: 'context:worker-a',
      ...runtime('cell:worker-a', 3, 'context:worker-a', 'browser-process:01', 'renderer:worker-a', 'partition:worker-a'),
      isolated_from_human: true,
      fleet_capacity: true,
      active_claim_count: 1,
      active_task_id: 'task:worker-a',
      active_claim_generation: 7,
      persistent_partition: true,
      storage_partition_id: 'partition:worker-a',
      resource_budget: BUDGET,
      expires_at: '2026-09-05T04:10:00Z',
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.AUTHENTICATED_WORKER,
      cell_id: 'cell:worker-b',
      browser_context_id: 'context:worker-b',
      ...runtime('cell:worker-b', 4, 'context:worker-b', 'browser-process:01', 'renderer:worker-b', 'partition:worker-b'),
      isolated_from_human: true,
      fleet_capacity: true,
      active_claim_count: 1,
      active_task_id: 'task:worker-b',
      active_claim_generation: 8,
      persistent_partition: true,
      storage_partition_id: 'partition:worker-b',
      resource_budget: BUDGET,
      expires_at: '2026-09-05T04:10:00Z',
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH,
      cell_id: 'cell:research-01',
      browser_context_id: 'context:research-01',
      ...runtime('cell:research-01', 1, 'context:research-01', 'browser-process:01', 'renderer:research-01'),
      isolated_from_human: true,
      fleet_capacity: true,
      active_claim_count: 0,
      persistent_partition: false,
      user_data_allowed: false,
      prompt_access_allowed: false,
      send_allowed: false,
      resource_budget: BUDGET,
      expires_at: '2026-09-05T04:10:00Z',
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.RECOVERY_PROBE,
      cell_id: 'cell:recovery-01',
      browser_context_id: 'context:recovery-01',
      ...runtime('cell:recovery-01', 1, 'context:recovery-01', 'browser-process:01', 'renderer:recovery-01'),
      isolated_from_human: true,
      fleet_capacity: false,
      active_claim_count: 0,
      persistent_partition: false,
      user_data_allowed: false,
      prompt_access_allowed: false,
      send_allowed: false,
      resource_budget: BUDGET,
      expires_at: '2026-09-05T04:10:00Z',
    },
  ];
}

test('two authenticated BrowserCells require distinct contexts and partitions', () => {
  const out = validateBrowserCellFleetIsolation(cells(), FLEET_OPTIONS);
  assert.equal(out.ok, true);
  assert.equal(out.capacity_cell_count, 3);
  assert.equal(out.active_claim_count, 2);
  assert.equal(out.unique_browser_contexts, true);
  assert.equal(out.human_profile_excluded_from_capacity, true);

  const sharedContext = cells();
  sharedContext[2].browser_context_id = sharedContext[1].browser_context_id;
  sharedContext[2].runtime_readback.browser_context_id = sharedContext[1].browser_context_id;
  assert.equal(validateBrowserCellFleetIsolation(sharedContext, FLEET_OPTIONS).reason, 'SHARED_BROWSER_CONTEXT_FORBIDDEN');

  const sharedPartition = cells();
  sharedPartition[2].storage_partition_id = sharedPartition[1].storage_partition_id;
  sharedPartition[2].runtime_readback.storage_partition_id = sharedPartition[1].storage_partition_id;
  assert.equal(validateBrowserCellFleetIsolation(sharedPartition, FLEET_OPTIONS).reason, 'SHARED_PERSISTENT_PARTITION_FORBIDDEN');

  const sharedRenderer = cells();
  sharedRenderer[2].runtime_readback.renderer_process_incarnation = sharedRenderer[1].runtime_readback.renderer_process_incarnation;
  assert.equal(validateBrowserCellFleetIsolation(sharedRenderer, FLEET_OPTIONS).reason, 'SHARED_RENDERER_PROCESS_FORBIDDEN');

  const staleGeneration = cells();
  staleGeneration[1].runtime_readback.cell_generation = 2;
  assert.equal(validateBrowserCellFleetIsolation(staleGeneration, FLEET_OPTIONS).reason, 'CELL_RUNTIME_READBACK_BINDING_MISMATCH');

  assert.equal(validateBrowserCellFleetIsolation(cells(), {
    now: NOW,
    resource_limits: { ...FLEET_OPTIONS.resource_limits, max_cells: 2 },
  }).reason, 'CELL_FLEET_RESOURCE_BUDGET_EXCEEDED');
});

test('causal trace context binds effect/task/cell/target without arbitrary baggage', () => {
  const out = bindBrowserFabricTraceContext({
    traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    effect_id: 'effect:session:00000001',
    task_id: 'task:00000001',
    claim_generation: 7,
    cell_id: 'cell:worker-a',
    cell_generation: 3,
    browser_context_id: 'context:worker-a',
    browser_process_incarnation: 'browser-process:01',
    target_incarnation: 'target-incarnation:0001',
  });
  assert.equal(out.ok, true);
  assert.equal(out.trace_id, '0123456789abcdef0123456789abcdef');
  assert.equal(out.arbitrary_baggage_allowed, false);
  assert.equal(out.sensitive_data_in_context_allowed, false);
  assert.match(out.correlation_sha256, /^[0-9a-f]{64}$/);
  assert.equal(bindBrowserFabricTraceContext({
    traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-ff',
    effect_id: 'effect:session:00000001',
    task_id: 'task:00000001',
    claim_generation: 7,
    cell_id: 'cell:worker-a',
    cell_generation: 3,
    browser_context_id: 'context:worker-a',
    browser_process_incarnation: 'browser-process:01',
    target_incarnation: 'target-incarnation:0001',
  }).reason, 'TRACEPARENT_INVALID');
});

test('transport promotion ACL remediation is rollback-only dry run, never auto-production DDL', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'sql', 'browser_fabric_transport_promotion_acl_dry_run_v1.sql'), 'utf8');
  assert.match(sql, /revoke execute on function public\.devos_transport_promotion_lease_v1\(uuid,text,text,text,text,bigint\) from public;/i);
  assert.match(sql, /revoke execute on function public\.devos_transport_promotion_release_v1\(uuid,text,uuid,text,text,text,bigint\) from public;/i);
  assert.match(sql, /from anon, authenticated;/i);
  assert.match(sql, /grant execute on function public\.devos_transport_promotion_lease_v1\(uuid,text,text,text,text,bigint\) to service_role;/i);
  assert.match(sql, /grant execute on function public\.devos_transport_promotion_release_v1\(uuid,text,uuid,text,text,text,bigint\) to service_role;/i);
  assert.match(sql, /rollback;\s*$/i);
  assert.match(sql, /browser_fabric_acl_target_v1/i);
  assert.match(sql, /browser_fabric_acl_resolved_v1/i);
  assert.match(sql, /exact pre-change proacl receipt/i);
  assert.doesNotMatch(sql, /^\s*commit;\s*$/im);
});

test('ledger pilot is outside auto migrations and preserves append-only/outbox boundaries', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'sql', 'browser_fabric_event_effect_ledger_pilot_v1.sql'), 'utf8');
  for (const fragment of [
    'browser_fabric_effect_event_v1',
    'browser_fabric_effect_outbox_v1',
    'browser_fabric_one_attempt_v1',
    'browser_fabric_one_ambiguous_outcome_v1',
    'browser_fabric_one_terminal_outcome_v1',
    "('CONFIRMED','ABSENT_PROVEN','AMBIGUOUS','CONFLICT','CORRUPT')",
    'browser_fabric_effect_event_no_update_delete_v1',
    'authority_effect boolean not null default false',
    'revoke all on table destruktion_meta.browser_fabric_effect_event_v1 from public, anon, authenticated, service_role',
    'revoke all on sequence destruktion_meta.browser_fabric_effect_event_v1_event_seq_seq from public, anon, authenticated, service_role',
  ]) assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), `${fragment} missing`);
  for (const domain of BROWSER_FABRIC_EXISTING_EFFECT_DOMAINS) {
    assert.ok(sql.includes(`'${domain}'`), `registered effect domain ${domain} missing from SQL`);
  }
  assert.doesNotMatch(sql, /create unique index if not exists browser_fabric_one_outcome_v1/i);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)[^;]*\s+to\s+(public|anon|authenticated)/i);
  assert.doesNotMatch(sql, /grant\s+insert(?:,select)?\s+on\s+destruktion_meta\.browser_fabric_effect_event_v1/i);
});
