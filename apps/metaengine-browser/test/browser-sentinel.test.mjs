import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  BrowserSentinelHost,
  browserSentinelWorkerHeartbeatPath,
  readSentinelState,
} from '../src/browser-sentinel.mjs';

async function tempState() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-sentinel-'));
  return { dir, statePath: path.join(dir, 'metaengine-browser-sentinel-v1.json') };
}

function fakeSpawn(calls) {
  return (executable, args, options) => {
    calls.push({ executable, args, options });
    return { pid: 43210, unref() { calls[calls.length - 1].unref = true; } };
  };
}

test('sentinel seals exact parent incarnation before detached worker launch', async () => {
  const { dir, statePath } = await tempState();
  const calls = [];
  const app = new EventEmitter();
  const worker = path.join(dir, 'browser-sentinel-worker.cjs');
  const executable = 'C:\\METAENGINE\\METAENGINE Browser.exe';
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: worker, executable, spawnImpl: fakeSpawn(calls) });
  const snap = await sentinel.start({ app });
  const disk = await readSentinelState(statePath);
  assert.equal(snap.lifecycle, 'ARMED');
  assert.equal(disk.token, snap.token);
  assert.equal(disk.parent_pid, process.pid);
  assert.equal(disk.executable, executable);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].executable, executable);
  assert.deepEqual(calls[0].args, [worker]);
  assert.equal(calls[0].options.detached, true);
  assert.equal(calls[0].options.shell, false);
  assert.equal(calls[0].options.stdio, 'ignore');
  assert.equal(calls[0].options.env.ELECTRON_RUN_AS_NODE, '1');
  assert.equal(calls[0].options.env.METAENGINE_SENTINEL_TOKEN, snap.token);
  assert.equal(calls[0].unref, true);
  assert.equal(snap.authority_effect, false);
});

test('planned user quit suppresses crash relaunch authority', async () => {
  const { dir, statePath } = await tempState();
  const app = new EventEmitter();
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(dir, 'worker.cjs'), executable: 'browser.exe', spawnImpl: fakeSpawn([]) });
  await sentinel.start({ app });
  app.emit('before-quit');
  await new Promise((resolve) => setImmediate(resolve));
  const disk = await readSentinelState(statePath);
  assert.equal(disk.lifecycle, 'PLANNED_SHUTDOWN');
  assert.equal(disk.expected_restart, false);
});

test('self-update arms expected-restart grace instead of planned shutdown', async () => {
  const { dir, statePath } = await tempState();
  const app = new EventEmitter();
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(dir, 'worker.cjs'), executable: 'browser.exe', spawnImpl: fakeSpawn([]) });
  await sentinel.start({ app });
  await sentinel.prepareExpectedRestart('SELF_UPDATE');
  app.emit('before-quit');
  await new Promise((resolve) => setImmediate(resolve));
  const disk = await readSentinelState(statePath);
  assert.equal(disk.lifecycle, 'EXPECTED_RESTART');
  assert.equal(disk.expected_restart, true);
  assert.equal(disk.expected_restart_reason, 'SELF_UPDATE');
  assert.equal(disk.relaunch_attempted, false);
});

test('stale heartbeat never authorizes duplicate worker while exact old pid is still alive', async () => {
  const { dir, statePath } = await tempState();
  const calls = [];
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: path.join(dir, 'worker.cjs'),
    executable: 'browser.exe',
    spawnImpl: fakeSpawn(calls),
    processAliveImpl: (pid) => Number(pid) === 43210,
  });
  await sentinel.start();
  const recovery = await sentinel.recoverWorkerIfProvenAbsent({ timeoutMs: 500 });
  assert.equal(recovery.state, 'STALE_WORKER_PID_ALIVE');
  assert.equal(recovery.recovered, false);
  assert.equal(recovery.automatic_retry_allowed, false);
  assert.equal(calls.length, 1);
});

test('proven absent exact worker pid is replaced once and candidate must earn exact heartbeat binding', async () => {
  const { dir, statePath } = await tempState();
  const calls = [];
  const alive = new Set([44002]);
  let spawnIndex = 0;
  const spawnImpl = (executable, args, options) => {
    spawnIndex += 1;
    const pid = spawnIndex === 1 ? 44001 : 44002;
    const child = new EventEmitter();
    child.pid = pid;
    child.unref = () => {};
    child.kill = () => true;
    calls.push({ executable, args, options, pid });
    if (spawnIndex > 1) {
      setImmediate(() => {
        child.emit('spawn');
        setTimeout(async () => {
          await fs.writeFile(browserSentinelWorkerHeartbeatPath(statePath), `${JSON.stringify({
            schema: 'metaengine.browser-sentinel.worker-heartbeat.v1',
            token: options.env.METAENGINE_SENTINEL_TOKEN,
            parent_pid: Number(options.env.METAENGINE_SENTINEL_PARENT_PID),
            worker_pid: pid,
            lifecycle: 'READY',
            heartbeat_at: new Date().toISOString(),
            authority_effect: false,
          })}\n`, { mode: 0o600 });
        }, 20);
      });
    }
    return child;
  };
  const sentinel = new BrowserSentinelHost({
    statePath,
    workerScript: path.join(dir, 'worker.cjs'),
    executable: 'browser.exe',
    spawnImpl,
    processAliveImpl: (pid) => alive.has(Number(pid)),
  });
  const initial = await sentinel.start();
  assert.equal(initial.worker_pid, 44001);

  const [first, second] = await Promise.all([
    sentinel.recoverWorkerIfProvenAbsent({ timeoutMs: 800 }),
    sentinel.recoverWorkerIfProvenAbsent({ timeoutMs: 800 }),
  ]);
  assert.equal(first.state, 'RECOVERED');
  assert.equal(second.state, 'RECOVERED');
  assert.equal(first.worker_pid, 44002);
  assert.equal(calls.length, 2);
  const disk = await readSentinelState(statePath);
  assert.equal(disk.worker_pid, 44002);
  assert.equal(disk.worker_recovery_old_pid, 44001);
  assert.equal(disk.worker_recovery_candidate_pid, 44002);
  assert.equal(disk.worker_recovery_state, 'RECOVERED');
  assert.equal(sentinel.snapshot().worker_ready, true);
});

