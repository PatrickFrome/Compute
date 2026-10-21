// CI consumers of a newly created disposable Owner. This is not an Owner
// provisioner and never accepts an arbitrary command, endpoint or READY flag.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { assertInstalledLaunchIdentity, assertInstalledPrimaryWindowJournal,
  verifyInstalledVisiblePrimaryWindow, isolatedLaunchEnvironment, INSTALLED_LAUNCH_SOURCE_FILES,
  startInstalledQualificationProcess, ISOLATED_OWNER_MARKER } from './qualify-installed-client-launch.mjs';
import { verifyWindowsTcpListener } from './verify-windows-tcp-listener.mjs';
import { validateLocalStateProviderConfig, validateLocalStateRuntimeIdentity,
  localStateProviderHealthAttested } from '../src/local-state-provider-policy.mjs';

const require = createRequire(import.meta.url);
const { assertPackagedOfflineRuntimeBinding } = require('./offline-runtime-package-binding.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error('installed_owner_consumer_' + reason); };
export const OWNER_CONSUMERS = Object.freeze(['FINAL_RUNTIME_ACTIVATION', 'SHELL_FIRST_DIRTY_PROFILE', 'AUTONOMOUS_SESSION_SOAK']);
const contained = (root, target) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
export function assertOwnerConsumerKind(consumer) {
  if (!OWNER_CONSUMERS.includes(consumer)) fail('kind_invalid');
  return consumer;
}

export function assertOwnerConsumerFixture({ consumer, root, identity, marker, owner, config, resourcesDir }) {
  assertOwnerConsumerKind(consumer);
  if (!path.isAbsolute(root || '') || !/^[a-f0-9]{40}$/.test(identity?.source_head || '')
    || !identity.package_version || !/^[a-f0-9]{64}$/.test(identity.bundle_sha256 || '')
    || marker?.schema !== 'metaengine.browser.isolated-owner-launch-fixture.v1'
    || marker.production_profile !== false || marker.source_data_rows_restored !== 0
    || marker.source_head !== identity.source_head) fail('fixture_identity_invalid');
  validateLocalStateProviderConfig(owner);
  if (!owner.runtime_host || owner.runtime_host.expected_bundle_sha256 !== identity.bundle_sha256
    || path.resolve(owner.runtime_host.bundle_directory).toLowerCase() !== path.resolve(resourcesDir, 'client-state-runtime').toLowerCase()
    || !contained(root, owner.runtime_identity_file) || !contained(root, owner.runtime_host.config_file)
    || config?.postgres_mode !== 'attached' || config.api_role_mode !== 'direct'
    || !contained(root, config.pg_data_directory || '') || !contained(root, config.state_directory || '')
    || config.expected_bundle_sha256 !== identity.bundle_sha256
    || path.resolve(config.bundle_directory || '').toLowerCase() !== path.resolve(resourcesDir, 'client-state-runtime').toLowerCase()) fail('fixture_binding_invalid');
  let database;
  try { database = new URL(config.database_url); } catch { fail('fixture_database_invalid'); }
  if (!['postgres:', 'postgresql:'].includes(database.protocol) || database.hostname !== '127.0.0.1'
    || !database.username || !database.password || !Number.isSafeInteger(Number(database.port))
    || Number(database.port) < 1024 || Number(database.port) > 65535) fail('fixture_database_invalid');
  return true;
}

export function assertOwnerConsumerProfile(profile, { appData, expectedVersion }) {
  if (profile?.schema !== 'metaengine.browser.profile-probe.v1' || profile.primary_instance !== true
    || profile.version !== expectedVersion || profile.app_id !== 'com.metaengine.browser.test'
    || path.resolve(profile.user_data_path || '').toLowerCase() !== path.resolve(appData, 'BrowserProfile').toLowerCase()) fail('profile_binding_invalid');
  return profile;
}

function activationFields(activation) {
  if (activation?.state !== 'READY'
    || activation.host_agent_state !== 'READY' || activation.signer_state !== 'READY'
    || activation.browser_execution_via_typed_ipc !== true || activation.verified_execution_outcomes_active !== true
    || activation.fast_control_read_side_active !== true || activation.fast_control_production_mutation_authority !== false
    || activation.production_authority_fabricated !== false || activation.second_scheduler !== false
    || activation.automatic_effect_retry_allowed !== false || activation.authority_effect !== false) fail('activation_unproven');
  // Only fixed public fields enter the artifact; arbitrary log fields never do.
  return Object.freeze(Object.fromEntries(['state', 'host_agent_state', 'signer_state',
    'browser_execution_via_typed_ipc', 'verified_execution_outcomes_active', 'fast_control_read_side_active',
    'fast_control_production_mutation_authority', 'production_authority_fabricated', 'second_scheduler',
    'automatic_effect_retry_allowed', 'authority_effect'].map(key => [key, activation[key]])));
}
export function assertFinalRuntimeConsumerActivation(row, { expectedGeneration } = {}) {
  if (row?.schema !== 'metaengine.browser.final-runtime-activation.lifecycle.v1' || row.state !== 'READY'
    || !Number.isSafeInteger(row.generation) || row.generation < 1 || row.second_scheduler !== false
    || row.authority_effect !== false || (expectedGeneration !== undefined && row.generation !== expectedGeneration)) fail('activation_unproven');
  return activationFields(row.activation);
}

export function assertOwnerConsumerRuntime({ previous, current, health, owner, pid, postgresPid }) {
  const runtime = validateLocalStateRuntimeIdentity(current, owner.base_url);
  if (!previous?.instance_id || previous.state !== 'STOPPED' || previous.runtime_ready !== false
    || previous.children_stopped !== true || current.instance_id === previous.instance_id
    || current.bundle_sha256 !== owner.runtime_host?.expected_bundle_sha256
    || current.postgres_mode !== 'attached' || current.api_role_mode !== 'direct'
    || !Number.isSafeInteger(current.host_pid) || current.host_pid < 1 || current.host_pid === postgresPid
    || current.host_pid === pid || !Array.isArray(current.children) || current.children.length !== 2
    || current.children[0].name !== 'api' || current.children[1].name !== 'edge'
    || !current.children.every(child => Number.isSafeInteger(child.pid) && child.pid > 0
      && child.pid !== postgresPid && child.pid !== pid && child.pid !== current.host_pid)
    || current.children[0].pid === current.children[1].pid
    || !localStateProviderHealthAttested(health, runtime.instance_id)) fail('runtime_readback_unproven');
  return runtime;
}

export function assertOwnerConsumerStopped({ current, stopped, primaryClose, shutdownClose }) {
  if (primaryClose?.code !== 0 || primaryClose.signal != null || shutdownClose?.code !== 0 || shutdownClose.signal != null
    || !current?.instance_id || !Number.isSafeInteger(current.host_pid) || current.host_pid < 1
    || stopped?.instance_id !== current.instance_id || stopped.host_pid !== current.host_pid
    || stopped.state !== 'STOPPED' || stopped.runtime_ready !== false || stopped.children_stopped !== true) fail('cleanup_unconfirmed');
  return true;
}

export function assertOwnerSessionSoak(proof, {sourceHead, version}) {
  if (proof?.schema !== 'metaengine.browser.windows-autonomous-soak.v3'
    || proof.source_head !== sourceHead || proof.package_version !== version
    || proof.normal_ui_boot_verified !== true || proof.second_instance_activations_verified !== 72
    || proof.resource_budget_evidence_captured !== true || proof.process_cleanup_confirmed !== true
    || proof.startup_resource_baseline_settled !== true || proof.duplicate_browser_runtime_observed !== false
    || proof.activation_latency_p95_budget_ms !== 1000 || proof.handle_growth_budget !== 24
    || proof.working_set_growth_budget_bytes !== 67108864 || proof.concurrent_activation_burst_size !== 8
    || proof.signed !== false || proof.published !== false || proof.promotion_authorized !== false
    || proof.authority_effect !== false) fail('session_soak_unproven');
  for (const [value, budget] of [[proof.activation_latency_p95_ms,1000], [proof.handle_growth,24],
    [proof.working_set_growth_bytes,67108864], [proof.concurrent_activation_burst_elapsed_ms,8000]]) {
    if (!Number.isFinite(value) || value < 0 || value > budget) fail('session_soak_budget_unproven');
  }
  if (!Number.isSafeInteger(proof.primary_pid) || proof.primary_pid < 1) fail('session_soak_pid_invalid');
  return proof;
}

export function assertOwnerConsumerProof(proof, { consumer, sourceHead, version, bundleSha256, installedAsarSha256, installedExecutableSha256 }) {
  assertOwnerConsumerKind(consumer);
  if (proof?.schema !== 'metaengine.browser.installed-owner-consumer-proof.v1'
    || proof.state !== 'PASSED_ISOLATED_REAL_RUNTIME' || proof.consumer !== consumer
    || proof.source_head !== sourceHead || proof.package_version !== version || proof.bundle_sha256 !== bundleSha256
    || !/^[a-f0-9]{64}$/.test(installedAsarSha256 || '') || proof.installed_asar_sha256 !== installedAsarSha256
    || !/^[a-f0-9]{64}$/.test(installedExecutableSha256 || '') || proof.installed_executable_sha256 !== installedExecutableSha256
    || !/^[a-f0-9]{64}$/.test(proof.qualifier_sha256 || '')
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(proof.runtime_instance_id || '')
    || proof.real_local_runtime_attested !== true || proof.profile_isolated !== true || proof.fixture_source_rows_restored !== 0
    || proof.current_os_window_visible !== true || proof.stable_window_verified !== true
    || proof.primary_exit_code !== 0 || proof.shutdown_exit_code !== 0
    || proof.process_cleanup_confirmed !== true || proof.runtime_host_lock_released !== true || proof.runtime_ports_closed !== true
    || proof.attached_postgres_incarnation_preserved !== true || proof.installed_source_bytes_verified !== true
    || proof.shutdown_method !== 'EXISTING_INSTALLER_SHUTDOWN_BARRIER' || proof.live_agent_execution !== false
    || proof.production_ready !== false || proof.promotion_authorized !== false || proof.automatic_retry_allowed !== false
    || proof.authority_effect !== false) fail('proof_invalid');
  if (consumer === 'AUTONOMOUS_SESSION_SOAK') assertOwnerSessionSoak(proof.session_soak, {sourceHead, version});
  else if (consumer === 'FINAL_RUNTIME_ACTIVATION') activationFields(proof.activation);
  else if (proof.fleet_degraded !== true || proof.activation !== null) fail('proof_invalid');
  return proof;
}

async function bounded(promise, milliseconds, reason) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('installed_owner_consumer_' + reason)), milliseconds);
  })]); } finally { clearTimeout(timer); }
}
async function waitFor(read, launch, milliseconds = 420000) {
  const until = Date.now() + milliseconds;
  while (Date.now() < until) {
    launch?.alive();
    try { const result = await read(); if (result) return result; } catch { /* finite category only */ }
    await delay(200);
  }
  fail('readback_timeout');
}
async function freePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const port = server.address().port;
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  return port;
}
async function closedPort(port) {
  await new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port });
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('installed_owner_consumer_port_probe_timeout')); }, 2000);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); reject(new Error('installed_owner_consumer_port_still_open')); });
    socket.once('error', error => { clearTimeout(timer); socket.destroy(); error.code === 'ECONNREFUSED' ? resolve() : reject(new Error('installed_owner_consumer_port_probe_failed')); });
  });
}
const jsonLines = output => output.split(/\r?\n/).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
async function physicalContained(root, target) {
  const real = await fs.realpath(target);
  if (!contained(root, real)) fail('fixture_path_escape');
  return real;
}
async function regularBytes(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 4 * 1024 * 1024) fail('fixture_file_invalid');
  return fs.readFile(file);
}

