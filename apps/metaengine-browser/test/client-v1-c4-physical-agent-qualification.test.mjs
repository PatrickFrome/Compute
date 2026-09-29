import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  createDevosSupervisorRoutes,
} from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const workspaceId = '2de9f84b-7c0a-4091-911c-894ff1d6eaf4';
const script = await readFile(new URL('./client-v1-signed-canary-goal.mjs', import.meta.url), 'utf8');

const request = (method = 'POST') => ({ method });

test('read-only DevOS environment route exposes exact continuous-service fence', async () => {
  const calls = [];
  const routes = createDevosSupervisorRoutes({
    workspaceId,
    rpc: async (name, args) => {
      calls.push({ name, args });
      if (name === 'devos_environment_state_v1') {
        return {
          schema: 'metaengine.devos.environment-state.v1',
          workspace_id: workspaceId,
          generation_floor: 9,
          refill_enabled: false,
          supervisor_admission_enabled: false,
          reset_at: null,
          reset_reason: 'operator_fence',
          authority_effect: false,
        };
      }
      throw new Error('unexpected_rpc');
    },
  });

  const response = await routes({
    req: request(),
    path: '/v1/devos/environment-state',
    body: {},
    clientId: 'device',
  });
  assert.equal(response.status, 200);
  const body = JSON.parse(await response.text());
  assert.equal(body.state, 'CLOSED');
  assert.equal(body.continuous_service_allowed, false);
  assert.equal(body.authoritative, true);
  assert.equal(body.automatic_retry_allowed, false);
  assert.equal(body.authority_effect, false);
  assert.deepEqual(calls, [{
    name: 'devos_environment_state_v1',
    args: { p_workspace: workspaceId },
  }]);
});

test('environment read rejects caller fields and owns no resume mutation', async () => {
  let calls = 0;
  const routes = createDevosSupervisorRoutes({
    workspaceId,
    rpc: async () => {
      calls += 1;
      throw new Error('must_not_call');
    },
  });
  const response = await routes({
    req: request(),
    path: '/v1/devos/environment-state',
    body: { confirm: true },
    clientId: 'device',
  });
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
  assert.equal((await response.json()).error, 'devos_environment_state_fields_forbidden');
});

test('physical qualification preflights admission and real capacity before creating a goal', () => {
  const preflight = script.indexOf("devicePost('/v1/devos/environment-state'");
  const capacity = script.indexOf("devicePost('/v1/meta/authoritative-inputs'");
  const submit = script.indexOf("devicePost('/v1/meta/client-goal-submit'");
  assert.ok(preflight >= 0 && capacity > preflight && submit > capacity);
  assert.match(script, /continuous_service_allowed !== true/);
  assert.match(script, /capacity\.available_slots\) < 1/);
  assert.match(script, /goal_submitted: false/);
});

test('physical qualification polls only readback after one goal submission', () => {
  const submitCalls = [...script.matchAll(/devicePost\('\/v1\/meta\/client-goal-submit'/g)];
  assert.equal(submitCalls.length, 1);
  assert.match(script, /while \(executionProof\.user_goal_to_agent_readback !== true/);
  assert.match(script, /devicePost\('\/v1\/meta\/client-goal-progress'/);
  assert.match(script, /devicePost\('\/v1\/meta\/client-goal-execution-proof'/);
  assert.match(script, /physical_effect_replayed: false/);
  assert.doesNotMatch(script, /while[\s\S]{0,3000}client-goal-submit/);
});

test('physical C4 exit requires Agent-origin proof, not synthetic or accepted-result completion', () => {
  assert.match(script, /if \(executionProof\.user_goal_to_agent_readback !== true\)/);
  assert.match(script, /TERMINAL_WITHOUT_AGENT_PROOF/);
  assert.match(script, /AGENT_PROOF_TIMEOUT/);
  // Result proof is recorded when present but is intentionally not the C4 exit:
  // C5 owns useful verified work + restart.
  assert.doesNotMatch(script, /if \(executionProof\.user_goal_to_result_readback !== true\)/);
});