test('sentinel worker source requires exact durable worker pid before heartbeat or liveness actuation', async () => {
  const source = await fs.readFile(new URL('../src/browser-sentinel-worker.cjs', import.meta.url), 'utf8');
  assert.match(source, /Number\(state\.worker_pid\) === process\.pid/);
  assert.match(source, /async function awaitWorkerBinding\(\)/);
  assert.match(source, /const initial = await awaitWorkerBinding\(\)/);
  assert.match(source, /if \(!validBinding\(current\)\) return false/);
  assert.doesNotMatch(source, /automatic_retry_allowed:\s*true[\s\S]{0,120}SEND|SEND[\s\S]{0,120}automatic_retry_allowed:\s*true/i);
});


test('a blocked Owner marker never leaks an unattested local endpoint into a detached Sentinel', async () => {
  const keys = ['METAENGINE_STATE_PROVIDER','METAENGINE_LOCAL_PROVIDER_BOOT_STATE',
    'METAENGINE_SUPERVISOR_BASE_URL','METAENGINE_LOCAL_STATE_INSTANCE_ID'];
  const saved = new Map(keys.map(key => [key,process.env[key]]));
  const {dir,statePath} = await tempState();
  const calls=[];
  let sentinel=null;
  try {
    process.env.METAENGINE_STATE_PROVIDER='LOCAL_POSTGRES';
    process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE='BLOCKED';
    process.env.METAENGINE_SUPERVISOR_BASE_URL='http://127.0.0.1:15433/a2-browser-native-supervisor-v1';
    process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID='not-attested';
    sentinel = new BrowserSentinelHost({
      statePath,workerScript:path.join(dir,'worker.cjs'),
      executable:'C:\\Program Files\\METAENGINE\\Browser.exe',spawnImpl:fakeSpawn(calls)
    });
    const state=await sentinel.start();
    assert.equal(state.lifecycle,'ARMED');
    assert.equal(calls.length,1);
    const childEnv=calls[0].options.env;
    assert.equal(childEnv.METAENGINE_STATE_PROVIDER,undefined);
    assert.equal(childEnv.METAENGINE_SUPERVISOR_BASE_URL,undefined);
    assert.equal(childEnv.METAENGINE_LOCAL_STATE_INSTANCE_ID,undefined);
    assert.equal(childEnv.ELECTRON_RUN_AS_NODE,'1');
    assert.equal(childEnv.METAENGINE_SENTINEL_PARENT_PID,String(process.pid));
  } finally {
    try { sentinel?.close?.(); } catch {}
    await fs.rm(dir,{recursive:true,force:true});
    for(const [key,value] of saved){
      if(value===undefined)delete process.env[key];
      else process.env[key]=value;
    }
  }
});


test('missing Sentinel executable degrades through a caught health error instead of crashing the parent', async t => {
  const { dir, statePath } = await tempState();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const moduleUrl = new URL('../src/browser-sentinel.mjs', import.meta.url).href;
  const script = `
    import { BrowserSentinelHost } from ${JSON.stringify(moduleUrl)};
    const sentinel = new BrowserSentinelHost(${JSON.stringify({ statePath, executable: path.join(dir, 'missing-executable'), workerScript: path.join(dir, 'worker.cjs') })});
    await sentinel.start();
    try { await sentinel.waitUntilHealthy(1000); process.exitCode = 4; }
    catch (error) {
      console.log(error.message);
      console.log(JSON.stringify(sentinel.snapshot()));
      if (error.message !== 'browser_sentinel_worker_process_error') process.exitCode = 5;
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8', timeout: 120000, windowsHide: true, shell: false,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /browser_sentinel_worker_process_error/);
  assert.match(result.stdout, /"worker_ready":false/);
  assert.match(result.stdout, /"worker_health":"PROCESS_ERROR"/);
  assert.doesNotMatch(result.stderr, /Unhandled 'error' event/);
});

test('an exact child process error overrides an otherwise fresh authenticated heartbeat', async t => {
  const { dir, statePath } = await tempState();
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const child = new EventEmitter();
  child.pid = 43211;
  child.unref = () => {};
  const sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(dir, 'worker.cjs'),
    spawnImpl: () => child });
  const binding = await sentinel.start();
  await fs.writeFile(browserSentinelWorkerHeartbeatPath(statePath), JSON.stringify({
    schema: 'metaengine.browser-sentinel.worker-heartbeat.v1', token: binding.token,
    parent_pid: process.pid, worker_pid: child.pid, lifecycle: 'READY',
    heartbeat_at: new Date().toISOString(), authority_effect: false,
  }));
  assert.equal(sentinel.snapshot().worker_ready, true);
  child.emit('error', new Error('private native launch detail'));
  assert.equal(sentinel.snapshot().worker_ready, false);
  assert.equal(sentinel.snapshot().worker_health, 'PROCESS_ERROR');
  assert.doesNotMatch(JSON.stringify(sentinel.snapshot()), /private native launch detail/);
  await assert.rejects(sentinel.waitUntilHealthy(), /browser_sentinel_worker_process_error/);
});
