import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { atomicJsonWrite, readJson } from '../src/security.mjs';

const LIVE_INCARNATION = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const DEAD_INCARNATION = '11111111-2222-4333-8444-555555555555';

function contextRow(overrides) {
  return {
    schema: 'metaengine.a2-compute-browser.context.v1',
    context_id: 'ctx',
    context_epoch: 1,
    persistence: 'EPHEMERAL',
    status: 'ACTIVE',
    pending_operation_id: null,
    pending_operation: null,
    pending_process_incarnation_id: null,
    last_process_incarnation_id: LIVE_INCARNATION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

function targetRow(overrides) {
  return {
    schema: 'metaengine.a2-browser-operator.target.v1',
    target_id: 'tgt',
    provider: 'BROWSER',
    platform: 'COMPUTE_BROWSER',
    surface: 'WEB',
    context_id: 'default',
    role: 'WORKER',
    conversation_epoch: 1,
    conversation_url: 'about:blank',
    status: 'ACTIVE',
    pending_operation_id: null,
    pending_operation: null,
    pending_process_incarnation_id: null,
    last_process_incarnation_id: LIVE_INCARNATION,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides
  };
}

async function fixture(name, { contexts = [], targets = [] } = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `a2-cb-orphan-${name}-`));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root });
  const profileId = `${name.replace(/[^a-z0-9]+/g, '')}-profile`;
  await runtime.init();
  await fs.mkdir(runtime.profileDir(profileId), { recursive: true });
  if (contexts.length) {
    await atomicJsonWrite(path.join(runtime.profileDir(profileId), 'contexts.json'), {
      schema: 'metaengine.a2-compute-browser.contexts.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      contexts
    });
  }
  if (targets.length) {
    await atomicJsonWrite(path.join(runtime.profileDir(profileId), 'targets.json'), {
      schema: 'metaengine.a2-compute-browser.targets.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      targets
    });
  }
  const processRef = {
    processIncarnationId: LIVE_INCARNATION,
    isRunning: () => true,
    stop: async () => {},
    cdp: { call: async () => { throw new Error('cdp_call_unexpected'); } }
  };
  runtime.running.set(profileId, {
    processRef,
    bindings: new Map(),
    contextBindings: new Map([
      ['default', { browser_context_id: null, process_incarnation_id: LIVE_INCARNATION }]
    ]),
    meta: {},
    lockFile: null
  });
  return {
    root,
    runtime,
    profileId,
    async close() {
      await runtime.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

test('dead-incarnation context intents retire on list: PREPARING becomes LOST and CLOSING becomes RETIRED', async () => {
  let fx;
  try {
    fx = await fixture('ctx-retire', {
      contexts: [
        contextRow({ context_id: 'open_orphan_ctx', status: 'PREPARING', pending_operation: 'CONTEXT_CREATE', pending_process_incarnation_id: DEAD_INCARNATION, last_process_incarnation_id: null }),
        contextRow({ context_id: 'close_orphan_ctx', status: 'CLOSING', pending_operation: 'CONTEXT_CLOSE', pending_process_incarnation_id: DEAD_INCARNATION, last_process_incarnation_id: null }),
        contextRow({ context_id: 'live_ctx', status: 'ACTIVE' })
      ]
    });
    const listed = await fx.runtime.listContexts(fx.profileId);
    const opened = listed.find((row) => row.context_id === 'open_orphan_ctx');
    assert.equal(opened.status, 'LOST');
    assert.equal(opened.bound, false);
    assert.equal(opened.lost_process_incarnation_id, DEAD_INCARNATION);
    assert.equal(opened.pending_operation, null);
    assert.equal(opened.pending_process_incarnation_id, null);
    const closed = (await fx.runtime.listContexts(fx.profileId, { includeRetired: true })).find((row) => row.context_id === 'close_orphan_ctx');
    assert.equal(closed.status, 'RETIRED');
    assert.equal(closed.pending_operation, null);
    const live = listed.find((row) => row.context_id === 'live_ctx');
    assert.equal(live.status, 'ACTIVE');
    const registry = await readJson(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), null);
    assert.equal(registry.contexts.find((row) => row.context_id === 'open_orphan_ctx').status, 'LOST');
    assert.equal(registry.contexts.find((row) => row.context_id === 'close_orphan_ctx').status, 'RETIRED');
  } finally {
    await fx?.close();
  }
});

test('LOST context from a dead PREPARING intent is explicitly reusable and rotates its epoch', async () => {
  let fx;
  try {
    fx = await fixture('ctx-reuse', {
      contexts: [contextRow({ context_id: 'reuse_ctx', context_epoch: 3, status: 'PREPARING', pending_operation: 'CONTEXT_CREATE', pending_process_incarnation_id: DEAD_INCARNATION, last_process_incarnation_id: null })]
    });
    fx.runtime.running.get(fx.profileId).processRef.cdp.call = async (method, params) => {
      assert.equal(method, 'Target.createBrowserContext');
      assert.deepEqual(params, { disposeOnDetach: true });
      return { browserContextId: 'engine-reuse' };
    };
    await fx.runtime.listContexts(fx.profileId);
    const recreated = await fx.runtime.createContext({ profileId: fx.profileId, contextId: 'reuse_ctx' });
    assert.equal(recreated.status, 'ACTIVE');
    assert.equal(recreated.context_epoch, 4);
  } finally {
    await fx?.close();
  }
});

test('mid-flight context intents of the live incarnation stay fenced from blind retry', async () => {
  let fx;
  try {
    fx = await fixture('ctx-fenced', {
      contexts: [
        contextRow({ context_id: 'fenced_open_ctx', status: 'PREPARING', pending_operation: 'CONTEXT_CREATE', pending_process_incarnation_id: LIVE_INCARNATION, last_process_incarnation_id: null }),
        contextRow({ context_id: 'fenced_close_ctx', status: 'CLOSING', pending_operation: 'CONTEXT_CLOSE', pending_process_incarnation_id: LIVE_INCARNATION })
      ]
    });
    const listed = await fx.runtime.listContexts(fx.profileId);
    assert.equal(listed.find((row) => row.context_id === 'fenced_open_ctx').status, 'PREPARING');
    assert.equal(listed.find((row) => row.context_id === 'fenced_close_ctx').status, 'CLOSING');
    await assert.rejects(
      fx.runtime.createContext({ profileId: fx.profileId, contextId: 'fenced_open_ctx' }),
      /context_id_exists/
    );
    await assert.rejects(
      fx.runtime.closeContext({ profileId: fx.profileId, contextId: 'fenced_close_ctx' }),
      /context_recovery_required/
    );
  } finally {
    await fx?.close();
  }
});

test('dead-incarnation target intents retire on list: open intents become LOST, CLOSING becomes RETIRED', async () => {
  let fx;
  try {
    fx = await fixture('tgt-retire', {
      targets: [
        targetRow({ target_id: 'preparing_target', status: 'PREPARING', pending_operation: 'TARGET_CREATE', pending_process_incarnation_id: DEAD_INCARNATION, last_process_incarnation_id: null }),
        targetRow({ target_id: 'activating_target', status: 'ACTIVATING', pending_operation: 'TARGET_ACTIVATE', pending_process_incarnation_id: DEAD_INCARNATION }),
        targetRow({ target_id: 'closing_target', status: 'CLOSING', pending_operation: 'TARGET_CLOSE', pending_process_incarnation_id: DEAD_INCARNATION }),
        targetRow({ target_id: 'active_target', status: 'ACTIVE', last_process_incarnation_id: DEAD_INCARNATION }),
        targetRow({ target_id: 'legacy_target', status: 'ACTIVE', last_process_incarnation_id: null, pending_process_incarnation_id: null }),
        targetRow({ target_id: 'live_target', status: 'ACTIVE' })
      ]
    });
    const listed = await fx.runtime.listTargets(fx.profileId);
    const listedAll = await fx.runtime.listTargets(fx.profileId, { includeRetired: true });
    assert.equal(listedAll.find((row) => row.target_id === 'preparing_target').status, 'LOST');
    assert.equal(listedAll.find((row) => row.target_id === 'activating_target').status, 'LOST');
    assert.equal(listedAll.find((row) => row.target_id === 'closing_target').status, 'RETIRED');
    assert.equal(listedAll.find((row) => row.target_id === 'active_target').status, 'LOST');
    assert.equal(listedAll.find((row) => row.target_id === 'active_target').lost_process_incarnation_id, DEAD_INCARNATION);
    assert.equal(listedAll.find((row) => row.target_id === 'legacy_target').status, 'LOST');
    const live = listed.find((row) => row.target_id === 'live_target');
    assert.equal(live.status, 'ACTIVE');
    assert.equal(live.bound, false);
    assert.equal(listed.find((row) => row.target_id === 'closing_target'), undefined);
    const registry = await readJson(path.join(fx.runtime.profileDir(fx.profileId), 'targets.json'), null);
    for (const id of ['preparing_target', 'activating_target', 'active_target', 'legacy_target']) {
      assert.equal(registry.targets.find((row) => row.target_id === id).status, 'LOST', id);
      assert.equal(registry.targets.find((row) => row.target_id === id).pending_process_incarnation_id, null, id);
    }
    assert.equal(registry.targets.find((row) => row.target_id === 'closing_target').status, 'RETIRED');
  } finally {
    await fx?.close();
  }
});

test('LOST target ids from dead incarnations are explicitly reusable with conversation epoch rotation', async () => {
  let fx;
  try {
    fx = await fixture('tgt-reuse', {
      targets: [targetRow({ target_id: 'reuse_target', conversation_epoch: 5, status: 'PREPARING', pending_operation: 'TARGET_CREATE', pending_process_incarnation_id: DEAD_INCARNATION, last_process_incarnation_id: null })]
    });
    fx.runtime.running.get(fx.profileId).processRef.cdp.call = async (method, params) => {
      assert.equal(method, 'Target.createTarget');
      assert.deepEqual(params, { url: 'about:blank' });
      return { targetId: 'engine-reuse-target' };
    };
    await fx.runtime.listTargets(fx.profileId);
    const recreated = await fx.runtime.createTarget({ profileId: fx.profileId, targetId: 'reuse_target' });
    assert.equal(recreated.status, 'ACTIVE');
    assert.equal(recreated.conversation_epoch, 6);
    assert.equal(recreated.bound, true);
  } finally {
    await fx?.close();
  }
});

test('mid-flight target intents of the live incarnation stay fenced from blind retry', async () => {
  let fx;
  try {
    fx = await fixture('tgt-fenced', {
      targets: [
        targetRow({ target_id: 'fenced_target', status: 'PREPARING', pending_operation: 'TARGET_CREATE', pending_process_incarnation_id: LIVE_INCARNATION, last_process_incarnation_id: null }),
        targetRow({ target_id: 'fenced_close_target', status: 'CLOSING', pending_operation: 'TARGET_CLOSE', pending_process_incarnation_id: LIVE_INCARNATION })
      ]
    });
    const listed = await fx.runtime.listTargets(fx.profileId);
    assert.equal(listed.find((row) => row.target_id === 'fenced_target').status, 'PREPARING');
    assert.equal(listed.find((row) => row.target_id === 'fenced_close_target').status, 'CLOSING');
    await assert.rejects(
      fx.runtime.createTarget({ profileId: fx.profileId, targetId: 'fenced_target' }),
      /target_id_exists/
    );
    await assert.rejects(
      fx.runtime.closeTarget({ profileId: fx.profileId, targetId: 'fenced_close_target' }),
      /target_not_bound/
    );
  } finally {
    await fx?.close();
  }
});

test('adversarial registry rows with unknown incarnations retire fail-closed to LOST, never to a false ACTIVE', async () => {
  let fx;
  try {
    fx = await fixture('adv', {
      contexts: [contextRow({ context_id: 'tampered_ctx', status: 'PREPARING', pending_operation: 'CONTEXT_CREATE', pending_process_incarnation_id: 'not-a-real-incarnation', last_process_incarnation_id: null })],
      targets: [targetRow({ target_id: 'tampered_target', status: 'ACTIVATING', pending_operation: 'TARGET_ACTIVATE', pending_process_incarnation_id: 12345 })]
    });
    const contexts = await fx.runtime.listContexts(fx.profileId);
    assert.equal(contexts.find((row) => row.context_id === 'tampered_ctx').status, 'LOST');
    const targets = await fx.runtime.listTargets(fx.profileId);
    assert.equal(targets.find((row) => row.target_id === 'tampered_target').status, 'LOST');
  } finally {
    await fx?.close();
  }
});

test('list with no running process retires every non-terminal row because the incarnation is over', async () => {
  let fx;
  try {
    fx = await fixture('down', {
      contexts: [contextRow({ context_id: 'down_ctx', status: 'PREPARING', pending_operation: 'CONTEXT_CREATE', pending_process_incarnation_id: LIVE_INCARNATION, last_process_incarnation_id: null })],
      targets: [targetRow({ target_id: 'down_target', status: 'CLOSING', pending_operation: 'TARGET_CLOSE', pending_process_incarnation_id: LIVE_INCARNATION })]
    });
    fx.runtime.running.get(fx.profileId).processRef.isRunning = () => false;
    const contexts = await fx.runtime.listContexts(fx.profileId);
    assert.equal(contexts.find((row) => row.context_id === 'down_ctx').status, 'LOST');
    const targets = await fx.runtime.listTargets(fx.profileId, { includeRetired: true });
    assert.equal(targets.find((row) => row.target_id === 'down_target').status, 'RETIRED');
  } finally {
    await fx?.close();
  }
});
