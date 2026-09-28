import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { me2HealthProbe } from '../src/me2/me2-daemon-host.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BROWSER_ROOT = path.resolve(HERE, '..');
const REPO_ROOT = path.resolve(BROWSER_ROOT, '../..');

const source = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

const SAFE_PROBE = Object.freeze({
  boot_mode: 'probe',
  read_only: true,
  model_execution_enabled: false,
  provider_api_enabled: false,
  agentchat_mutation_enabled: false,
  scheduler_authority: false,
  browser_actuation_authority: false,
  command_mutation_enabled: false,
  token_mutation_enabled: false,
  persistent_state_write_enabled: false,
  durable_state_authority: false,
  state_storage: 'EPHEMERAL_MEMORY_ONLY',
  authority_effect: false,
});

test('R99 Browser-hosted ME2 probe cannot seed or expose mutation/model REST authority', () => {
  const daemon = source('apps/me2-daemon/index.ts');
  assert.match(daemon, /if \(!PROBE_MODE\) seed\(\)/);
  assert.match(daemon, /method !== "GET" \|\| PROBE_BLOCKED_GET_PATHS\.has\(path\)/);
  for (const pathName of ['/providers','/llm','/glm','/agents','/agentchat','/pool','/governor','/demand','/tokens']) {
    assert.equal(daemon.includes('"' + pathName + '"'), true, 'probe must classify ' + pathName);
  }
  for (const marker of [
    'ME2_BROWSER_PROBE_READ_ONLY',
    'ME2_BROWSER_PROBE_AGENTCHAT_DISABLED',
    'ME2_BROWSER_PROBE_TOKENS_DISABLED',
    'model_execution_enabled: false',
    'provider_api_enabled: false',
    'agentchat_mutation_enabled: false',
    'command_mutation_enabled: false',
    'token_mutation_enabled: false',
  ]) assert.equal(daemon.includes(marker), true, 'missing probe marker: ' + marker);
});

test('R99 Browser probe disables duplicate daemon background authorities', () => {
  const daemon = source('apps/me2-daemon/index.ts');
  assert.match(daemon, /if \(!PROBE_MODE\) \{[\s\S]*drainCommands\(8\)[\s\S]*fleetSelfTick\(VERSION\)[\s\S]*fleetTick\(\)[\s\S]*fleetGc\(\)/);
  assert.match(daemon, /if \(poolBootAllowed && !PROBE_MODE\)/);
  assert.match(daemon, /if \(!PROBE_MODE\) startMasterLoop\(\)/);
  assert.match(daemon, /if \(!PROBE_MODE\) initEvidence\(\)/);
  assert.match(daemon, /if \(!PROBE_MODE\) \{[\s\S]*startScreencastServer\(\)/);
});

test('R99 host rejects healthy-looking external daemon without explicit zero-authority probe proof', async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, last_seq: 7 }) });
    const unsafe = await me2HealthProbe(50);
    assert.equal(unsafe.ok, false);
    assert.equal(unsafe.reason, 'unsafe_browser_probe_contract');

    globalThis.fetch = async () => ({ ok: true, json: async () => ({ ok: true, last_seq: 8, browser_probe: SAFE_PROBE }) });
    const safe = await me2HealthProbe(50);
    assert.equal(safe.ok, true);
    assert.equal(safe.reason, 'ok');
    assert.deepEqual(safe.browser_probe, SAFE_PROBE);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('R99 packaged daemon manifest and installed smoke require the same probe policy', () => {
  const build = source('apps/metaengine-browser/scripts/build-me2-daemon-staging.ps1');
  const verify = source('apps/metaengine-browser/scripts/verify-me2-daemon-bundle.mjs');
  for (const marker of [
    'browser_probe_read_only',
    'model_execution_enabled',
    'provider_api_enabled',
    'agentchat_mutation_enabled',
    'command_mutation_enabled',
    'token_mutation_enabled',
  ]) {
    assert.equal(build.includes(marker), true, 'build manifest missing: ' + marker);
    assert.equal(verify.includes(marker), true, 'installed verifier missing: ' + marker);
  }
});


test('R103 Browser launch cannot be promoted to the historical full daemon by environment override', async () => {
  const host = source('apps/metaengine-browser/src/me2/me2-daemon-host.mjs');
  const entry = source('apps/me2-daemon/browser-probe-entry.ts');
  const build = source('apps/metaengine-browser/scripts/build-me2-daemon-staging.ps1');
  const verify = source('apps/metaengine-browser/scripts/verify-me2-daemon-bundle.mjs');

  assert.match(host, /ME2_BOOT_MODE:\s*'probe'/);
  assert.doesNotMatch(host, /ME2_DAEMON_BOOT_MODE\s*\|\|/);
  assert.match(host, /browser-probe-entry\.ts/);
  assert.match(host, /SOURCE_BUN_PROBE_ONLY/);
  assert.doesNotMatch(host, /args:\s*\['index\.ts'\]/);

  const oldSourceOnly = new Set(['/root/index.ts']);
  const launch = (await import('../src/me2/me2-daemon-host.mjs')).resolveMe2DaemonLaunch({
    resourcesPath: '/no-resources',
    cwd: '/root',
    env: { ME2_DAEMON_DIR: '/root', ME2_DAEMON_BIN: 'bun' },
    exists: (p) => oldSourceOnly.has(String(p).replaceAll('\\\\', '/')),
  });
  assert.equal(launch, null, 'legacy full source entrypoint must fail closed');

  assert.match(entry, /process\.env\.ME2_HOSTED_BY_BROWSER\s*=\s*'1'/);
  assert.match(entry, /process\.env\.ME2_BOOT_MODE\s*=\s*'probe'/);
  assert.match(entry, /await import\('\.\/index'\)/);

  assert.match(build, /build --compile --target=bun-windows-x64 browser-probe-entry\.ts --outfile/);
  assert.match(build, /probe_only_entrypoint = 'browser-probe-entry\.ts'/);
  assert.match(build, /browser_host_mode_override_allowed = \$false/);

  assert.match(verify, /ME2_BOOT_MODE:\s*'full'/);
  assert.match(verify, /ME2_DAEMON_BOOT_MODE:\s*'full'/);
  assert.match(verify, /hostile_boot_mode_override_rejected:\s*true/);
});


test('R104 Browser probe state is ephemeral and cannot become a parallel durable truth', () => {
  const store = source('apps/me2-daemon/store.ts');
  const daemon = source('apps/me2-daemon/index.ts');
  const verify = source('apps/metaengine-browser/scripts/verify-me2-daemon-bundle.mjs');

  assert.match(store, /BROWSER_PROBE_MODE = process\.env\.ME2_HOSTED_BY_BROWSER === "1"/);
  assert.match(store, /DB_FILE = BROWSER_PROBE_MODE \? ":memory:" : join\(HERE, "me2\.db"\)/);
  assert.match(store, /if \(!BROWSER_PROBE_MODE\) mkdirSync/);
  assert.match(daemon, /persistent_state_write_enabled: false/);
  assert.match(daemon, /durable_state_authority: false/);
  assert.match(daemon, /state_storage: "EPHEMERAL_MEMORY_ONLY"/);
  assert.match(verify, /Browser probe must not create durable ME2 SQLite state/);
  assert.match(verify, /durable_state_file_created: false/);
});
