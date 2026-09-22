import {
  DEVELOPER_EMERGENCY_UPDATE_ACTION,
  evaluateDeveloperEmergencyUpdateAdmission,
} from './developer-emergency-update-admission.mjs';
import {
  parseMetaengineDevVersion,
  resolveTrustedMetaengineDevRelease,
} from './trusted-dev-release-resolver.mjs';
import { stageGuardianUpdateIntake } from './browser-guardian-update-intake.mjs';
import { BrowserGuardianUpdateActuatorClient } from './browser-guardian-update-actuator-client.mjs';

export const NATIVE_GUARDIAN_DEVELOPER_EMERGENCY_SCHEMA = 'metaengine.developer-emergency-update-runtime.v1';

const GIT_SHA = /^[0-9a-f]{40}$/;
const SHA256 = /^[0-9a-f]{64}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NONCE = /^[A-Za-z0-9_-]{32,128}$/;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function baseReceipt(state, reason, extra = {}) {
  return freeze({
    schema: NATIVE_GUARDIAN_DEVELOPER_EMERGENCY_SCHEMA,
    state,
    reason,
    admitted: false,
    physical_dispatch_count: 0,
    physical_dispatch_count_known: true,
    physical_dispatch_upper_bound: 0,
    effect_outcome: state === 'AMBIGUOUS' ? 'AMBIGUOUS' : 'NO_EFFECT_PROVEN',
    automatic_retry_allowed: false,
    bypass_program_policy: true,
    bypassed_browser_mode: true,
    bypassed_browser_armed_state: true,
    bypassed_browser_rollout_policy: true,
    bypassed_browser_update_cadence: true,
    bypassed_browser_self_update_state: true,
    arbitrary_url_allowed: false,
    arbitrary_executable_allowed: false,
    arbitrary_shell_allowed: false,
    electron_updater_fallback_used: false,
    authority_effect: false,
    ...extra,
  });
}

function hold(reason, extra = {}) {
  return baseReceipt('HOLD', reason, extra);
}

function ambiguous(reason, {
  commandId = null,
  release = null,
  nativeResult = null,
  dispatchCount = 0,
  dispatchCountKnown = true,
  error = null,
} = {}) {
  return baseReceipt('AMBIGUOUS', reason, {
    admitted: true,
    command_id: commandId,
    effect_id: commandId,
    effect_generation: commandId ? 1 : null,
    candidate_git_sha: release?.git_sha || null,
    release_version: release?.version || null,
    installer_sha256: release?.installer_sha256 || null,
    manifest_sha256: release?.manifest_sha256 || null,
    installed_executable_sha256: release?.installed_executable_sha256 || null,
    physical_dispatch_count: dispatchCount,
    physical_dispatch_count_known: dispatchCountKnown,
    physical_dispatch_upper_bound: 1,
    effect_outcome: 'AMBIGUOUS',
    native_result: nativeResult ? structuredClone(nativeResult) : null,
    error: error ? String(error?.message || error).slice(0, 300) : null,
  });
}

function confirmed({ commandId, release, ownerProbe, nativeResult, dispatchCount }) {
  return baseReceipt('CONFIRMED', 'NATIVE_GUARDIAN_EXACT_SUCCESSOR_READY', {
    admitted: true,
    command_id: commandId,
    effect_id: commandId,
    effect_generation: 1,
    candidate_git_sha: release.git_sha,
    release_version: release.version,
    installer_sha256: release.installer_sha256,
    manifest_sha256: release.manifest_sha256,
    installed_executable_sha256: release.installed_executable_sha256,
    physical_dispatch_count: dispatchCount,
    physical_dispatch_count_known: true,
    physical_dispatch_upper_bound: 1,
    effect_outcome: 'CONFIRMED',
    owner_binding: {
      expected_owner_sid: ownerProbe.expected_owner_sid,
      enrollment_evidence_sha256: ownerProbe.enrollment_evidence_sha256,
      device_key_fingerprint_sha256: ownerProbe.device_key_fingerprint_sha256,
      owner_binding_proven: ownerProbe.owner_binding_proven === true,
      device_binding_proven: ownerProbe.device_binding_proven === true,
      authority_effect: false,
    },
    native_result: structuredClone(nativeResult),
  });
}

