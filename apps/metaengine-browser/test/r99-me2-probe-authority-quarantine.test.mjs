import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { me2HealthProbe, resolveMe2DaemonLaunch } from '../src/me2/me2-daemon-host.mjs';

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


test('R103.2 packaged Browser ignores hostile ME2 executable and directory overrides before spawn', () => {
  const resourcesPath = path.join(path.sep, 'trusted', 'resources');
  const trustedDir = path.join(resourcesPath, 'me2-daemon');
  const trustedExe = path.join(trustedDir, 'me2-daemon.exe');
  const hostileDir = path.join(path.sep, 'hostile', 'daemon');
  const hostileExe = path.join(hostileDir, 'me2-daemon.exe');
  const existing = new Set([trustedExe, hostileExe]);

  const launch = resolveMe2DaemonLaunch({
    packaged: true,
    resourcesPath,
    cwd: hostileDir,
    env: { ME2_DAEMON_DIR: hostileDir, ME2_DAEMON_BIN: hostileExe },
    exists: (candidate) => existing.has(candidate),
  });

  assert.equal(launch?.mode, 'PACKAGED_STANDALONE');
  assert.equal(launch?.dir, trustedDir);
  assert.equal(launch?.bin, trustedExe);
  assert.equal(launch?.launch_provenance, 'ELECTRON_RESOURCES_PATH');

  const noTrustedArtifact = resolveMe2DaemonLaunch({
    packaged: true,
    resourcesPath,
    cwd: hostileDir,
    env: { ME2_DAEMON_DIR: hostileDir, ME2_DAEMON_BIN: hostileExe },
    exists: (candidate) => candidate === hostileExe,
  });
  assert.equal(noTrustedArtifact, null, 'hostile external executable cannot substitute for a missing packaged artifact');
});

test('R103.2 development launch fixes executable to bun and requires browser-probe-entry', () => {
  const cwd = path.join(path.sep, 'repo', 'apps', 'metaengine-browser');
  const sourceDir = path.resolve(cwd, '..', 'me2-daemon');
  const probeEntry = path.join(sourceDir, 'browser-probe-entry.ts');
  const hostileDir = path.join(path.sep, 'hostile', 'daemon');

  const launch = resolveMe2DaemonLaunch({
    packaged: false,
    resourcesPath: path.join(path.sep, 'missing', 'resources'),
    cwd,
    env: { ME2_DAEMON_DIR: hostileDir, ME2_DAEMON_BIN: 'hostile-executor' },
    exists: (candidate) => candidate === probeEntry || candidate === path.join(hostileDir, 'browser-probe-entry.ts'),
  });

  assert.equal(launch?.mode, 'SOURCE_BUN_PROBE_ONLY');
  assert.equal(launch?.dir, sourceDir);
  assert.equal(launch?.bin, 'bun');
  assert.deepEqual(launch?.args, ['browser-probe-entry.ts']);
  assert.equal(launch?.launch_provenance, 'DEVELOPMENT_SOURCE_PROBE_ENTRY');
});

test('R103 Browser launch cannot be promoted to the historical full daemon by environment override', async () => {
  const host = source('apps/metaengine-browser/src/me2/me2-daemon-host.mjs');
  const integration = source('apps/metaengine-browser/src/me2/me2-integration-entry.mjs');
  const entry = source('apps/me2-daemon/browser-probe-entry.ts');
  const build = source('apps/metaengine-browser/scripts/build-me2-daemon-staging.ps1');
  const verify = source('apps/metaengine-browser/scripts/verify-me2-daemon-bundle.mjs');

  assert.match(host, /ME2_BOOT_MODE:\s*'probe'/);
  assert.doesNotMatch(host, /ME2_DAEMON_BOOT_MODE\s*\|\|/);
  assert.match(host, /launch_provenance:\s*'ELECTRON_RESOURCES_PATH'/);
  assert.match(host, /environment_launch_override_allowed:\s*false/);
  assert.doesNotMatch(host, /env\.ME2_DAEMON_DIR/);
  assert.doesNotMatch(host, /env\.ME2_DAEMON_BIN/);
  assert.match(integration, /packaged:\s*app\?\.isPackaged\s*===\s*true/);
  assert.match(integration, /resourcesPath:\s*process\.resourcesPath/);
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


test('R103 Browser probe performs no SQL-mirror or token bootstrap effects', () => {
  const daemon = source('apps/me2-daemon/index.ts');

  for (const pathName of [
    '/sqlmirror/ui-token',
    '/sqlmirror/ui-token/verify',
    '/sqlmirror/feed',
    '/sqlmirror/rls-audit',
    '/sqlmirror/rpc-reconcile',
  ]) {
    assert.equal(daemon.includes('"' + pathName + '"'), true, 'probe must classify effectful GET ' + pathName);
  }

  assert.match(daemon, /if \(!PROBE_MODE && process\.env\.ME2_SQL_MIRROR === undefined/);
  assert.match(daemon, /const sqlMirror = PROBE_MODE[\s\S]{0,420}ME2_BROWSER_PROBE_READ_ONLY[\s\S]{0,240}: new SqlMirror\(db\)/);
  assert.match(daemon, /if \(!PROBE_MODE\) \{[\s\S]{0,220}sqlMirror\.start\(\)[\s\S]{0,260}gotrueToken\(\)/);
  assert.doesNotMatch(daemon, /const sqlMirror = new SqlMirror\(db\);\s*sqlMirror\.start\(\)/);
});
