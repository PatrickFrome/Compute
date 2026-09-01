import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DevOsNativeTaskCycle, renderDevosTaskPrompt } from '../src/devos-native-task-cycle.mjs';
import { DevOsEffectDeliveryJournal } from '../src/devos-effect-delivery-journal.mjs';

const lease = {
  task_id: '09f2e414-5c31-4fc7-87a3-f5de1315cb81',
  agent_id: 'agent_a2bf77e6-66d3-4f10-9c9c-683df36f4510',
  role: 'IMPLEMENTER',
  tab_id: 'tab_ff91dce7-eeb3-425d-9052-94d521c2dfa6',
  target_id: 'webcontents:10',
  agent_generation_epoch: 7,
  lease_generation: 1,
  base_sha: '724612235eb7ceb4534c13d126425b274d876394',
  branch_name: 'work/devos-native-task-dispatch-v1',
  automatic_retry_allowed: false,
  task_spec: { schema: 'metaengine.devos.task.v1', objective: 'Implement the safe slice.', constraints: ['no main merge'], deliverable: 'commit tests' },
};
const conversationUrl = 'https://chatgpt.com/c/12345678-abcd-4abc-8abc-123456789abc';
const conversationHash = crypto.createHash('sha256').update(conversationUrl).digest('hex');
const promptHash = crypto.createHash('sha256').update(renderDevosTaskPrompt(lease)).digest('hex');
const fleet = {
  schema: 'metaengine.browser.fleet-snapshot.v1',
  readiness_contract: 'TRANSPORT_PROOF_REQUIRED',
  policy: { warm_agents: 1, spawn_burst_limit: 2 },
  agents: [{
    agent_id: lease.agent_id,
    role: lease.role,
    lifecycle_state: 'ACTIVE',
    tab_id: lease.tab_id,
    target_id: lease.target_id,
    generation_epoch: lease.agent_generation_epoch,
    transport_proof: {
      schema: 'metaengine.browser.fleet-transport-proof.v1',
      tab_id: lease.tab_id,
      target_id: lease.target_id,
      generation_epoch: lease.agent_generation_epoch,
      conversation_url_sha256: conversationHash,
      proven_at: '2026-09-01T00:00:00.000Z',
      authority_effect: false,
    },
    automatic_retry_allowed: false,
    authority_effect: false,
  }],
};
const composer = { role: 'textbox', name: 'Message ChatGPT' };
const send = { role: 'button', name: 'Send prompt' };
const stop = { role: 'button', name: 'Stop generating' };
const supervisorTab = 'tab_supervisor';

const response = (status, body) => ({ status, ok: status >= 200 && status < 300, async json() { return structuredClone(body); } });
const state = (selected) => ({
  fleet,
  active_tab: { tab_id: selected },
  tabs: [{ tab_id: supervisorTab, selected: selected === supervisorTab }, { tab_id: lease.tab_id, selected: selected === lease.tab_id }],
});
const frame = ({ sent = false } = {}) => ({
  tab_id: lease.tab_id,
  target_id: lease.target_id,
  url: sent ? conversationUrl : 'https://chatgpt.com/',
  viewport: { width: 1200, height: 700 },
  semantic_targets: sent ? [composer, stop] : [composer, send],
  authority_effect: false,
});
const journalBinding = () => ({
  task_id: lease.task_id,
  lease_generation: lease.lease_generation,
  agent_id: lease.agent_id,
  tab_id: lease.tab_id,
  target_id: lease.target_id,
  agent_generation_epoch: lease.agent_generation_epoch,
  prompt_sha256: promptHash,
});

async function journalFixture() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-devos-restart-'));
  return { statePath: path.join(dir, 'journal.json') };
}

function commandHarness(calls, selectedRef, { sentInitially = false } = {}) {
  let captureCount = 0;
  return async (command) => {
    calls.push(command.action);
    if (command.action === 'FLEET_RECONCILE') return fleet;
    if (command.action === 'SELECT_TAB') { selectedRef.value = command.payload.tab_id; return { ok: true }; }
    if (command.action === 'CAPTURE') {
      captureCount += 1;
      const sent = sentInitially || captureCount >= 3;
      return frame({ sent });
    }
    if (command.action === 'SEMANTIC_TYPE' || command.action === 'TYPED_CLICK') return { authority_effect: true };
    throw new Error(`unexpected_action:${command.action}`);
  };
}

