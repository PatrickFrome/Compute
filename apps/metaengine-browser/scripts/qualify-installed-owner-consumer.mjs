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
import { verifyMe2UiBundle } from './verify-me2-ui-bundle.mjs';
import { validateLocalStateProviderConfig, validateLocalStateRuntimeIdentity,
  localStateProviderHealthAttested } from '../src/local-state-provider-policy.mjs';

const require = createRequire(import.meta.url);
const { assertPackagedOfflineRuntimeBinding } = require('./offline-runtime-package-binding.cjs');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = reason => { throw new Error('installed_owner_consumer_' + reason); };
export const OWNER_CONSUMERS = Object.freeze(['FINAL_RUNTIME_ACTIVATION', 'SHELL_FIRST_DIRTY_PROFILE', 'AUTONOMOUS_SESSION_SOAK']);
const SOAK_FAILURE_CODES = new Set([
  'launch_ports_invalid', 'ui_endpoint_contract_invalid', 'other_failure',
  'packaged_browser_missing', 'proof_missing', 'activation_count_invalid', 'concurrent_burst_invalid',
  'activation_p95_budget_invalid', 'resource_budget_invalid', 'profile_probe_timeout', 'profile_probe_exit',
  'profile_probe_output_missing', 'profile_probe_contract_invalid', 'normal_ui_exited_early',
  'runtime_import_failed', 'normal_ui_not_stable_visible', 'runtime_import_success_missing',
  'startup_always_on_control_state_invalid', 'runtime_genesis_contract_invalid', 'runtime_genesis_initial_tabs_invalid',
  'normal_ui_exited_before_resource_baseline', 'startup_resource_baseline_unsettled',
  'zero_topology_startup_created_initial_tab', 'zero_topology_startup_started_initial_remote_load',
  'normal_ui_exited_before_me2_settle', 'me2_runtime_degraded', 'me2_runtime_not_settled',
  'normal_ui_exited_before_resource_plateau', 'me2_resource_baseline_not_stable',
  'secondary_timeout', 'secondary_exit', 'secondary_ack_missing', 'secondary_ack_invalid', 'duplicate_launch_id',
  'primary_activation_missing', 'activation_sequence_not_monotonic', 'activation_ack_sequence_drift',
  'activation_sequence_duplicate', 'primary_died_after_activation', 'burst_secondary_timeout',
  'burst_secondary_exit', 'burst_secondary_ack_missing', 'burst_secondary_ack_invalid', 'burst_duplicate_launch_id',
  'burst_primary_activation_missing', 'burst_activation_ack_sequence_drift', 'burst_activation_sequence_duplicate',
  'primary_died_during_post_activation_hold', 'runtime_import_failed_after_activation_burst',
  'redundant_durable_second_instance_marker_present', 'activation_p95_budget_exceeded',
  'working_set_growth_budget_exceeded', 'handle_growth_budget_exceeded', 'concurrent_burst_budget_exceeded',
  'activation_count_mismatch', 'shutdown_signal_timeout', 'shutdown_signal_failed', 'shutdown_primary_timeout',
  'primary_cleanup_unconfirmed',
]);
// Diagnostic only. Never forward the child command, stderr, suffix values or
// private paths, and never turn a classified failure into a successful proof.
export function ownerSessionSoakFailureCode(error) {
  const fallback = 'session_soak_physical_failed';
  if (error?.code === 'ETIMEDOUT') return 'session_soak_process_timeout';
  if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'session_soak_output_limit';
  // execFile reports its own timeout with killed:true and no ETIMEDOUT code,
  // exactly as an explicit kill. Preserve that uncertainty without changing
  // the native timeout, process lifecycle or failure boundary.
  if (error?.killed === true) return 'session_soak_process_terminated_or_timed_out';
  if (typeof error?.stderr !== 'string' || Buffer.byteLength(error.stderr) > 1024 * 1024) return fallback;
  const reasons = new Set();
  for (const match of error.stderr.matchAll(/^\s*(?:\+\s*)?FullyQualifiedErrorId\s*:\s*soak_([a-z0-9_]+)(?=[:\s]|$)/gm)) {
    const code = match[1].replace(/^profile_probe_exit_\d+$/, 'profile_probe_exit');
    if (!SOAK_FAILURE_CODES.has(code)) return fallback;
    reasons.add(code);
  }
  if (reasons.size !== 1) return fallback;
  return 'session_soak_' + [...reasons][0];
}

