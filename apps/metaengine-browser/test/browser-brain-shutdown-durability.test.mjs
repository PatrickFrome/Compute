import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import { BrowserBrainCollaborationRuntimeV2 } from '../src/browser-brain-collaboration-runtime-v2.mjs';
import { BrowserRealtimeProcessPlane } from '../src/browser-realtime-process-plane.mjs';

const DIGEST = `sha256:${'b'.repeat(64)}`;
const SHA = '8'.repeat(40);

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('mutation during an in-flight collaboration save coalesces to one latest follow-up checkpoint', async () => {
  const firstSaveStarted = deferred();
  const releaseFirstSave = deferred();
  const saves = [];
  let saveCalls = 0;
  const runtime = new BrowserBrainCollaborationRuntimeV2({
    clock: () => 25_000,
    saveState: async (checkpoint) => {
      saveCalls += 1;
      saves.push(structuredClone(checkpoint));
      if (saveCalls === 1) {
        firstSaveStarted.resolve();
        await releaseFirstSave.promise;
      }
    },
  });

  runtime.recordTask({
    context_id: 'ctx.inflight',
    task_id: 'task.inflight',
    objective: 'preserve the newest checkpoint while a prior save is in flight',
    required_capabilities: ['memory'],
  });
  await firstSaveStarted.promise;
  assert.equal(saveCalls, 1);

  runtime.recordArtifact({
    artifact_id: 'artifact.inflight',
    context_id: 'ctx.inflight',
    task_id: 'task.inflight',
    kind: 'proof',
    content_digest: DIGEST,
    base_sha: SHA,
    branch: 'work/inflight',
  });
  runtime.recordHandoff({
    handoff_id: 'handoff.inflight',
    context_id: 'ctx.inflight',
    task_id: 'task.inflight',
    from_agent_id: 'agent_alpha',
    objective: 'resume from the latest durable state',
    verified_facts: ['the first physical save was still in flight'],
    next_actions: ['restore the second checkpoint'],
    base_sha: SHA,
    branch: 'work/inflight',
  });
  runtime.claimWork({
    claim_id: 'claim.inflight',
    context_id: 'ctx.inflight',
    task_id: 'task.inflight',
    agent_id: 'agent_alpha',
    scope: 'shutdown-durability',
    ttl_ms: 60_000,
  });

  const flushing = runtime.flush();
  await Promise.resolve();
  assert.equal(saveCalls, 1);
  releaseFirstSave.resolve();
  const flushed = await flushing;

  assert.equal(flushed.ok, true);
  assert.equal(saveCalls, 2);
  const restored = new BrowserBrainCollaborationRuntimeV2({ clock: () => 26_000 });
  restored.restore(saves.at(-1));
  assert.equal(restored.taskLedger('ctx.inflight').tasks.length, 1);
  assert.deepEqual(restored.taskLedger('ctx.inflight').artifact_refs, ['artifact.inflight']);
  const kinds = restored.checkpoint().entries.map((row) => row.kind);
  assert.ok(kinds.includes('HANDOFF_RECORDED'));
  assert.ok(kinds.includes('CLAIM_RECORDED'));
});

test('process-plane stopAndWait fences event sources before awaiting one Brain durability flush', async () => {
  const flushGate = deferred();
  let flushCalls = 0;
  const brain = {
    observeEdge: () => Object.freeze({ authority_effect: false }),
    snapshot: () => Object.freeze({ schema: 'test.brain.v1', authority_effect: false }),
    pressureBudget: () => null,
    flushCollaborationPersistence: () => {
      flushCalls += 1;
      return flushGate.promise;
    },
  };
  const app = new EventEmitter();
  app.getAppMetrics = () => [];
  const plane = new BrowserRealtimeProcessPlane({
    app,
    getWebContents: () => [],
    brainCoordinator: brain,
    sampleMs: 5_000,
  });

  plane.start();
  const sequenceBeforeStop = plane.snapshot().sequence;
  const first = plane.stopAndWait();
  const second = plane.stopAndWait();
  assert.equal(plane.snapshot().running, false);
  assert.equal(plane.brainSnapshot().shutdown_persistence_flush_in_flight, true);
  assert.equal(flushCalls, 1);

  app.emit('browser-window-created');
  assert.equal(plane.snapshot().sequence, sequenceBeforeStop);
  let settled = false;
  void first.then(() => { settled = true; });
  await Promise.resolve();
  assert.equal(settled, false);

  flushGate.resolve();
  assert.equal(await first, true);
  assert.equal(await second, true);
  assert.equal(flushCalls, 1);
  assert.equal(plane.brainSnapshot().shutdown_persistence_flush_in_flight, false);
  assert.equal(plane.stop(), false);
});

test('native supervisor normal quit awaits Brain durability while self-update preflush preserves quitAndInstall semantics', () => {
  const source = readFileSync(new URL('../src/native-supervisor-client.mjs', import.meta.url), 'utf8');
  const planeSource = readFileSync(new URL('../src/browser-realtime-process-plane.mjs', import.meta.url), 'utf8');

  assert.match(source, /#installQuitDurabilityBarrier\(app\)/);
  assert.match(source, /app\.on\('before-quit', this\.#quitBarrierHandler\)/);
  assert.match(source, /event\?\.preventDefault\?\.\(\)/);
  assert.match(source, /this\.#quitDurabilityPromise = this\.stopAndWait\(\)/);
  assert.match(source, /this\.#quitDurabilityApproved \|\| this\.#selfUpdateDurabilityReadyRef\?\.\(\) === true/);
  assert.match(source, /await realtimeProcessPlane\.stopAndWait\(\)/);
  assert.match(source, /selfUpdateDurabilityReady = true/);
  assert.match(source, /automatic_retry_allowed: false/);
  assert.match(planeSource, /async stopAndWait\(\)/);
  assert.match(planeSource, /browser_realtime_process_plane_stop_in_flight/);
  assert.doesNotMatch(source, /quitAndInstall\s*=|\.quitAndInstall\s*\(/);
});
