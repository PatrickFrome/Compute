import test from 'node:test';
import assert from 'node:assert/strict';
import childProcess, {spawn} from 'node:child_process';
import {EventEmitter} from 'node:events';
import {syncBuiltinESMExports} from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import {PassThrough} from 'node:stream';
import {createHash} from 'node:crypto';
import os from 'node:os';
import {createCodexCliWindowsProcessController, resolveCodexCliJobHelperSource} from '../src/codex-cli-windows-process-controller.mjs';
import {CODEX_STARTUP_STAGES, createCodexCliStartupPhaseParser, instrumentCodexCliHelperStartup, instrumentCodexCliRuntimeStartup,
  withCodexCliStartupObservation} from './fixtures/codex-cli-startup-observation.mjs';
import {CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX, CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX} from '../scripts/prepare-codex-cli-job-runtime.mjs';

// Portable source/parser/protocol doubles only: no Windows startup phase, native
// compilation, Job Object or physical cleanup is qualified by these tests.
const prefix = 'ME_CODEX_STARTUP_V1 ';
const helperPath = path.resolve('owned-helper.ps1'), powershellPath = path.resolve('fixed-powershell.exe');
const args = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath];
const options = {cwd: path.resolve('owned-directory'), env: {PRIVATE_TOKEN: 'must-not-be-exported'}, stdio: ['pipe', 'pipe', 'pipe']};
function processDouble() {
  const child = new EventEmitter();
  child.stdin = new PassThrough(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  child.kills = 0; child.kill = () => { child.kills++; return true; };
  return child;
}
function fixture(t, children = [processDouble()]) {
  const original = childProcess.spawn, calls = [];
  const delegate = (...call) => { calls.push(call); return children[calls.length - 1]; };
  childProcess.spawn = delegate; syncBuiltinESMExports();
  t.after(() => { childProcess.spawn = original; syncBuiltinESMExports(); });
  return {children, calls, delegate};
}
const immediate = () => new Promise(resolve => setImmediate(resolve));

// Mutation refuses missing/duplicate anchors instead of running a partial or
// misleading trace. All injected bytes are fixed nonsecret diagnostic literals.
test('startup instrumentation has exact source anchors and never changes the production helper bytes', async () => {
  const original = await fs.readFile(resolveCodexCliJobHelperSource());
  const source = original.toString('utf8').replace(/\r\n/g, '\n');
  const traced = instrumentCodexCliHelperStartup(source);
  assert.notEqual(traced, source);
  const crlf = instrumentCodexCliHelperStartup(source.replaceAll('\n', '\r\n'));
  assert.equal(crlf.replaceAll('\r\n', '\n'), traced);
  assert.ok(!crlf.replaceAll('\r\n', '').includes('\n'), 'injected labels retain the disposable helper newline form');
  for (const stage of CODEX_STARTUP_STAGES.filter(stage => !stage.startsWith('ASSEMBLY_LOAD_') && !stage.startsWith('MODULE_IMPORT_')
    && !['REQUEST_LINE_READ', 'REQUEST_JSON_BEGIN', 'REQUEST_JSON_END'].includes(stage))) assert.equal(traced.split(prefix + stage).length, 2, stage);
  assert.ok(traced.indexOf(prefix + 'PS_ENTER') < traced.indexOf("$ErrorActionPreference = 'Stop'"));
  assert.doesNotMatch(traced, /ME_CODEX_STARTUP_V1 (?:ADD_TYPE|ASSEMBLY_LOAD)_/);
  const request = traced.indexOf('$line = [Console]::In.ReadLine()');
  assert.ok(traced.indexOf(prefix + 'REQUEST_READ_BEGIN') < request);
  assert.ok(request < traced.indexOf(prefix + 'REQUEST_READ_END'));
  let previous = -1;
  for (const stage of CODEX_STARTUP_STAGES.slice(CODEX_STARTUP_STAGES.indexOf('NATIVE_RUN_ENTER'))) {
    const at = traced.indexOf(prefix + stage); assert.ok(at > previous); previous = at;
  }
  assert.ok(traced.indexOf('Console.Error.WriteLine("' + prefix + 'READY_FLUSH_RETURNED') > traced.indexOf(String.raw`      Emit("{\"type\":\"ready\",`));
  assert.deepEqual(await fs.readFile(resolveCodexCliJobHelperSource()), original);
  for (const changed of [source.replace('Add-Type -TypeDefinition', 'Removed-Type -TypeDefinition'),
    source + "\n$ErrorActionPreference = 'Stop'", traced]) {
    assert.throws(() => instrumentCodexCliHelperStartup(changed), {message: 'native_startup_observation_source_anchor_invalid'});
  }
});

test('prepared-helper instrumentation reuses the assembly and separates explicit import, input wait and JSON parsing without exporting input', async () => {
  const loader = CODEX_CLI_JOB_ASSEMBLY_LOAD_PREFIX + 'c3ludGhldGljLWJ5dGVz' + CODEX_CLI_JOB_ASSEMBLY_LOAD_SUFFIX;
  const moduleImport = String.raw`  Microsoft.PowerShell.Core\Import-Module -Name 'C:\Windows\System32\WindowsPowerShell\v1.0\Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1' -ErrorAction Stop`;
  const request='  $line = [Console]::In.ReadLine()';
  const envelope='  $envelope = $line | ConvertFrom-Json';
  const bodyParse='  $request = ([Text.UTF8Encoding]::new($false,$true)).GetString($bytes) | ConvertFrom-Json';
  const original=(await fs.readFile(resolveCodexCliJobHelperSource(),'utf8')).replace(/\r\n/g,'\n').split("\n'@\n")[1];
  assert.ok(original);
  for (const eol of ['\n', '\r\n']) {
    const source = ['# generated assembly bytes; actual original v2 transport statements', loader, original].join('\n').replaceAll('\n',eol);
    const traced = instrumentCodexCliRuntimeStartup(source);
    assert.ok(traced.indexOf(prefix + 'ASSEMBLY_LOAD_BEGIN') < traced.indexOf(loader));
    assert.ok(traced.indexOf(prefix + 'ASSEMBLY_LOAD_END') > traced.indexOf(loader));
    assert.equal(traced.split(loader).length, 2);
    const importBegin = traced.indexOf(prefix + 'MODULE_IMPORT_BEGIN'), importEnd = traced.indexOf(prefix + 'MODULE_IMPORT_END');
    assert.ok(traced.indexOf(prefix + 'ASSEMBLY_LOAD_END') < importBegin && importBegin < traced.indexOf(moduleImport)
      && traced.indexOf(moduleImport) < importEnd);
    assert.equal(traced.split(moduleImport).length, 2, 'the same fixed module import executes once');
    const lineRead = traced.indexOf(request);
    const lineReadMarker = traced.indexOf(prefix + 'REQUEST_LINE_READ');
    const jsonBegin = traced.indexOf(prefix + 'REQUEST_JSON_BEGIN');
    const parse = traced.indexOf(envelope), body = traced.indexOf(bodyParse);
    const jsonEnd = traced.indexOf(prefix + 'REQUEST_JSON_END');
    assert.ok(importEnd < lineRead && lineRead < lineReadMarker && lineReadMarker < jsonBegin && jsonBegin < parse && parse < body && body < jsonEnd);
    assert.equal(traced.split('[Console]::In.ReadLine()').length, 2, 'input is read once');
    assert.equal(traced.split('ConvertFrom-Json').length, 3, 'the exact envelope and body parsers each remain once');
    for (const line of traced.split(eol).filter(line => line.includes('[Console]::Error.WriteLine')))
      assert.doesNotMatch(line, /\$(?:request|line|bytes|envelope)/);
    if (eol === '\r\n') assert.ok(!traced.replaceAll('\r\n', '').includes('\n'));
    for (const bad of [traced, source + eol + loader, source.replace(loader, ''), source + "\nAdd-Type -TypeDefinition @'",
      source.replace(moduleImport, ''), source + eol + moduleImport,
      source.replace(request, ''), source + eol + request, source.replace(envelope,''), source+eol+bodyParse])
      assert.throws(() => instrumentCodexCliRuntimeStartup(bad), /source_anchor_invalid/);
  }
});

test('startup parser accepts split ASCII/CRLF markers and exports only allowlisted stages and receipt times', () => {
  let clock = 100;
  const parser = createCodexCliStartupPhaseParser({now: () => clock, startedAt: 100});
  parser.write(Buffer.from('private compiler error with prompt/env/path\nME_CODEX_START'));
  clock = 107; parser.write(Buffer.from('UP_V1 PS_ENTER\r\n'));
  clock = 113; parser.write(Buffer.from(prefix + 'ASSEMBLY_LOAD_BEGIN\n'));
  clock = 114; parser.write(Buffer.from(prefix + 'MODULE_IMPORT_BEGIN\n'));
  clock = 118; parser.write(Buffer.from(prefix + 'MODULE_IMPORT_END\n'));
  clock = 120; parser.write(Buffer.from(prefix + 'REQUEST_READ_BEGIN\n'));
  clock = 123; parser.write(Buffer.from(prefix + 'REQUEST_LINE_READ\n'));
  clock = 124; parser.write(Buffer.from(prefix + 'REQUEST_JSON_BEGIN\n'));
  clock = 150; parser.write(Buffer.from(prefix + 'REQUEST_JSON_END\n'));
  const record = parser.snapshot();
  assert.deepEqual(record.stages, [{stage: 'PS_ENTER', elapsed_ms: 7}, {stage: 'ASSEMBLY_LOAD_BEGIN', elapsed_ms: 13},
    {stage: 'MODULE_IMPORT_BEGIN', elapsed_ms: 14}, {stage: 'MODULE_IMPORT_END', elapsed_ms: 18},
    {stage: 'REQUEST_READ_BEGIN', elapsed_ms: 20}, {stage: 'REQUEST_LINE_READ', elapsed_ms: 23},
    {stage: 'REQUEST_JSON_BEGIN', elapsed_ms: 24}, {stage: 'REQUEST_JSON_END', elapsed_ms: 50}]);
  assert.ok(record.unknown_stderr_bytes > 0);
  assert.equal(record.phase_stream_invalid, false); assert.equal(record.phase_stream_overflow, false);
  assert.doesNotMatch(JSON.stringify(record), /private|compiler|prompt|env|path|ME_CODEX_START/);
  record.stages[0].stage = 'MUTATED'; assert.equal(parser.snapshot().stages[0].stage, 'PS_ENTER');
});

test('startup parser rejects duplicate/out-of-order/unrecognized stage labels without printing them', () => {
  const parser = createCodexCliStartupPhaseParser({now: () => 0});
  for (const stage of ['ASSEMBLY_LOAD_BEGIN', 'PS_ENTER', 'ASSEMBLY_LOAD_BEGIN', 'private-unrecognized-label']) parser.write(prefix + stage + '\n');
  const record = parser.snapshot();
  assert.equal(record.phase_stream_invalid, true);
  assert.deepEqual(record.stages, [{stage: 'ASSEMBLY_LOAD_BEGIN', elapsed_ms: 0}]);
  assert.doesNotMatch(JSON.stringify(record), /private-unrecognized|PS_ENTER/);
});

test('startup parser bounds unterminated and excessive stderr and never emits raw text', () => {
  const parser = createCodexCliStartupPhaseParser({now: () => 0});
  parser.write('private'.repeat(10000)); parser.write('\n' + prefix + 'PS_ENTER\n');
  const record = parser.snapshot();
  assert.equal(record.phase_stream_overflow, true); assert.equal(record.stages.length, 0);
  assert.ok(record.unknown_stderr_bytes <= 65537);
  assert.doesNotMatch(JSON.stringify(record), /private/);
  assert.ok(JSON.stringify(record).length < 256);
});

test('owned startup observer preserves spawn argument identities/return handle and reports only after close', async t => {
  const owned = processDouble(), unrelated = processDouble(), f = fixture(t, [owned, unrelated]);
  const reports = []; let clock = 100, settled = false;
  const returned = {unchanged: true};
  const observed = withCodexCliStartupObservation({helperPath, powershellPath, now: () => clock, report: record => reports.push(record)}, async ({readyValidated}) => {
    assert.equal(spawn(powershellPath, args, options), owned);
    assert.equal(spawn('unrelated-executable', ['private unrelated args'], options), unrelated);
    clock = 103; owned.emit('spawn');
    clock = 108; owned.stderr.write(prefix + 'PS_ENTER\n');
    owned.stderr.write('private compiler error\n');
    clock = 112; readyValidated();
    return returned;
  });
  observed.then(() => { settled = true; });
  await immediate(); assert.equal(settled, false); assert.equal(reports.length, 0);
  assert.equal(owned.kills, 0); assert.equal(unrelated.kills, 0);
  assert.equal(unrelated.listenerCount('close'), 0); assert.equal(unrelated.stderr.listenerCount('data'), 0);
  assert.equal(f.calls[0][1], args); assert.equal(f.calls[0][2], options);
  clock = 125; owned.emit('close', 0, null);
  assert.equal(await observed, returned); assert.equal(childProcess.spawn, f.delegate); assert.equal(spawn, f.delegate);
  const record = reports[0]; assert.equal(reports.length, 1);
  assert.equal(record.startup_deadline_ms, 30000); assert.equal(record.helper_spawns_observed, 1);
  assert.equal(record.spawn_event_elapsed_ms, 3); assert.equal(record.ready_validated_elapsed_ms, 12); assert.equal(record.close_elapsed_ms, 25);
  assert.equal(record.body_failed, false); assert.equal(record.contention_proven, false); assert.equal(record.native_qualification_proven, false);
  assert.doesNotMatch(JSON.stringify(record), /private|must-not-be-exported|owned-helper|fixed-powershell|PRIVATE_TOKEN/);
});

test('owned startup observer awaits close, restores imports and preserves the exact primary error even if reporting throws', async t => {
  const f = fixture(t), child = f.children[0], primary = Error('private primary error');
  let settled = false, reportCalled = false;
  const observed = withCodexCliStartupObservation({helperPath, powershellPath, report: record => {
    reportCalled = true; assert.equal(record.body_failed, true); throw Error('private report error');
  }}, async () => { spawn(powershellPath, args, options); throw primary; });
  observed.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(observed, error => error === primary);
  await immediate(); assert.equal(settled, false); assert.equal(reportCalled, false); assert.notEqual(childProcess.spawn, f.delegate);
  assert.equal(child.kills, 0); child.emit('close', null, 'SIGTERM'); await rejected;
  assert.equal(reportCalled, true); assert.equal(childProcess.spawn, f.delegate); assert.equal(spawn, f.delegate);
});

test('overlapping startup observation scopes refuse before mutation and cannot restore a stale spawn binding', async t => {
  const f = fixture(t), child = f.children[0], reports = [];
  const active = withCodexCliStartupObservation({helperPath, powershellPath, report: record => reports.push(record)}, async () => {
    spawn(powershellPath, args, options);
  });
  const activeBinding = childProcess.spawn; let entered = false;
  await assert.rejects(withCodexCliStartupObservation({helperPath: 'another-helper', powershellPath, report() { assert.fail('overlap cannot report'); }}, async () => {
    entered = true;
  }), {message: 'native_startup_observation_scope_already_active'});
  assert.equal(entered, false); assert.equal(childProcess.spawn, activeBinding); assert.equal(spawn, activeBinding);
  assert.equal(f.calls.length, 1); assert.equal(reports.length, 0);
  child.emit('close', 0); await active;
  assert.equal(childProcess.spawn, f.delegate); assert.equal(spawn, f.delegate); assert.equal(reports.length, 1);
});

test('an observer report failure cannot produce a successful physical qualification or export private report text', async t => {
  const f = fixture(t);
  await assert.rejects(withCodexCliStartupObservation({helperPath, powershellPath, report() { throw Error('private report text'); }}, async () => {
    spawn(powershellPath, args, options); f.children[0].emit('close', 0);
  }), {message: 'native_startup_observation_report_failed'});
  assert.equal(childProcess.spawn, f.delegate);
});

test('observing the real controller preserves its unchanged default30s startup timeout and fixed failure', async t => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-startup-protocol-'));
  t.after(() => fs.rm(directory, {recursive: true, force: true}));
  const helperPath = path.join(directory, 'owned-helper.ps1'), helperBytes = 'protocol double, never executed';
  await fs.writeFile(helperPath, helperBytes);
  const expectedHelperSha256 = createHash('sha256').update(helperBytes).digest('hex');
  const f = fixture(t), child = f.children[0];
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  Object.defineProperty(process, 'platform', {...platform, value: 'win32'});
  t.after(() => Object.defineProperty(process, 'platform', platform));
  t.mock.timers.enable({apis: ['setTimeout']});
  const reports = [];
  const observed = withCodexCliStartupObservation({helperPath, powershellPath, report: record => reports.push(record)}, async () => {
    const controller = createCodexCliWindowsProcessController({helperPath, powershellPath, expectedHelperSha256});
    await controller.spawn({executablePath: path.resolve('inert-worker.exe'), cwd: options.cwd, args: [],
      expectedExecutableSha256: 'a'.repeat(64), runId: '11111111-1111-4111-8111-111111111111', env: options.env, timeoutMs: 15000});
  });
  const rejected = assert.rejects(observed, {message: 'codex_cli_process_CONTROLLER_STARTUP_TIMEOUT'});
  t.mock.timers.tick(29999); assert.equal(child.kills, 0);
  t.mock.timers.tick(1); assert.equal(child.kills, 1); assert.equal(reports.length, 0);
  child.emit('close', null, 'SIGTERM'); await rejected;
  assert.equal(reports[0].body_failed, true); assert.equal(reports[0].ready_validated_elapsed_ms, null);
  assert.equal(childProcess.spawn, f.delegate); assert.equal(f.calls[0][2].env, options.env);
});
