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
const innerJobAttribute = 'Require(UpdateProcThreadAttribute(attributes,0,new UIntPtr(0x0002000d),jobList,new UIntPtr((uint)IntPtr.Size),IntPtr.Zero,IntPtr.Zero),"job_attribute_failed");';
const omittedInnerAssociation = 'Require(true,"test_inner_association_omitted");';
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const csharpString = value => '@"' + value.replaceAll('"', '""') + '"';

// Source-safety contracts only; these generated controls do not execute native
// Windows code or turn an auxiliary process hint into identity/effect authority.
const inventoryRequirement = 'Require(inventory.complete && inventory.helperListed && inventory.childListed,"outer_known_identity_inventory");';
const parentRequirement = 'Require(ParentIs(child,helper.pid),"child_parent");';
const knownIdentityRequirement = 'Require(GetProcessId(helper.process)==helper.pid && Birth(helper.process)==helperBirth && GetProcessId(child)==childPid && Birth(child)==childBirth,"known_identity_before_helper_kill");';
const knownMembershipRequirement = 'Require(IsProcessInJob(helper.process,guard,out membership) && membership && IsProcessInJob(child,guard,out membership) && membership,"known_membership_before_helper_kill");';
const forcedHelperKill = 'Require(TerminateProcess(helper.process,91),"forced_exact_helper_kill");';
const outerCleanup = 'Require(TerminateJobObject(guard,125),"outer_final_cleanup")';
const childOuterMembership = 'Require(IsProcessInJob(child,guard,out membership) && membership,"child_outer_membership"); childOuterBound=true;';
const childFallback = 'if(child!=IntPtr.Zero && childOwned && !(outerTerminationRequested && childOuterBound)) {';
const childCleanupWait = 'if(child!=IntPtr.Zero && childOwned) Cleanup(cleanupErrors,()=>Require(WaitForSingleObject(child,5000)==0,"child_cleanup_wait"));';
const controlWait = 'Require(WaitForSingleObject(child,5000)==0x102,"unassigned_control_survives_helper_exit");';
const controlActive = 'Require(GetExitCodeProcess(child,out childCode) && childCode==259,"unassigned_control_still_active"); controlSurvived=true;';
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
  parentRequirement,
  childOuterMembership,
  inventoryRequirement, knownIdentityRequirement, knownMembershipRequirement,
  forcedHelperKill,
  'Require(WaitForSingleObject(helper.process,5000)==0,"helper_exit_wait");',
  'Require(GetExitCodeProcess(helper.process,out helperCode) && helperCode==91,"forced_helper_exit_code");',
  'Require(WaitForSingleObject(child,5000)==0,"inner_last_close_child_exit");',
  'Require(GetExitCodeProcess(child,out childCode) && childCode!=259,"child_exit_readback"); innerObserved=true;',
  controlWait, controlActive,
  'GuardLimits(guard); observed=true;',
  outerCleanup,
  'outerTerminationRequested=true;',
  childFallback,
  'uint state=WaitForSingleObject(child,0);',
  'Cleanup(cleanupErrors,()=>Require(state==0 || state==0x102,"owned_child_cleanup_probe"));',
  'if(state!=0) Cleanup(cleanupErrors,()=>Require(TerminateProcess(child,125),"owned_child_final_cleanup"));',
  childCleanupWait,
  'Require(GetExitCodeProcess(child,out code) && code!=259,"child_cleanup_exit_readback");',
  'if(control) Require(code==125,"unassigned_control_cleanup_code");',
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
  assert.doesNotMatch(source, /\b(?:OpenProcess|GetProcessById)\s*\(/, 'numeric PIDs never authorize a process handle or kill');
  assert.match(source, /GetHandleInformation\(guard,out handleFlags\) && \(handleFlags&1\)==0/);
  assert.match(source, /limits\.basic\.flags==0x2000 && limits\.basic\.processTime==0 && limits\.basic\.jobTime==0/);
  assert.match(source, /bool helperBound=false,childOwned=false,childOuterBound=false,outerTerminationRequested=false,/);
  assert.equal(source.split('childOuterBound=true;').length, 2, 'only a checked native membership readback can confirm child containment');
  assert.equal(source.split('outerTerminationRequested=true;').length, 2, 'only a checked successful OUTER termination can suppress the fallback');
  assert.match(source, /Require\(TerminateJobObject\(guard,125\),"outer_final_cleanup"\); outerTerminationRequested=true;/);
  assert.match(source, /Require\(scenario=="BOUND" \|\| scenario=="UNASSIGNED_CONTROL","fixture_scenario"\); bool control=scenario=="UNASSIGNED_CONTROL";/);
  assert.match(source, /if\(!control\) \{[\s\S]*"inner_last_close_child_exit"[\s\S]*\} else \{[\s\S]*"unassigned_control_survives_helper_exit"/);
  assert.doesNotMatch(source, /accounting\.active\s*==\s*2/, 'aggregate association/reference counts are not the claimed two-process identity proof');
  const begin = source.indexOf('  static Inventory ReadInventory('), end = source.indexOf('  static void CaptureFailureInventory(');
  assert.ok(begin > 0 && end > begin);
  const inventory = source.slice(begin, end);
  assert.match(inventory, /const int capacity=256; int bytes=checked\(8\+capacity\*IntPtr\.Size\);/);
  assert.match(inventory, /QueryInformationJobObject\(guard,3,information,\(uint\)bytes,out result\.returned\)/);
  assert.match(inventory, /result\.listed<=\(uint\)capacity && result\.returned>=8\+result\.listed\*\(uint\)IntPtr\.Size/);
  assert.match(inventory, /result\.complete=result\.queryOk && header && result\.assigned==result\.listed && result\.invalid==0 && result\.duplicates==0;/);
  assert.equal(inventory.split('result.complete=').length, 2);
  assert.match(inventory, /if\(information!=IntPtr\.Zero\) Marshal\.FreeHGlobal\(information\)/);
  assert.doesNotMatch(inventory, /\b(?:Require|OpenProcess|GetProcessById|TerminateProcess|TerminateJobObject|ResumeThread|DiagnosticSnapshotHints|Image)\s*\(/,
    'native association inventory grants no auxiliary effect or name-based identity authority');
}

test('birth-window observer uses complete known-identity inventory and counterfactual outcomes before outer cleanup', async () => {
  assertObserverCustody(await fs.readFile(observerPath, 'utf8'));
});

// Execute only the committed fixture's small teardown-request/wait statements
// with deterministic native stubs. C# lambdas/operators here are also JavaScript;
// the sole local uint declaration becomes let. This is an ordering/race contract,
// not a C# compilation, Windows API execution or native cleanup qualification.
function exerciseChildTeardown(source, {outerOk = true, childBound = true, childOwned = true,
  probe = 0x102, terminateOk = true, wait = 0, exitDuringProbe = false} = {}) {
  const begin = source.indexOf('      if(guard!=IntPtr.Zero) Cleanup(cleanupErrors,()=>');
  const end = source.indexOf(childCleanupWait, begin) + childCleanupWait.length;
  assert.ok(begin >= 0 && end > begin);
  const statements = source.slice(begin, end).replace('uint state=', 'let state=');
  const calls = [], errors = []; let childSignaled = false;
  const run = new Function('guard', 'helper', 'child', 'IntPtr', 'helperBound', 'childOwned', 'childOuterBound',
    'Cleanup', 'cleanupErrors', 'Require', 'TerminateJobObject', 'TerminateProcess', 'WaitForSingleObject',
    'let outerTerminationRequested=false;\n' + statements);
  run('outer', {process: 'helper'}, 'child', {Zero: null}, true, childOwned, childBound,
    (errors, action) => { try { action(); } catch (error) { errors.push(error.message); } }, errors,
    (ok, stage) => { if (!ok) throw Error(stage); },
    (handle, code) => { calls.push(['job', handle, code]); return outerOk; },
    (handle, code) => { calls.push(['process', handle, code]); return !childSignaled && terminateOk; },
    (handle, milliseconds) => {
      calls.push(['wait', handle, milliseconds]);
      if (handle === 'helper') return 0;
      if (milliseconds === 0) { if (exitDuringProbe) childSignaled = true; return probe; }
      assert.equal(milliseconds, 5000); return wait;
    });
  return {calls, errors};
}

test('successful OUTER termination of a verified child waits for exit without a racy duplicate individual termination', async () => {
  const source = await fs.readFile(observerPath, 'utf8');
  const result = exerciseChildTeardown(source, {exitDuringProbe: true});
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.calls, [['job', 'outer', 125], ['wait', 'helper', 5000], ['wait', 'child', 5000]]);
  // Replay the old source branch with a timeout probe immediately followed by
  // process exit. The redundant native kill now fails, although the later exact
  // handle wait succeeds. This deterministically refutes the previous ordering.
  const begin = source.indexOf('      ' + childFallback), end = source.indexOf('\n      if(helper.process!=IntPtr.Zero) Cleanup(', begin);
  assert.ok(begin >= 0 && end > begin);
  const old = source.slice(0, begin) + '      if(child!=IntPtr.Zero && childOwned && WaitForSingleObject(child,0)!=0) Cleanup(cleanupErrors,()=>Require(TerminateProcess(child,125),"owned_child_final_cleanup"));' + source.slice(end);
  const legacy = exerciseChildTeardown(old, {exitDuringProbe: true});
  assert.deepEqual(legacy.errors, ['owned_child_final_cleanup']);
  assert.ok(legacy.calls.some(call => call[0] === 'process'));
  assert.deepEqual(legacy.calls.at(-1), ['wait', 'child', 5000]);
  assert.throws(() => assertObserverCustody(old), assert.AssertionError);
});

test('OUTER failure or unverified child membership retains checked exact-owned fallback and unconditional completion waits', async () => {
  const source = await fs.readFile(observerPath, 'utf8');
  for (const options of [{outerOk: false}, {childBound: false}]) {
    const result = exerciseChildTeardown(source, options);
    assert.deepEqual(result.errors, options.outerOk === false ? ['outer_final_cleanup'] : []);
    assert.deepEqual(result.calls, [['job', 'outer', 125], ['wait', 'child', 0], ['process', 'child', 125], ['wait', 'helper', 5000], ['wait', 'child', 5000]]);
  }
  assert.deepEqual(exerciseChildTeardown(source, {childBound: false, terminateOk: false}).errors, ['owned_child_final_cleanup']);
  assert.deepEqual(exerciseChildTeardown(source, {outerOk: false, terminateOk: false, wait: 0x102}).errors,
    ['outer_final_cleanup', 'owned_child_final_cleanup', 'child_cleanup_wait'], 'request, fallback and completion failures are all retained');
  const failedProbe = exerciseChildTeardown(source, {childBound: false, probe: 0xffffffff});
  assert.deepEqual(failedProbe.errors, ['owned_child_cleanup_probe']);
  assert.ok(failedProbe.calls.some(call => call[0] === 'process'), 'a failed probe cannot prevent best-effort termination of the already-owned handle');
  assert.deepEqual(exerciseChildTeardown(source, {childBound: false, probe: 0xffffffff, terminateOk: false}).errors,
    ['owned_child_cleanup_probe', 'owned_child_final_cleanup'], 'arbitrary native termination failures are not ignored');
  assert.deepEqual(failedProbe.calls.at(-1), ['wait', 'child', 5000], 'completion is still awaited after a fallback failure');
  const alreadyExited = exerciseChildTeardown(source, {childBound: false, probe: 0});
  assert.deepEqual(alreadyExited.errors, []); assert.ok(!alreadyExited.calls.some(call => call[0] === 'process'));
  for (const wait of [0x102, 0xffffffff]) assert.deepEqual(exerciseChildTeardown(source, {wait}).errors, ['child_cleanup_wait']);
  const unowned = exerciseChildTeardown(source, {childOwned: false, childBound: false});
  assert.deepEqual(unowned.calls, [['job', 'outer', 125], ['wait', 'helper', 5000]], 'no individual fallback or readback is authorized by an unowned child handle');
});

function assertFailureInventoryDiagnostic(source) {
  assertObserverCustody(source);
  assert.equal(source.split('var accountingDeadline=DateTime.UtcNow.AddSeconds(2);').length, 2);
  const capture = 'if(!inventory.complete || !inventory.helperListed || !inventory.childListed) CaptureFailureInventory(';
  assert.equal(source.split(capture).length, 2);
  const call = source.indexOf(capture), refusal = source.indexOf(inventoryRequirement);
  assert.ok(call < refusal && refusal < source.indexOf(forcedHelperKill), 'diagnostics cannot replace refusal or move outer cleanup before observation');
  const begin = source.indexOf('  static string DiagnosticWaitState('), end = source.indexOf('  static void GuardLimits(');
  assert.ok(begin > 0 && end > begin);
  const diagnostic = source.slice(begin, end);
  assert.doesNotMatch(diagnostic, /\b(?:Require|OpenProcess|GetProcessById|TerminateProcess|TerminateJobObject|ResumeThread|Image)\s*\(/,
    'diagnostics have no effect authority and cannot replace the primary phase');
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

test('failed association inventory retains bounded fixed-label diagnostics without changing refusal or cleanup', async () => {
  assertFailureInventoryDiagnostic(await fs.readFile(observerPath, 'utf8'));
});

for (const [name, mutate] of [
  ['incomplete inventory accepted', source => source.replace(inventoryRequirement, inventoryRequirement.replace('inventory.complete && ', ''))],
  ['effectful diagnostic', source => source.replace('const int capacity=256; int bytes=', 'TerminateProcess(child,125); const int capacity=256; int bytes=')],
  ['diagnostic native-qualification promotion', source => source.replace(String.raw`\"native_qualification_proven\":false`, String.raw`\"native_qualification_proven\":true`)],
]) test(`outer inventory source rejects ${name}`, async () => {
  const source = await fs.readFile(observerPath, 'utf8');
  assert.notEqual(mutate(source), source);
  assert.throws(() => assertFailureInventoryDiagnostic(mutate(source)), assert.AssertionError);
});

for (const [name, mutate] of [
  ['outer cleanup before observation', source => source.replace(outerCleanup, '').replace(forcedHelperKill, outerCleanup + ';\n' + forcedHelperKill)],
  ['numeric-PID process opening', source => source + '\nOpenProcess(0,false,childPid);'],
  ['unowned handle-transfer source', source => source.replace('DuplicateHandle(helper.process,', 'DuplicateHandle(new IntPtr(rawValue),')],
  ['missing parent correlation', source => source.replace(parentRequirement, '')],
  ['missing known kernel identity recheck', source => source.replace(knownIdentityRequirement, '')],
  ['OUTER success alone suppressing child fallback', source => source.replace('outerTerminationRequested && childOuterBound', 'outerTerminationRequested')],
  ['membership alone suppressing child fallback', source => source.replace('outerTerminationRequested && childOuterBound', 'childOuterBound')],
  ['membership flagged before native confirmation', source => source.replace(childOuterMembership, 'childOuterBound=true; ' + childOuterMembership.replace(' childOuterBound=true;', ''))],
  ['OUTER request flagged before checked success', source => source.replace(outerCleanup + '; outerTerminationRequested=true;', 'outerTerminationRequested=true; ' + outerCleanup + ';')],
  ['missing exact-child completion wait', source => source.replace(childCleanupWait, '')],
  ['control death accepted as survival', source => source.replace(controlWait, controlWait.replace('==0x102', '==0'))],
  ['missing eventual unassigned cleanup code', source => source.replace('if(control) Require(code==125,"unassigned_control_cleanup_code");', '')],
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

function buildBirthGatedHelper(source, {scenario, nonce, channel}) {
  assert.ok(['BOUND', 'UNASSIGNED_CONTROL'].includes(scenario), 'known native attribution scenario');
  assert.match(nonce, /^[a-f0-9]{64}$/);
  assert.equal(typeof channel, 'string');
  source = source.replace(/^\ufeff/, '');
  assert.equal(source.split(ownershipTransfer).length, 2, 'gate must follow exactly the successful owned native birth');
  assert.equal(source.split(innerJobAttribute).length, 2, 'control must target only the checked INNER Job-list association');
  if (scenario === 'UNASSIGNED_CONTROL') source = source.replace(innerJobAttribute, omittedInnerAssociation);
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
  return source.replace(ownershipTransfer, ownershipTransfer + gate);
}

function assertBirthEvidence(evidence, {scenario, nonce}) {
  assert.ok(evidence && typeof evidence === 'object' && !Array.isArray(evidence));
  assert.ok(['BOUND', 'UNASSIGNED_CONTROL'].includes(scenario));
  const control = scenario === 'UNASSIGNED_CONTROL';
  assert.equal(evidence.scenario, scenario); assert.equal(evidence.nonce, nonce);
  for (const field of ['child_image_verified', 'child_parent_verified', 'outer_membership_verified',
    'outer_inventory_complete', 'outer_known_helper_listed', 'outer_known_child_listed',
    'helper_exit_confirmed', 'child_exit_confirmed', 'outer_guard_open_during_observation',
    'outer_termination_after_observation', 'handles_closed']) assert.equal(evidence[field], true, field);
  assert.equal(evidence.auxiliary_authority_granted, false);
  assert.ok(Number.isSafeInteger(evidence.outer_listed_processes) && evidence.outer_listed_processes >= 2 && evidence.outer_listed_processes <= 256);
  assert.ok(Number.isSafeInteger(evidence.outer_auxiliary_entries) && evidence.outer_auxiliary_entries === evidence.outer_listed_processes - 2);
  assert.ok(Number.isSafeInteger(evidence.helper_pid) && evidence.helper_pid > 0 && evidence.helper_pid <= 0xffffffff);
  assert.ok(Number.isSafeInteger(evidence.child_pid) && evidence.child_pid > 0 && evidence.child_pid <= 0xffffffff && evidence.child_pid !== evidence.helper_pid);
  assert.match(evidence.helper_birth_100ns, /^[1-9][0-9]{16,18}$/);
  assert.match(evidence.child_birth_100ns, /^[1-9][0-9]{16,18}$/);
  assert.ok(BigInt(evidence.child_birth_100ns) >= BigInt(evidence.helper_birth_100ns));
  assert.equal(evidence.inner_cleanup_observed, !control);
  assert.equal(evidence.unassigned_control_survived, control);
  assert.equal(evidence.child_exit_before_outer_cleanup, !control);
  for (const key of ['child_code_before_outer_cleanup', 'child_exit_code']) {
    assert.ok(Number.isSafeInteger(evidence[key]) && evidence[key] >= 0 && evidence[key] <= 0xffffffff, key);
  }
  assert.notEqual(evidence.child_exit_code, 259, 'eventual exact-child cleanup is observed, not assumed');
  if (control) {
    assert.equal(evidence.child_code_before_outer_cleanup, 259, 'the unassigned child must remain active after helper death');
    assert.equal(evidence.child_exit_code, 125, 'only later owned cleanup may terminate the unassigned control');
  } else {
    assert.notEqual(evidence.child_code_before_outer_cleanup, 259);
    assert.equal(evidence.child_exit_code, evidence.child_code_before_outer_cleanup);
  }
}

// These are generated protocol/source controls, never native Windows evidence.
function protocolEvidence(scenario = 'BOUND', auxiliary = 1) {
  const control = scenario === 'UNASSIGNED_CONTROL';
  return {scenario, nonce: 'a'.repeat(64), helper_pid: 123, helper_birth_100ns: '133333333333333333',
    child_pid: 124, child_birth_100ns: '133333333333333334', child_image_verified: true, child_parent_verified: true,
    outer_membership_verified: true, outer_inventory_complete: true, outer_known_helper_listed: true, outer_known_child_listed: true,
    outer_listed_processes: 2 + auxiliary, outer_auxiliary_entries: auxiliary, auxiliary_authority_granted: false,
    inner_cleanup_observed: !control, unassigned_control_survived: control, child_exit_before_outer_cleanup: !control,
    helper_exit_confirmed: true, child_exit_confirmed: true, child_code_before_outer_cleanup: control ? 259 : 0,
    child_exit_code: control ? 125 : 0, outer_guard_open_during_observation: true,
    outer_termination_after_observation: true, handles_closed: true};
}

test('copied unassigned control omits only INNER association and preserves suspended no-window creation and the bounded pre-ready gate', async () => {
  const source = await fs.readFile(resolveCodexCliJobHelper(), 'utf8');
  const options = {nonce: 'a'.repeat(64), channel: path.resolve('generated-birth-channel.txt')};
  const bound = buildBirthGatedHelper(source, {...options, scenario: 'BOUND'});
  const control = buildBirthGatedHelper(source, {...options, scenario: 'UNASSIGNED_CONTROL'});
  assert.equal(control.replace(omittedInnerAssociation, innerJobAttribute), bound);
  assert.ok(bound.includes(innerJobAttribute)); assert.ok(!control.includes(innerJobAttribute));
  const nativeCreate = 'bool created=CreateProcess(exe,command,IntPtr.Zero,IntPtr.Zero,true,0x08000004|0x00080000,IntPtr.Zero,cwd,ref extended,out createdProcess);';
  for (const variant of [bound, control]) {
    assert.equal(variant.split(nativeCreate).length, 2);
    assert.equal(variant.split('System.Threading.Thread.Sleep(10000);').length, 2);
    assert.equal(variant.split('Require(false,"test_birth_gate_expired");').length, 2);
    assert.ok(variant.indexOf('File.WriteAllLines(') > variant.indexOf(ownershipTransfer));
    assert.ok(variant.indexOf('Require(false,"test_birth_gate_expired");') < variant.indexOf('bool inJob;'));
    assert.doesNotMatch(variant, /\bAssignProcessToJobObject\s*\(/);
  }
  for (const changed of [source.replace(innerJobAttribute, ''), source + '\n' + innerJobAttribute, source.replace(ownershipTransfer, '')]) {
    assert.throws(() => buildBirthGatedHelper(changed, {...options, scenario: 'UNASSIGNED_CONTROL'}), assert.AssertionError);
  }
  assert.throws(() => buildBirthGatedHelper(source, {...options, scenario: 'UNKNOWN'}), assert.AssertionError);
});

test('protocol attribution keeps opaque auxiliary inventory separate from the BOUND and UNASSIGNED_CONTROL outcomes', () => {
  for (const auxiliary of [0, 1, 254]) for (const scenario of ['BOUND', 'UNASSIGNED_CONTROL']) {
    const evidence = protocolEvidence(scenario, auxiliary); assertBirthEvidence(evidence, {scenario, nonce: evidence.nonce});
  }
});

for (const [name, scenario, mutate] of [
  ['incomplete or truncated inventory', 'BOUND', e => { e.outer_inventory_complete = false; }],
  ['missing helper identity', 'BOUND', e => { e.outer_known_helper_listed = false; }],
  ['missing child identity', 'BOUND', e => { e.outer_known_child_listed = false; }],
  ['authority granted by an auxiliary entry', 'BOUND', e => { e.auxiliary_authority_granted = true; }],
  ['inconsistent auxiliary count', 'BOUND', e => { e.outer_auxiliary_entries++; }],
  ['wrong scenario', 'BOUND', e => { e.scenario = 'UNASSIGNED_CONTROL'; }],
  ['unobserved inner cleanup', 'BOUND', e => { e.inner_cleanup_observed = false; }],
  ['unassigned child death called inner proof', 'UNASSIGNED_CONTROL', e => { e.inner_cleanup_observed = true; e.child_exit_before_outer_cleanup = true; e.child_code_before_outer_cleanup = 0; }],
  ['unassigned child failed to survive helper death', 'UNASSIGNED_CONTROL', e => { e.unassigned_control_survived = false; e.child_code_before_outer_cleanup = 0; }],
  ['unassigned cleanup not observed', 'UNASSIGNED_CONTROL', e => { e.child_exit_confirmed = false; e.child_exit_code = 259; }],
  ['wrong unassigned cleanup exit', 'UNASSIGNED_CONTROL', e => { e.child_exit_code = 0; }],
  ['early outer cleanup', 'BOUND', e => { e.outer_termination_after_observation = false; }],
]) test(`birth attribution protocol rejects ${name}`, () => {
  const evidence = protocolEvidence(scenario); mutate(evidence);
  assert.throws(() => assertBirthEvidence(evidence, {scenario, nonce: 'a'.repeat(64)}), assert.AssertionError);
});

// Each scenario gets its own unchanged 120s test and 90s observer bounds. Do not
// combine the two native launches under a silently widened shared test budget.
for (const scenario of ['BOUND', 'UNASSIGNED_CONTROL']) test(scenario === 'BOUND'
  ? 'real Windows inner Job kills the exact suspended birth-window child before ready, independently of the outer cleanup guard'
  : 'real Windows unassigned INNER control survives helper death until later exact owned cleanup', {
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
  const nonce = crypto.randomBytes(32).toString('hex');
  const channel = path.join(directory, `birth-${nonce}.txt`), canary = path.join(directory, 'must-not-run.txt');
  const helperPath = path.join(directory, 'birth-gated-helper.ps1');
  const helperSource = buildBirthGatedHelper(original.toString('utf8'), {scenario, nonce, channel});
  await fs.writeFile(helperPath, '\ufeff' + helperSource, 'utf8');
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
      birth_channel_path: channel, nonce, scenario, expected_child_path: process.execPath, expected_child_sha256: expectedSha});
    const completion = await observer.completion;
    assert.deepEqual(completion, {code: 0, signal: null, timedOut: false, overflow: false, spawnError: null, inputError: null},
      `bounded native observer failed: ${stdout}\n${stderr}`);
    const lines = stdout.trim().split(/\r?\n/); assert.equal(lines.length, 1);
    assertBirthEvidence(JSON.parse(lines[0]), {scenario, nonce});
    await assert.rejects(fs.stat(canary), {code: 'ENOENT'});
  });
  assert.equal(sha(await fs.readFile(resolveCodexCliJobHelper())), sha(original), 'production helper must remain untouched by fault injection');
});
