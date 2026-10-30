import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import {syncBuiltinESMExports} from 'node:module';
import {createHash, randomUUID} from 'node:crypto';
import {createCodexCliWindowsProcessController, verifyCodexCliJobHelper} from '../src/codex-cli-windows-process-controller.mjs';
import {codexCliEnvironment} from '../src/codex-cli-runner.mjs';
import {withOwnedCodexCliProcess} from './fixtures/with-owned-codex-cli-process.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const native = {skip: process.platform !== 'win32', timeout: 60000};

// Capture only the real helper launched by this controller. This fixture never
// replaces a native read, return value, protocol frame or completion. EOF is
// injected solely into this owned helper's control pipe; cleanup stays with the
// controller, and the original close is joined before restoring the binding.
async function withHelperTransport(body) {
  const verified = verifyCodexCliJobHelper(), originalSpawn = childProcess.spawn, owned = [];
  childProcess.spawn = (...args) => {
    const child = originalSpawn(...args);
    if (args[1]?.at(-2) === '-File' && args[1]?.at(-1) === verified.helperPath) {
      const item = {child, closed: false, result: null};
      item.completion = new Promise(resolve => child.once('close', (code, signal) => {
        item.closed = true; item.result = {code, signal}; resolve();
      }));
      owned.push(item);
    }
    return child;
  };
  syncBuiltinESMExports();
  try {
    await body(() => { assert.equal(owned.length, 1); return owned[0]; });
  } finally {
    await Promise.all(owned.map(item => item.completion));
    childProcess.spawn = originalSpawn; syncBuiltinESMExports();
  }
  assert.equal(owned.length, 1);
}

async function fixture(t) {
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'metaengine-job-lifetime-')));
  t.after(async () => {
    assert.equal(await fs.realpath(directory), directory);
    assert.equal(path.dirname(directory), temporary);
    assert.ok(path.basename(directory).startsWith('metaengine-job-lifetime-'));
    await fs.rm(directory, {recursive: true, force: false});
  });
  const spec = {executablePath: process.execPath, expectedExecutableSha256: sha(await fs.readFile(process.execPath)),
    cwd: directory, env: codexCliEnvironment(path.join(directory, 'unused-auth')), timeoutMs: 10000, runId: randomUUID()};
  return {directory, spec};
}

function joined(handle, terminal, transport) {
  assert.equal(transport.closed, true, 'the original helper close must precede completion');
  assert.deepEqual(transport.result, {code: 0, signal: null});
  assert.equal(terminal.tree_cleanup_confirmed, true);
  assert.equal(terminal.process_exit_confirmed, true);
  assert.equal(terminal.handles_closed, true);
  assert.equal(terminal.pipes_drained, true);
  assert.equal(terminal.pid, handle.proof.pid);
  assert.equal(terminal.process_incarnation_id, handle.proof.process_incarnation_id);
  assert.equal(terminal.job_accounting.active_processes, 0);
  // Windows can add an auxiliary process to the same job. Accounting is an
  // aggregate, not an exact two-process identity inventory. Both generated
  // processes were created; all associated processes must now be inactive.
  assert.ok(terminal.job_accounting.total_processes >= 2);
  assert.equal(terminal.joined_settlement.scope, 'WINDOWS_HELPER_TREE');
  assert.deepEqual(terminal.joined_settlement.helper_process, handle.proof.helper_process);
  assert.equal(terminal.joined_settlement.parent_join.helper_pid, transport.child.pid);
  assert.equal(terminal.joined_settlement.parent_join.helper_process_incarnation_id, handle.proof.helper_process.process_incarnation_id);
  assert.equal(terminal.joined_settlement.parent_join.transport, 'STDIO_CLOSE_DRAINED');
}

