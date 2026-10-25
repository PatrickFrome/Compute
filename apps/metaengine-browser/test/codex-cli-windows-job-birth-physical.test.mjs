import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {codexCliEnvironment} from '../src/codex-cli-runner.mjs';
import {resolveCodexCliJobHelper} from '../src/codex-cli-windows-process-controller.mjs';
import {withOwnedCodexCliProcess} from './fixtures/with-owned-codex-cli-process.mjs';

const observerPath = fileURLToPath(new URL('./fixtures/codex-cli-job-birth-observer.ps1', import.meta.url));
const ownershipTransfer = 'process=createdProcess;';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const csharpString = value => '@"' + value.replaceAll('"', '""') + '"';

// Source-safety contracts only; the generated negative controls are not native
// execution or evidence that a forced-death observation has passed.
const observerStages = [
  'guard=CreateJobObject(IntPtr.Zero,null);',
  'Require(IsProcessInJob(new IntPtr(-1),guard,out observerInside) && !observerInside,"observer_outside_outer");',
  'limits.basic.flags=0x2000;',
  'Require(ok,"helper_create"); helper=created;',
  'Require(IsProcessInJob(helper.process,guard,out membership) && membership,"helper_outer_membership");',
  'Require(ResumeThread(helper.thread)!=0xffffffff,"helper_resume");',
  'Require(fields[0]==nonce && UInt32.Parse(fields[1],CultureInfo.InvariantCulture)==helper.pid',
  'Require(DuplicateHandle(helper.process,new IntPtr(rawValue),new IntPtr(-1),out transferred,0,false,2),"child_handle_transfer"); child=transferred;',
  'Require(GetProcessId(child)==childPid',
  'Require(SamePath(Image(child),childPath),"child_image");',
  'Require(ParentIs(child,helper.pid),"child_parent");',
  'Require(IsProcessInJob(child,guard,out membership) && membership,"child_outer_membership");',
  'Require(accounting.active==2 && accounting.total>=2,"outer_active_identity_set");',
  'Require(TerminateProcess(helper.process,91),"forced_exact_helper_kill");',
  'Require(WaitForSingleObject(helper.process,5000)==0,"helper_exit_wait");',
  'Require(WaitForSingleObject(child,5000)==0,"inner_last_close_child_exit");',
  'Require(GetExitCodeProcess(child,out childCode) && childCode!=259,"child_exit_readback");',
  'GuardLimits(guard); observed=true;',
  'Require(TerminateJobObject(guard,125),"outer_final_cleanup")',
  'Close(ref guard,"outer_guard_close")',
  'if(cleanupErrors.Count>0) throw new AggregateException(',
  'Console.Out.WriteLine(',
];
function assertObserverCustody(source) {
  let previous = -1;
  for (const marker of observerStages) {
    assert.equal(source.split(marker).length, 2, 'observer custody stage must be unique: ' + marker);
    const position = source.indexOf(marker); assert.ok(position > previous, 'observer custody stages must remain ordered'); previous = position;
  }
  assert.doesNotMatch(source, /\b(?:OpenProcess|GetProcessById)\s*\(/, 'file-supplied numeric PIDs never authorize a process handle or kill');
  assert.match(source, /GetHandleInformation\(guard,out handleFlags\) && \(handleFlags&1\)==0/);
  assert.match(source, /limits\.basic\.flags==0x2000 && limits\.basic\.processTime==0 && limits\.basic\.jobTime==0/);
  assert.match(source, /if\(child!=IntPtr\.Zero && childOwned && WaitForSingleObject\(child,0\)!=0\)/);
}

test('birth-window observer keeps its outer cleanup guard separate from exact-child exit evidence', async () => {
  assertObserverCustody(await fs.readFile(observerPath, 'utf8'));
});

function assertFailureInventoryDiagnostic(source) {
  assertObserverCustody(source);
  assert.equal(source.split('var accountingDeadline=DateTime.UtcNow.AddSeconds(2);').length, 2);
  const capture = 'if(accounting.active!=2 || accounting.total<2) CaptureFailureInventory(';
  assert.equal(source.split(capture).length, 2);
  const call = source.indexOf(capture), refusal = source.indexOf(observerStages[12]);
  assert.ok(call < refusal && refusal < source.indexOf(observerStages[13]), 'diagnostics cannot replace refusal or move outer cleanup before the observation');
  const begin = source.indexOf('  static string DiagnosticWaitState('), end = source.indexOf('  static void GuardLimits(');
  assert.ok(begin > 0 && end > begin);
  const diagnostic = source.slice(begin, end);
  assert.match(diagnostic, /const int capacity=256; int bytes=checked\(8\+capacity\*IntPtr\.Size\);/);
  assert.match(diagnostic, /QueryInformationJobObject\(guard,3,information,\(uint\)bytes,out returned\)/);
  assert.match(diagnostic, /listed<=\(uint\)capacity && returned>=8\+listed\*\(uint\)IntPtr\.Size/);
  assert.match(diagnostic, /if\(information!=IntPtr\.Zero\) Marshal\.FreeHGlobal\(information\)/);
  assert.doesNotMatch(diagnostic, /\b(?:Require|OpenProcess|GetProcessById|TerminateProcess|TerminateJobObject|ResumeThread|Image)\s*\(/,
    'failure diagnostics have no effect authority and cannot replace the primary phase');
  for (const key of ['active_processes', 'total_processes', 'limit_terminated_processes', 'accounting_polls',
    'first_active_processes', 'minimum_active_processes', 'maximum_active_processes', 'accounting_struct_bytes',
    'total_field_offset', 'active_field_offset', 'pointer_bytes', 'pid_list_capacity', 'pid_list_complete',
    'pid_list_assigned_processes', 'pid_list_count', 'helper_listed', 'child_listed', 'other_listed_processes',
    'snapshot_hint_console_hosts', 'snapshot_hint_compilers', 'snapshot_hint_unclassified', 'helper_wait_state', 'child_wait_state']) {
    assert.ok(diagnostic.includes(String.raw`\"${key}\":`), key);
  }
  assert.ok(diagnostic.includes(String.raw`\"diagnostic_only\":true`));
  assert.ok(diagnostic.includes(String.raw`\"native_qualification_proven\":false`));
  assert.ok(!diagnostic.includes(String.raw`\"native_qualification_proven\":true`));
  for (const forbidden of ['pid', 'helper_pid', 'child_pid', 'path', 'image', 'args', 'env', 'exception']) {
    assert.ok(!diagnostic.includes(String.raw`\"${forbidden}\":`), 'no raw identity or private text key: ' + forbidden);
  }
  assert.match(source, /\$inventory = \[MetaengineJobBirthObserver\]::FailureInventoryJson/);
}

test('failed outer inventory emits bounded fixed-label diagnostics without changing exact-count refusal or cleanup', async () => {
  assertFailureInventoryDiagnostic(await fs.readFile(observerPath, 'utf8'));
});

for (const [name, mutate] of [
  ['weakened active-count proof', source => source.replace(observerStages[12], observerStages[12].replace('accounting.active==2', 'accounting.active>=2'))],
  ['effectful diagnostic', source => source.replace('const int capacity=256;', 'TerminateProcess(child,125); const int capacity=256;')],
  ['diagnostic native-qualification promotion', source => source.replace(String.raw`\"native_qualification_proven\":false`, String.raw`\"native_qualification_proven\":true`)],
]) test(`outer inventory diagnostic source rejects ${name}`, async () => {
  const source = await fs.readFile(observerPath, 'utf8');
  assert.notEqual(mutate(source), source);
  assert.throws(() => assertFailureInventoryDiagnostic(mutate(source)), assert.AssertionError);
});

for (const [name, mutate] of [
  ['outer cleanup before child-exit observation', source => source.replace(observerStages[18], '').replace(observerStages[13], observerStages[18] + ';\n' + observerStages[13])],
  ['file-PID process opening', source => source + '\nOpenProcess(0,false,childPid);'],
  ['unowned handle-transfer source', source => source.replace('DuplicateHandle(helper.process,', 'DuplicateHandle(new IntPtr(rawValue),')],
  ['missing parent correlation', source => source.replace(observerStages[10], '')],
]) test(`birth-window observer source refuses ${name}`, async () => {
  const source = await fs.readFile(observerPath, 'utf8');
  assert.notEqual(mutate(source), source);
  assert.throws(() => assertObserverCustody(mutate(source)), assert.AssertionError);
});

// This adapter owns only the disposable observer. Its non-inherited outer Job
// owns the inert helper tree; killing the observer is a bounded-abort cleanup,
// never evidence that the production inner Job worked.
function observerController(powershellPath, directory) {
  return { async spawn() {
    const child = spawn(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', observerPath], {
      cwd: directory, env: codexCliEnvironment(path.join(directory, 'unused-auth')),
      windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
    let closed = false, timedOut = false, overflow = false, spawnError = null, inputError = null, bytes = 0;
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 65536) { overflow = true; child.kill(); }
    });
    child.once('error', error => { spawnError = error.code || 'SPAWN_FAILED'; });
    child.stdin.on('error', error => { inputError = error.code || 'INPUT_FAILED'; child.kill(); });
    const completion = new Promise(resolve => child.once('close', (code, signal) => {
      closed = true; clearTimeout(timer);
      resolve({code, signal: signal ?? null, timedOut, overflow, spawnError, inputError});
    }));
    return {stdout: child.stdout, stderr: child.stderr, completion,
      start(request) { child.stdin.end(JSON.stringify(request) + '\n'); },
      async terminate() { if (!closed) child.kill(); await completion; },
    };
  }};
}

