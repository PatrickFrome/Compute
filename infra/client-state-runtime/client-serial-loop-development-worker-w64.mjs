// W64 test-only adapter: exercise the existing DevelopmentPlane worker's
// read-only REPO_HEAD_READ through its real message protocol. NEVER a second
// scheduler/executor; DevelopmentPlane advertises no sandbox execution.
import assert from 'node:assert/strict';
import path from 'node:path';
import { realpath } from 'node:fs/promises';
import { Worker } from 'node:worker_threads';
import { fileURLToPath } from 'node:url';
import { DevelopmentPlane } from '../../apps/metaengine-browser/src/development-plane.mjs';

const workerPath = fileURLToPath(new URL('../../apps/metaengine-browser/src/development-plane-worker.cjs', import.meta.url));
const source = `
  const { parentPort, workerData } = require('node:worker_threads');
  process.parentPort = { postMessage: data => parentPort.postMessage(data), on: (event, fn) => parentPort.on(event, data => fn({data})) }; // Electron MessagePort event shape
  process.env.METAENGINE_REPO_ROOT = workerData.sourceDir;
  process.env.METAENGINE_GIT_REPOSITORY = 'PatrickFrome/Compute';
  require(workerData.workerPath);
`;

export async function probeW64GeneratedDevelopmentWorker(sourceDir) {
  const dir = await realpath(sourceDir);
  const fixtureName = path.basename(path.dirname(dir));
  assert.match(fixtureName, /^metaengine-w56-own-pg17-[A-Za-z0-9_-]+$/,
    'worker may only read a newly generated W56 Git fixture');
  assert.equal(path.basename(dir), 'unique-git');
  let spawned = null;
  const plane = new DevelopmentPlane({
    timeout_ms: 10_000,
    spawnWorker: () => {
      spawned = new Worker(source, { eval:true, workerData: { sourceDir:dir, workerPath } });
      // Existing plane expects the Electron utilityProcess API; this shim only
      // bridges Worker lifecycle. No shell, Git mutation, or arbitrary RPC.
      spawned.kill = () => { void spawned.terminate(); return true; };
      return spawned;
    },
  });
  try {
    const state = await plane.start();
    assert.equal(state.state, 'READY');
    const head = await plane.request('REPO_HEAD_READ');
    const caps = await plane.request('CAPABILITIES');
    assert.equal(head.repository_present, true);
    assert.equal(head.repository, 'PatrickFrome/Compute');
    assert.match(head.head, /^[0-9a-f]{40}$/);
    assert.equal(caps.verification_sandbox_execution, false);
    assert.equal(caps.arbitrary_eval, false);
    assert.equal(caps.direct_promote_current, false);
    await assert.rejects(plane.request('SANDBOX_EXECUTE'),
      /development_plane_capability_denied/);
    return Object.freeze({ head:head.head, ref:head.ref,
      worker_pid:state.pid, authority_effect:false, edit_authority:false,
      capability:'REPO_HEAD_READ', origin:'SYNTHETIC/STAGING' });
  } finally {
    try { await plane.stopAndWait(5_000); }
    catch { if(spawned) await spawned.terminate(); }
  }
}
