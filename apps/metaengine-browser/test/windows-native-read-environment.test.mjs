import test from 'node:test';
import assert from 'node:assert/strict';
import {fixedWindowsNativeReadEnvironment} from '../src/windows-native-read-environment.mjs';
import {readWindowsSandboxHostBoot} from '../src/codex-cli-sandbox-probe.mjs';
import {readNativeCodingWindowsProcess} from '../src/native-coding-host-observers.mjs';

// Pure environment/reader doubles only. No Windows startup, native identity,
// filesystem, ACL or timing outcome is established by these fixture responses.
const context = {TEMP: 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp', TMP: 'D:\\Local Temp',
  USERPROFILE: "C:\\Users\\O'Connor", APPDATA: "C:\\Users\\O'Connor\\AppData\\Roaming",
  LOCALAPPDATA: "C:\\Users\\O'Connor\\AppData\\Local"};
const hostile = {PATH: 'D:\\untrusted-bin', PSModulePath: 'D:\\untrusted-modules', COMSPEC: 'D:\\evil.exe',
  PATHEXT: '.EVIL', NODE_OPTIONS: '--require private-token', OPENAI_API_KEY: 'private-token',
  DATABASE_URL: 'private-database', PGPASSWORD: 'private-password', HTTP_PROXY: 'private-proxy',
  HTTPS_PROXY: 'private-proxy', ALL_PROXY: 'private-proxy', NPM_CONFIG_REGISTRY: 'private-mirror',
  PSExecutionPolicyPreference: 'Bypass', METAENGINE_NATIVE_CODING_PID: '999'};
