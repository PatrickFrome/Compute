import test from 'node:test';
import assert from 'node:assert/strict';

import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const WORKSPACE = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const CLIENT = 'native-client-regression';

function availableWorkspaceSnapshot() {
  return {
    schema: 'metaengine.devos.workspace-binding-snapshot.v1',
    state: 'AVAILABLE',
    coordination_workspace_id: WORKSPACE,
    observed_at: new Date().toISOString(),
    bindings: [],
    filesystem_paths_exposed: false,
    scheduler_authority: false,
    browser_actuation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

test('authenticated DevOS route exposes the canonical workspace readback projection', async () => {
  const calls = [];
  const rpc = async (name, args) => {
    calls.push({ name, args });
    if (name === 'h205f22_a2_workspace_binding_snapshot_v1') return availableWorkspaceSnapshot();
    throw new Error(`unexpected_rpc:${name}`);
  };
  const route = createDevosSupervisorRoutes({ rpc, workspaceId: WORKSPACE });
  const response = await route({ req: { method: 'GET' }, path: '/v1/devos/workspace-snapshot', body: {}, clientId: CLIENT });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.state, 'AVAILABLE');
  assert.deepEqual(body.bindings, []);
  assert.equal(body.filesystem_paths_exposed, false);
  assert.equal(body.scheduler_authority, false);
  assert.equal(body.browser_actuation_authority, false);
  assert.equal(body.automatic_retry_allowed, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'h205f22_a2_workspace_binding_snapshot_v1');
  assert.equal(calls[0].args.p_coordination_workspace_id, WORKSPACE);
});

test('expected continuity degradation is a typed lease fence, never a generic 502 path', async () => {
  const rpc = async (name) => {
    if (name === 'meta_orchestrator_controller_lease_v1') throw new Error('meta provider unavailable');
    if (name === 'devos_fleet_reconcile_v1') return { reconciled: true, authority_effect: false };
    if (name === 'devos_fleet_snapshot_v1') {
      return {
        active_tasks: [{
          task_id: '938bb776-21b6-49ec-966b-562183f7deca',
          role: 'PLANNER',
          state: 'READY',
          base_sha: '1b83a1680b899be6804ea0eb77d663f629e76fe8',
          created_at: '2026-09-05T06:32:18.827Z',
          priority: 10,
        }],
        active_claims: [],
        recent_events: [],
      };
    }
    if (name === 'devos_fleet_lease_v1') {
      throw new Error('rest_400: devos_dispatch_continuity_degraded:ROLLOVER_REQUIRED');
    }
    throw new Error(`unexpected_rpc:${name}`);
  };
  const route = createDevosSupervisorRoutes({ rpc, workspaceId: WORKSPACE });
  const response = await route({
    req: { method: 'POST' },
    path: '/v1/devos/cycle',
    clientId: CLIENT,
    body: {
      fleet: {
        agents: [{
          agent_id: 'agent_a127f504-0453-470d-9526-3e1762fa97b3',
          role: 'PLANNER',
          lifecycle_state: 'ACTIVE',
          tab_id: 'tab_3148ec2d-ba1a-4251-a7aa-b34dc423c76d',
          target_id: 'webcontents:7',
          generation_epoch: 29,
        }],
      },
    },
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.schema, 'metaengine.devos.browser-cycle.v1');
  assert.equal(body.lease, null);
  assert.equal(body.lease_fenced, true);
  assert.equal(body.lease_fence_reason, 'devos_dispatch_continuity_degraded');
  assert.equal(body.automatic_retry_allowed, false);
  assert.equal(body.second_scheduler_loop, false);
});
