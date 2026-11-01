#!/usr/bin/env node
// The supplied binary must already be built from the pinned source patch.
// These checks stop before thread creation; they never acknowledge execution.
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const POLICY_EVENT = 'metaengine.effective_policy.v1';
const ACCEPT_EVENT = 'metaengine.effective_policy.accept.v1';
const UPSTREAM = '3b01b36fa5eb96ba82a776bd3c2fc57f8969181f';
const SECRET = 'DISPOSABLE_USER_CONFIG_SECRET_MUST_NOT_APPEAR';
const MAX_EVENT_BYTES = 65536;
const STARTUP_MS = 30000;
const HELD_MS = 250;

function options(argv) {
  const result = { kind: 'exec' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    if (!['--binary', '--kind', '--evidence-root'].includes(key) || !argv[index + 1]) {
      throw new Error('usage: no-model-probe.mjs --binary ABSOLUTE_PATH [--kind exec|cli] [--evidence-root ABSOLUTE_DIR]');
    }
    result[key.slice(2).replace('-root', 'Root')] = argv[index + 1];
  }
  assert.ok(path.isAbsolute(result.binary ?? ''), 'binary path must be absolute');
  assert.ok(['exec', 'cli'].includes(result.kind), 'kind must be exec or cli');
  if (result.evidenceRoot) assert.ok(path.isAbsolute(result.evidenceRoot), 'evidence root must be absolute');
  return result;
}

async function digest(file) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

