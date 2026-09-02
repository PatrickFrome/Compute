import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BrowserSentinelHost } from '../src/browser-sentinel.mjs';
import { SupervisorLifecycleRuntime } from '../src/supervisor-lifecycle-runtime.mjs';

const CLAIM = Object.freeze({
  task_id: '9e000239-dcdd-4cd9-b236-84f4a76f66bd',
  claim_id: 101,
  point_id: 'devos.maintenance.bug-hunter.g4',
  lease_generation: 1,
  base_sha: 'c77e991c76df372861b4ab68fc1d2086e31a80b7',
  branch_name: 'work/devos-maintenance-bug-hunter-g4',
});

function idleFrame(text = '') {
  return {
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Send' },
    ],
  };
}

function generatingFrame(text = '') {
  return {
    url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
    title: 'ChatGPT',
    text_excerpt: text,
    semantic_targets: [
      { role: 'textbox', name: 'Message ChatGPT' },
      { role: 'button', name: 'Stop generating' },
    ],
  };
}

function fakeSpawn() {
  return () => ({ pid: 43210, unref() {} });
}

test('FALSIFIER: terminal-IDLE sampling does not permanently block a successor supervisor wake', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-g4-supervisor-'));
  const statePath = path.join(dir, 'keepalive.json');
  const originalDateNow = Date.now;
  let wallNow = Date.parse('2026-09-02T12:00:00Z');
  let generating = false;
  let typed = '';
  const sent = [];

  Date.now = () => wallNow;
  try {
    const getState = async () => ({
      tabs: [{ tab_id: 'tab1', url: 'https://chatgpt.com/c/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', selected: true }],
      fleet: { agents: [] },
    });
    const executeCommand = async (command) => {
      if (command.action === 'CAPTURE') return generating ? generatingFrame(typed) : idleFrame(typed);
      if (command.action === 'SEMANTIC_TYPE') { typed = String(command.payload?.text || ''); return { ok: true, authority_effect: true }; }
      if (command.action === 'TYPED_CLICK') { generating = true; sent.push(typed); return { ok: true, authority_effect: true }; }
      throw new Error(`unexpected_action:${command.action}`);
    };

    const runtime = new SupervisorLifecycleRuntime({
      getState,
      executeCommand,
      canActuate: () => true,
      statePath,
      monitorMs: 5000,
      researchMs: 5 * 60 * 1000,
    });

    await runtime.start();
    assert.equal(sent.length, 1, 'initial research wake must be sent');
    assert.equal(runtime.snapshot().supervisor_generation, 'IDLE');
    const firstWakeId = runtime.snapshot().active_request?.wake_id;
    assert.ok(firstWakeId);

    // The response starts and finishes entirely between lifecycle polls. The
    // monitor therefore sees IDLE -> IDLE and cannot use a sampled transition.
    generating = false;
    wallNow += 5 * 60 * 1000 + 1;
    await runtime.cycle({ force: true });

    const snap = runtime.snapshot();
    assert.equal(snap.supervisor_generation, 'IDLE');
    assert.equal(sent.length, 2, 'a due successor wake must still be sent from terminal IDLE');
    assert.notEqual(snap.active_request?.wake_id, firstWakeId, 'successor wake must replace the prior request binding');
    assert.match(sent[1], /METAENGINE_SUPERVISOR_WAKE_V1/);
  } finally {
    Date.now = originalDateNow;
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test('FALSIFIER: durable-state rename EPERM escapes the sentinel before-quit listener', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-g4-eperm-'));
  const statePath = path.join(dir, 'metaengine-browser-sentinel-v1.json');
  const app = new EventEmitter();
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: path.join(dir, 'browser-sentinel-worker.cjs'),
    executable: 'METAENGINE Browser.exe',
    spawnImpl: fakeSpawn(),
  });
  await sentinel.start({ app });

  const originalRenameSync = fsSync.renameSync;
  fsSync.renameSync = () => {
    const error = new Error('simulated Windows durable rename contention');
    error.code = 'EPERM';
    throw error;
  };
  try {
    assert.throws(
      () => app.emit('before-quit'),
      (error) => error?.code === 'EPERM' && /durable rename contention/.test(String(error?.message)),
      'before-quit must currently surface the unhandled EPERM; this is the liveness defect evidence',
    );
  } finally {
    fsSync.renameSync = originalRenameSync;
    await fs.rm(dir, { recursive: true, force: true });
  }

  assert.equal(CLAIM.base_sha, 'c77e991c76df372861b4ab68fc1d2086e31a80b7');
});