test('real Windows inner Job kills the exact suspended birth-window child before ready, independently of the outer cleanup guard', {
  skip: process.platform !== 'win32', timeout: 120000,
}, async t => {
  const temporary = await fs.realpath(os.tmpdir());
  const directory = await fs.realpath(await fs.mkdtemp(path.join(temporary, 'metaengine-job-birth-')));
  t.after(async () => {
    assert.equal(await fs.realpath(directory), directory);
    assert.equal(path.dirname(directory), temporary);
    assert.ok(path.basename(directory).startsWith('metaengine-job-birth-'));
    await fs.rm(directory, {recursive: true, force: true});
  });
  const original = await fs.readFile(resolveCodexCliJobHelper());
  const source = original.toString('utf8').replace(/^\ufeff/, '');
  assert.equal(source.split(ownershipTransfer).length, 2, 'gate must follow exactly the successful owned native birth');
  const nonce = crypto.randomBytes(32).toString('hex');
  const channel = path.join(directory, `birth-${nonce}.txt`), canary = path.join(directory, 'must-not-run.txt');
  const helperPath = path.join(directory, 'birth-gated-helper.ps1');
  const gate = `
        long testHelperBirth,testChildBirth,testExit,testKernel,testUser;
        Require(GetProcessTimes(new IntPtr(-1),out testHelperBirth,out testExit,out testKernel,out testUser),"test_helper_birth_failed");
        Require(GetProcessTimes(process.process,out testChildBirth,out testExit,out testKernel,out testUser),"test_child_birth_failed");
        File.WriteAllLines(${csharpString(channel)},new[]{${csharpString(nonce)},
          System.Diagnostics.Process.GetCurrentProcess().Id.ToString(System.Globalization.CultureInfo.InvariantCulture),
          testHelperBirth.ToString(System.Globalization.CultureInfo.InvariantCulture),process.pid.ToString(System.Globalization.CultureInfo.InvariantCulture),
          testChildBirth.ToString(System.Globalization.CultureInfo.InvariantCulture),process.process.ToInt64().ToString(System.Globalization.CultureInfo.InvariantCulture)});
        System.Threading.Thread.Sleep(10000);
        Require(false,"test_birth_gate_expired");`;
  await fs.writeFile(helperPath, '\ufeff' + source.replace(ownershipTransfer, ownershipTransfer + gate), 'utf8');
  const powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const expectedSha = sha(await fs.readFile(process.execPath));
  const helperRequest = JSON.stringify({executable_path: process.execPath,
    args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(canary)},'ran')`], cwd: directory,
    run_id: crypto.randomUUID(), timeout_ms: 10000, expected_sha256: expectedSha, deadline_ms: ''});
  await withOwnedCodexCliProcess(observerController(powershellPath, directory), {}, async observer => {
    let stdout = '', stderr = '';
    observer.stdout.on('data', chunk => { stdout = (stdout + chunk.toString()).slice(0, 65536); });
    observer.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(0, 65536); });
    observer.start({powershell_path: powershellPath, helper_path: helperPath, helper_request: helperRequest, cwd: directory,
      birth_channel_path: channel, nonce, expected_child_path: process.execPath, expected_child_sha256: expectedSha});
    const completion = await observer.completion;
    assert.deepEqual(completion, {code: 0, signal: null, timedOut: false, overflow: false, spawnError: null, inputError: null},
      `bounded native observer failed: ${stdout}\n${stderr}`);
    const lines = stdout.trim().split(/\r?\n/); assert.equal(lines.length, 1);
    const evidence = JSON.parse(lines[0]);
    assert.equal(evidence.nonce, nonce);
    for (const field of ['child_image_verified', 'child_parent_verified', 'outer_membership_verified', 'inner_cleanup_observed',
      'helper_exit_confirmed', 'child_exit_confirmed', 'outer_guard_open_during_observation', 'outer_termination_after_observation', 'handles_closed']) {
      assert.equal(evidence[field], true, field);
    }
    assert.ok(Number.isSafeInteger(evidence.helper_pid) && evidence.helper_pid > 0);
    assert.ok(Number.isSafeInteger(evidence.child_pid) && evidence.child_pid > 0 && evidence.child_pid !== evidence.helper_pid);
    assert.match(evidence.helper_birth_100ns, /^[1-9][0-9]{16,18}$/);
    assert.match(evidence.child_birth_100ns, /^[1-9][0-9]{16,18}$/);
    assert.ok(BigInt(evidence.child_birth_100ns) >= BigInt(evidence.helper_birth_100ns));
    assert.ok(Number.isSafeInteger(evidence.child_exit_code) && evidence.child_exit_code >= 0 && evidence.child_exit_code <= 0xffffffff && evidence.child_exit_code !== 259);
    await assert.rejects(fs.stat(canary), {code: 'ENOENT'});
  });
  assert.equal(sha(await fs.readFile(resolveCodexCliJobHelper())), sha(original), 'production helper must remain untouched by fault injection');
});
