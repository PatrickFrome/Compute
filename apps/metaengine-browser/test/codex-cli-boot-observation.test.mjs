import test, {beforeEach} from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readWindowsSandboxHostBoot, windowsSandboxBootIdentity} from '../src/codex-cli-sandbox-probe.mjs';
import {CODEX_BOOT_READ_STAGES, instrumentWindowsBootReadScript, createWindowsBootReadPhaseParser,
  readWindowsBootWithPhaseObservation} from './fixtures/codex-cli-boot-observation.mjs';

// Generated transport/parser controls only. These do not qualify Windows,
// Add-Type compilation, kernel identity or the physical 12s startup budget.
const contextKeys = new Set(['TEMP', 'TMP', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA']);
const windowsContext = Object.freeze({TEMP: 'C:\\Fixture\\Temp', TMP: 'C:\\Fixture\\Temp',
  USERPROFILE: 'C:\\Fixture', APPDATA: 'C:\\Fixture\\AppData\\Roaming',
  LOCALAPPDATA: 'C:\\Fixture\\AppData\\Local'});
// These fake Win32 transports must not inherit a Linux CI profile. Keep the
// production environment validator intact and restore the enclosing process.
beforeEach(t => {
  const previous = Object.fromEntries(Object.entries(process.env).filter(([key]) => contextKeys.has(key.toUpperCase())));
  const clear = () => { for (const key of Object.keys(process.env)) if (contextKeys.has(key.toUpperCase())) delete process.env[key]; };
  clear(); Object.assign(process.env, windowsContext);
  t.after(() => { clear(); Object.assign(process.env, previous); });
});
const prefix = 'ME_CODEX_BOOT_READ_V1 ';
const boot = () => ({schema: 'metaengine.windows.kernel-boot.v1', kernel_boot_id: 29,
  system_process: {pid: 4, created_at: '2026-10-22T03:00:00.000Z',
    created_100ns: String(BigInt(Date.parse('2026-10-22T03:00:00.000Z')) * 10000n + 116444736000000000n)},
  last_boot_at: '2026-10-22T02:59:56.000Z', os_version: '10.0.19045'});
const immediate = () => new Promise(resolve => setImmediate(resolve));

async function originalCall() {
  let call;
  await readWindowsSandboxHostBoot({platform: 'win32', exec(...args) {
    call = args; return Promise.resolve({stdout: JSON.stringify(boot())});
  }});
  return call;
}

function fixture() {
  const child = new EventEmitter(); child.stdin = new PassThrough(); child.stderr = new PassThrough();
  let resolve, reject;
  const pending = new Promise((yes, no) => { resolve = yes; reject = no; });
  pending.child = child;
  const calls = [], reports = [];
  return {child, calls, reports, resolve, reject,
    execute(...args) { calls.push(args); return pending; }, report: record => reports.push(record)};
}

test('boot phase markers bind exact native reads and reject drift instead of emitting a partial trace', async () => {
  const [, args] = await originalCall();
  const source = Buffer.from(args[4], 'base64').toString('utf16le');
  const marked = instrumentWindowsBootReadScript(source);
  for (const stage of CODEX_BOOT_READ_STAGES) assert.equal(marked.split(prefix + stage).length, 2, stage);
  let prior = -1;
  for (const stage of CODEX_BOOT_READ_STAGES) {
    const at = marked.indexOf(prefix + stage); assert.ok(at > prior, stage); prior = at;
  }
  assert.ok(marked.indexOf(prefix + 'ADD_TYPE_BEGIN') < marked.indexOf('Add-Type -TypeDefinition $source'));
  assert.ok(marked.indexOf('Add-Type -TypeDefinition $source') < marked.indexOf(prefix + 'ADD_TYPE_END'));
  assert.ok(marked.indexOf(prefix + 'RECHECK_END') > marked.indexOf("throw 'kernel_boot_changed'"));
  assert.ok(marked.indexOf(prefix + 'JSON_WRITE_END') > marked.indexOf('ConvertTo-Json -Depth 4 -Compress'));
  const crlf = instrumentWindowsBootReadScript(source.replaceAll('\n', '\r\n'));
  assert.equal(crlf.replaceAll('\r\n', '\n'), marked);
  assert.ok(!crlf.replaceAll('\r\n', '').includes('\n'));
  for (const changed of [marked, source.replace('Add-Type -TypeDefinition', 'Missing-Type -TypeDefinition'),
    source + "\n$again=Get-CimInstance Win32_Process -Filter 'ProcessId=4'"]) {
    assert.throws(() => instrumentWindowsBootReadScript(changed), {message: 'native_boot_observation_source_anchor_invalid'});
  }
});

test('boot observer preserves the production 12s transport options, stdin ownership and validated native result', async () => {
  const expected = await originalCall(), f = fixture();
  let clock = 100, settled = false;
  const observed = readWindowsBootWithPhaseObservation({...f, platform: 'win32', now: () => clock});
  observed.then(() => { settled = true; });
  assert.equal(f.calls.length, 1); assert.equal(f.child.stdin.writableEnded, true);
  assert.equal(f.calls[0][0], expected[0]); assert.deepEqual(f.calls[0][2], expected[2]);
  assert.equal(f.calls[0][2].timeout, 12000); assert.equal(f.calls[0][2].shell, false);
  assert.deepEqual(f.calls[0][1].slice(0, 4), expected[1].slice(0, 4));
  assert.notEqual(f.calls[0][1][4], expected[1][4]);
  clock = 103; f.child.emit('spawn');
  clock = 110; f.child.stderr.write(prefix + 'SCRIPT_ENTER\n');
  f.child.stderr.write('private compiler path, command, credential\n');
  clock = 120; f.child.stderr.write(prefix + 'ADD_TYPE_BEGIN\n');
  f.resolve({stdout: JSON.stringify(boot())});
  await immediate(); assert.equal(settled, false); assert.equal(f.reports.length, 0);
  clock = 125; f.child.emit('close', 0, null);
  const result = await observed; assert.deepEqual(result, boot());
  assert.equal(windowsSandboxBootIdentity(result), windowsSandboxBootIdentity(boot()));
  assert.equal(f.reports.length, 1); const report = f.reports[0];
  assert.equal(report.spawn_event_elapsed_ms, 3); assert.equal(report.close_elapsed_ms, 25);
  assert.equal(report.outcome, 'READ_RETURNED'); assert.equal(report.owned_transport_closed, true);
  assert.equal(report.causal_attribution_proven, false); assert.equal(report.native_qualification_proven, false);
  assert.deepEqual(report.stages, [{stage: 'SCRIPT_ENTER', elapsed_ms: 10}, {stage: 'ADD_TYPE_BEGIN', elapsed_ms: 20}]);
  assert.ok(report.unknown_stderr_bytes > 0);
  assert.doesNotMatch(JSON.stringify(report), /private|compiler path|credential|SystemRoot|PowerShell|PSModulePath/);
});

test('a timed-out boot read keeps its original failure, waits for close and never retries or reports a replacement success', async () => {
  const f = fixture(), failure = Object.assign(Error('original bounded read failed'), {code: 'ETIMEDOUT'});
  let settled = false;
  const observed = readWindowsBootWithPhaseObservation({...f, platform: 'win32', report(record) {
    f.reports.push(record); throw Error('private reporting error');
  }});
  observed.then(() => { settled = true; }, () => { settled = true; });
  const rejected = assert.rejects(observed, error => error === failure);
  f.child.stderr.write(prefix + 'SCRIPT_ENTER\n' + prefix + 'ADD_TYPE_BEGIN\n');
  f.reject(failure); await immediate();
  assert.equal(settled, false); assert.equal(f.reports.length, 0); assert.equal(f.calls.length, 1);
  f.child.emit('close', null, 'SIGTERM'); await rejected;
  assert.equal(f.calls.length, 1); assert.equal(f.reports[0].outcome, 'READ_FAILED');
  assert.equal(f.reports[0].production_timeout_ms, 12000);
  assert.equal(f.reports[0].stages.at(-1).stage, 'ADD_TYPE_BEGIN');
  assert.equal(f.reports[0].native_qualification_proven, false);
});

test('complete diagnostic stages cannot validate a malformed native boot result', async () => {
  const f = fixture();
  const observed = readWindowsBootWithPhaseObservation({...f, platform: 'win32'});
  const rejected = assert.rejects(observed, /codex_sandbox_host_boot_unverified/);
  for (const stage of CODEX_BOOT_READ_STAGES) f.child.stderr.write(prefix + stage + '\n');
  f.resolve({stdout: JSON.stringify({...boot(), kernel_boot_id: 0})}); f.child.emit('close', 0, null);
  await rejected;
  assert.equal(f.reports[0].outcome, 'READ_FAILED');
  assert.equal(f.reports[0].native_qualification_proven, false);
});

test('boot parser exposes only ordered allowlisted phases and bounded unknown byte counts', () => {
  const parser = createWindowsBootReadPhaseParser({now: () => 0});
  parser.write(prefix.slice(0, 8)); parser.write(prefix.slice(8) + 'SCRIPT_ENTER\r\n');
  parser.write(prefix + 'ADD_TYPE_BEGIN\n' + prefix + 'SCRIPT_ENTER\n' + prefix + 'private-unrecognized-stage\n');
  parser.write('private'.repeat(10000));
  const result = parser.snapshot();
  assert.deepEqual(result.stages, [{stage: 'SCRIPT_ENTER', elapsed_ms: 0}, {stage: 'ADD_TYPE_BEGIN', elapsed_ms: 0}]);
  assert.equal(result.phase_stream_invalid, true); assert.equal(result.phase_stream_overflow, true);
  assert.ok(result.unknown_stderr_bytes <= 65537); assert.ok(JSON.stringify(result).length < 512);
  assert.doesNotMatch(JSON.stringify(result), /private/);
});