function exactTrustedRelease(release, currentVersion, expectedGitSha) {
  if (!release || release.schema !== 'metaengine.trusted-dev-release.v1' || release.authority_effect !== false) {
    throw new Error('emergency_trusted_release_required');
  }
  const current = parseMetaengineDevVersion(currentVersion);
  const next = parseMetaengineDevVersion(release.version);
  if (!current || !next || next.core !== current.core || next.build <= current.build) {
    throw new Error('emergency_trusted_successor_version_invalid');
  }
  const gitSha = String(release.git_sha || '').trim().toLowerCase();
  const installerSha = String(release.installer_sha256 || '').trim().toLowerCase();
  const manifestSha = String(release.manifest_sha256 || '').trim().toLowerCase();
  const installedSha = String(release.installed_executable_sha256 || '').trim().toLowerCase();
  if (!GIT_SHA.test(gitSha) || !SHA256.test(installerSha) || !SHA256.test(manifestSha) || !SHA256.test(installedSha)) {
    throw new Error('emergency_trusted_release_digest_invalid');
  }
  if (expectedGitSha && gitSha !== expectedGitSha) throw new Error('emergency_expected_git_sha_mismatch');
  if (release.target_present_proof_supported !== true) throw new Error('emergency_installed_executable_binding_required');
  if (String(release.tag || '') !== `v${next.version}`) throw new Error('emergency_release_tag_invalid');
  if (String(release.installer_name || '') !== `METAENGINE-Browser-Test-Setup-${next.version}-x64.exe`) {
    throw new Error('emergency_installer_name_invalid');
  }
  const expectedFeed = `https://github.com/PatrickFrome/Compute/releases/download/v${next.version}/`;
  if (String(release.feed_url || '') !== expectedFeed) throw new Error('emergency_release_feed_invalid');
  return freeze({
    ...structuredClone(release),
    version: next.version,
    git_sha: gitSha,
    installer_sha256: installerSha,
    manifest_sha256: manifestSha,
    installed_executable_sha256: installedSha,
  });
}

function exactIntake(intake, release) {
  if (!intake || intake.schema !== 'metaengine.browser-guardian.update-intake.v1'
      || intake.fixed_intake_layout !== true
      || intake.caller_supplied_path_used !== false
      || intake.caller_supplied_url_used !== false
      || intake.authority_effect !== false) {
    throw new Error('emergency_guardian_intake_invalid');
  }
  if (String(intake.release_version || '') !== release.version
      || String(intake.installer_sha256 || '').toLowerCase() !== release.installer_sha256
      || String(intake.manifest_sha256 || '').toLowerCase() !== release.manifest_sha256
      || String(intake.installed_executable_sha256 || '').toLowerCase() !== release.installed_executable_sha256) {
    throw new Error('emergency_guardian_intake_binding_mismatch');
  }
  return intake;
}

function exactCommandContext(command) {
  if (String(command?.action || '').toUpperCase() !== DEVELOPER_EMERGENCY_UPDATE_ACTION) return null;
  const preflight = evaluateDeveloperEmergencyUpdateAdmission({ command });
  if (preflight.reason === 'EMERGENCY_COMMAND_INVALID') return null;
  const commandId = String(command?.command_id || '').trim().toLowerCase();
  const requestNonce = String(command?.payload?.request_nonce || '');
  const expectedGitSha = command?.payload?.expected_git_sha == null
    ? null
    : String(command.payload.expected_git_sha).trim().toLowerCase();
  if (!UUID.test(commandId) || !NONCE.test(requestNonce) || (expectedGitSha != null && !GIT_SHA.test(expectedGitSha))) return null;
  return freeze({ commandId, requestNonce, expectedGitSha });
}

