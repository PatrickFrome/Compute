import assert from 'node:assert/strict';
import test from 'node:test';

import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-devos-routes.mjs';

const WORKSPACE = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';

async function bodyOf(response) {
  return JSON.parse(await response.text());
}

function environment({ open = false, floor = 28 } = {}) {
  return {
    schema: 'metaengine.devos.environment-state.v1',
    workspace_id: WORKSPACE,
    generation_floor: floor,
    refill_enabled: open,
    supervisor_admission_enabled: open,
    reset_at: open ? null : '2026-10-03T12:00:00.000Z',
    reset_reason: open ? null : 'CONTROLLED_RESET',
    authority_effect: false,
  };
}

test('resume-admission requires device auth and explicit confirmation before any RPC', async () => {
  let calls = 0;
  const route = createDevosSupervisorRoutes({
    workspaceId: WORKSPACE,
    rpc: async () => { calls += 1; return {}; },
  });

  const unauthenticated = await route({
    req: { method: 'POST' },
    path: '/v1/devos/resume-admission',
    body: { confirm: true, expected_generation_floor: 28 },
    clientId: null,
  });
  assert.equal(unauthenticated.status, 401);

  const unconfirmed = await route({
    req: { method: 'POST' },
    path: '/v1/devos/resume-admission',
    body: { confirm: false, expected_generation_floor: 28 },
    clientId: 'device-test',
  });
  assert.equal(unconfirmed.status, 400);
  assert.equal((await bodyOf(unconfirmed)).error, 'devos_resume_confirmation_required');
  assert.equal(calls, 0);
});

test('resume-admission uses exact generation CAS and proves OPEN with an independent state readback', async () => {
  const calls = [];
  let stateReads = 0;
  const route = createDevosSupervisorRoutes({
    workspaceId: WORKSPACE,
    rpc: async (name, args) => {
      calls.push([name, structuredClone(args)]);
      if (name === 'devos_environment_state_v1') {
        stateReads += 1;
        return environment({ open: stateReads > 1, floor: 28 });
      }
      if (name === 'devos_environment_resume_v1') {
        assert.deepEqual(args, { p_workspace: WORKSPACE, p_expected_generation_floor: 28 });
        return {
          schema: 'metaengine.devos.environment-resume.v1',
          ok: true,
          workspace_id: WORKSPACE,
          generation_floor: 28,
          refill_enabled: true,
          supervisor_admission_enabled: true,
          authority_effect: false,
        };
      }
      throw new Error(`unexpected_rpc:${name}`);
    },
  });

  const response = await route({
    req: { method: 'POST' },
    path: '/v1/devos/resume-admission',
    body: { confirm: true, expected_generation_floor: 28 },
    clientId: 'device-test',
  });
  assert.equal(response.status, 200);
  const body = await bodyOf(response);
  assert.equal(body.schema, 'metaengine.devos.environment-resume.v1');
  assert.equal(body.resumed, true);
  assert.equal(body.requested_floor, 28);
  assert.equal(body.before.state, 'CLOSED');
  assert.equal(body.after.state, 'OPEN');
  assert.equal(body.after.continuous_service_allowed, true);
  assert.equal(body.operator_initiated, true);
  assert.equal(body.automatic_retry_allowed, false);
  assert.equal(body.authority_effect, false);
  assert.deepEqual(calls.map(([name]) => name), [
    'devos_environment_state_v1',
    'devos_environment_resume_v1',
    'devos_environment_state_v1',
  ]);
});

test('stale generation resume fails closed with 409 and no automatic retry authority', async () => {
  let resumeCalls = 0;
  const route = createDevosSupervisorRoutes({
    workspaceId: WORKSPACE,
    rpc: async (name) => {
      if (name === 'devos_environment_state_v1') return environment({ open: false, floor: 28 });
      if (name === 'devos_environment_resume_v1') {
        resumeCalls += 1;
        throw new Error('devos_environment_resume_generation_mismatch');
      }
      throw new Error(`unexpected_rpc:${name}`);
    },
  });

  const response = await route({
    req: { method: 'POST' },
    path: '/v1/devos/resume-admission',
    body: { confirm: true, expected_generation_floor: 27 },
    clientId: 'device-test',
  });
  assert.equal(response.status, 409);
  const body = await bodyOf(response);
  assert.equal(body.error, 'devos_resume_generation_mismatch');
  assert.equal(body.requested_floor, 27);
  assert.equal(body.automatic_retry_allowed, false);
  assert.equal(body.authority_effect, false);
  assert.equal(resumeCalls, 1);
});
