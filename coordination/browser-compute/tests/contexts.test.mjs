import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ComputeBrowserRuntime } from '../src/runtime.mjs';
import { startRpcServer } from '../src/rpc-server.mjs';
import { atomicJsonWrite, readJson } from '../src/security.mjs';

const INCARNATION = '44444444-4444-4444-8444-444444444444';

async function fixture(name, cdpCall) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `a2-cb-${name}-`));
  const runtime = new ComputeBrowserRuntime({ stateRoot: root });
  const profileId = `${name}-profile`;
  await runtime.init();
  await fs.mkdir(runtime.profileDir(profileId), { recursive: true });
  const processRef = {
    processIncarnationId: INCARNATION,
    isRunning: () => true,
    stop: async () => {},
    cdp: { call: cdpCall }
  };
  runtime.running.set(profileId, {
    processRef,
    bindings: new Map(),
    contextBindings: new Map([
      ['default', { browser_context_id: null, process_incarnation_id: INCARNATION }]
    ]),
    meta: {},
    lockFile: null,
    semanticFrames: new Map()
  });
  return {
    root,
    runtime,
    profileId,
    processRef,
    async close() {
      await runtime.shutdown();
      await fs.rm(root, { recursive: true, force: true });
    }
  };
}

test('context create persists intent before exact restricted CDP effect', async () => {
  let fx;
  try {
    fx = await fixture('context-intent', async (method, params) => {
      assert.equal(method, 'Target.createBrowserContext');
      assert.deepEqual(params, { disposeOnDetach: true });
      assert.equal('proxyServer' in params, false);
      assert.equal('proxyBypassList' in params, false);
      assert.equal('originsWithUniversalNetworkAccess' in params, false);
      const registry = await readJson(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), null);
      const prepared = registry.contexts.find((row) => row.context_id === 'research_ctx');
      assert.equal(prepared.status, 'PREPARING');
      assert.equal(prepared.pending_operation, 'CONTEXT_CREATE');
      assert.equal(prepared.pending_process_incarnation_id, INCARNATION);
      return { browserContextId: 'engine-context-secret' };
    });
    const created = await fx.runtime.createContext({ profileId: fx.profileId, contextId: 'research_ctx' });
    assert.equal(created.status, 'ACTIVE');
    assert.equal(created.context_epoch, 1);
    assert.equal(created.bound, true);
    assert.doesNotMatch(JSON.stringify(created), /engine-context-secret|browserContextId|browser_context_id/);
    const contexts = await fx.runtime.listContexts(fx.profileId);
    assert.deepEqual(contexts.map((row) => row.context_id), ['default', 'research_ctx']);
    assert.equal(contexts[0].persistence, 'PROFILE_DEFAULT');
    assert.equal(contexts[1].persistence, 'EPHEMERAL');
  } finally {
    await fx?.close();
  }
});

test('ambiguous context create remains fenced from blind retry', async () => {
  let calls = 0;
  let fx;
  try {
    fx = await fixture('context-create-ambiguous', async () => {
      calls += 1;
      throw new Error('cdp_call_timeout:Target.createBrowserContext');
    });
    await assert.rejects(
      fx.runtime.createContext({ profileId: fx.profileId, contextId: 'ambiguous_ctx' }),
      /cdp_call_timeout/
    );
    await assert.rejects(
      fx.runtime.createContext({ profileId: fx.profileId, contextId: 'ambiguous_ctx' }),
      /context_id_exists/
    );
    assert.equal(calls, 1);
    const registry = await readJson(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), null);
    assert.equal(registry.contexts[0].status, 'PREPARING');
    assert.equal(registry.contexts[0].pending_operation, 'CONTEXT_CREATE');
  } finally {
    await fx?.close();
  }
});

test('default context is non-disposable and live targets block context close before CDP', async () => {
  let calls = 0;
  let fx;
  try {
    fx = await fixture('context-close-guard', async () => { calls += 1; return {}; });
    await assert.rejects(
      fx.runtime.closeContext({ profileId: fx.profileId, contextId: 'default' }),
      /default_context_not_disposable/
    );
    await atomicJsonWrite(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), {
      schema: 'metaengine.a2-compute-browser.contexts.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      contexts: [{ context_id: 'busy_ctx', context_epoch: 1, status: 'ACTIVE', last_process_incarnation_id: INCARNATION }]
    });
    await atomicJsonWrite(path.join(fx.runtime.profileDir(fx.profileId), 'targets.json'), {
      schema: 'metaengine.a2-compute-browser.targets.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      targets: [{ target_id: 'busy_target', context_id: 'busy_ctx', status: 'ACTIVE' }]
    });
    fx.runtime.running.get(fx.profileId).contextBindings.set('busy_ctx', {
      browser_context_id: 'engine-busy',
      process_incarnation_id: INCARNATION
    });
    await assert.rejects(
      fx.runtime.closeContext({ profileId: fx.profileId, contextId: 'busy_ctx' }),
      /context_has_live_targets/
    );
    assert.equal(calls, 0);
  } finally {
    await fx?.close();
  }
});