/**
 * Production bridge from the DB-leased DEVELOPER_EMERGENCY_UPDATE command to the
 * Windows Guardian actuator. The command id is deliberately reused as the native
 * effect id: replaying the same leased command therefore addresses the same durable
 * native write-ahead record and can never create a second installer dispatch.
 *
 * There is no retry loop. Any transport failure after DISPATCH is submitted is
 * classified AMBIGUOUS because the native barrier or physical effect may already
 * have happened. A subsequent command must use a new command/effect id and can only
 * be admitted after exact readback of the prior installed state.
 */
export function createNativeGuardianDeveloperEmergencyUpdateController({
  identity,
  currentVersion,
  fetchImpl = globalThis.fetch,
  githubApiToken = null,
  localAppData = null,
  platform = process.platform,
  releaseResolver = resolveTrustedMetaengineDevRelease,
  intakeStager = stageGuardianUpdateIntake,
  actuator = null,
} = {}) {
  if (!identity) throw new Error('emergency_native_identity_required');
  if (!parseMetaengineDevVersion(currentVersion)) throw new Error('emergency_native_current_version_invalid');
  if (typeof fetchImpl !== 'function') throw new Error('emergency_native_fetch_required');
  if (typeof releaseResolver !== 'function') throw new Error('emergency_native_release_resolver_required');
  if (typeof intakeStager !== 'function') throw new Error('emergency_native_intake_stager_required');
  const actuatorClient = actuator || new BrowserGuardianUpdateActuatorClient({ identity });
  if (typeof actuatorClient?.probeOwner !== 'function'
      || typeof actuatorClient?.dispatch !== 'function'
      || typeof actuatorClient?.observe !== 'function') {
    throw new Error('emergency_native_actuator_required');
  }

  return async function nativeGuardianDeveloperEmergencyUpdate(command) {
    const context = exactCommandContext(command);
    if (!context) return hold('EMERGENCY_COMMAND_INVALID');
    if (platform !== 'win32') return hold('NATIVE_GUARDIAN_WINDOWS_REQUIRED', {
      command_id: context.commandId,
      request_nonce: context.requestNonce,
    });

    let ownerProbe;
    try {
      ownerProbe = await actuatorClient.probeOwner({
        command_id: context.commandId,
        request_nonce: context.requestNonce,
      });
    } catch (error) {
      return hold('DEVELOPER_OWNER_DEVICE_BINDING_REQUIRED', {
        command_id: context.commandId,
        request_nonce: context.requestNonce,
        error: String(error?.message || error).slice(0, 300),
      });
    }

    let release;
    try {
      const resolved = await releaseResolver({
        currentVersion,
        fetchImpl,
        githubApiToken,
      });
      if (!resolved) return hold('TRUSTED_SUCCESSOR_NOT_AVAILABLE', {
        command_id: context.commandId,
        request_nonce: context.requestNonce,
        owner_binding_proven: true,
      });
      release = exactTrustedRelease(resolved, currentVersion, context.expectedGitSha);
    } catch (error) {
      return hold('VERIFIED_IMMUTABLE_RELEASE_REQUIRED', {
        command_id: context.commandId,
        request_nonce: context.requestNonce,
        owner_binding_proven: true,
        error: String(error?.message || error).slice(0, 300),
      });
    }

    try {
      const intake = await intakeStager({
        release,
        fetchImpl,
        ...(localAppData ? { localAppData } : {}),
      });
      exactIntake(intake, release);
    } catch (error) {
      return hold('EXACT_TRUSTED_UPDATE_INTAKE_REQUIRED', {
        command_id: context.commandId,
        request_nonce: context.requestNonce,
        candidate_git_sha: release.git_sha,
        release_version: release.version,
        error: String(error?.message || error).slice(0, 300),
      });
    }

    const nativeRequest = freeze({
      effect_id: context.commandId,
      effect_generation: 1,
      command_id: context.commandId,
      request_nonce: context.requestNonce,
      release_version: release.version,
      candidate_git_sha: release.git_sha,
      installer_sha256: release.installer_sha256,
      manifest_sha256: release.manifest_sha256,
      installed_executable_sha256: release.installed_executable_sha256,
    });

    let dispatch;
    try {
      dispatch = await actuatorClient.dispatch(nativeRequest);
    } catch (error) {
      return ambiguous('NATIVE_GUARDIAN_DISPATCH_RESULT_UNKNOWN', {
        commandId: context.commandId,
        release,
        dispatchCount: 0,
        dispatchCountKnown: false,
        error,
      });
    }

    const dispatchedHere = dispatch.physical_dispatch_performed === true ? 1 : 0;
    if (dispatch.state === 'READY') {
      return confirmed({
        commandId: context.commandId,
        release,
        ownerProbe,
        nativeResult: dispatch,
        dispatchCount: dispatchedHere,
      });
    }
    if (dispatch.state === 'NO_EFFECT_PROVEN') {
      return hold(dispatch.reason || 'NATIVE_GUARDIAN_NO_EFFECT_PROVEN', {
        admitted: true,
        command_id: context.commandId,
        effect_id: context.commandId,
        effect_generation: 1,
        candidate_git_sha: release.git_sha,
        release_version: release.version,
        installer_sha256: release.installer_sha256,
        manifest_sha256: release.manifest_sha256,
        installed_executable_sha256: release.installed_executable_sha256,
        native_result: structuredClone(dispatch),
      });
    }
    if (dispatch.state === 'AMBIGUOUS') {
      return ambiguous(dispatch.reason || 'NATIVE_GUARDIAN_EFFECT_AMBIGUOUS', {
        commandId: context.commandId,
        release,
        nativeResult: dispatch,
        dispatchCount: dispatchedHere,
        dispatchCountKnown: dispatch.physical_dispatch_performed === true,
      });
    }
    if (dispatch.state !== 'DISPATCHED') {
      return ambiguous('NATIVE_GUARDIAN_DISPATCH_STATE_INVALID', {
        commandId: context.commandId,
        release,
        nativeResult: dispatch,
        dispatchCount: dispatchedHere,
        dispatchCountKnown: true,
      });
    }

    let observed;
    try {
      observed = await actuatorClient.observe(nativeRequest);
    } catch (error) {
      return ambiguous('NATIVE_GUARDIAN_POST_DISPATCH_READBACK_UNKNOWN', {
        commandId: context.commandId,
        release,
        nativeResult: dispatch,
        dispatchCount: dispatchedHere,
        dispatchCountKnown: true,
        error,
      });
    }

    if (observed.state === 'READY' && observed.exact_ready_binding === true
        && String(observed.installed_executable_sha256 || '').toLowerCase() === release.installed_executable_sha256) {
      return confirmed({
        commandId: context.commandId,
        release,
        ownerProbe,
        nativeResult: observed,
        dispatchCount: dispatchedHere,
      });
    }

    return ambiguous(observed.reason || 'NATIVE_GUARDIAN_SUCCESSOR_READBACK_UNPROVEN', {
      commandId: context.commandId,
      release,
      nativeResult: observed,
      dispatchCount: dispatchedHere,
      dispatchCountKnown: true,
    });
  };
}

export function nativeGuardianDeveloperEmergencyUpdateContract() {
  return freeze({
    schema: 'metaengine.developer-emergency-update-native-controller.v1',
    db_leased_command_required: true,
    command_id_is_native_effect_id: true,
    effect_generation: 1,
    durable_owner_binding_required: true,
    enrolled_device_challenge_required: true,
    trusted_release_resolver_required: true,
    trusted_release_installer_digest_required: true,
    trusted_release_manifest_digest_required: true,
    installed_executable_digest_required: true,
    fixed_github_release_origin: 'PatrickFrome/Compute',
    fixed_native_pipe_required: true,
    native_write_ahead_effect_barrier_required: true,
    caller_supplied_path_allowed: false,
    caller_supplied_url_allowed: false,
    caller_supplied_shell_allowed: false,
    electron_updater_fallback_allowed: false,
    dispatch_transport_failure_outcome: 'AMBIGUOUS',
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