const SOAK_DIAGNOSTIC_LIMIT = 32768;
const SOAK_PHASES = new Set(['PROFILE_PROBE', 'NORMAL_UI_START', 'PRIMARY_WINDOW_READINESS',
  'STARTUP_CONTRACT', 'STARTUP_SUBSYSTEMS', 'ME2_READINESS', 'RESOURCE_BASELINE',
  'SEQUENTIAL_ACTIVATIONS', 'BURST_ACTIVATIONS', 'POST_ACTIVATION_HOLD', 'RESOURCE_BUDGETS',
  'SHUTDOWN', 'COMPLETE']);
const CONSUMER_SOAK_PHASES = new Set(['UI_INTEGRITY_BASELINE', 'PHYSICAL_SOAK', 'SESSION_PROOF',
  'RUNTIME_ATTESTATION', 'CLEANUP_READBACK', 'OWNER_PRESERVATION', 'POST_EXIT_INTEGRITY', 'COMPLETE']);
const SOAK_OBSERVATIONS = new Set(['RUNTIME_STATUS_UNAVAILABLE', 'RUNTIME_STATUS_INVALID',
  'HEALTH_PROBE_FAILED', 'HEALTH_HTTP_REJECTED', 'HEALTH_RESPONSE_INVALID',
  'RUNTIME_ATTESTATION_UNPROVEN', 'PRIMARY_RECORD_UNAVAILABLE', 'PRIMARY_RECORD_INVALID',
  'NATIVE_WINDOW_UNVERIFIED']);
const ME2_FAILURE_EVENTS = new Map([
  ['metaengine.browser.me2.ui-host.v1', new Set(['UI_DIR_NOT_FOUND', 'UI_INITIAL_READINESS_FAILED', 'SPAWN_ERROR', 'RESTARTS_EXHAUSTED'])],
  ['metaengine.browser.me2.daemon-host.v1', new Set(['DAEMON_LAUNCH_NOT_FOUND', 'DAEMON_INITIAL_READINESS_FAILED', 'SPAWN_ERROR', 'RESTARTS_EXHAUSTED'])],
  ['metaengine.browser.me2.integration.v1', new Set(['ME2_CONTRACT_MISMATCH', 'ME2_CONTRACT_UNREACHABLE', 'DAEMON_HOST_START_FAILED', 'UI_HOST_START_FAILED'])],
  ['metaengine.browser.me2-r97-installed-ui.v1', new Set(['ME2_R97_UI_CONTRACT_INCOMPLETE'])],
]);
const CONSUMER_SOAK_FAILURES = new Set(['session_soak_physical_failed', 'session_soak_process_timeout',
  'session_soak_output_limit', 'session_soak_process_terminated_or_timed_out',
  'session_soak_unproven', 'session_soak_budget_unproven', 'session_soak_pid_invalid',
  'session_soak_activation_receipts_unproven',
  'session_soak_attestation_missing', 'runtime_readback_unproven', 'cleanup_unconfirmed',
  'port_probe_timeout', 'port_still_open', 'port_probe_failed', 'runtime_process_still_alive',
  'owner_input_changed', 'artifact_or_cleanup_changed', 'session_soak_ui_integrity_unproven',
  'session_soak_ui_integrity_changed', 'session_soak_runtime_integrity_unproven',
  ...[...SOAK_FAILURE_CODES].map(code => 'session_soak_' + code)]);
