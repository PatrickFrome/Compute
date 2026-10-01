import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import {
  loadPackagedEmergencyMaintenanceTrustRoot,
} from './emergency-maintenance-trust-root.mjs';
import {
  BrowserGuardianUpdateActuatorClient,
  requestGuardianUpdatePipe,
} from './browser-guardian-update-actuator-client.mjs';

export const BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_BINDING_SCHEMA =
  'metaengine.browser-guardian.machine-bootstrap-binding.v1';
export const BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA =
  'metaengine.browser-guardian.machine-bootstrap-launcher.v1';

const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const SLOT = /^[0-9a-f]{16}-[0-9a-f]{16}$/;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function state(state, reason, extra = {}) {
  return freeze({
    schema: BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA,
    state,
    reason,
    ready: state === 'READY',
    explicit_user_action_required: state !== 'READY',
    uac_consent_required: state === 'ACTIVATION_REQUIRED',
    fixed_packaged_bootstrap: true,
    caller_supplied_path_used: false,
    caller_supplied_arguments_used: false,
    arbitrary_shell_used: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

export function validateGuardianMachineBootstrapBinding(
  input,
  { expectedBuildSha = null, expectedVersion = null } = {},
) {
  if (!input || input.schema !== BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_BINDING_SCHEMA) {
    throw new Error('guardian_machine_bootstrap_binding_schema_invalid');
  }
  const sourceHead = String(input.source_head || '').trim().toLowerCase();
  const version = String(input.package_version || '').trim();
  const slotId = String(input.slot_id || '').trim().toLowerCase();
  const bootstrapName = String(input.bootstrap_name || '');
  const bootstrapSha256 = String(input.bootstrap_sha256 || '').trim().toLowerCase();
  const bootstrapSize = Number(input.bootstrap_size);
  if (!SHA40.test(sourceHead)) throw new Error('guardian_machine_bootstrap_source_head_invalid');
  if (expectedBuildSha != null && sourceHead !== String(expectedBuildSha).trim().toLowerCase()) {
    throw new Error('guardian_machine_bootstrap_source_head_mismatch');
  }
  if (!VERSION.test(version)) throw new Error('guardian_machine_bootstrap_version_invalid');
  if (expectedVersion != null && version !== String(expectedVersion)) {
    throw new Error('guardian_machine_bootstrap_version_mismatch');
  }
  if (!SLOT.test(slotId)) throw new Error('guardian_machine_bootstrap_slot_invalid');
  if (bootstrapName !== `METAENGINE-Guardian-Bootstrap-${version}-x64.exe`) {
    throw new Error('guardian_machine_bootstrap_name_invalid');
  }
  if (!SHA256.test(bootstrapSha256)
      || !Number.isSafeInteger(bootstrapSize)
      || bootstrapSize < 64 * 1024
      || bootstrapSize > 32 * 1024 * 1024) {
    throw new Error('guardian_machine_bootstrap_bytes_invalid');
  }
  for (const field of ['guardian_manifest_sha256', 'service_sha256', 'configurator_sha256']) {
    if (!SHA256.test(String(input[field] || '').trim().toLowerCase())) {
      throw new Error(`guardian_machine_bootstrap_${field}_invalid`);
    }
  }
  if (input.embedded_assets_only !== true
      || input.explicit_elevated_install_required !== true
      || input.automatic_retry_allowed !== false
      || input.authority_effect !== false) {
    throw new Error('guardian_machine_bootstrap_contract_invalid');
  }
  return freeze({
    schema: BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_BINDING_SCHEMA,
    source_head: sourceHead,
    package_version: version,
    slot_id: slotId,
    bootstrap_name: bootstrapName,
    bootstrap_sha256: bootstrapSha256,
    bootstrap_size: bootstrapSize,
    guardian_manifest_sha256: String(input.guardian_manifest_sha256).toLowerCase(),
    service_sha256: String(input.service_sha256).toLowerCase(),
    configurator_sha256: String(input.configurator_sha256).toLowerCase(),
    embedded_assets_only: true,
    explicit_elevated_install_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

export function loadPackagedGuardianMachineBootstrapBinding({
  packageJsonUrl = new URL('../package.json', import.meta.url),
  expectedBuildSha = null,
  expectedVersion = null,
} = {}) {
  let packageJson;
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonUrl, 'utf8'));
  } catch {
    throw new Error('guardian_machine_bootstrap_package_metadata_unreadable');
  }
  return validateGuardianMachineBootstrapBinding(
    packageJson?.metaengineGuardianBootstrapBinding,
    { expectedBuildSha, expectedVersion },
  );
}

function sha256File(filePath) {
  const bytes = fs.readFileSync(filePath);
  return {
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}

export function verifyPackagedGuardianBootstrapExecutable({
  binding,
  resourcesPath,
  expectedBuildSha,
  expectedVersion,
} = {}) {
  const exact = validateGuardianMachineBootstrapBinding(binding, {
    expectedBuildSha,
    expectedVersion,
  });
  const root = path.resolve(String(resourcesPath || ''));
  if (!root || root === path.parse(root).root) throw new Error('guardian_machine_bootstrap_resources_root_invalid');
  const dir = path.join(root, 'guardian-bootstrap');
  const executable = path.join(dir, exact.bootstrap_name);
  const dirStat = fs.lstatSync(dir);
  const exeStat = fs.lstatSync(executable);
  if (!dirStat.isDirectory() || dirStat.isSymbolicLink()) {
    throw new Error('guardian_machine_bootstrap_directory_untrusted');
  }
  if (!exeStat.isFile() || exeStat.isSymbolicLink()) {
    throw new Error('guardian_machine_bootstrap_executable_untrusted');
  }
  if (path.resolve(executable) !== executable) throw new Error('guardian_machine_bootstrap_path_invalid');
  const bytes = sha256File(executable);
  if (bytes.size !== exact.bootstrap_size || bytes.sha256 !== exact.bootstrap_sha256) {
    throw new Error('guardian_machine_bootstrap_executable_identity_mismatch');
  }
  return freeze({
    binding: exact,
    executable,
    executable_sha256: bytes.sha256,
    executable_size: bytes.size,
    fixed_path: true,
    symlink_rejected: true,
    authority_effect: false,
  });
}

function ownerObservationState(result, binding) {
  if (result?.state === 'OWNER_BOUND'
      && result.owner_binding_proven === true
      && result.device_binding_proven === true) {
    return state('READY', 'GUARDIAN_OWNER_AND_DEVICE_BOUND', {
      source_head: binding.source_head,
      package_version: binding.package_version,
      guardian_service_ready: true,
      owner_binding_proven: true,
      device_binding_proven: true,
      uac_consent_required: false,
      explicit_user_action_required: false,
    });
  }
  if (result?.state === 'NO_EFFECT_PROVEN'
      && result?.reason === 'OWNER_ENROLLMENT_TICKET_REQUIRED'
      && result.effect_absent_proven === true) {
    return state('OWNER_ENROLLMENT_REQUIRED', 'GUARDIAN_SERVICE_READY_OWNER_BINDING_REQUIRED', {
      source_head: binding.source_head,
      package_version: binding.package_version,
      guardian_service_ready: true,
      owner_binding_proven: false,
      device_binding_proven: false,
      uac_consent_required: false,
    });
  }
  if (result?.state === 'AMBIGUOUS') {
    return state('AMBIGUOUS', String(result.reason || 'GUARDIAN_OWNER_OBSERVATION_AMBIGUOUS'), {
      source_head: binding.source_head,
      package_version: binding.package_version,
      guardian_service_ready: true,
    });
  }
  return state('HOLD', String(result?.reason || 'GUARDIAN_OWNER_OBSERVATION_UNPROVEN'), {
    source_head: binding.source_head,
    package_version: binding.package_version,
    guardian_service_ready: true,
  });
}

export function createBrowserGuardianMachineBootstrapLauncher({
  platform = process.platform,
  isPackaged = false,
  resourcesPath = '',
  version = '',
  identity,
  openPath,
  bindingLoader = loadPackagedGuardianMachineBootstrapBinding,
  trustRootLoader = loadPackagedEmergencyMaintenanceTrustRoot,
  actuatorFactory = null,
  launchTimeoutMs = 60_000,
  readbackTimeoutMs = 30_000,
  pollIntervalMs = 300,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  if (!identity
      || typeof identity.randomNonce !== 'function'
      || typeof identity.guardianOwnerChallenge !== 'function'
      || typeof identity.guardianUpdateActuatorProof !== 'function') {
    throw new Error('guardian_machine_bootstrap_identity_required');
  }
  if (typeof openPath !== 'function') throw new Error('guardian_machine_bootstrap_open_path_required');
  if (bindingLoader != null && typeof bindingLoader !== 'function') throw new Error('guardian_machine_bootstrap_binding_loader_invalid');
  if (trustRootLoader != null && typeof trustRootLoader !== 'function') throw new Error('guardian_machine_bootstrap_trust_root_loader_invalid');
  if (!Number.isSafeInteger(launchTimeoutMs) || launchTimeoutMs < 1 || launchTimeoutMs > 120_000) {
    throw new Error('guardian_machine_bootstrap_launch_timeout_invalid');
  }
  const timeout = Math.max(2_000, Math.min(60_000, Number(readbackTimeoutMs) || 30_000));
  const poll = Math.max(100, Math.min(2_000, Number(pollIntervalMs) || 300));
  let inFlight = null;

  function prepared() {
    if (platform !== 'win32') return { result: state('UNAVAILABLE', 'GUARDIAN_MACHINE_BOOTSTRAP_WINDOWS_REQUIRED') };
    if (isPackaged !== true) return { result: state('UNAVAILABLE', 'PACKAGED_BROWSER_REQUIRED') };
    let trustRoot;
    let binding;
    let executable;
    try {
      trustRoot = trustRootLoader();
      binding = bindingLoader({
        expectedBuildSha: trustRoot.build_sha,
        expectedVersion: version,
      });
      executable = verifyPackagedGuardianBootstrapExecutable({
        binding,
        resourcesPath,
        expectedBuildSha: trustRoot.build_sha,
        expectedVersion: version,
      });
    } catch (error) {
      return {
        result: state('HOLD', 'PROTECTED_BOOTSTRAP_IDENTITY_UNPROVEN', {
          error: String(error?.message || error).slice(0, 240),
        }),
      };
    }
    return { trustRoot, binding, executable };
  }

  function actuator() {
    if (typeof actuatorFactory === 'function') return actuatorFactory();
    return new BrowserGuardianUpdateActuatorClient({
      identity,
      transport: (wire) => requestGuardianUpdatePipe(wire, { timeoutMs: 2_000 }),
    });
  }

  async function observePrepared(preparedValue) {
    const commandId = crypto.randomUUID();
    const requestNonce = identity.randomNonce();
    try {
      const result = await actuator().observeOwner({
        command_id: commandId,
        request_nonce: requestNonce,
      });
      return ownerObservationState(result, preparedValue.binding);
    } catch (error) {
      const message = String(error?.message || error);
      if (/guardian_update_actuator_pipe_(?:error|timeout|ended_without_result)/.test(message)) {
        return state('ACTIVATION_REQUIRED', 'GUARDIAN_SERVICE_NOT_REACHABLE', {
          source_head: preparedValue.binding.source_head,
          package_version: preparedValue.binding.package_version,
          guardian_service_ready: false,
          bootstrap_sha256: preparedValue.executable.executable_sha256,
        });
      }
      return state('HOLD', 'GUARDIAN_OWNER_OBSERVATION_FAILED', {
        source_head: preparedValue.binding.source_head,
        package_version: preparedValue.binding.package_version,
        error: message.slice(0, 240),
      });
    }
  }

  async function ensureOwner(preparedValue) {
    const commandId = crypto.randomUUID();
    const requestNonce = identity.randomNonce();
    try {
      const result = await actuator().ensureOwnerBound({
        command_id: commandId,
        request_nonce: requestNonce,
      });
      return ownerObservationState(result, preparedValue.binding);
    } catch (error) {
      const message = String(error?.message || error);
      const ambiguous = error?.code === 'GUARDIAN_OWNER_ENROLLMENT_AMBIGUOUS'
        || /guardian_owner_enrollment_(?:result_unknown|readback_unknown|ambiguous)/.test(message);
      return state(ambiguous ? 'AMBIGUOUS' : 'HOLD',
        ambiguous ? 'GUARDIAN_OWNER_ENROLLMENT_RESULT_UNKNOWN' : 'GUARDIAN_OWNER_ENROLLMENT_FAILED', {
          source_head: preparedValue.binding.source_head,
          package_version: preparedValue.binding.package_version,
          guardian_service_ready: true,
          error: message.slice(0, 240),
        });
    }
  }

  async function status() {
    const p = prepared();
    if (p.result) return p.result;
    return observePrepared(p);
  }

  async function activate() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const p = prepared();
      if (p.result) return p.result;

      const before = await observePrepared(p);
      if (before.state === 'READY') return before;
      if (before.state === 'OWNER_ENROLLMENT_REQUIRED') return ensureOwner(p);
      if (before.state === 'AMBIGUOUS' || before.state === 'HOLD' || before.state === 'UNAVAILABLE') return before;
      if (before.state !== 'ACTIVATION_REQUIRED') {
        return state('HOLD', 'GUARDIAN_ACTIVATION_PRECONDITION_INVALID');
      }

      let openError;
      let launchTimer;
      try {
        // A stalled/lost OS acknowledgement cannot hold IPC forever or prove
        // that elevation never happened. A late completion is not a retry.
        openError = await Promise.race([
          Promise.resolve().then(() => openPath(p.executable.executable)),
          new Promise((_, reject) => {
            launchTimer = setTimeout(() => reject(new Error('guardian_bootstrap_uac_launch_deadline')), launchTimeoutMs);
          }),
        ]);
      } catch (error) {
        return state('AMBIGUOUS', 'GUARDIAN_BOOTSTRAP_UAC_LAUNCH_OUTCOME_UNKNOWN', {
          source_head: p.binding.source_head,
          package_version: p.binding.package_version,
          error: String(error?.message || error).slice(0, 240),
          uac_launch_requested: true,
          physical_effect_outcome: 'UNPROVEN',
        });
      } finally {
        clearTimeout(launchTimer);
      }
      if (String(openError || '')) {
        return state('HOLD', 'GUARDIAN_BOOTSTRAP_UAC_LAUNCH_REJECTED', {
          source_head: p.binding.source_head,
          package_version: p.binding.package_version,
          error: String(openError).slice(0, 240),
          uac_launch_requested: true,
          physical_effect_outcome: 'UNPROVEN',
        });
      }

      const deadline = now() + timeout;
      while (now() < deadline) {
        await sleep(poll);
        const observed = await observePrepared(p);
        if (observed.state === 'ACTIVATION_REQUIRED') continue;
        if (observed.state === 'OWNER_ENROLLMENT_REQUIRED') {
          const bound = await ensureOwner(p);
          return freeze({ ...bound, uac_launch_requested: true });
        }
        return freeze({ ...observed, uac_launch_requested: true });
      }
      return state('HOLD', 'GUARDIAN_BOOTSTRAP_READBACK_TIMEOUT', {
        source_head: p.binding.source_head,
        package_version: p.binding.package_version,
        guardian_service_ready: false,
        uac_launch_requested: true,
        physical_effect_outcome: 'UNPROVEN',
      });
    })().finally(() => { inFlight = null; });
    return inFlight;
  }

  return Object.freeze({ status, activate });
}

export function browserGuardianMachineBootstrapLauncherContract() {
  return freeze({
    schema: BROWSER_GUARDIAN_MACHINE_BOOTSTRAP_LAUNCHER_SCHEMA,
    explicit_user_action_required: true,
    startup_auto_elevation_allowed: false,
    renderer_supplied_path_allowed: false,
    renderer_supplied_arguments_allowed: false,
    packaged_asar_binding_required: true,
    fixed_resources_subdirectory: 'guardian-bootstrap',
    exact_sha256_and_size_required: true,
    symlink_rejected: true,
    windows_uac_manifest_required: true,
    open_path_only: true,
    read_only_service_polling_allowed: true,
    single_owner_enrollment_attempt_after_service_readback: true,
    automatic_effect_retry_allowed: false,
    ambiguous_owner_enrollment_retry_allowed: false,
    bounded_uac_acknowledgement_required: true,
    lost_uac_acknowledgement_proves_no_effect: false,
    authority_effect: false,
  });
}