test('lost DB receipt survives restart and redelivers receipt without replaying Browser effect', async () => {
  const { statePath } = await journalFixture();
  const firstJournal = new DevOsEffectDeliveryJournal({ statePath });
  const firstCalls = [];
  const firstSelected = { value: supervisorTab };
  let firstMarkRunning = 0;
  const firstCycle = new DevOsNativeTaskCycle({
    effectJournal: firstJournal,
    getState: async () => state(firstSelected.value),
    executeCommand: commandHarness(firstCalls, firstSelected),
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
      if (requestPath === '/v1/devos/mark-running') { firstMarkRunning += 1; throw new Error('connection_reset_after_write'); }
      if (requestPath.includes('/status')) return response(200, { task_id: lease.task_id, state: 'LEASED', lease_generation: 1 });
      throw new Error(`unexpected:${requestPath}`);
    },
  });

  const first = await firstCycle.cycle();
  assert.equal(first.dispatch.state, 'DELIVERY_PENDING');
  assert.equal(firstMarkRunning, 1);
  assert.equal(firstCalls.filter((x) => x === 'SEMANTIC_TYPE').length, 1);
  assert.equal(firstCalls.filter((x) => x === 'TYPED_CLICK').length, 1);

  const persistedAfterLoss = new DevOsEffectDeliveryJournal({ statePath });
  await persistedAfterLoss.init();
  assert.equal(persistedAfterLoss.find(journalBinding()).state, 'DELIVERY_PENDING');

  const secondJournal = new DevOsEffectDeliveryJournal({ statePath });
  const secondCalls = [];
  const secondSelected = { value: supervisorTab };
  let redelivery = 0;
  const secondCycle = new DevOsNativeTaskCycle({
    effectJournal: secondJournal,
    getState: async () => state(secondSelected.value),
    executeCommand: commandHarness(secondCalls, secondSelected, { sentInitially: true }),
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
      if (requestPath.includes('/status')) return response(200, { task_id: lease.task_id, state: 'LEASED', lease_generation: 1 });
      if (requestPath === '/v1/devos/mark-running') { redelivery += 1; return response(200, { state: 'RUNNING' }); }
      throw new Error(`unexpected:${requestPath}`);
    },
  });

  const second = await secondCycle.cycle();
  assert.equal(second.dispatch.state, 'RUNNING_RECEIPT_REDELIVERED');
  assert.equal(second.dispatch.physical_effect_replayed, false);
  assert.equal(redelivery, 1);
  assert.equal(secondCalls.filter((x) => x === 'SEMANTIC_TYPE').length, 0);
  assert.equal(secondCalls.filter((x) => x === 'TYPED_CLICK').length, 0);
  assert.equal(secondCalls.includes('CAPTURE'), true);

  const confirmed = new DevOsEffectDeliveryJournal({ statePath });
  await confirmed.init();
  assert.equal(confirmed.find(journalBinding()).state, 'CONFIRMED');
});

test('restart from EXECUTION_STARTED becomes AMBIGUOUS and never types or clicks again', async () => {
  const { statePath } = await journalFixture();
  const seed = new DevOsEffectDeliveryJournal({ statePath });
  await seed.init();
  await seed.beginExecution(journalBinding(), { phase: 'BEFORE_SEMANTIC_TYPE' });

  const restarted = new DevOsEffectDeliveryJournal({ statePath });
  const calls = [];
  const selected = { value: supervisorTab };
  const cycle = new DevOsNativeTaskCycle({
    effectJournal: restarted,
    getState: async () => state(selected.value),
    executeCommand: commandHarness(calls, selected, { sentInitially: true }),
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
      if (requestPath.includes('/status')) return response(200, { task_id: lease.task_id, state: 'LEASED', lease_generation: 1 });
      throw new Error(`unexpected:${requestPath}`);
    },
  });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'NO_REDISPATCH_AMBIGUOUS');
  assert.equal(calls.filter((x) => x === 'SEMANTIC_TYPE').length, 0);
  assert.equal(calls.filter((x) => x === 'TYPED_CLICK').length, 0);

  const readback = new DevOsEffectDeliveryJournal({ statePath });
  await readback.init();
  assert.equal(readback.find(journalBinding()).state, 'AMBIGUOUS');
});

test('stale lease-generation status cannot confirm a prior physical effect', async () => {
  const { statePath } = await journalFixture();
  const seed = new DevOsEffectDeliveryJournal({ statePath });
  await seed.init();
  await seed.beginExecution(journalBinding());
  await seed.markDeliveryPending(journalBinding(), { conversation_url_sha256: conversationHash, effect_state: 'PROVEN_GENERATING' });

  const calls = [];
  const selected = { value: supervisorTab };
  const cycle = new DevOsNativeTaskCycle({
    effectJournal: new DevOsEffectDeliveryJournal({ statePath }),
    getState: async () => state(selected.value),
    executeCommand: commandHarness(calls, selected, { sentInitially: true }),
    signedRequest: async (requestPath) => {
      if (requestPath === '/v1/devos/cycle') return response(200, { schema: 'metaengine.devos.browser-cycle.v1', backlog: { ready: 1, running: 0 }, lease, running: [] });
      if (requestPath.includes('/status')) return response(200, { task_id: lease.task_id, state: 'RUNNING', lease_generation: 2 });
      throw new Error(`unexpected:${requestPath}`);
    },
  });
  const out = await cycle.cycle();
  assert.equal(out.dispatch.state, 'NO_REDISPATCH_AMBIGUOUS');
  assert.equal(calls.includes('SEMANTIC_TYPE'), false);
  assert.equal(calls.includes('TYPED_CLICK'), false);
});

test('corrupt journal fails before scheduler request or Browser effect', async () => {
  const { statePath } = await journalFixture();
  await fs.writeFile(statePath, '{broken', 'utf8');
  let requests = 0;
  let commands = 0;
  const cycle = new DevOsNativeTaskCycle({
    effectJournal: new DevOsEffectDeliveryJournal({ statePath }),
    getState: async () => state(supervisorTab),
    executeCommand: async () => { commands += 1; return fleet; },
    signedRequest: async () => { requests += 1; return response(500, {}); },
  });
  await assert.rejects(() => cycle.cycle(), /devos_effect_journal_json_invalid/);
  assert.equal(requests, 0);
  assert.equal(commands, 0);
});
