import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { BROWSER_CELL_SCHEMA, BROWSER_CELL_TYPES } from '../src/browser-fabric-browser-cell.mjs';
import { validateBrowserCellFleetIsolation } from '../src/browser-fabric-cell-fleet.mjs';
import { bindBrowserFabricTraceContext } from '../src/browser-fabric-trace-context.mjs';

const repoRoot = path.resolve(import.meta.dirname, '..', '..', '..');

function cells() {
  return [
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.HUMAN,
      cell_id: 'cell:human-01',
      browser_context_id: 'context:human-01',
      fleet_capacity: false,
      active_claim_count: 0,
      persistent_partition: true,
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.AUTHENTICATED_WORKER,
      cell_id: 'cell:worker-a',
      browser_context_id: 'context:worker-a',
      active_claim_count: 1,
      persistent_partition: true,
      storage_partition_id: 'partition:worker-a',
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.AUTHENTICATED_WORKER,
      cell_id: 'cell:worker-b',
      browser_context_id: 'context:worker-b',
      active_claim_count: 1,
      persistent_partition: true,
      storage_partition_id: 'partition:worker-b',
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.EPHEMERAL_RESEARCH,
      cell_id: 'cell:research-01',
      browser_context_id: 'context:research-01',
      active_claim_count: 0,
      persistent_partition: false,
      user_data_allowed: false,
      prompt_access_allowed: false,
    },
    {
      schema: BROWSER_CELL_SCHEMA,
      type: BROWSER_CELL_TYPES.RECOVERY_PROBE,
      cell_id: 'cell:recovery-01',
      browser_context_id: 'context:recovery-01',
      active_claim_count: 0,
      persistent_partition: false,
      user_data_allowed: false,
      send_allowed: false,
    },
  ];
}

test('two authenticated BrowserCells require distinct contexts and partitions', () => {
  const out = validateBrowserCellFleetIsolation(cells());
  assert.equal(out.ok, true);
  assert.equal(out.capacity_cell_count, 3);
  assert.equal(out.active_claim_count, 2);
  assert.equal(out.unique_browser_contexts, true);
  assert.equal(out.human_profile_excluded_from_capacity, true);

  const sharedContext = cells();
  sharedContext[2].browser_context_id = sharedContext[1].browser_context_id;
  assert.equal(validateBrowserCellFleetIsolation(sharedContext).reason, 'SHARED_BROWSER_CONTEXT_FORBIDDEN');

  const sharedPartition = cells();
  sharedPartition[2].storage_partition_id = sharedPartition[1].storage_partition_id;
  assert.equal(validateBrowserCellFleetIsolation(sharedPartition).reason, 'SHARED_WORKER_PARTITION_FORBIDDEN');
});

test('causal trace context binds effect/task/cell/target without arbitrary baggage', () => {
  const out = bindBrowserFabricTraceContext({
    traceparent: '00-0123456789abcdef0123456789abcdef-0123456789abcdef-01',
    effect_id: 'effect:session:00000001',
    task_id: 'task:00000001',
    claim_generation: 7,
    browser_context_id: 'context:worker-a',
    target_incarnation: 'target-incarnation:0001',
  });
  assert.equal(out.ok, true);
  assert.equal(out.trace_id, '0123456789abcdef0123456789abcdef');
  assert.equal(out.arbitrary_baggage_allowed, false);
  assert.equal(out.sensitive_data_in_context_allowed, false);
  assert.match(out.correlation_sha256, /^[0-9a-f]{64}$/);
});

test('transport promotion ACL remediation is rollback-only dry run, never auto-production DDL', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'sql', 'browser_fabric_transport_promotion_acl_dry_run_v1.sql'), 'utf8');
  assert.match(sql, /revoke execute on function public\.devos_transport_promotion_lease_v1\(uuid,text,text,text,text,bigint\) from public;/i);
  assert.match(sql, /revoke execute on function public\.devos_transport_promotion_release_v1\(uuid,text,uuid,text,text,text,bigint\) from public;/i);
  assert.match(sql, /grant execute on function public\.devos_transport_promotion_lease_v1\(uuid,text,text,text,text,bigint\) to service_role;/i);
  assert.match(sql, /grant execute on function public\.devos_transport_promotion_release_v1\(uuid,text,uuid,text,text,text,bigint\) to service_role;/i);
  assert.match(sql, /rollback;\s*$/i);
  assert.doesNotMatch(sql, /^\s*commit;\s*$/im);
});

test('ledger pilot is outside auto migrations and preserves append-only/outbox boundaries', () => {
  const sql = fs.readFileSync(path.join(repoRoot, 'sql', 'browser_fabric_event_effect_ledger_pilot_v1.sql'), 'utf8');
  for (const fragment of [
    'browser_fabric_effect_event_v1',
    'browser_fabric_effect_outbox_v1',
    'browser_fabric_one_attempt_v1',
    'browser_fabric_effect_event_no_update_delete_v1',
    'authority_effect boolean not null default false',
    'revoke all on table destruktion_meta.browser_fabric_effect_event_v1 from public, anon, authenticated',
  ]) assert.ok(sql.toLowerCase().includes(fragment.toLowerCase()), `${fragment} missing`);
  assert.doesNotMatch(sql, /grant\s+(insert|update|delete|all)[^;]*\s+to\s+(public|anon|authenticated)/i);
});
