import test from 'node:test';
import assert from 'node:assert/strict';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const taskId = '09f2e414-5c31-4fc7-87a3-f5de1315cb81';
const agentId = 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510';

function followerLease() {
  return {
    schema: 'metaengine.meta-orchestrator.controller-lease.v1',
    workspace_id: workspaceId,
    roadmap_id: 'metaengine-development-os-v1',
    leased: false,
    leader_epoch: 1,
    holder_verified: false,
    not_expired: true,
    authority_effect: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
  };
}

test('lease backpressure preserves DB READY as deferred demand but exposes zero schedulable READY capacity', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push([name, structuredClone(args)]);
    if (name === 'meta_orchestrator_controller_lease_v1') return followerLease();
    if (name === 'devos_fleet_reconcile_v1') return { ok: true, authority_effect: false };
    if (name === 'devos_fleet_snapshot_v1') {
      return {
        active_tasks: [{
          task_id: taskId,
          role: 'IMPLEMENTER',
          state: 'READY',
          priority: 90,
          created_at: '2026-09-02T18:00:00.000Z',
          authority_effect: false,
        }],
        active_claims: [],
        recent_events: [],
        authority_effect: false,
      };
    }
    if (name === 'devos_fleet_lease_v1') {
      return {
        leased: false,
        backpressure: true,
        reason: 'CHATGPT_RATE_LIMIT_BACKPRESSURE',
        retry_after_ms: 60000,
        page_signal_authority: false,
        automatic_retry_allowed: false,
        authority_effect: false,
      };
    }
    throw new Error(`unexpected_rpc:${name}`);
  };

  const handle = createDevosSupervisorRoutes({ rpc, workspaceId });
  const response = await handle({
    req: { method: 'POST' },
    path: '/v1/devos/cycle',
    clientId: 'browser-control-client',
    body: {
      fleet: {
        agents: [{
          agent_id: agentId,
          role: 'IMPLEMENTER',
          lifecycle_state: 'ACTIVE',
          tab_id: 'tab_worker',
          target_id: 'webcontents:10',
          generation_epoch: 7,
        }],
      },
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.lease, null);
  assert.equal(body.lease_attempts, 1);
  assert.equal(body.scheduler_backpressure.active, true);
  assert.equal(body.scheduler_backpressure.reason, 'CHATGPT_RATE_LIMIT_BACKPRESSURE');
  assert.equal(body.scheduler_backpressure.page_signal_authority, false);
  assert.equal(body.scheduler_backpressure.automatic_retry_allowed, false);
  assert.equal(body.backlog.ready, 0);
  assert.equal(body.backlog.deferred_ready, 1);
  assert.deepEqual(body.backlog.by_role, {});
  assert.deepEqual(body.backlog.deferred_by_role, { IMPLEMENTER: 1 });
  assert.equal(body.backlog.scheduler_backpressure, true);
  assert.equal(calls.filter(([name]) => name === 'devos_fleet_lease_v1').length, 1);
});
