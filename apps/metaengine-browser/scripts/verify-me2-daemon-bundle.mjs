import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';

function parseArgs(argv) {
  const out = { root: null, expectedSha: null, smoke: false, evidence: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--root') out.root = argv[++i];
    else if (arg === '--expected-sha') out.expectedSha = argv[++i];
    else if (arg === '--smoke') out.smoke = true;
    else if (arg === '--evidence') out.evidence = argv[++i];
    else throw new Error(`me2_daemon_verify_arg_unknown:${arg}`);
  }
  if (!out.root) throw new Error('me2_daemon_verify_root_required');
  return out;
}

async function sha256(file) {
  return crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchJson(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error(`http_${response.status}`);
  return response.json();
}

async function smoke(exe, manifest) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-me2-daemon-smoke-'));
  const offset = process.pid % 1000;
  const restPort = 41000 + offset;
  const wsPort = 43000 + offset;
  let stdout = '';
  let stderr = '';
  const systemRoot = process.env.SystemRoot || process.env.WINDIR || 'C:\\Windows';
  const runtimePath = process.platform === 'win32'
    ? [path.join(systemRoot, 'System32'), systemRoot].join(';')
    : String(process.env.PATH || '');
  const child = spawn(exe, [], {
    env: {
      ...process.env,
      PATH: runtimePath,
      Path: runtimePath,
      NODE_PATH: '',
      BUN_INSTALL: '',
      ME2_BOOT_MODE: 'probe',
      ME2_DATA_DIR: dataDir,
      ME2_REST_PORT: String(restPort),
      ME2_WS_PORT: String(wsPort),
      ME2_HOSTED_BY_BROWSER: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  child.stdout?.on('data', (chunk) => { stdout += String(chunk).slice(0, 4096); });
  child.stderr?.on('data', (chunk) => { stderr += String(chunk).slice(0, 4096); });

  try {
    let health = null;
    let state = null;
    let lastError = null;
    for (let attempt = 0; attempt < 80; attempt += 1) {
      if (child.exitCode != null) throw new Error(`me2_daemon_smoke_early_exit:${child.exitCode}:${stderr.slice(-1000)}`);
      try {
        health = await fetchJson(`http://127.0.0.1:${restPort}/health`);
        state = await fetchJson(`http://127.0.0.1:${restPort}/state`);
        if (health?.ok === true && state?.contract === 'me2-daemon-contract.v1') break;
      } catch (error) {
        lastError = error;
      }
      await sleep(250);
    }
    if (health?.ok !== true || state?.contract !== 'me2-daemon-contract.v1') {
      throw new Error(`me2_daemon_smoke_not_ready:${String(lastError?.message || lastError || 'unknown')}`);
    }
    assert.equal(String(health.version), String(manifest.daemon_version), 'daemon health version must match package manifest');
    assert.equal(String(state.version), String(manifest.daemon_version), 'daemon state version must match package manifest');
    return {
      runtime_smoke: 'PASS',
      health_version: String(health.version),
      state_contract: String(state.contract),
      boot_mode: 'probe',
      external_bun_used: false,
      external_runtime_path_sanitized: process.platform === 'win32',
    };
  } finally {
    try { child.kill(); } catch {}
    await sleep(250);
    await fs.rm(dataDir, { recursive: true, force: true });
  }
}

const args = parseArgs(process.argv.slice(2));
const root = path.resolve(args.root);
const manifestPath = path.join(root, 'me2-daemon-manifest.json');
const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
assert.equal(manifest.schema, 'metaengine.browser.me2-daemon-package.v1');
assert.match(String(manifest.source_head), /^[0-9a-f]{40}$/);
if (args.expectedSha) assert.equal(String(manifest.source_head), String(args.expectedSha).toLowerCase());
assert.match(String(manifest.daemon_version), /^\d+\.\d+\.\d+(?:[-+].+)?$/);
assert.equal(manifest.runtime_embedded, true);
assert.equal(manifest.external_bun_required, false);
assert.equal(manifest.default_browser_host_boot_mode, 'probe');
assert.equal(manifest.scheduler_authority, false);
assert.equal(manifest.browser_actuation_authority, false);
assert.equal(manifest.authority_effect, false);

const exe = path.join(root, String(manifest.executable || ''));
const stat = await fs.stat(exe);
assert.equal(stat.isFile(), true);
assert.equal(stat.size, Number(manifest.executable_bytes));
assert.equal(await sha256(exe), String(manifest.executable_sha256));

const proof = {
  schema: 'metaengine.browser.me2-daemon-installed-proof.v1',
  source_head: manifest.source_head,
  daemon_version: manifest.daemon_version,
  executable_sha256: manifest.executable_sha256,
  executable_bytes: manifest.executable_bytes,
  runtime_embedded: true,
  external_bun_required: false,
  package_manifest_verified: true,
  smoke_child_external_runtime_path_sanitized: args.smoke && process.platform === 'win32',
  ...(args.smoke ? await smoke(exe, manifest) : { runtime_smoke: 'NOT_REQUESTED' }),
  authority_effect: false,
};

if (args.evidence) {
  await fs.mkdir(path.dirname(path.resolve(args.evidence)), { recursive: true });
  await fs.writeFile(path.resolve(args.evidence), JSON.stringify(proof, null, 2) + '\n');
}
process.stdout.write(JSON.stringify(proof) + '\n');