function childEnvironment(directory, home) {
  const env = {};
  const allow = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'LANG', 'LC_ALL', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']);
  for (const [key, value] of Object.entries(process.env)) {
    if (allow.has(key.toUpperCase())) env[key] = value;
  }
  // This is a disposable child-only environment, never the operator's home.
  return {
    ...env, HOME: directory, USERPROFILE: directory, CODEX_HOME: home,
    APPDATA: path.join(directory, 'appdata'), LOCALAPPDATA: path.join(directory, 'localappdata'),
    TEMP: path.join(directory, 'temp'), TMP: path.join(directory, 'temp'), TMPDIR: path.join(directory, 'temp'),
    NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  };
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort((a,b) => Buffer.compare(Buffer.from(a), Buffer.from(b))).map(key => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function checkPolicy(event, nonce, mode, workspace) {
  assert.equal(event.type, POLICY_EVENT);
  assert.equal(event.nonce, nonce);
  assert.equal(event.mode, mode);
  assert.match(event.context_id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  assert.ok(Buffer.byteLength(JSON.stringify(event)) <= MAX_EVENT_BYTES, 'policy event must be bounded');
  assert.equal(event.policy?.schema, 'metaengine.codex.effective-policy.v1');
  assert.equal(event.policy?.stage, 'THREAD_START_RESOLVED_BEFORE_SPAWN');
  assert.equal(event.policy?.upstream_commit, UPSTREAM);
  assert.equal(event.policy?.load_mode?.ignore_user_config, true);
  assert.equal(event.policy?.load_mode?.ignore_user_and_project_exec_policy_rules, true);
  assert.equal(path.resolve(event.policy?.cwd ?? ''), path.resolve(workspace));
  assert.equal(event.policy?.origins_scope, 'CONFIG_LAYER_MERGE_EXCLUDING_REQUIREMENTS_AND_HARNESS_OVERRIDES');
  assert.equal(event.policy?.requirements?.source_scope, 'NORMALIZED_CONSTRAINT');
  assert.match(event.policy?.requirements?.generation ?? '', /^sha256:[0-9a-f]{64}$/);
  const projectedRequirements = { values: event.policy.requirements.values, sources: event.policy.requirements.sources };
  assert.equal(event.policy.requirements.generation, `sha256:${createHash('sha256').update(canonicalJson(projectedRequirements)).digest('hex')}`, 'JS consumer must reproduce the producer requirement generation');
  assert.ok(Array.isArray(event.policy?.layers), 'layer metadata missing');
  assert.ok(event.policy.layers.every(layer => /^sha256:[0-9a-f]{64}$/.test(layer.version)), 'layer generation missing');
  assert.ok(!event.policy.layers.some(layer => layer.name === 'user' && layer.enabled && !layer.loader_ignored), 'ignored user config must not be applied');
  assert.ok(event.policy.layers.filter(layer => layer.name === 'user').every(layer => layer.loader_ignored === true && layer.content_scope === 'IGNORED_EMPTY_PLACEHOLDER'), 'ignored user layer must disclose placeholder generation');
  assert.ok(!JSON.stringify(event).includes(SECRET), 'user config secret leaked');
}

async function runScenario({ name, mode, rejection, opts, evidence, baseUrl, requests }) {
  const expectPolicy = !['invalid_nonce', 'disabled_exec_server', 'remote_exec_server'].includes(rejection);
  const directory = path.join(evidence, name);
  const home = path.join(directory, 'owned-codex-home');
  const workspace = path.join(directory, 'workspace');
  for (const subdir of [directory, home, workspace, 'temp', 'appdata', 'localappdata'].map(value => path.isAbsolute(value) ? value : path.join(directory, value))) {
    await fs.mkdir(subdir, { recursive: true, mode: 0o700 });
  }
  await fs.writeFile(path.join(home, 'config.toml'), `developer_instructions = ${JSON.stringify(SECRET)}\nallow_login_shell = false\n`, { mode: 0o600 });
  const nonce = rejection === 'invalid_nonce' ? 'invalid' : randomBytes(32).toString('hex');
  // This prospective original task is never sent by the negative/inspect suite.
  // Its immutable argv hash must remain independent of all ACK frames.
  const originalPrompt = Buffer.from('Disposable original task: never submitted by no-model suite.\n', 'utf8');
  const originalPromptSha256 = createHash('sha256').update(originalPrompt).digest('hex');
  const args = [
    ...(opts.kind === 'cli' ? ['--no-daemon', 'exec'] : []),
    '--json', '--color', 'never', '--ignore-user-config', '--ignore-rules', '--ephemeral',
    '--skip-git-repo-check', '--sandbox', 'read-only', '-C', workspace,
    '-c', 'model_provider="mock"',
    '-c', `model_providers.mock={name="Mock",base_url=${JSON.stringify(baseUrl)},wire_api="responses",requires_openai_auth=false,supports_websockets=true}`,
    '-c', 'check_for_update_on_startup=false',
    '--model', 'gpt-5.1-codex',
    '--metaengine-effective-policy', nonce,
    ...(mode === 'inspect' ? ['--metaengine-policy-only'] : ['--metaengine-prompt-sha256', originalPromptSha256]), '-'
  ];
  const env = childEnvironment(directory, home);
  // Only these negative scenarios inject an execution-server selector.
  if (rejection === 'disabled_exec_server') env.CODEX_EXEC_SERVER_URL = 'none';
  if (rejection === 'remote_exec_server') env.CODEX_EXEC_SERVER_URL = `${baseUrl.replace(/^http:/, 'ws:')}/exec-server`;
  const deadlineAt = new Date(Date.now() + STARTUP_MS).toISOString();
  const child = spawn(opts.binary, args, { cwd: workspace, env, shell: false, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  const stdout = [];
  const stderr = [];
  const events = [];
  let stdoutBytes = 0;
  let stderrBytes = 0;
  let line = '';
  let policy;
  let resolvePolicy;
  let rejectPolicy;
  let closed = false;
  let streamError;
  const policyPromise = new Promise((resolve, reject) => { resolvePolicy = resolve; rejectPolicy = reject; });
  // Invalid-parser cases do not await this promise; keep its rejection handled.
  policyPromise.catch(() => {});
  const completion = new Promise((resolve, reject) => {
    child.once('error', error => { streamError = error; rejectPolicy(error); reject(error); });
    child.once('close', (code, signal) => {
      closed = true;
      if (!policy) rejectPolicy(new Error('child closed before policy event'));
      resolve({ code, signal });
    });
  });
  child.stdin.on('error', error => { if (error.code !== 'EPIPE') streamError = error; });
  child.stdout.on('data', chunk => {
    stdoutBytes += chunk.length;
    stdout.push(chunk);
    if (stdoutBytes > 256 * 1024) { streamError = new Error('stdout limit exceeded'); child.kill(); return; }
    line += chunk.toString('utf8');
    let newline;
    while ((newline = line.indexOf('\n')) >= 0) {
      const value = line.slice(0, newline);
      line = line.slice(newline + 1);
      if (!value.trim()) continue;
      try {
        const event = JSON.parse(value);
        events.push(event);
        if (event.type === POLICY_EVENT) {
          if (policy) { streamError = new Error('duplicate policy event'); child.kill(); }
          else { policy = event; resolvePolicy(event); }
        }
      } catch {
        streamError = new Error('stdout contains non-JSONL data');
        child.kill();
      }
    }
  });
  child.stderr.on('data', chunk => {
    stderrBytes += chunk.length;
    stderr.push(chunk);
    if (stderrBytes > 512 * 1024) { streamError = new Error('stderr limit exceeded'); child.kill(); }
  });
  const timeout = setTimeout(() => { streamError = new Error('bounded probe deadline exceeded'); child.kill('SIGKILL'); }, Math.max(0, Date.parse(deadlineAt) - Date.now()));
  const initialRequests = requests.length;
  let result;
  try {
    if (expectPolicy) {
      const event = await policyPromise;
      checkPolicy(event, nonce, mode, workspace);
      // No stdin byte has been sent. Seeing this event proves prompt-read deferral.
      if (mode === 'execute') {
        await delay(HELD_MS);
        assert.ok(!closed, 'execute process must remain at the acceptance barrier');
        assert.ok(!events.some(item => item.type === 'thread.started' || item.type.startsWith('turn.')), 'thread or turn started before acceptance');
        const acceptance = { type: ACCEPT_EVENT, nonce: event.nonce, context_id: event.context_id };
        if (rejection === 'nonce') acceptance.nonce = '0'.repeat(64) === nonce ? '1'.repeat(64) : '0'.repeat(64);
        if (rejection === 'context') acceptance.context_id = '00000000-0000-0000-0000-000000000000';
        if (rejection === 'unknown_field') acceptance.verified = true;
        if (rejection === 'eof') child.stdin.end();
        else child.stdin.end(`${JSON.stringify(acceptance)}\n`);
      }
    }
    result = await completion;
    assert.ifError(streamError);
    assert.equal(result.signal, null, 'probe must exit on its own');
    if (mode === 'inspect' && expectPolicy) assert.equal(result.code, 0, 'inspect mode must complete successfully');
    else assert.notEqual(result.code, 0, 'rejected acceptance must fail');
    assert.ok(!events.some(item => item.type === 'thread.started' || item.type.startsWith('turn.')), 'no thread/turn may start in no-model cases');
    if (!expectPolicy) {
      assert.equal(policy, undefined, 'invalid invocation must not produce a policy');
      assert.equal(requests.length - initialRequests, 0, 'invalid invocation must fail before HTTP or WebSocket activity');
    }
    assert.ok(!Buffer.concat(stdout).includes(Buffer.from(SECRET)), 'stdout leaked disposable user secret');
    assert.ok(!requests.slice(initialRequests).some(item => item.model_request), 'model endpoint or prewarm was contacted');
    return { name, exit_code: result.code, policy_events: policy ? 1 : 0, http_requests: requests.length - initialRequests, model_requests: 0,
      original_prompt_sha256: originalPromptSha256, nonce, deadline_at: deadlineAt, task_bytes_sent: 0 };
  } finally {
    clearTimeout(timeout);
    if (!closed) { child.kill('SIGKILL'); child.stdin.destroy(); await completion.catch(() => {}); }
    await fs.writeFile(path.join(directory, 'stdout.jsonl'), Buffer.concat(stdout), { mode: 0o600 });
    await fs.writeFile(path.join(directory, 'stderr.log'), Buffer.concat(stderr), { mode: 0o600 });
  }
}

async function main() {
  const opts = options(process.argv.slice(2));
  const binarySha = await digest(opts.binary);
  const evidenceRoot = opts.evidenceRoot ?? os.tmpdir();
  await fs.mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const evidence = await fs.mkdtemp(path.join(evidenceRoot, 'metaengine-policy-no-model-'));
  await fs.chmod(evidence, 0o700);
  const requests = [];
  const record = (request, websocket = false) => {
    const target = new URL(request.url ?? '/', 'http://127.0.0.1');
    const model_request = websocket || /(?:^|\/)responses(?:\/|$)|(?:^|\/)chat\/completions(?:\/|$)/.test(target.pathname);
    requests.push({ method: request.method, path: target.pathname, websocket, model_request });
  };
  const server = http.createServer((request, response) => {
    record(request);
    request.resume();
    response.writeHead(/models/.test(request.url ?? '') ? 200 : 503, { 'content-type': 'application/json' });
    response.end(JSON.stringify(/models/.test(request.url ?? '') ? { models: [], data: [] } : { error: { message: 'No-model probe forbids inference' } }));
  });
  server.on('upgrade', (request, socket) => { record(request, true); socket.destroy(); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
  const results = [];
  try {
    for (const scenario of [
      { name: 'inspect_open_stdin', mode: 'inspect' },
      { name: 'reject_nonce', mode: 'execute', rejection: 'nonce' },
      { name: 'reject_context', mode: 'execute', rejection: 'context' },
      { name: 'reject_unknown_field', mode: 'execute', rejection: 'unknown_field' },
      { name: 'reject_eof', mode: 'execute', rejection: 'eof' },
      { name: 'reject_invalid_nonce', mode: 'inspect', rejection: 'invalid_nonce' },
      { name: 'reject_disabled_exec_server', mode: 'inspect', rejection: 'disabled_exec_server' },
      { name: 'reject_remote_exec_server', mode: 'inspect', rejection: 'remote_exec_server' },
    ]) results.push(await runScenario({ ...scenario, opts, evidence, baseUrl, requests }));
    assert.equal(await digest(opts.binary), binarySha, 'binary changed during probe');
    assert.ok(!requests.some(item => item.model_request), 'model endpoint was contacted');
    const summary = { status: 'NO_MODEL_BARRIER_CHECKS_PASS', platform: process.platform, binary_sha256: binarySha,
      upstream_commit: UPSTREAM, binary_kind: opts.kind, cases: results, model_response_requests: 0,
      native_process_custody_qualified: false, windows_binary_qualified: false, evidence_directory: evidence };
    await fs.writeFile(path.join(evidence, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
    await fs.writeFile(path.join(evidence, 'http-observations.json'), `${JSON.stringify(requests, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
  } catch (error) {
    await fs.writeFile(path.join(evidence, 'failure.json'), `${JSON.stringify({ completed_cases: results, reason: error.message })}\n`, { mode: 0o600 });
    // Raw stderr/config stays in private fixture logs; the error summary is bounded.
    process.stderr.write(`${JSON.stringify({ status: 'NO_MODEL_BARRIER_CHECKS_FAILED', completed_cases: results.length,
      reason: String(error.message).slice(0, 500), evidence_directory: evidence })}\n`);
    process.exitCode = 1;
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

await main();