const fixed = (value, allowed, fallback = 'UNKNOWN') => allowed.has(value) ? value : fallback;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
const flag = value => typeof value === 'boolean' ? value : null;
const processDiagnostic = value => ({ pid: integer(value?.pid, 1, 2147483647),
  exited: flag(value?.exited), exit_code: integer(value?.exit_code, -2147483648, 4294967295) });
const portsDiagnostic = value => Object.fromEntries(['ui', 'gateway', 'daemon'].map(key => [key, integer(value?.[key], 1, 65535)]));
const failureDiagnostic = value => value && SOAK_FAILURE_CODES.has(value.code)
  ? { code: value.code, phase: fixed(value.phase, SOAK_PHASES) } : null;
const runtimeDiagnostic = value => ({
  state: fixed(value?.state, new Set(['STARTING', 'READY', 'STOPPING', 'STOPPED', 'FAILED'])),
  runtime_ready: flag(value?.runtime_ready), children_stopped: flag(value?.children_stopped),
  host_pid: integer(value?.host_pid, 1, 2147483647),
  children: ['api', 'edge'].map(name => ({ name,
    pid: integer(Array.isArray(value?.children) && value.children.length <= 8
      ? value.children.find(child => child?.name === name)?.pid : null, 1, 2147483647) })),
});

// The PowerShell checkpoint is untrusted diagnostic input, never an authority
// or readiness receipt. Re-project every field instead of copying JSON/logs.
export function summarizeOwnerSessionSoakCheckpoint(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > SOAK_DIAGNOSTIC_LIMIT) return { readback: 'OVERSIZED', checkpoint: null };
  let row;
  try { row = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, '')); } catch { return { readback: 'INVALID', checkpoint: null }; }
  if (row?.schema !== 'metaengine.browser.session-soak-diagnostics.v1' || row.diagnostic_only !== true
    || row.qualification_proven !== false || row.automatic_retry_allowed !== false || row.authority_effect !== false)
    return { readback: 'INVALID', checkpoint: null };
  const me2Failure = ME2_FAILURE_EVENTS.get(row.me2_failure?.schema)?.has(row.me2_failure?.event)
    ? { schema: row.me2_failure.schema, event: row.me2_failure.event } : null;
  return { readback: 'AVAILABLE', checkpoint: {
    state: fixed(row.state, new Set(['RUNNING', 'FAILED', 'PASSED'])), phase: fixed(row.phase, SOAK_PHASES),
    elapsed_ms: integer(row.elapsed_ms, 0, 86400000), sequence: integer(row.sequence, 0, 1000000),
    first_failure: failureDiagnostic(row.first_failure), cleanup_failure: failureDiagnostic(row.cleanup_failure),
    process: processDiagnostic(row.process), ports: portsDiagnostic(row.ports),
    readiness: Object.fromEntries(['daemon', 'contract', 'ui_started', 'ui', 'gateway', 'mission_removed', 'primary_shell', 'r97_dom']
      .map(key => [key, flag(row.readiness?.[key])])),
    ui_http: { status: integer(row.ui_http?.status, 100, 599),
      outcome: fixed(row.ui_http?.outcome, new Set(['UNOBSERVED', 'READY', 'HTTP_REJECTED', 'PROBE_FAILED'])) },
    me2_failure: me2Failure, verified_activation_count: integer(row.verified_activation_count, 0, 112),
  } };
}

async function readSoakCheckpoint(directory) {
  let handle;
  try {
    const file = path.join(directory, 'soak-diagnostics.json');
    const link = await fs.lstat(file);
    if (!link.isFile() || link.isSymbolicLink() || link.nlink !== 1) return { readback: 'INVALID', checkpoint: null };
    if (link.size > SOAK_DIAGNOSTIC_LIMIT) return { readback: 'OVERSIZED', checkpoint: null };
    handle = await fs.open(file, 'r');
    const opened = await handle.stat();
    if (!opened.isFile() || opened.nlink !== 1 || opened.dev !== link.dev || opened.ino !== link.ino)
      return { readback: 'INVALID', checkpoint: null };
    const bytes = Buffer.alloc(SOAK_DIAGNOSTIC_LIMIT + 1);
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    return summarizeOwnerSessionSoakCheckpoint(bytes.subarray(0, bytesRead));
  } catch (error) { return { readback: error?.code === 'ENOENT' ? 'MISSING' : 'UNAVAILABLE', checkpoint: null }; }
  finally { await handle?.close().catch(() => {}); }
}

