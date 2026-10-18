import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import test from 'node:test';
import { strictCheck } from '../src/sandbox-enforcement.ts';
import { buildSeccompFilter, CLONE_NEW_FLAGS_MASK } from '../src/seccomp-filter.ts';

function evaluateFilter(program, nr, arg0 = 0, arch = 0xc000003e) {
  let accumulator = 0;
  const instructions = program.instrs;
  for (let pc = 0; pc < instructions.length / 4; pc++) {
    const [code, jt, jf, k] = instructions.slice(pc * 4, pc * 4 + 4);
    if (code === 0x20) accumulator = (k === 0 ? nr : k === 4 ? arch : k === 16 ? arg0 : 0) >>> 0;
    else if (code === 0x15) pc += accumulator === (k >>> 0) ? jt : jf;
    else if (code === 0x54) accumulator = (accumulator & k) >>> 0;
    else if (code === 0x06) return k >>> 0;
    else throw new Error(`unsupported BPF opcode ${code}`);
  }
  throw new Error('filter fell through');
}

test('actual BPF denies canonical kernel syscall numbers, modern mounts and x32 bypasses', () => {
  // Independent x86_64 ABI fixture: Linux arch/x86/entry/syscalls/syscall_64.tbl.
  const filter = buildSeccompFilter('deny');
  const denied = [155, 161, 165, 166, 175, 176, 313, 428, 429, 430, 431, 432, 433, 442, 467];
  for (const nr of denied) {
    assert.equal(evaluateFilter(filter, nr) & 0xffff0000, 0x00050000, `native syscall ${nr}`);
    assert.equal(evaluateFilter(filter, nr | 0x40000000) & 0xffff0000, 0x00050000, `x32 syscall ${nr}`);
  }
  assert.equal(evaluateFilter(filter, 435), 0x00050000 | 38);
  assert.equal(evaluateFilter(filter, 56, CLONE_NEW_FLAGS_MASK) & 0xffff0000, 0x00050000);
  for (const nr of [0, 1, 218, 273]) assert.equal(evaluateFilter(filter, nr), 0x7fff0000, `ordinary runtime syscall ${nr}`);
  for (const domain of [2, 10]) assert.equal(evaluateFilter(filter, 41, domain) & 0xffff0000, 0x00050000);
  assert.equal(evaluateFilter(filter, 41, 1), 0x7fff0000);
  assert.equal(evaluateFilter(buildSeccompFilter('allow'), 41, 2), 0x7fff0000);
  assert.equal(evaluateFilter(filter, 0, 0, 0x40000003) & 0xffff0000, 0x00050000);
});

const source = (file) => stripTypeScriptTypes(readFileSync(new URL(file, import.meta.url), 'utf8'), { mode: 'strip' });
const goodLayers = () => ({ make_private: true, ro_root: true, rw_rebinds: true, secrets_hidden: true, seccomp: 'installed', rlimit_as: true, rlimit_nofile: true, rlimit_core: true, net: 'deny' });

test('mandatory confinement cannot be disabled by the historical strict:false setting', () => {
  assert.equal(strictCheck(goodLayers(), 'deny', false).ok, true);
  for (const field of Object.keys(goodLayers())) {
    const layers = goodLayers(); delete layers[field];
    assert.equal(strictCheck(layers, 'deny', false).ok, false, field);
  }
  assert.equal(strictCheck(null, 'deny', false).ok, false);
});

const launcher = source('../src/sandbox2-launcher.ts');
const admissionStart = launcher.indexOf('const verdictWritten = writeVerdict(seccompStatus);');
assert.ok(admissionStart >= 0);
const launcherTail = launcher.slice(admissionStart);
const executeTail = new Function('layers', 'profile', 'seccompStatus', 'writeVerdict', 'strictCheck', 'spawnSync', 'process', 'console', launcherTail);

test('actual launcher refuses payload before spawn on every missing layer or failed evidence write', () => {
  const run = (layers, written) => {
    let calls = 0;
    const processStub = { exit(code) { throw { exit: code }; } };
    let exit;
    try {
      executeTail(layers, { net: 'deny', cmd: ['fixture-binary'], cwd: '/fixture', env: {} }, layers.seccomp,
        () => written, strictCheck, () => { calls++; return { status: 0 }; }, processStub, { error() {} });
    } catch (result) { exit = result.exit; }
    return { calls, exit };
  };
  assert.deepEqual(run(goodLayers(), true), { calls: 1, exit: 0 });
  assert.deepEqual(run(goodLayers(), false), { calls: 0, exit: 126 });
  for (const field of Object.keys(goodLayers())) {
    const layers = goodLayers(); delete layers[field];
    assert.deepEqual(run(layers, true), { calls: 0, exit: 126 }, field);
  }
});

const exec = source('../src/exec.ts');
const start = exec.indexOf('async function spawnPlanned(');
const end = exec.indexOf('// ── статус / probe', start);
assert.ok(start >= 0 && end > start);
const makeTerminal = new Function('dependencies', `with (dependencies) { ${exec.slice(start, end).replaceAll('export async function', 'async function')}; return { runTerminalAsync, runApprovedAsync }; }`);

test('normal and approved terminal paths require network-denying OS sandbox with no fallback', async () => {
  const calls = [];
  const terminal = makeTerminal({
    EXEC_SCHEMA: 'fixture', emit() {},
    planExec() { return { ok: true, cwd: '/fixture', timeout_ms: 1000, segments: ['node -e fixture'], binaries: ['node'] }; },
    async classifyGate() { return { verdict: 'allow', result: {} }; },
    async runSandboxedAsync(command, cwd, options) {
      calls.push({ command, cwd, options });
      return { ok: false, schema: 'fixture', exit: null, stdout_tail: '', stderr_tail: '', duration: 1, timed_out: false, env_keys: [], sandbox: { strict_ok: false, layers: {}, net: 'deny' } };
    },
  });
  for (const run of [() => terminal.runTerminalAsync('node -e fixture', '/fixture', 1000, 'agent', { sandbox: false }), () => terminal.runApprovedAsync('node -e fixture', '/fixture', 1000)]) {
    const verdict = await run();
    assert.equal(verdict.ok, false);
    assert.equal(verdict.reason, 'sandbox_failed');
    assert.equal(verdict.sandboxed, true);
  }
  assert.equal(calls.length, 2);
  assert.ok(calls.every((call) => call.options.net === 'deny'));
  assert.equal(exec.includes('spawn(argv[0]'), false, 'unconfined bash/prlimit fallback removed');
});