test('context close persists intent and ambiguous completion cannot blind retry', async () => {
  let calls = 0;
  let fx;
  try {
    fx = await fixture('context-close-ambiguous', async (method, params) => {
      calls += 1;
      assert.equal(method, 'Target.disposeBrowserContext');
      assert.deepEqual(params, { browserContextId: 'engine-close' });
      const registry = await readJson(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), null);
      assert.equal(registry.contexts[0].status, 'CLOSING');
      assert.equal(registry.contexts[0].pending_operation, 'CONTEXT_CLOSE');
      throw new Error('cdp_call_timeout:Target.disposeBrowserContext');
    });
    await atomicJsonWrite(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), {
      schema: 'metaengine.a2-compute-browser.contexts.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      contexts: [{ context_id: 'close_ctx', context_epoch: 1, status: 'ACTIVE', last_process_incarnation_id: INCARNATION }]
    });
    fx.runtime.running.get(fx.profileId).contextBindings.set('close_ctx', {
      browser_context_id: 'engine-close',
      process_incarnation_id: INCARNATION
    });
    await assert.rejects(
      fx.runtime.closeContext({ profileId: fx.profileId, contextId: 'close_ctx' }),
      /cdp_call_timeout/
    );
    await assert.rejects(
      fx.runtime.closeContext({ profileId: fx.profileId, contextId: 'close_ctx' }),
      /context_recovery_required/
    );
    assert.equal(calls, 1);
  } finally {
    await fx?.close();
  }
});

test('target create binds to the selected logical context without exposing engine identity', async () => {
  let fx;
  try {
    fx = await fixture('context-target', async (method, params) => {
      assert.equal(method, 'Target.createTarget');
      assert.deepEqual(params, { url: 'about:blank', browserContextId: 'engine-research' });
      return { targetId: 'engine-target-secret' };
    });
    await atomicJsonWrite(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), {
      schema: 'metaengine.a2-compute-browser.contexts.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      contexts: [{ context_id: 'research_ctx', context_epoch: 1, status: 'ACTIVE', last_process_incarnation_id: INCARNATION }]
    });
    fx.runtime.running.get(fx.profileId).contextBindings.set('research_ctx', {
      browser_context_id: 'engine-research',
      process_incarnation_id: INCARNATION
    });
    const created = await fx.runtime.createTarget({
      profileId: fx.profileId,
      contextId: 'research_ctx',
      targetId: 'research_target'
    });
    assert.equal(created.context_id, 'research_ctx');
    assert.doesNotMatch(JSON.stringify(created), /engine-research|engine-target-secret/);
    const registry = await readJson(path.join(fx.runtime.profileDir(fx.profileId), 'targets.json'), null);
    assert.equal(registry.targets[0].context_id, 'research_ctx');
  } finally {
    await fx?.close();
  }
});

test('old-incarnation context becomes LOST and explicit recreation rotates its epoch', async () => {
  let fx;
  try {
    fx = await fixture('context-recovery', async (method, params) => {
      assert.equal(method, 'Target.createBrowserContext');
      assert.deepEqual(params, { disposeOnDetach: true });
      return { browserContextId: 'engine-context-new' };
    });
    await atomicJsonWrite(path.join(fx.runtime.profileDir(fx.profileId), 'contexts.json'), {
      schema: 'metaengine.a2-compute-browser.contexts.v1',
      revision: 1,
      updated_at: new Date().toISOString(),
      contexts: [{
        context_id: 'recover_ctx',
        context_epoch: 1,
        status: 'ACTIVE',
        last_process_incarnation_id: '55555555-5555-4555-8555-555555555555'
      }]
    });
    const observed = await fx.runtime.listContexts(fx.profileId);
    const lost = observed.find((row) => row.context_id === 'recover_ctx');
    assert.equal(lost.status, 'LOST');
    assert.equal(lost.bound, false);
    assert.equal(lost.lost_process_incarnation_id, '55555555-5555-4555-8555-555555555555');
    const recreated = await fx.runtime.createContext({ profileId: fx.profileId, contextId: 'recover_ctx' });
    assert.equal(recreated.context_epoch, 2);
    assert.equal(recreated.status, 'ACTIVE');
    assert.equal(recreated.process_incarnation_id, INCARNATION);
  } finally {
    await fx?.close();
  }
});

test('RPC lifecycle operations are serialized across separate client connections', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'a2-cb-rpc-global-'));
  let rpc;
  let concurrent = 0;
  let maximum = 0;
  const runtime = {
    stateRoot: root,
    async createContext({ contextId }) {
      concurrent += 1;
      maximum = Math.max(maximum, concurrent);
      await new Promise((resolve) => setTimeout(resolve, 25));
      concurrent -= 1;
      return { context_id: contextId };
    }
  };
  function request(endpoint, token, id) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(endpoint);
      let buffer = '';
      socket.once('error', reject);
      socket.on('data', (chunk) => {
        buffer += chunk.toString('utf8');
        const newline = buffer.indexOf('\n');
        if (newline < 0) return;
        const response = JSON.parse(buffer.slice(0, newline));
        socket.end();
        resolve(response);
      });
      socket.once('connect', () => socket.write(`${JSON.stringify({
        id,
        token,
        method: 'context.create',
        params: { profileId: 'rpc-profile', contextId: `rpc_context_${id}` }
      })}\n`));
    });
  }
  try {
    try {
      rpc = await startRpcServer(runtime);
    } catch (error) {
      if (error?.code === 'EPERM') {
        t.skip('local sandbox forbids Unix-domain socket listen');
        return;
      }
      throw error;
    }
    const token = (await fs.readFile(rpc.tokenFile, 'utf8')).trim();
    const [first, second] = await Promise.all([
      request(rpc.endpoint, token, 1),
      request(rpc.endpoint, token, 2)
    ]);
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(maximum, 1);
  } finally {
    await rpc?.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});


