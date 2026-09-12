import { createRequire } from 'node:module';
import {
  DEVELOPER_EMERGENCY_UPDATE_ACTION,
  evaluateDeveloperEmergencyUpdateAdmission,
} from './developer-emergency-update-admission.mjs';

const require = createRequire(import.meta.url);
const { executeGuardianCandidateActivation } = require('./browser-guardian-activation-executor.cjs');

export const DEVELOPER_EMERGENCY_UPDATE_RUNTIME_SCHEMA = 'metaengine.developer-emergency-update-runtime.v1';
const SHA256_RE = /^[0-9a-f]{64}$/;

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function hold(reason, admission = null, extra = {}) {
  return freeze({
    schema: DEVELOPER_EMERGENCY_UPDATE_RUNTIME_SCHEMA,
    state: 'HOLD',
    reason,
    admitted: admission?.admitted === true,
    admission: admission ? structuredClone(admission) : null,
    physical_dispatch_count: 0,
    effect_outcome: 'NO_EFFECT_PROVEN',
    automatic_retry_allowed: false,
    bypass_program_policy: admission?.bypass_program_policy === true,
    arbitrary_url_allowed: false,
    arbitrary_executable_allowed: false,
    arbitrary_shell_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function exactGuardianEffectBinding(plan, releaseGate) {
  if (!plan || plan.schema !== 'metaengine.browser-guardian.plan.v1') return false;
  if (String(plan.action || '').toUpperCase() !== 'ACTIVATE_CANDIDATE') return false;
  if (plan.process_effect_candidate !== true || plan.requires_external_executor !== true) return false;
  const target = plan.target_release;
  if (!target || !String(target.release_id || '').trim()) return false;
  const artifactSha = String(target.artifact_sha256 || '').trim().toLowerCase();
  if (!SHA256_RE.test(artifactSha)) return false;
  return artifactSha === String(releaseGate?.installer_sha256 || '').trim().toLowerCase();
}

function effectOutcome(effect) {
  const state = String(effect?.state || '').toUpperCase();
  if (state === 'CONFIRMED') return 'CONFIRMED';
  if (['PRE_EFFECT_FENCED', 'NO_EFFECT_PROVEN'].includes(state)) return 'NO_EFFECT_PROVEN';
  return 'AMBIGUOUS';
}

/**
 * Executes a developer break-glass update only after the leased command has been
 * independently bound to the durable owner/device identity, the immutable release
 * authority gate, and the Guardian recovery plan. Browser mode/armed/rollout/cadence
 * are deliberately absent from this contract.
 *
 * This coordinator has no network discovery, filesystem, shell, executable-path,
 * or retry authority. A caller supplies the already-proven evidence plus one bounded
 * external Guardian dispatcher. The Guardian effect journal remains authoritative
 * for replay/ambiguity fencing.
 */
export async function executeDeveloperEmergencyUpdate({
  command = null,
  owner_binding = null,
  release_gate = null,
  guardian_recovery_plan = null,
  guardian_effect_plan = null,
  guardian_journal = null,
  guardian_binding = null,
  revalidate_candidate = null,
  dispatch_activation = null,
  observe_activation = null,
} = {}) {
  if (String(command?.action || '').toUpperCase() !== DEVELOPER_EMERGENCY_UPDATE_ACTION) {
    return hold('EMERGENCY_ACTION_REQUIRED');
  }

  const admission = evaluateDeveloperEmergencyUpdateAdmission({
    command,
    owner_binding,
    release_gate,
    guardian_recovery_plan,
  });
  if (admission.admitted !== true) return hold(admission.reason, admission);

  if (!exactGuardianEffectBinding(guardian_effect_plan, release_gate)) {
    return hold('GUARDIAN_EFFECT_PLAN_RELEASE_BINDING_REQUIRED', admission, {
      candidate_sha: admission.candidate_sha || null,
      release_version: admission.release_version || null,
    });
  }
  if (!guardian_journal || !guardian_binding) {
    return hold('GUARDIAN_DURABLE_EFFECT_JOURNAL_REQUIRED', admission);
  }
  if (typeof revalidate_candidate !== 'function'
      || typeof dispatch_activation !== 'function'
      || typeof observe_activation !== 'function') {
    return hold('GUARDIAN_EXTERNAL_ACTIVATION_ADAPTER_REQUIRED', admission);
  }

  const effect = await executeGuardianCandidateActivation({
    plan: guardian_effect_plan,
    journal: guardian_journal,
    binding: guardian_binding,
    revalidateCandidate: async (context) => {
      const proof = await revalidate_candidate({
        ...context,
        admission: structuredClone(admission),
      });
      if (proof?.proven !== true) return proof;
      const installedSha = String(proof.installer_sha256 || release_gate.installer_sha256 || '').trim().toLowerCase();
      const manifestSha = String(proof.manifest_sha256 || release_gate.manifest_sha256 || '').trim().toLowerCase();
      if (installedSha !== String(release_gate.installer_sha256 || '').trim().toLowerCase()) {
        return { proven: false, reason: 'emergency_installer_digest_revalidation_drift' };
      }
      if (manifestSha !== String(release_gate.manifest_sha256 || '').trim().toLowerCase()) {
        return { proven: false, reason: 'emergency_manifest_digest_revalidation_drift' };
      }
      return { ...proof, proven: true };
    },
    dispatchActivation: async (context) => dispatch_activation({
      ...context,
      admission: structuredClone(admission),
    }),
    observeActivation: async (context) => observe_activation({
      ...context,
      admission: structuredClone(admission),
    }),
  });

  return freeze({
    schema: DEVELOPER_EMERGENCY_UPDATE_RUNTIME_SCHEMA,
    state: effect.state,
    reason: effect.reason,
    admitted: true,
    admission: structuredClone(admission),
    effect: structuredClone(effect),
    physical_dispatch_count: Number(effect.physical_dispatch_count || 0),
    effect_outcome: effectOutcome(effect),
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
    authority_effect: false,
  });
}