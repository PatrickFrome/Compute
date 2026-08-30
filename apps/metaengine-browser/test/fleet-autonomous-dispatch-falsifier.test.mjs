import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { dispatchFleetTask } from '../src/fleet-task-dispatcher.mjs';
import { FleetProvisioner } from '../src/fleet-provisioner.mjs';
import { NativeSupervisorClient } from '../src/native-supervisor-client.mjs';
import {
  OwnerSafetyGateRegistry,
  bindGlobalOwnerSafetyGateRegistry,
} from '../src/owner-safety-gate-registry.mjs';
import { SupervisorDeviceIdentity } from '../src/supervisor-device-identity.mjs';

const AGENT_ID = 'agent_aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const TAB_ID = 'tab_11111111-2222-3333-4444-555555555555';
const TARGET_ID = 'webcontents:77';
const BASE_SHA = '724612235eb7ceb4534c13d126425b274d876394';
const CONVERSATION_URL = 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function composerFrame(url = 'https://chatgpt.com/') {
  return {
    url,
    semantic_targets: [{ role: 'textbox', name: 'Чат с ChatGPT', backend_node_id: 3 }],
    authority_effect: false,
  };
}

function dispatchPayload(generationEpoch = 4) {
  return {
    task_id: 'task.falsifier.dispatch.0001',
    agent_id: AGENT_ID,
    point_id: 'federated.autonomy.dispatch',
    base_sha: BASE_SHA,
    generation_epoch: generationEpoch,
    prompt: 'Falsifier probe: exact binding only.',
  };
}

function dispatcherHarness({ preUrl = 'https://chatgpt.com/', postUrl = CONVERSATION_URL, generationEpoch = 4 } = {}) {
  const calls = [];
  let marked = null;
  let captureCount = 0;
  const fleet = {
    snapshot: () => ({
      agents: [{
        agent_id: AGENT_ID,
        role: 'FALSIFIER',
        lifecycle_state: 'BOUND_UNVERIFIED',
        generation_epoch: generationEpoch,
        tab_id: TAB_ID,
        target_id: TARGET_ID,
      }],
    }),
    markTransportProven: async (value) => { marked = structuredClone(value); },
  };
  return {
    calls,
    getMarked: () => marked,
    deps: {
      fleet,
      getView: () => ({ webContents: { id: 77, isDestroyed: () => false } }),
      publishSnapshot: async () => {},
      captureSemanticFrame: async () => {
        captureCount += 1;
        return composerFrame(captureCount === 1 ? preUrl : postUrl);
      },
      executeSemanticCommand: async () => {
        calls.push('execute');
        return {
          action: 'SEMANTIC_TYPE',
          submit_after_type: true,
          effect_state: 'AMBIGUOUS_AFTER_ENTER',
          stop_observed: false,
          new_conversation_observed: false,
          automatic_retry_allowed: false,
          authority_effect: true,
        };
      },
    },
  };
}

test('ambiguous Enter in an already-open conversation must not be proven by stale /c/ URL', async () => {
  const h = dispatcherHarness({ preUrl: CONVERSATION_URL, postUrl: CONVERSATION_URL });
  await assert.rejects(
    () => dispatchFleetTask({ payload: dispatchPayload(), ...h.deps }),
    (error) => {
      assert.equal(error.message, 'fleet_task_send_effect_ambiguous');
      assert.equal(error.receipt?.automatic_retry_allowed, false);
      return true;
    },
  );
  assert.equal(h.calls.length, 1, 'the ambiguous Enter must never be replayed');
  assert.equal(h.getMarked(), null, 'ambiguous transport must never become ACTIVE');
});

test('stale agent generation is fenced before semantic capture or actuation', async () => {
  const h = dispatcherHarness({ generationEpoch: 5 });
  await assert.rejects(
    () => dispatchFleetTask({ payload: dispatchPayload(4), ...h.deps }),
    /fleet_task_generation_binding_mismatch/,
  );
  assert.equal(h.calls.length, 0);
  assert.equal(h.getMarked(), null);
});

const secureStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (value) => Buffer.from(`enc:${value}`, 'utf8'),
  decryptString: (value) => Buffer.from(value).toString('utf8').replace(/^enc:/, ''),
};

async function enrolledIdentity(prefix) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const identity = new SupervisorDeviceIdentity({ statePath: path.join(dir, 'device.json'), secureStorage });
  await identity.ensure();
  await identity.bindDevice(crypto.randomUUID());
  return { dir, identity };
}