const executable = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const expectedEnvironment = {...context, SystemRoot: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows', WINDIR: 'C:\\Windows',
  PATH: 'C:\\Windows\\System32', PSModulePath: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\Modules'};
function controlledEnvironment(t, changes = {}) {
  const relevant = new Set([...Object.keys(context), ...Object.keys(hostile), 'SystemRoot', 'SYSTEMROOT', 'WINDIR'].map(key => key.toUpperCase()));
  const before = Object.fromEntries(Object.entries(process.env).filter(([key]) => relevant.has(key.toUpperCase())));
  for (const key of Object.keys(process.env)) if (relevant.has(key.toUpperCase())) delete process.env[key];
  Object.assign(process.env, context, hostile, {SystemRoot: 'C:\\Windows', SYSTEMROOT: 'C:\\Windows'}, changes);
  t.after(() => {
    for (const key of Object.keys(process.env)) if (relevant.has(key.toUpperCase())) delete process.env[key];
    Object.assign(process.env, before);
  });
}
const createdAt = '2026-10-22T04:00:00.000Z';
const birth = String(BigInt(Date.parse(createdAt)) * 10000n + 116444736000000000n);
const boot = () => ({schema: 'metaengine.windows.kernel-boot.v1', kernel_boot_id: 29,
  system_process: {pid: 4, created_at: createdAt, created_100ns: birth}, last_boot_at: createdAt, os_version: '10.0.19045'});
const nativeProcess = () => ({pid: 123, created_at: createdAt, birth_100ns: birth,
  exe_b64: Buffer.from('C:\\fixed\\worker.exe').toString('base64'), user_sid: 'S-1-5-21-111-1001'});

function assertInvocation(call, timeout, maxBuffer, environment) {
  assert.equal(call.exe.replaceAll('/', '\\'), executable);
  assert.deepEqual(call.args.slice(0, 4), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand']);
  assert.equal(call.args.length, 5);
  assert.equal(call.options.shell, false); assert.equal(call.options.windowsHide, true);
  assert.equal(call.options.timeout, timeout); assert.equal(call.options.maxBuffer, maxBuffer);
  assert.deepEqual(call.options.env, environment);
  return Buffer.from(call.args[4], 'base64').toString('utf16le');
}

test('fixed native read context restores only validated profile/temp data and pins executable/module discovery', () => {
  const source = {...context, ...hostile, SystemRoot: 'Z:\\untrusted-root', WINDIR: 'Z:\\untrusted-root'};
  const before = {...source};
  const environment = fixedWindowsNativeReadEnvironment(source);
  assert.deepEqual(environment, expectedEnvironment); assert.ok(Object.isFrozen(environment));
  assert.deepEqual(source, before);
  assert.doesNotMatch(JSON.stringify(environment), /private-token|private-database|private-password|private-proxy|private-mirror|untrusted/);
  assert.equal(environment.TEMP, context.TEMP, '8.3 context is not promoted into canonical path authority');
});

test('unapproved environment values are never read, including executable/module overrides and credentials', () => {
  const source = {...context};
  for (const key of [...Object.keys(hostile), 'SystemRoot', 'WINDIR', 'UNKNOWN_ENVIRONMENT_VALUE']) {
    Object.defineProperty(source, key, {enumerable: true, get() { throw Error('unapproved_environment_value_was_read'); }});
  }
  assert.deepEqual(fixedWindowsNativeReadEnvironment(source), expectedEnvironment);
});

test('missing context has fixed OS fallbacks; key casing and ordinary local separators cannot inject duplicate variables', () => {
  const missing = fixedWindowsNativeReadEnvironment({});
  assert.equal(missing.TEMP, 'C:\\Windows\\Temp'); assert.equal(missing.TMP, 'C:\\Windows\\Temp');
  assert.equal(missing.USERPROFILE, 'C:\\Windows'); assert.equal(missing.APPDATA, undefined); assert.equal(missing.LOCALAPPDATA, undefined);
  const environment = fixedWindowsNativeReadEnvironment({temp: 'D:/Local Temp/', userprofile: 'C:/Users/Example', appdata: 'C:/Users/Example/AppData/Roaming'});
  assert.equal(environment.TEMP, 'D:\\Local Temp\\'); assert.equal(environment.USERPROFILE, 'C:\\Users\\Example');
  assert.equal(environment.APPDATA, 'C:\\Users\\Example\\AppData\\Roaming');
  assert.equal(environment.temp, undefined); assert.equal(environment.userprofile, undefined);
  for (const key of Object.keys(context)) {
    assert.throws(() => fixedWindowsNativeReadEnvironment({[key]: 'C:\\one', [key.toLowerCase()]: 'D:\\two'}), {message: 'windows_native_read_environment_context_invalid'});
    assert.equal(fixedWindowsNativeReadEnvironment({[key]: context[key], [key.toLowerCase()]: context[key]})[key], context[key]);
  }
});

test('each inherited context field rejects nonlocal/ambiguous/control/ADS/device/oversized values without leaking them', () => {
  const invalid = ['', undefined, null, 7, 'relative', 'C:drive-relative', '\\root-relative', '/root-relative',
    '\\\\server\\share', '//server/share', '\\\\?\\C:\\device', '\\\\.\\C:\\device', 'C:\\safe\nprivate-token',
    'C:\\safe\u0000private-token', 'C:\\safe\u007fprivate-token', 'C:\\safe:stream', 'C:\\wild*card', 'C:\\wild?card',
    'C:\\quote"private-token', 'C:\\parent\\..\\private-token', 'C:\\dot\\.\\private-token', 'C:\\trailing.\\child', 'C:\\trailing \\child', 'C:\\' + 'x'.repeat(2048)];
  for (const key of Object.keys(context)) for (const value of invalid) {
    assert.throws(() => fixedWindowsNativeReadEnvironment({[key]: value}),
      error => error.message === 'windows_native_read_environment_context_invalid' && !error.message.includes('private-token'));
  }
});

test('context rejects DOS device components/extensions and documented console aliases while retaining ordinary Unicode/spaces', () => {
  const devices = ['NUL', 'CON', 'AUX', 'PRN',
    ...Array.from({length: 9}, (_, i) => 'COM' + (i + 1)), ...Array.from({length: 9}, (_, i) => 'LPT' + (i + 1)),
    ...['¹', '²', '³'].flatMap(digit => ['COM' + digit, 'LPT' + digit])];
  for (const component of [...devices, 'CONIN$', 'CONOUT$']) {
    const invalidPaths = ['C:\\' + component, 'C:\\dir\\' + component + '\\child', 'C:/dir/' + component.toLowerCase()];
    if (devices.includes(component)) invalidPaths.push('C:\\dir\\' + component + '.txt', 'C:\\dir\\' + component + '.tar.gz', 'C:\\dir\\' + component + ' .txt');
    for (const key of Object.keys(context)) for (const value of invalidPaths) {
      assert.throws(() => fixedWindowsNativeReadEnvironment({[key]: value}), {message: 'windows_native_read_environment_context_invalid'});
    }
  }
  for (const component of ["Zoë 李 O'Connor", 'CON notes', 'AUXiliary', 'COM10', 'LPT10', 'COM四', 'RUNNER~1', 'Console', '.profile']) {
    const value = 'C:\\Users\\' + component;
    assert.equal(fixedWindowsNativeReadEnvironment({USERPROFILE: value}).USERPROFILE, value);
  }
});

test('boot reader emits a fixed in-memory native binding without a C# compiler and retains the12s read budget', async t => {
  controlledEnvironment(t); let call;
  const value = await readWindowsSandboxHostBoot({platform: 'win32', exec: async (exe, args, options) => {
    call = {exe, args, options}; return {stdout: JSON.stringify(boot())};
  }});
  const script = assertInvocation(call, 12000, 8192, expectedEnvironment);
  assert.match(script, /NtQueryInformationProcess/); assert.match(script, /ProcessId=4/);
  assert.match(script, /kernel_boot_changed/); assert.doesNotMatch(script, /O'Connor|private-token|RUNNER~1/);
  assert.match(script, /DefinePInvokeMethod\('NtQueryInformationProcess','C:\\Windows\\System32\\ntdll\.dll','NtQueryInformationProcess'/);
  assert.match(script, /AssemblyBuilderAccess\]::Run\)/);
  assert.match(script, /MethodImplAttributes\]::PreserveSig/);
  assert.doesNotMatch(script, /Add-Type|CodeDom|CompileAssembly|LoadFrom|LoadFile|WriteAll|Start-Process/);
  assert.deepEqual(value, boot());
});

test('boot read closes unused input before awaiting completion and preserves transport refusal', async t => {
  controlledEnvironment(t);let closed=0,resolveRead;
  const pending=new Promise(resolve=>{resolveRead=resolve;});
  pending.child={stdin:{end(){closed++;}}};
  const reading=readWindowsSandboxHostBoot({platform:'win32',exec:()=>pending});
  const closedBeforeSettlement=closed;
  resolveRead({stdout:JSON.stringify(boot())});assert.deepEqual(await reading,boot());
  assert.equal(closedBeforeSettlement,1,'fixed noninteractive reader must send EOF before waiting');
  const failure=Object.assign(Error('fixture_transport_timeout'),{killed:true,signal:'SIGTERM'});
  const rejected=Promise.reject(failure);rejected.child={stdin:{end(){closed++;}}};
  await assert.rejects(readWindowsSandboxHostBoot({platform:'win32',exec:()=>rejected}),error=>error===failure);
  assert.equal(closed,2);
});

test('process reader uses shared fixed context, validated PID and15s budget while retaining stdin close and identity validation', async t => {
  controlledEnvironment(t); let call, inputClosed = 0;
  const exec = (exe, args, options) => {
    call = {exe, args, options};
    const pending = Promise.resolve({stdout: JSON.stringify(nativeProcess())});
    pending.child = {stdin: {end() { inputClosed++; }}}; return pending;
  };
  const value = await readNativeCodingWindowsProcess(123, {platform: 'win32', exec});
  const script = assertInvocation(call, 15000, 16384, {...expectedEnvironment, METAENGINE_NATIVE_CODING_PID: '123'});
  assert.equal(inputClosed, 1); assert.match(script, /GetOwnerSid/); assert.match(script, /\$p\.Handle/);
  assert.doesNotMatch(script, /O'Connor|private-token|RUNNER~1/);
  assert.deepEqual(value, {pid: 123, created_at: createdAt, process_incarnation_id: `pid:123:created_100ns:${birth}`,
    exe_path: 'C:\\fixed\\worker.exe', user_sid: 'S-1-5-21-111-1001'});
  const malformed = nativeProcess(); malformed.birth_100ns = String(BigInt(birth) + 10000n);
  await assert.rejects(readNativeCodingWindowsProcess(123, {platform: 'win32', exec: async () => ({stdout: JSON.stringify(malformed)})}), /native_birth_mismatch/);
  const badBoot = boot(); badBoot.system_process.pid = 8;
  await assert.rejects(readWindowsSandboxHostBoot({platform: 'win32', exec: async () => ({stdout: JSON.stringify(badBoot)})}), /host_boot_unverified/);
});

test('invalid inherited context and unverified inventory SystemRoot refuse before launching a reader', async t => {
  controlledEnvironment(t, {TEMP: '\\\\remote\\private-token'}); let calls = 0;
  const exec = async () => { calls++; throw Error('must_not_execute'); };
  await assert.rejects(readWindowsSandboxHostBoot({platform: 'win32', exec}), {message: 'windows_native_read_environment_context_invalid'});
  await assert.rejects(readNativeCodingWindowsProcess(123, {platform: 'win32', exec}), /native_process_unavailable/);
  assert.equal(calls, 0);
  process.env.TEMP = context.TEMP; process.env.SystemRoot = 'D:\\Windows'; process.env.SYSTEMROOT = 'D:\\Windows';
  await assert.rejects(readNativeCodingWindowsProcess(123, {platform: 'win32', exec}), /windows_root_unverified/);
  assert.equal(calls, 0);
});

test('DOS device contexts refuse before either native reader launches', async t => {
  controlledEnvironment(t, {TEMP: 'C:\\dir\\NUL.txt'}); let calls = 0;
  const exec = async () => { calls++; throw Error('must_not_execute'); };
  await assert.rejects(readWindowsSandboxHostBoot({platform: 'win32', exec}), {message: 'windows_native_read_environment_context_invalid'});
  await assert.rejects(readNativeCodingWindowsProcess(123, {platform: 'win32', exec}), /native_process_unavailable/);
  assert.equal(calls, 0);
});
