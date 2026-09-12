import {
  DEVELOPER_EMERGENCY_UPDATE_ACTION,
  evaluateDeveloperEmergencyUpdateAdmission,
} from './developer-emergency-update-admission.mjs';
import {
  DEVELOPER_EMERGENCY_UPDATE_RUNTIME_SCHEMA,
  executeDeveloperEmergencyUpdate,
} from './developer-emergency-update-runtime.mjs';

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function hold(reason, extra = {}) {
  return freeze({
    schema: DEVELOPER_EMERGENCY_UPDATE_RUNTIME_SCHEMA,
    state: 'HOLD',
    reason,
    admitted: false,
    physical_dispatch_count: 0,
    effect_outcome: 'NO_EFFECT_PROVEN',
    automatic_retry_allowed: false,
    bypass_program_policy: true,
    arbitrary_url_allowed: false,
    arbitrary_executable_allowed: false,
    arbitrary_shell_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function requiredProvider(providers, name) {
  return typeof providers?.[name] === 'function' ? providers[name] : null;
}

/**
 * Creates the production-side trust boundary for a developer emergency update.
 *
 * The returned handler accepts only the already-leased supervisor command. It never
 * accepts proof objects, filesystem paths, URLs, executable names, or shell text from
 * the command caller. Every proof/effect dependency is obtained from a locally
 * configured provider. This lets the supervisor bypass Browser policy without
 * bypassing durable owner/device identity, release authority, or the Guardian journal.
 *
 * Providers are intentionally dependency-injected because the Windows Guardian SCM
 * currently exposes durable enrollment/readback primitives but not yet the complete
 * owner-device challenge + A/B activation API. Missing providers therefore fail closed
 * with a proven zero-effect receipt instead of silently falling back to Electron.
 */
export function createDeveloperEmergencyUpdateController({ providers = {} } = {}) {
  return async function developerEmergencyUpdateController(command) {
    if (String(command?.action || '').toUpperCase() !== DEVELOPER_EMERGENCY_UPDATE_ACTION) {
      return hold('EMERGENCY_ACTION_REQUIRED');
    }

    // Reuse the canonical command parser indirectly. With no proofs supplied, a
    // well-formed command reaches the owner-binding gate; malformed commands stop at
    // EMERGENCY_COMMAND_INVALID before any local/native provider is called.
    const commandPreflight = evaluateDeveloperEmergencyUpdateAdmission({ command });
    if (commandPreflight.reason === 'EMERGENCY_COMMAND_INVALID') {
      return hold('EMERGENCY_COMMAND_INVALID');
    }

    const requestNonce = String(command?.payload?.request_nonce || '');
    const expectedGitSha = command?.payload?.expected_git_sha == null
      ? null
      : String(command.payload.expected_git_sha).trim().toLowerCase();
    const commandId = String(command?.command_id || '').toLowerCase();
    const context = freeze({
      command_id: commandId,
      request_nonce: requestNonce,
      expected_git_sha: expectedGitSha,
      release_mode: 'LATEST_TRUSTED',
    });

    const providerNames = [
      'derive_owner_binding',
      'derive_release_gate',
      'derive_guardian_recovery_plan',
      'derive_guardian_effect_plan',
      'guardian_journal',
      'guardian_binding',
      'revalidate_candidate',
      'dispatch_activation',
      'observe_activation',
    ];
    for (const name of providerNames) {
      if (!requiredProvider(providers, name)) {
        return hold('DEVELOPER_EMERGENCY_LOCAL_PROVIDER_REQUIRED', {
          missing_provider: name,
          command_id: commandId,
          request_nonce: requestNonce,
        });
      }
    }

    let ownerBinding;
    let releaseGate;
    let recoveryPlan;
    let effectPlan;
    let journal;
    let binding;
    try {
      // The nonce is passed to the trusted local identity provider so its native
      // enrolled-device challenge can be bound to this exact leased command.
      ownerBinding = await providers.derive_owner_binding(context);
      releaseGate = await providers.derive_release_gate({
        ...context,
        owner_binding: structuredClone(ownerBinding),
      });
      recoveryPlan = await providers.derive_guardian_recovery_plan({
        ...context,
        owner_binding: structuredClone(ownerBinding),
        release_gate: structuredClone(releaseGate),
      });
      effectPlan = await providers.derive_guardian_effect_plan({
        ...context,
        owner_binding: structuredClone(ownerBinding),
        release_gate: structuredClone(releaseGate),
        guardian_recovery_plan: structuredClone(recoveryPlan),
      });
      journal = await providers.guardian_journal({ ...context });
      binding = await providers.guardian_binding({
        ...context,
        owner_binding: structuredClone(ownerBinding),
        release_gate: structuredClone(releaseGate),
      });
    } catch (error) {
      return hold('DEVELOPER_EMERGENCY_LOCAL_PROOF_DERIVATION_FAILED', {
        command_id: commandId,
        request_nonce: requestNonce,
        error: String(error?.message || error || 'unknown_error').slice(0, 300),
      });
    }

    // Admission is checked before constructing any effect adapter invocation. This
    // also enforces optional expected_git_sha against the locally derived release.
    const admission = evaluateDeveloperEmergencyUpdateAdmission({
      command,
      owner_binding: ownerBinding,
      release_gate: releaseGate,
      guardian_recovery_plan: recoveryPlan,
    });
    if (admission.admitted !== true) {
      return hold(admission.reason, {
        admission: structuredClone(admission),
        command_id: commandId,
        request_nonce: requestNonce,
      });
    }

    return executeDeveloperEmergencyUpdate({
      command,
      owner_binding: ownerBinding,
      release_gate: releaseGate,
      guardian_recovery_plan: recoveryPlan,
      guardian_effect_plan: effectPlan,
      guardian_journal: journal,
      guardian_binding: binding,
      revalidate_candidate: async (effectContext) => providers.revalidate_candidate({
        ...context,
        effect_context: structuredClone(effectContext),
        release_gate: structuredClone(releaseGate),
      }),
      dispatch_activation: async (effectContext) => providers.dispatch_activation({
        ...context,
        effect_context: structuredClone(effectContext),
        release_gate: structuredClone(releaseGate),
      }),
      observe_activation: async (effectContext) => providers.observe_activation({
        ...context,
        effect_context: structuredClone(effectContext),
        release_gate: structuredClone(releaseGate),
      }),
    });
  };
}

export function developerEmergencyUpdateControllerContract() {
  return freeze({
    schema: 'metaengine.developer-emergency-update-controller.v1',
    accepts_leased_command_only: true,
    caller_supplied_proofs_allowed: false,
    caller_supplied_url_allowed: false,
    caller_supplied_executable_allowed: false,
    caller_supplied_shell_allowed: false,
    request_nonce_forwarded_to_local_device_challenge_provider: true,
    expected_git_sha_enforced_by_canonical_admission: true,
    missing_native_provider_fails_closed: true,
    missing_native_provider_effect_outcome: 'NO_EFFECT_PROVEN',
    electron_updater_fallback_allowed: false,
    durable_guardian_journal_required: true,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}