function consumerSoakFailureCode(error) {
  const message = error?.message;
  if (typeof message === 'string' && message.startsWith('installed_owner_consumer_')) {
    const code = message.slice('installed_owner_consumer_'.length);
    if (CONSUMER_SOAK_FAILURES.has(code)) return code;
  }
  return 'contract_unproven';
}

// A timeout can prevent PowerShell's finally from running. The independent
// parent writes the last bounded checkpoint plus its own terminal observation.
// Neither a PASSED checkpoint nor this terminal record is a qualification proof.
export async function withOwnerSessionSoakTerminalDiagnostics({ directory, sourceHead, version, ports, context, readRuntime, run }) {
  let originalError = null, failed = false;
  try { return await run(); }
  catch (error) { failed = true; originalError = error; throw error; }
  finally {
    try {
      const readback = await readSoakCheckpoint(directory);
      let runtime = context.runtime, runtimeReadback = runtime ? 'LAST_OBSERVATION' : 'UNAVAILABLE';
      if (readRuntime) {
        try { runtime = await readRuntime(); runtimeReadback = 'TERMINAL'; }
        catch { /* Preserve the explicitly labelled last observation. */ }
      }
      const nativeError = originalError?.cause || originalError;
      const runner = context.runner;
      const terminal = {
        schema: 'metaengine.browser.session-soak-terminal-diagnostics.v1',
        state: failed ? 'FAILED' : 'PASSED',
        source_head: /^[a-f0-9]{40}$/.test(sourceHead || '') ? sourceHead : null,
        package_version: /^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(version || '') ? version : null,
        consumer_phase: fixed(context.phase, CONSUMER_SOAK_PHASES),
        failure_code: failed ? consumerSoakFailureCode(originalError) : null,
        runner: { ...processDiagnostic({ pid: runner?.pid, exited: runner ? context.runnerSettled : null,
          exit_code: runner?.exitCode ?? (typeof nativeError?.code === 'number' ? nativeError.code : null) }),
          signal: fixed(runner?.signalCode ?? nativeError?.signal, new Set(['SIGTERM', 'SIGKILL', 'SIGINT', 'SIGBREAK']), null),
          killed: nativeError?.killed === true,
          error_code: fixed(nativeError?.code, new Set(['ETIMEDOUT', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ENOENT', 'EACCES']), null),
          deadline_ms: runner ? integer(context.runnerDeadlineMs, 1, 900000) : null },
        ports: portsDiagnostic(ports), runtime: runtimeDiagnostic(runtime), runtime_readback: runtimeReadback,
        observer: { first_failure: fixed(context.firstObservationFailure, SOAK_OBSERVATIONS, null),
          last_failure: fixed(context.lastObservationFailure, SOAK_OBSERVATIONS, null),
          runtime_attested: context.runtimeAttested === true, native_window_verified: context.nativeWindowVerified === true },
        ...readback, diagnostic_only: true, qualification_proven: false,
        automatic_retry_allowed: false, authority_effect: false,
      };
      const bytes = JSON.stringify(terminal) + '\n';
      if (Buffer.byteLength(bytes) > SOAK_DIAGNOSTIC_LIMIT) throw new Error('soak_terminal_size_invalid');
      const file = await fs.open(path.join(directory, 'soak-terminal-diagnostics.json'), 'wx', 0o600);
      try { await file.writeFile(bytes); await file.sync(); } finally { await file.close(); }
    } catch { /* Diagnostic I/O never replaces the original failure or grants a retry. */ }
  }
}

export function assertOwnerSessionSoakUiIntegrity(before, after) {
  for (const value of [before, after]) {
    if (!/^[a-f0-9]{64}$/.test(value?.manifest_sha256 || '')
      || !/^[a-f0-9]{64}$/.test(value?.content_sha256 || '')) fail('session_soak_ui_integrity_unproven');
  }
  if (before.manifest_sha256 !== after.manifest_sha256 || before.content_sha256 !== after.content_sha256
    || before.git_sha !== after.git_sha || before.content_file_count !== after.content_file_count
    || before.content_hash_scheme !== after.content_hash_scheme || before.installed_size_bytes !== after.installed_size_bytes)
    fail('session_soak_ui_integrity_changed');
  return { installed_ui_manifest_sha256: before.manifest_sha256, installed_ui_content_sha256: before.content_sha256,
    post_exit_ui_manifest_sha256: after.manifest_sha256, post_exit_ui_content_sha256: after.content_sha256,
    post_exit_ui_integrity_verified: true };
}
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
  if (!Array.isArray(proof.activation_receipts) || proof.activation_receipts.length !== 72) fail('session_soak_activation_receipts_unproven');
  const indexes = { SEQUENTIAL: new Set(), BURST: new Set() }, launchIds = new Set(), sequences = new Set();
  for (const row of proof.activation_receipts) {
    const group = row?.kind === 'SEQUENTIAL' ? indexes.SEQUENTIAL : row?.kind === 'BURST' ? indexes.BURST : null;
    const limit = row?.kind === 'SEQUENTIAL' ? 64 : 8;
    if (!group || !Number.isSafeInteger(row.index) || row.index < 1 || row.index > limit
      || group.has(row.index) || typeof row.launch_id !== 'string'
      || !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(row.launch_id)
      || launchIds.has(row.launch_id.toLowerCase()) || !Number.isSafeInteger(row.event_sequence) || row.event_sequence < 1
      || sequences.has(row.event_sequence) || row.primary_pid !== proof.primary_pid || row.visible !== true)
      fail('session_soak_activation_receipts_unproven');
    group.add(row.index); launchIds.add(row.launch_id.toLowerCase()); sequences.add(row.event_sequence);
  }
  if (indexes.SEQUENTIAL.size !== 64 || indexes.BURST.size !== 8) fail('session_soak_activation_receipts_unproven');
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
  if (consumer === 'AUTONOMOUS_SESSION_SOAK') {
    assertOwnerSessionSoak(proof.session_soak, {sourceHead, version});
    if (proof.post_exit_runtime_integrity_verified !== true || proof.post_exit_ui_integrity_verified !== true
      || proof.post_exit_runtime_bundle_sha256 !== bundleSha256
      || !/^[a-f0-9]{64}$/.test(proof.installed_ui_manifest_sha256 || '')
      || !/^[a-f0-9]{64}$/.test(proof.installed_ui_content_sha256 || '')
      || proof.post_exit_ui_manifest_sha256 !== proof.installed_ui_manifest_sha256
      || proof.post_exit_ui_content_sha256 !== proof.installed_ui_content_sha256) fail('session_soak_integrity_unproven');
  }
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
  const runtimeBinding = pkg.metaengineClientStateRuntime;
  const runtimeVerifierBytes = asar.extractFile(archive, path.normalize('infra/client-state-runtime/offline-runtime-bundle.mjs'));
  await assertPackagedOfflineRuntimeBinding(runtimeBinding, { expectedHead, packageVersion: expectedVersion, resourcesDir,
    verifierBytes: runtimeVerifierBytes });
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
    const context = { phase: 'UI_INTEGRITY_BASELINE', runnerSettled: false, runnerDeadlineMs: 900000 };
    return withOwnerSessionSoakTerminalDiagnostics({ directory, sourceHead: expectedHead, version: expectedVersion,
      ports: { ui: uiPort, gateway: gatewayPort, daemon: daemonPort }, context,
      readRuntime: async () => JSON.parse(await regularBytes(owner.runtime_identity_file)), run: async () => {
    let uiBefore;
    try { uiBefore = verifyMe2UiBundle(path.join(resourcesDir, 'me2-ui'), expectedHead); }
    catch (error) { throw new Error('installed_owner_consumer_session_soak_ui_integrity_unproven', { cause: error }); }
    const proofFile = path.join(directory, 'windows-autonomous-soak-proof.json');
    await fs.writeFile(proofFile, JSON.stringify({schema:'metaengine.browser.windows-autonomous-soak.v3',
      source_head:expectedHead,package_version:expectedVersion,normal_ui_boot_verified:false,
      second_instance_activations_verified:0,signed:false,published:false,promotion_authorized:false,
      authority_effect:false})+'\n', {flag:'wx',mode:0o600});
    let finished = false, current = null, attestedHealth = null, nativeWindow = null;
    context.phase = 'PHYSICAL_SOAK';
    const task = promisify(execFile)('powershell.exe', ['-NoLogo','-NoProfile','-NonInteractive',
      '-ExecutionPolicy','Bypass','-File',path.join(sourceRoot,'apps/metaengine-browser/scripts/windows-autonomous-session-soak.ps1'),
      '-AppPath',executable,'-ProofPath',proofFile,'-RunnerTemp',directory],
      {env:{...env,RUNNER_TEMP:directory},windowsHide:true,timeout:900000,maxBuffer:1024*1024});
    context.runner = task.child;
    // Observe fresh runtime attestation while the real UI is running, rather
    // than inferring runtime readiness from a final success flag.
    task.then(()=>{finished=true;context.runnerSettled=true;},()=>{finished=true;context.runnerSettled=true;});
    const observeFailure = code => {
      context.firstObservationFailure ??= code;
      context.lastObservationFailure = code;
    };
    while (!finished) {
      let observationFailure = 'RUNTIME_STATUS_UNAVAILABLE';
      try {
        const status = JSON.parse(await regularBytes(owner.runtime_identity_file));
        context.runtime = runtimeDiagnostic(status);
        observationFailure = 'RUNTIME_STATUS_INVALID';
        if (!status || typeof status !== 'object' || Array.isArray(status)) throw new Error('untrusted_runtime_status');
        observationFailure = 'HEALTH_PROBE_FAILED';
        const response = await fetch(owner.base_url+'/health',{signal:AbortSignal.timeout(2000)});
        observationFailure = 'HEALTH_RESPONSE_INVALID';
        const health = response.ok ? await response.json() : null;
        if (response.ok && status.instance_id !== previous.instance_id
          && status.bundle_sha256 === owner.runtime_host.expected_bundle_sha256
          && status.postgres_mode === 'attached' && status.api_role_mode === 'direct'
          && localStateProviderHealthAttested(health,status.instance_id)) {
          current=status;attestedHealth=health;
          context.runtimeAttested = true;
          if(!nativeWindow){
            observationFailure = 'PRIMARY_RECORD_UNAVAILABLE';
            const running=JSON.parse((await regularBytes(path.join(directory,'soak-running-primary.json'))).toString('utf8').replace(/^\uFEFF/,''));
            if(running.version===expectedVersion&&Number.isSafeInteger(running.pid)&&running.pid>0) {
              observationFailure = 'NATIVE_WINDOW_UNVERIFIED';
              nativeWindow=await verifyInstalledVisiblePrimaryWindow(running.pid);
              context.nativeWindowVerified = nativeWindow?.visible === true;
            } else observeFailure('PRIMARY_RECORD_INVALID');
          }
        } else observeFailure(response.ok ? 'RUNTIME_ATTESTATION_UNPROVEN' : 'HEALTH_HTTP_REJECTED');
      } catch { observeFailure(observationFailure); }
      if (!finished) await delay(250);
    }
    try { await task; }
    catch (error) { throw new Error('installed_owner_consumer_' + ownerSessionSoakFailureCode(error), { cause: error }); }
    context.phase = 'SESSION_PROOF';
    const soak = assertOwnerSessionSoak(JSON.parse((await regularBytes(proofFile)).toString('utf8').replace(/^\uFEFF/,'')),{sourceHead:expectedHead,version:expectedVersion});
    context.phase = 'RUNTIME_ATTESTATION';
    if (!current || nativeWindow?.pid !== soak.primary_pid || nativeWindow.visible!==true) fail('session_soak_attestation_missing');
    assertOwnerConsumerRuntime({previous,current,health:attestedHealth,owner,pid:soak.primary_pid,postgresPid});
    context.phase = 'CLEANUP_READBACK';
    const stopped = JSON.parse(await regularBytes(owner.runtime_identity_file));
    context.runtime = runtimeDiagnostic(stopped);
    assertOwnerConsumerStopped({current,stopped,primaryClose:{code:0,signal:null},shutdownClose:{code:0,signal:null}});
    await assert.rejects(fs.lstat(path.join(config.state_directory,'runtime-host-lock.json')),{code:'ENOENT'});
    for (const port of [config.api_port,config.edge_port,...ports]) await closedPort(port);
    for (const pid of [soak.primary_pid,current.host_pid,...current.children.map(child=>child.pid)]) {
      try { process.kill(pid,0); fail('runtime_process_still_alive'); } catch(error) { if(error.code!=='ESRCH')throw error; }
    }
    context.phase = 'OWNER_PRESERVATION';
    if (!(await regularBytes(postmasterFile)).equals(pgBefore)
      || !(await regularBytes(ownerFile)).equals(ownerBytes)
      || !(await regularBytes(owner.runtime_host.config_file)).equals(configBytes)) fail('owner_input_changed');
    process.kill(postgresPid,0);
    context.phase = 'POST_EXIT_INTEGRITY';
    if(hash(await fs.readFile(executable))!==artifact.installed_executable_sha256
      ||hash(await fs.readFile(archive))!==artifact.installed_asar_sha256)fail('artifact_or_cleanup_changed');
    let uiAfter;
    try { uiAfter = verifyMe2UiBundle(path.join(resourcesDir, 'me2-ui'), expectedHead); }
    catch (error) { throw new Error('installed_owner_consumer_session_soak_ui_integrity_unproven', { cause: error }); }
    const uiIntegrity = assertOwnerSessionSoakUiIntegrity(uiBefore, uiAfter);
    try {
      await assertPackagedOfflineRuntimeBinding(runtimeBinding, { expectedHead, packageVersion: expectedVersion, resourcesDir,
        verifierBytes: runtimeVerifierBytes });
    } catch (error) { throw new Error('installed_owner_consumer_session_soak_runtime_integrity_unproven', { cause: error }); }
    context.phase = 'COMPLETE';
    return Object.freeze({schema:'metaengine.browser.installed-owner-consumer-proof.v1',state:'PASSED_ISOLATED_REAL_RUNTIME',
      consumer,...identity,...artifact,qualifier_sha256:hash(await fs.readFile(fileURLToPath(import.meta.url))),
      real_local_runtime_attested:true,runtime_instance_id:current.instance_id,profile_isolated:true,
      fixture_source_rows_restored:0,current_os_window_visible:true,stable_window_verified:true,
      session_soak:soak,activation:null,fleet_degraded:false,primary_exit_code:0,shutdown_exit_code:0,
      process_cleanup_confirmed:true,runtime_host_lock_released:true,runtime_ports_closed:true,
      attached_postgres_incarnation_preserved:true,shutdown_method:'EXISTING_INSTALLER_SHUTDOWN_BARRIER',
      installed_source_bytes_verified:true,...uiIntegrity,post_exit_runtime_integrity_verified:true,
      post_exit_runtime_bundle_sha256:runtimeBinding.bundle_sha256,
      live_agent_execution:false,production_ready:false,promotion_authorized:false,
      automatic_retry_allowed:false,authority_effect:false});
    } });
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