test('real Windows normal exit joins full input/output and kills a descendant holding the inherited stdio ends', native, async t => {
  const {spec} = await fixture(t), prompt = 'p'.repeat(65536), count = 131072;
  const script = `const fs=require('node:fs'),crypto=require('node:crypto');let chunks=[];`
    + `process.stdin.on('data',b=>chunks.push(b));process.stdin.on('end',()=>{`
    + `const data=Buffer.concat(chunks);fs.writeSync(1,crypto.createHash('sha256').update(data).digest('hex')+'\\n');`
    + `fs.writeSync(1,'o'.repeat(${count}));fs.writeSync(2,'e'.repeat(${count}));`
    + `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});`
    + `child.once('spawn',()=>process.exit(0));});`;
  await withHelperTransport(async getTransport => {
    await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(), {...spec, args: ['-e', script], promptSha256: sha(prompt)}, async handle => {
      let stdout = '', stderr = '';
      handle.stdout.on('data', value => { stdout += value.toString(); });
      handle.stderr.on('data', value => { stderr += value.toString(); });
      await handle.resume(prompt);
      const terminal = await handle.completion;
      joined(handle, terminal, getTransport());
      assert.equal(terminal.exit_code, 0); assert.equal(terminal.reason, null);
      assert.equal(stdout, sha(prompt) + '\n' + 'o'.repeat(count));
      assert.equal(stderr, 'e'.repeat(count));
    });
  });
});

for (const mode of ['CANCEL', 'CONTROL_EOF']) test(`real Windows resumed ${mode} joins original helper close after exact descendant cleanup`, native, async t => {
  const {spec} = await fixture(t);
  const script = `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});`
    + `child.once('spawn',()=>require('node:fs').writeSync(1,'ready\\n'));setInterval(()=>{},1000);`;
  await withHelperTransport(async getTransport => {
    await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(), {...spec, args: ['-e', script]}, async handle => {
      let output = '', timer;
      const running = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(Error('fixture_worker_ready_timeout')), 5000);
        handle.stdout.on('data', value => { output += value.toString(); if (output === 'ready\n') resolve(); });
      });
      handle.stderr.resume();
      try {
        await handle.resume('');
        await Promise.race([running, handle.completion.then(() => { throw Error('fixture_worker_exited_before_ready'); })]);
      } finally { clearTimeout(timer); }
      if (mode === 'CONTROL_EOF') getTransport().child.stdin.end();
      else await handle.terminate('CANCELLED');
      const terminal = await handle.completion;
      joined(handle, terminal, getTransport());
      assert.equal(terminal.reason, 'CANCELLED'); assert.equal(terminal.exit_code, 124);
      assert.equal(terminal.never_resumed, false);
    });
  });
});

test('real Windows suspended control EOF cannot become a cleanup receipt or execute the child', native, async t => {
  const {directory, spec} = await fixture(t), canary = path.join(directory, 'must-not-run.txt');
  await withHelperTransport(async getTransport => {
    await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(), {...spec,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canary)},'ran')`]}, async handle => {
      handle.stdout.resume(); handle.stderr.resume(); getTransport().child.stdin.end();
      const terminal = await handle.completion;
      assert.equal(getTransport().closed, true); assert.equal(getTransport().result.code, 1);
      assert.equal(terminal.reason, 'NATIVE_JOB_FAILED'); assert.equal(terminal.tree_cleanup_confirmed, false);
      assert.equal(terminal.joined_settlement, undefined);
      await assert.rejects(fs.stat(canary), {code: 'ENOENT'});
    });
  });
});

test('real Windows unconsumed input is bounded by descendant cleanup and cannot attest successful pipe drain', native, async t => {
  const {spec} = await fixture(t), prompt = 'p'.repeat(65536);
  const script = `const child=require('node:child_process').spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'inherit'});`
    + `child.once('spawn',()=>process.exit(0));`;
  await withHelperTransport(async getTransport => {
    await withOwnedCodexCliProcess(createCodexCliWindowsProcessController(), {...spec, args: ['-e', script], promptSha256: sha(prompt)}, async handle => {
      handle.stdout.resume(); handle.stderr.resume(); await handle.resume(prompt);
      const terminal = await handle.completion;
      assert.equal(getTransport().closed, true); assert.equal(getTransport().result.code, 1);
      assert.equal(terminal.reason, 'NATIVE_JOB_FAILED'); assert.equal(terminal.tree_cleanup_confirmed, false);
      assert.equal(terminal.joined_settlement, undefined);
    });
  });
});