export async function qualifyInstalledOwnerConsumer({ consumer, installRoot, sourceRoot, expectedHead, expectedVersion, ownerQaRoot, evidenceDirectory }) {
  assertOwnerConsumerKind(consumer);
  if (process.platform !== 'win32') fail('windows_required');
  for (const directory of [installRoot, sourceRoot, ownerQaRoot, evidenceDirectory]) if (!path.isAbsolute(directory || '')) fail('absolute_paths_required');
  const root = await fs.realpath(ownerQaRoot), directory = await fs.realpath(evidenceDirectory);
  if (path.dirname(root).toLowerCase() !== (await fs.realpath(os.tmpdir())).toLowerCase()
    || !path.basename(root).startsWith('compute-attached-bundle-')) fail('fixture_root_invalid');
  const resourcesDir = path.join(await fs.realpath(installRoot), 'resources');
  const executable = path.join(path.dirname(resourcesDir), 'METAENGINE Browser Test.exe'), archive = path.join(resourcesDir, 'app.asar');
  const artifact = { installed_executable_sha256: hash(await fs.readFile(executable)), installed_asar_sha256: hash(await fs.readFile(archive)) };
  const asar = await import('@electron/asar');
  const pkg = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'));
  const identity = assertInstalledLaunchIdentity(pkg, { expectedHead, expectedVersion });
  for (const relative of INSTALLED_LAUNCH_SOURCE_FILES) {
    if (!asar.extractFile(archive, path.normalize(relative)).equals(await fs.readFile(path.join(sourceRoot, 'apps/metaengine-browser', relative)))) fail('installed_source_mismatch');
  }
  await assertPackagedOfflineRuntimeBinding(pkg.metaengineClientStateRuntime, { expectedHead, packageVersion: expectedVersion, resourcesDir,
    verifierBytes: asar.extractFile(archive, path.normalize('infra/client-state-runtime/offline-runtime-bundle.mjs')) });
  const marker = JSON.parse(await regularBytes(await physicalContained(root, path.join(root, ISOLATED_OWNER_MARKER))));
  const appData = await physicalContained(root, path.join(root, 'Roaming'));
  const localAppData = await physicalContained(root, path.join(root, 'Local'));
  const temporaryDirectory = await physicalContained(root, path.join(root, 'Temp'));
  const ownerFile = await physicalContained(root, path.join(appData, '@metaengine/browser-shell/metaengine-state-provider-v1.json'));
  const ownerBytes = await regularBytes(ownerFile), owner = validateLocalStateProviderConfig(JSON.parse(ownerBytes));
  await physicalContained(root, owner.runtime_host?.config_file || '');
  const configBytes = await regularBytes(owner.runtime_host.config_file), config = JSON.parse(configBytes);
  assertOwnerConsumerFixture({ consumer, root, identity, marker, owner, config, resourcesDir });
  for (const target of [owner.runtime_identity_file, config.pg_data_directory, config.state_directory]) await physicalContained(root, target);
  const previous = JSON.parse(await regularBytes(owner.runtime_identity_file));
  if (previous.state !== 'STOPPED' || previous.runtime_ready !== false || previous.children_stopped !== true) fail('prior_runtime_not_stopped');
  const postmasterFile = path.join(config.pg_data_directory, 'postmaster.pid'), pgBefore = await regularBytes(postmasterFile);
  const postgresPid = Number(pgBefore.toString('utf8').split(/\r?\n/)[0]);
  if (!Number.isSafeInteger(postgresPid) || postgresPid < 1) fail('postmaster_identity_invalid');
  process.kill(postgresPid, 0);
  const ports = [];
  while (ports.length < 3) { const port = await freePort(); if (!ports.includes(port)) ports.push(port); }
  const [uiPort, gatewayPort, daemonPort] = ports;
  const env = isolatedLaunchEnvironment({ appData, localAppData, temporaryDirectory, uiPort, gatewayPort, daemonPort });
  if (consumer === 'AUTONOMOUS_SESSION_SOAK') {
    const proofFile = path.join(directory, 'windows-autonomous-soak-proof.json');
    await fs.writeFile(proofFile, JSON.stringify({schema:'metaengine.browser.windows-autonomous-soak.v3',
      source_head:expectedHead,package_version:expectedVersion,normal_ui_boot_verified:false,
      second_instance_activations_verified:0,signed:false,published:false,promotion_authorized:false,
      authority_effect:false})+'\n', {flag:'wx',mode:0o600});
    let finished = false, current = null, attestedHealth = null, nativeWindow = null;
    const task = promisify(execFile)('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive',
      '-ExecutionPolicy','Bypass','-File',path.join(sourceRoot,'apps/metaengine-browser/scripts/windows-autonomous-session-soak.ps1'),
      '-AppPath',executable,'-ProofPath',proofFile,'-RunnerTemp',directory],
      {env:{...env,RUNNER_TEMP:directory},windowsHide:true,timeout:900000,maxBuffer:1024*1024});
    // Observe fresh runtime attestation while the real UI is running, rather
    // than inferring runtime readiness from a final success flag.
    task.then(()=>{finished=true;},()=>{finished=true;});
    while (!finished) {
      try {
        const status = JSON.parse(await regularBytes(owner.runtime_identity_file));
        const response = await fetch(owner.base_url+'/health',{signal:AbortSignal.timeout(2000)});
        const health = response.ok ? await response.json() : null;
        if (response.ok && status.instance_id !== previous.instance_id
          && status.bundle_sha256 === owner.runtime_host.expected_bundle_sha256
          && status.postgres_mode === 'attached' && status.api_role_mode === 'direct'
          && localStateProviderHealthAttested(health,status.instance_id)) {
          current=status;attestedHealth=health;
          if(!nativeWindow){
            const running=JSON.parse((await regularBytes(path.join(directory,'soak-running-primary.json'))).toString('utf8').replace(/^\uFEFF/,''));
            if(running.version===expectedVersion&&Number.isSafeInteger(running.pid)&&running.pid>0)
              nativeWindow=await verifyInstalledVisiblePrimaryWindow(running.pid);
          }
        }
      } catch { /* wait only while the bounded physical runner is alive */ }
      if (!finished) await delay(250);
    }
    try { await task; } catch { fail('session_soak_physical_failed'); }
    const soak = assertOwnerSessionSoak(JSON.parse((await regularBytes(proofFile)).toString('utf8').replace(/^\uFEFF/,'')),{sourceHead:expectedHead,version:expectedVersion});
    if (!current || nativeWindow?.pid !== soak.primary_pid || nativeWindow.visible!==true) fail('session_soak_attestation_missing');
    assertOwnerConsumerRuntime({previous,current,health:attestedHealth,owner,pid:soak.primary_pid,postgresPid});
    const stopped = JSON.parse(await regularBytes(owner.runtime_identity_file));
    assertOwnerConsumerStopped({current,stopped,primaryClose:{code:0,signal:null},shutdownClose:{code:0,signal:null}});
    await assert.rejects(fs.lstat(path.join(config.state_directory,'runtime-host-lock.json')),{code:'ENOENT'});
    for (const port of [config.api_port,config.edge_port,...ports]) await closedPort(port);
    for (const pid of [soak.primary_pid,current.host_pid,...current.children.map(child=>child.pid)]) {
      try { process.kill(pid,0); fail('runtime_process_still_alive'); } catch(error) { if(error.code!=='ESRCH')throw error; }
    }
    if (!(await regularBytes(postmasterFile)).equals(pgBefore)
      || !(await regularBytes(ownerFile)).equals(ownerBytes)
      || !(await regularBytes(owner.runtime_host.config_file)).equals(configBytes)) fail('owner_input_changed');
    process.kill(postgresPid,0);
    if(hash(await fs.readFile(executable))!==artifact.installed_executable_sha256
      ||hash(await fs.readFile(archive))!==artifact.installed_asar_sha256)fail('artifact_or_cleanup_changed');
    return Object.freeze({schema:'metaengine.browser.installed-owner-consumer-proof.v1',state:'PASSED_ISOLATED_REAL_RUNTIME',
      consumer,...identity,...artifact,qualifier_sha256:hash(await fs.readFile(fileURLToPath(import.meta.url))),
      real_local_runtime_attested:true,runtime_instance_id:current.instance_id,profile_isolated:true,
      fixture_source_rows_restored:0,current_os_window_visible:true,stable_window_verified:true,
      session_soak:soak,activation:null,fleet_degraded:false,primary_exit_code:0,shutdown_exit_code:0,
      process_cleanup_confirmed:true,runtime_host_lock_released:true,runtime_ports_closed:true,
      attached_postgres_incarnation_preserved:true,shutdown_method:'EXISTING_INSTALLER_SHUTDOWN_BARRIER',
      installed_source_bytes_verified:true,live_agent_execution:false,production_ready:false,promotion_authorized:false,
      automatic_retry_allowed:false,authority_effect:false});
  }
  if (consumer === 'SHELL_FIRST_DIRTY_PROFILE') Object.assign(env, { METAENGINE_DISABLE_CRASH_SENTINEL: '1', METAENGINE_DISABLE_LOGIN_START: '1' });
  const profileProcess = startInstalledQualificationProcess(executable,
    ['--metaengine-profile-probe', '--user-data-dir=' + path.join(appData, 'BrowserProfile')],
    { ...env, METAENGINE_PROFILE_PROBE_WRITE: '1' }, directory);
  const profileClose = await bounded(profileProcess.closed, 20000, 'profile_probe_timeout');
  if (profileClose.code !== 0 || profileClose.signal) fail('profile_probe_failed');
  const profiles = jsonLines(profileProcess.output()).filter(row => row.schema === 'metaengine.browser.profile-probe.v1');
  if (profiles.length !== 1) fail('profile_probe_ambiguous');
  const profile = assertOwnerConsumerProfile(profiles[0], { appData, expectedVersion });
  await physicalContained(appData, profile.user_data_path);
  const dirty = [];
  if (consumer === 'SHELL_FIRST_DIRTY_PROFILE') {
    for (const generation of [1, 2]) {
      const target = path.join(profile.user_data_path, `metaengine-fleet-state-v${generation}.json.tmp`);
      await fs.mkdir(target); dirty.push(target);
    }
  }
  const launch = startInstalledQualificationProcess(executable,
    ['--user-data-dir=' + profile.user_data_path, '--proxy-server=http://127.0.0.1:9', '--proxy-bypass-list=127.0.0.1;localhost'],
    env, directory, { visibleGui: true });
  let current, observation, primaryClose, shutdownClose, cleaned = false;
  try {
    observation = await waitFor(async () => {
      const status = JSON.parse(await regularBytes(owner.runtime_identity_file));
      const response = await fetch(owner.base_url + '/health', { signal: AbortSignal.timeout(5000) });
      if (!response.ok) return null;
      assertOwnerConsumerRuntime({ previous, current: status, health: await response.json(), owner, pid: launch.child.pid, postgresPid });
      current = status;
      const journal = JSON.parse(await regularBytes(path.join(profile.user_data_path, 'metaengine-browser-startup-journal-v1.json')));
      const window = assertInstalledPrimaryWindowJournal(journal, { pid: launch.child.pid, version: expectedVersion });
      const rows = jsonLines(launch.output());
      const activationRow = consumer === 'FINAL_RUNTIME_ACTIVATION'
        ? rows.findLast(row => row.schema === 'metaengine.browser.final-runtime-activation.lifecycle.v1') : null;
      const activation = activationRow ? assertFinalRuntimeConsumerActivation(activationRow) : null;
      if (consumer === 'FINAL_RUNTIME_ACTIVATION' && !activation) return null;
      const fleetDegraded = rows.some(row => row.state === 'SUBSYSTEM_DEGRADED' && row.subsystem === 'FLEET');
      if (consumer === 'SHELL_FIRST_DIRTY_PROFILE' && !fleetDegraded) return null;
      return { activation, activationGeneration: activationRow?.generation, window, fleetDegraded };
    }, launch);
    const api = current.children.find(child => child.name === 'api'), edge = current.children.find(child => child.name === 'edge');
    await verifyWindowsTcpListener({ port: config.api_port, pid: api.pid });
    await verifyWindowsTcpListener({ port: config.edge_port, pid: edge.pid });
    await verifyWindowsTcpListener({ port: gatewayPort, pid: launch.child.pid });
    await delay(3000); launch.alive();
    const after = JSON.parse(await regularBytes(owner.runtime_identity_file));
    const afterHealth = await fetch(owner.base_url + '/health', { signal: AbortSignal.timeout(5000) });
    if (!afterHealth.ok || after.instance_id !== current.instance_id || after.host_pid !== current.host_pid
      || JSON.stringify(after.children) !== JSON.stringify(current.children)) fail('runtime_incarnation_changed');
    assertOwnerConsumerRuntime({ previous, current: after, health: await afterHealth.json(), owner, pid: launch.child.pid, postgresPid });
    const osWindow = await verifyInstalledVisiblePrimaryWindow(launch.child.pid);
    const afterJournal = JSON.parse(await regularBytes(path.join(profile.user_data_path, 'metaengine-browser-startup-journal-v1.json')));
    assertInstalledPrimaryWindowJournal(afterJournal, { pid: launch.child.pid, version: expectedVersion, expectedWindowId: observation.window.window_id });
    if (consumer === 'FINAL_RUNTIME_ACTIVATION') observation.activation = assertFinalRuntimeConsumerActivation(
      jsonLines(launch.output()).findLast(row => row.schema === 'metaengine.browser.final-runtime-activation.lifecycle.v1'),
      { expectedGeneration: observation.activationGeneration });
    if (!(await regularBytes(ownerFile)).equals(ownerBytes) || !(await regularBytes(owner.runtime_host.config_file)).equals(configBytes)) fail('owner_input_changed');
    observation.osWindow = osWindow;
  } finally {
    // Same normal-profile installer shutdown barrier as installed Owner QA.
    // No taskkill/image-name fallback: unknown shutdown preserves the fixture.
    const shutdown = startInstalledQualificationProcess(executable,
      ['--metaengine-installer-shutdown', '--user-data-dir=' + profile.user_data_path], env, directory);
    shutdownClose = await bounded(shutdown.closed, 50000, 'shutdown_signal_timeout');
    primaryClose = await bounded(launch.closed, 50000, 'shutdown_primary_timeout');
    const stopped = JSON.parse(await regularBytes(owner.runtime_identity_file));
    if (!current) current = stopped;
    assertOwnerConsumerStopped({ current, stopped, primaryClose, shutdownClose });
    await assert.rejects(fs.lstat(path.join(config.state_directory, 'runtime-host-lock.json')), { code: 'ENOENT' });
    for (const port of [config.api_port, config.edge_port, ...ports]) await closedPort(port);
    for (const pid of [current.host_pid, ...(current.children || []).map(child => child.pid)]) {
      try { process.kill(pid, 0); fail('runtime_process_still_alive'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
    }
    if (!(await regularBytes(postmasterFile)).equals(pgBefore)) fail('postmaster_incarnation_changed');
    process.kill(postgresPid, 0);
    for (const target of dirty) await fs.rmdir(target);
    cleaned = true;
  }
  if (!cleaned || hash(await fs.readFile(executable)) !== artifact.installed_executable_sha256
    || hash(await fs.readFile(archive)) !== artifact.installed_asar_sha256) fail('artifact_or_cleanup_changed');
  return Object.freeze({ schema: 'metaengine.browser.installed-owner-consumer-proof.v1', state: 'PASSED_ISOLATED_REAL_RUNTIME',
    consumer, ...identity, ...artifact, qualifier_sha256: hash(await fs.readFile(fileURLToPath(import.meta.url))),
    real_local_runtime_attested: true, runtime_instance_id: current.instance_id, profile_isolated: true,
    fixture_source_rows_restored: 0, current_os_window_visible: observation.osWindow.visible,
    stable_window_verified: true, activation: observation.activation, fleet_degraded: observation.fleetDegraded,
    primary_exit_code: primaryClose.code, shutdown_exit_code: shutdownClose.code,
    process_cleanup_confirmed: true, runtime_host_lock_released: true, runtime_ports_closed: true,
    attached_postgres_incarnation_preserved: true, shutdown_method: 'EXISTING_INSTALLER_SHUTDOWN_BARRIER',
    installed_source_bytes_verified: true, live_agent_execution: false, production_ready: false,
    promotion_authorized: false, automatic_retry_allowed: false, authority_effect: false });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: Object.fromEntries([
      'consumer', 'install-root', 'source-root', 'expected-head', 'expected-version', 'owner-qa-root', 'evidence-dir',
    ].map(name => [name, { type: 'string' }])) });
    const proof = await qualifyInstalledOwnerConsumer({ consumer: values.consumer, installRoot: values['install-root'],
      sourceRoot: values['source-root'], expectedHead: values['expected-head'], expectedVersion: values['expected-version'],
      ownerQaRoot: values['owner-qa-root'], evidenceDirectory: values['evidence-dir'] });
    process.stdout.write(JSON.stringify(proof) + '\n');
  } catch (error) {
    const reason = /^installed_owner_consumer_[a-z0-9_]{1,100}$/.test(error?.message || '') ? error.message : 'installed_owner_consumer_contract_unproven';
    console.error(reason); process.exitCode = 1;
  }
}