test('duplicate concurrent supervisor cycles coalesce to one heartbeat and one command poll', async () => {
  const { dir, identity } = await enrolledIdentity('metaengine-falsifier-heartbeat-');
  let statePosts = 0;
  let commandPolls = 0;
  try {
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/v1/state')) {
        statePosts += 1;
        return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } });
      }
      if (pathname.endsWith('/v1/commands/next')) {
        commandPolls += 1;
        return new Response(JSON.stringify({ command: null }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected_fetch:${pathname}`);
    };
    const client = new NativeSupervisorClient({
      identity,
      fetchImpl,
      version: '0.6.1-dev.1',
      intervalMs: 60000,
      getState: async () => ({ tabs: [], active_tab: null, development_plane: null, fleet: null, perception: null }),
      executeCommand: async () => { throw new Error('no command expected'); },
    });
    await Promise.all([client.cycle(), client.cycle(), client.cycle()]);
    assert.equal(statePosts, 1);
    assert.equal(commandPolls, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('mutating command must not replay when effect succeeded but result transport is ambiguous', async () => {
  const { dir, identity } = await enrolledIdentity('metaengine-falsifier-replay-');
  const commandId = crypto.randomUUID();
  let mutatingExecutions = 0;
  try {
    const fetchImpl = async (url) => {
      const pathname = new URL(url).pathname;
      if (pathname.endsWith('/v1/state')) return new Response('{}', { status: 202, headers: { 'content-type': 'application/json' } });
      if (pathname.endsWith('/v1/commands/next')) {
        return new Response(JSON.stringify({
          command: {
            command_id: commandId,
            action: 'NEW_TAB',
            payload: { url: 'https://chatgpt.com/' },
            issued_at: new Date().toISOString(),
            expires_at: new Date(Date.now() + 60000).toISOString(),
          },
        }), { status: 200, headers: { 'content-type': 'application/json' } });
      }
      if (/\/v1\/commands\/[^/]+\/result$/.test(pathname)) {
        return new Response(JSON.stringify({ error: 'synthetic_result_transport_failure' }), { status: 503, headers: { 'content-type': 'application/json' } });
      }
      throw new Error(`unexpected_fetch:${pathname}`);
    };
    const client = new NativeSupervisorClient({
      identity,
      fetchImpl,
      version: '0.6.1-dev.1',
      intervalMs: 60000,
      getState: async () => ({ tabs: [], active_tab: null, development_plane: null, fleet: null, perception: null }),
      executeCommand: async (command) => {
        if (command?.command_id === commandId) mutatingExecutions += 1;
        return { ok: true, authority_effect: true };
      },
    });
    await assert.rejects(() => client.cycle(), /native_supervisor_result_http_503/);
    assert.equal(mutatingExecutions, 1);
    await assert.rejects(() => client.cycle(), /native_supervisor_result_http_503/);
    assert.equal(mutatingExecutions, 1, 'same command_id must be fenced after an ambiguous result transport');
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

async function cleanGateRegistry() {
  let state = null;
  const registry = new OwnerSafetyGateRegistry({
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    clock: () => 1788000000000,
  });
  await registry.init();
  bindGlobalOwnerSafetyGateRegistry(registry);
  return registry;
}

test('disabling owner ambiguous-fanout gate must not turn unknown createTab effect into compensating retries', async () => {
  const registry = await cleanGateRegistry();
  await registry.disable({
    gate_id: 'fleet.ambiguous_compensating_fanout',
    reason: 'FALSIFIER_NEGATIVE_TEST',
    override_id: 'falsifier-override-0001',
  });
  let attempts = 0;
  let state = null;
  const provisioner = new FleetProvisioner({
    policy: { warm_agents: 1, desired_agents: 1, profile: 'BALANCED' },
    clock: (() => { let n = 1788000000000; return () => ++n; })(),
    uuid: (() => { let n = 0; return () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`; })(),
    loadState: async () => state,
    saveState: async (value) => { state = structuredClone(value); },
    tabExists: () => false,
    createTab: async () => {
      attempts += 1;
      throw new Error('synthetic_create_effect_unknown');
    },
    loadTab: async () => {},
  });
  try {
    await provisioner.init();
    await provisioner.reconcile({ active: true });
    assert.equal(attempts, 1, 'ambiguous external create effect must stop fanout even when an owner development gate is disabled');
    assert.equal(provisioner.snapshot().counts.PROVISIONING_AMBIGUOUS, 1);
  } finally {
    await cleanGateRegistry();
  }
});
