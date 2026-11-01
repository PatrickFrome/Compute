const assert = require('node:assert/strict');
const { Worker } = require('node:worker_threads');
const { spawnSync } = require('node:child_process');
const binary = process.argv[2];
const addon = require(binary);
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

(async () => {
  if (process.argv.includes('--pending-open')) {
    const pending = addon.openGuardianConnectedPeer();
    await wait(50);
    const start = Date.now();
    assert.equal(addon.cancelPendingGuardianPeerObservations(), undefined);
    await assert.rejects(pending, /environment_closed/);
    assert.ok(Date.now() - start < 1500, 'pending OPEN cancellation waited for the worker pool');
    // Module revocation affects existing scopes; it cannot permanently disable
    // the Addon or supply authority for a subsequent separately owned scope.
    delete process.env.GUARDIAN_NAPI_SYNTHETIC_SLOW_OPEN;
    const next = await addon.openGuardianConnectedPeer();
    await next.close();
    console.log('NAPI_PENDING_OPEN_CANCEL=PASS; SYNTHETIC_CORE_NOT_WINDOWS');
    return;
  }
  assert.throws(() => addon.openGuardianConnectedPeer({ verified: true }), /arguments_forbidden/);
  assert.throws(() => addon.cancelPendingGuardianPeerObservations({ verified: true }), /arguments_forbidden/);
  // Keep the JS completion callback queued while the immediate synthetic core's
  // worker finishes OPEN. Revocation in this gap must reject the pending promise
  // instead of returning a revoked Peer carrying its pre-cancel cached snapshot.
  const completionRace = addon.openGuardianConnectedPeer();
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
  addon.cancelPendingGuardianPeerObservations();
  await assert.rejects(completionRace, /environment_closed/);
  console.log('NAPI_OPEN_COMPLETION_CANCEL=PASS; SYNTHETIC_CORE_NOT_WINDOWS');
  const peer = await addon.openGuardianConnectedPeer();
  assert.equal(JSON.parse(peer.snapshot()).fixture_classification, 'SYNTHETIC_CORE_NOT_WINDOWS');
  assert.equal(JSON.parse(peer.snapshot()).rechecks, 0);
  const original = peer.snapshot();
  const pending = peer.recheck();
  const start = Date.now();
  assert.equal(peer.snapshot(), original);
  assert.ok(Date.now() - start < 100, 'cached snapshot waited for a native operation');
  assert.throws(() => peer.recheck(), /recheck_pending/);
  assert.throws(() => peer.snapshot.call({}), /receiver_invalid/);
  assert.throws(() => peer.close.call(JSON.parse(original)), /receiver_invalid/);
  const firstClose = await Promise.allSettled([pending, peer.close()]);
  assert.equal(firstClose[1].status, 'fulfilled');
  assert.equal(JSON.parse(peer.snapshot()).closed, true);
  assert.throws(() => peer.recheck(), /closed/);
  await peer.close();

  const saturated = await Promise.all(Array.from({ length: 4 }, () => addon.openGuardianConnectedPeer()));
  const reads = saturated.map(scope => scope.recheck());
  await wait(50);
  const cancelStart = Date.now();
  const drained = await Promise.allSettled([...reads, ...saturated.map(scope => scope.close())]);
  assert.ok(drained.slice(4).every(row => row.status === 'fulfilled'));
  assert.ok(Date.now() - cancelStart < 1500, 'cancellation queued behind the saturated worker pool');

  let gcPeer = await addon.openGuardianConnectedPeer();
  const gcRead = gcPeer.recheck();
  const gcClose = gcPeer.close();
  gcPeer = null;
  global.gc();
  const gcDrain = await Promise.allSettled([gcRead, gcClose]);
  assert.equal(gcDrain[1].status, 'fulfilled');

  const child = spawnSync(process.execPath, ['--expose-gc', __filename, binary, '--pending-open'], {
    encoding: 'utf8', timeout: 12_000,
    env: { ...process.env, UV_THREADPOOL_SIZE: '4', GUARDIAN_NAPI_SYNTHETIC_SLOW_OPEN: '1' },
  });
  assert.ifError(child.error);
  assert.equal(child.status, 0, child.stdout + child.stderr);

  const worker = new Worker(`const { parentPort } = require('node:worker_threads');
    const api = require(${JSON.stringify(binary)});
    void api.openGuardianConnectedPeer().then(scope => scope.recheck()).catch(() => {});
    parentPort.postMessage('work-queued'); setInterval(() => {}, 10000);`, { eval: true });
  await new Promise((resolve, reject) => { worker.once('message', resolve); worker.once('error', reject); });
  await wait(50);
  await worker.terminate();
  // N-API environment cleanup may run after async work drains. This verifies
  // retained lifetime only and deliberately makes NO bounded-teardown claim.
  console.log(child.stdout.trim());
  console.log('NAPI_LIFETIME_TESTS=PASS; SYNTHETIC_CORE_NOT_WINDOWS; environment_termination_wait=UNQUALIFIED; no peer/source/SCM qualification');
})().catch(error => { console.error(error); process.exitCode = 1; });
