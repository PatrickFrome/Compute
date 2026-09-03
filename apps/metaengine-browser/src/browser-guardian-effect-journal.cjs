'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { durableWriteJson } = require('./durable-json-file.cjs');

const BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA = 'metaengine.browser-guardian.effect-journal.v1';
const BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION = '1.0.0';
const BROWSER_GUARDIAN_EFFECT_DOMAINS = Object.freeze({
  PROCESS: 'PROCESS',
  MACHINE_COPY: 'MACHINE_COPY',
  SCM_CONFIG: 'SCM_CONFIG',
});
const EFFECT_DOMAINS = new Set(Object.values(BROWSER_GUARDIAN_EFFECT_DOMAINS));
const EFFECT_ACTIONS = new Set(['START_CHILD','RESTART_EXACT_CHILD','ACTIVATE_CANDIDATE','ROLLBACK_CANDIDATE']);
const UNRESOLVED_EFFECT_STATES = new Set(['EFFECT_ATTEMPTED','EFFECT_DISPATCHED','AMBIGUOUS']);
const TERMINAL_STATES = new Set(['CONFIRMED','NO_EFFECT_PROVEN']);

const MACHINE_BOOTSTRAP_PLAN_SCHEMA = 'metaengine.browser-guardian.bootstrap-plan.v1';
const MACHINE_BOOTSTRAP_PROTOCOL_GENERATION = 2;
const MACHINE_COPY_ACTION = 'COPY_EXACT_RELEASE_ASSETS';
const SCM_CONFIG_ACTION = 'APPLY_SCM_CONFIG_EXACT_SLOT';
const MACHINE_ROOT = '%ProgramFiles%\\METAENGINE\\Guardian';
const SERVICE_NAME = 'METAENGINEBrowserGuardian';
const SERVICE_BINARY = 'METAENGINEBrowserGuardian.exe';
const CONFIGURATOR_BINARY = 'METAENGINEBrowserGuardianConfigure.exe';
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const DEV_VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;

const SCM_FAILURE_ACTIONS = Object.freeze([
  Object.freeze({ type: 'RESTART', delay_ms: 5_000 }),
  Object.freeze({ type: 'RESTART', delay_ms: 15_000 }),
  Object.freeze({ type: 'RESTART', delay_ms: 60_000 }),
]);

function journalPath(statePath) {
  const base = String(statePath || '');
  if (!base) throw new Error('guardian_effect_journal_state_path_required');
  return `${base}.guardian-effect-journal-v1.json`;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256Json(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function bindingFrom(value) {
  const guardianId = String(value?.guardian_instance_id || '').trim();
  const executable = String(value?.executable || '').trim();
  if (!guardianId || !executable) throw new Error('guardian_effect_binding_invalid');
  return Object.freeze({ guardian_instance_id: guardianId, executable });
}

function sameBinding(row, binding) {
  return row?.guardian_instance_id === binding.guardian_instance_id
    && String(row?.executable || '') === binding.executable;
}

function releaseFrom(value) {
  const releaseId = String(value?.release_id || '').trim();
  const artifactSha256 = String(value?.artifact_sha256 || '').toLowerCase();
  if (!releaseId || !SHA256.test(artifactSha256)) throw new Error('guardian_effect_release_invalid');
  return Object.freeze({ release_id: releaseId, artifact_sha256: artifactSha256 });
}

function planIdentity(plan) {
  if (!plan || plan.schema !== 'metaengine.browser-guardian.plan.v1') throw new Error('guardian_effect_plan_schema_invalid');
  const action = String(plan.action || '').toUpperCase();
  if (!EFFECT_ACTIONS.has(action) || plan.process_effect_candidate !== true || plan.requires_external_executor !== true) {
    throw new Error('guardian_effect_plan_not_effectful');
  }
  for (const field of ['actuation_eligible','automatic_retry_allowed','browser_authority','task_authority','scheduler_authority','page_model_text_authority','release_authority','authority_effect']) {
    if (plan[field] !== false) throw new Error(`guardian_effect_plan_authority_invalid:${field}`);
  }
  const targetRelease = releaseFrom(plan.target_release);
  const identity = {
    action,
    target_release: targetRelease,
    exact_pid: null,
    exact_process_incarnation_id: null,
    process_absence_proven: false,
  };
  if (action === 'START_CHILD') {
    if (plan.process_absence_proven !== true) throw new Error('guardian_effect_start_absence_unproven');
    identity.process_absence_proven = true;
  } else if (action === 'RESTART_EXACT_CHILD') {
    const pid = Number(plan.exact_pid || 0);
    const incarnation = String(plan.exact_process_incarnation_id || '').trim();
    if (!Number.isSafeInteger(pid) || pid < 1 || !incarnation) throw new Error('guardian_effect_restart_binding_invalid');
    identity.exact_pid = pid;
    identity.exact_process_incarnation_id = incarnation;
  }
  return Object.freeze(identity);
}

function machineZeroAuthority(plan) {
  for (const field of [
    'browser_authority',
    'task_authority',
    'page_model_text_authority',
    'scheduler_authority',
    'release_authority',
    'service_configuration_authority',
    'process_effect_authority',
    'filesystem_effect_authority',
    'automatic_retry_allowed',
    'authority_effect',
  ]) {
    if (plan?.[field] !== false) throw new Error(`guardian_machine_effect_plan_authority_invalid:${field}`);
  }
}

function exactPositiveInt(value, reason) {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) throw new Error(reason);
  return parsed;
}

function exactSha(value, reason) {
  const normalized = String(value || '').trim().toLowerCase().replace(/^sha256:/, '');
  if (!SHA256.test(normalized)) throw new Error(reason);
  return normalized;
}

function machineTargetFrom(plan) {
  if (!plan || plan.schema !== MACHINE_BOOTSTRAP_PLAN_SCHEMA) throw new Error('guardian_machine_effect_plan_schema_invalid');
  if (Number(plan.protocol_generation) !== MACHINE_BOOTSTRAP_PROTOCOL_GENERATION) throw new Error('guardian_machine_effect_protocol_generation_invalid');
  machineZeroAuthority(plan);

  const target = plan.target;
  if (!target || typeof target !== 'object' || Array.isArray(target)) throw new Error('guardian_machine_effect_target_invalid');
  const sourceHead = String(target.source_head || '').trim().toLowerCase();
  const version = String(target.version || '').trim();
  const guardianManifestSha = exactSha(target.guardian_manifest_sha256, 'guardian_machine_effect_guardian_manifest_sha_invalid');
  const verifiedManifestSha = exactSha(target.verified_self_update_manifest_sha256, 'guardian_machine_effect_verified_manifest_sha_invalid');
  const serviceSha = exactSha(target.service_binary_sha256, 'guardian_machine_effect_service_sha_invalid');
  const configuratorSha = exactSha(target.configurator_binary_sha256, 'guardian_machine_effect_configurator_sha_invalid');
  if (!GIT_SHA.test(sourceHead)) throw new Error('guardian_machine_effect_source_head_invalid');
  if (!DEV_VERSION.test(version)) throw new Error('guardian_machine_effect_version_invalid');

  const slotId = String(target.slot_id || '').trim();
  const expectedSlotId = `${sourceHead.slice(0, 16)}-${guardianManifestSha.slice(0, 16)}`;
  if (slotId !== expectedSlotId) throw new Error('guardian_machine_effect_slot_id_drift');
  const slotPath = String(target.slot_path || '').trim();
  if (slotPath !== `${MACHINE_ROOT}\\slots\\${slotId}`) throw new Error('guardian_machine_effect_slot_path_drift');
  const githubTag = String(target.github_tag || '').trim();
  if (githubTag !== `v${version}`) throw new Error('guardian_machine_effect_github_tag_drift');

  return Object.freeze({
    slot_id: slotId,
    slot_path: slotPath,
    source_head: sourceHead,
    version,
    github_tag: githubTag,
    verified_self_update_manifest_sha256: verifiedManifestSha,
    guardian_manifest_sha256: guardianManifestSha,
    service_binary_sha256: serviceSha,
    service_binary_size: exactPositiveInt(target.service_binary_size, 'guardian_machine_effect_service_size_invalid'),
    configurator_binary_sha256: configuratorSha,
    configurator_binary_size: exactPositiveInt(target.configurator_binary_size, 'guardian_machine_effect_configurator_size_invalid'),
  });
}

function machineCopyIdentity(plan) {
  if (String(plan?.action || '') !== MACHINE_COPY_ACTION) throw new Error('guardian_machine_copy_action_invalid');
  if (String(plan?.reason || '') !== 'TARGET_SLOT_ABSENT') throw new Error('guardian_machine_copy_reason_invalid');
  const target = machineTargetFrom(plan);
  const copy = plan.copy_contract;
  if (!copy || copy.source !== 'VERIFIED_GITHUB_RELEASE_ASSETS_ONLY'
      || String(copy.source_tag || '') !== target.github_tag
      || copy.overwrite_existing !== false
      || copy.require_sha256_readback !== true
      || copy.require_size_readback !== true
      || copy.require_machine_acl_readback !== true
      || copy.require_final_path_readback !== true) {
    throw new Error('guardian_machine_copy_contract_invalid');
  }
  return Object.freeze({
    effect_domain: BROWSER_GUARDIAN_EFFECT_DOMAINS.MACHINE_COPY,
    action: MACHINE_COPY_ACTION,
    protocol_generation: MACHINE_BOOTSTRAP_PROTOCOL_GENERATION,
    target,
    copy_contract: Object.freeze({
      source: 'VERIFIED_GITHUB_RELEASE_ASSETS_ONLY',
      source_tag: target.github_tag,
      overwrite_existing: false,
      require_sha256_readback: true,
      require_size_readback: true,
      require_machine_acl_readback: true,
      require_final_path_readback: true,
    }),
  });
}

function scmContractFor(target) {
  return Object.freeze({
    service_name: SERVICE_NAME,
    service_type: 'SERVICE_WIN32_OWN_PROCESS',
    start_type: 'SERVICE_AUTO_START',
    account: 'LocalSystem',
    binary_path: `${target.slot_path}\\${SERVICE_BINARY}`,
    binary_sha256: target.service_binary_sha256,
    machine_secure_binary_path_required: true,
    failure_reset_period: 'INFINITE',
    failure_actions: SCM_FAILURE_ACTIONS,
    last_failure_action_repeats: true,
    non_crash_failure_actions: true,
    reboot_action: false,
    run_command_action: false,
    service_start_stop_effect: false,
  });
}

function scmConfigIdentity(plan) {
  if (String(plan?.action || '') !== SCM_CONFIG_ACTION) throw new Error('guardian_scm_config_action_invalid');
  if (String(plan?.reason || '') !== 'TARGET_SLOT_READY_SERVICE_ABSENT') throw new Error('guardian_scm_config_reason_invalid');
  const target = machineTargetFrom(plan);
  return Object.freeze({
    effect_domain: BROWSER_GUARDIAN_EFFECT_DOMAINS.SCM_CONFIG,
    action: SCM_CONFIG_ACTION,
    protocol_generation: MACHINE_BOOTSTRAP_PROTOCOL_GENERATION,
    target,
    scm_contract: scmContractFor(target),
  });
}

function rowDomain(row) {
  const explicit = String(row?.effect_domain || '').trim().toUpperCase();
  if (explicit) {
    if (!EFFECT_DOMAINS.has(explicit)) throw new Error('guardian_effect_domain_invalid');
    return explicit;
  }
  if (EFFECT_ACTIONS.has(String(row?.plan?.action || '').toUpperCase())) return BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS;
  throw new Error('guardian_effect_domain_missing');
}

async function readJson(file) {
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw new Error('guardian_effect_journal_json_invalid');
    throw error;
  }
}

function validateRow(row, binding = null) {
  if (!row || row.schema !== BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA || row.version !== BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION) throw new Error('guardian_effect_journal_schema_invalid');
  if (!Number.isSafeInteger(Number(row.sequence)) || Number(row.sequence) < 1) throw new Error('guardian_effect_journal_sequence_invalid');
  if (!Number.isSafeInteger(Number(row.effect_generation)) || Number(row.effect_generation) < 1) throw new Error('guardian_effect_generation_invalid');
  if (!SHA256.test(String(row.plan_digest || ''))) throw new Error('guardian_effect_plan_digest_invalid');
  if (row.automatic_retry_allowed !== false || row.browser_authority !== false || row.task_authority !== false || row.scheduler_authority !== false || row.release_authority !== false || row.authority_effect !== false) throw new Error('guardian_effect_journal_authority_invalid');
  const rowBinding = bindingFrom(row);
  const effectDomain = rowDomain(row);
  if (binding && !sameBinding(row, binding)) throw new Error('guardian_effect_journal_binding_drift');
  return Object.freeze({ ...row, ...rowBinding, effect_domain: effectDomain });
}

function exactBinaryReadback(proof, target, kind) {
  const service = kind === 'service';
  const prefix = service ? 'service_binary' : 'configurator_binary';
  const expectedName = service ? SERVICE_BINARY : CONFIGURATOR_BINARY;
  const expectedSha = service ? target.service_binary_sha256 : target.configurator_binary_sha256;
  const expectedSize = service ? target.service_binary_size : target.configurator_binary_size;
  if (String(proof?.[`${prefix}_path`] || '') !== `${target.slot_path}\\${expectedName}`) return false;
  if (String(proof?.[`${prefix}_sha256`] || '').trim().toLowerCase() !== expectedSha) return false;
  return Number(proof?.[`${prefix}_size`]) === expectedSize;
}

function exactFailureActions(value) {
  if (!Array.isArray(value) || value.length !== SCM_FAILURE_ACTIONS.length) return false;
  return SCM_FAILURE_ACTIONS.every((expected, index) => {
    const actual = value[index];
    return actual?.type === expected.type && Number(actual?.delay_ms) === expected.delay_ms;
  });
}

class BrowserGuardianEffectJournal {
  #path;
  #row = null;
  #writeTail = Promise.resolve();

  constructor({ statePath } = {}) {
    this.#path = journalPath(statePath);
  }

  async init(bindingSource) {
    const binding = bindingFrom(bindingSource);
    const existing = await readJson(this.#path);
    if (existing) this.#row = validateRow(existing, binding);
    return this.snapshot();
  }

  snapshot() { return this.#row ? structuredClone(this.#row) : null; }
  unresolvedEffect() { return UNRESOLVED_EFFECT_STATES.has(String(this.#row?.state || '')); }
  resumableIntent() { return String(this.#row?.state || '') === 'INTENT_RECORDED'; }
  terminal() { return TERMINAL_STATES.has(String(this.#row?.state || '')); }

  #enqueue(operation) {
    const current = this.#writeTail.then(operation);
    this.#writeTail = current.catch(() => {});
    return current;
  }

  async #commit(bindingSource, state, fields = {}) {
    const binding = bindingFrom(bindingSource);
    if (this.#row && !sameBinding(this.#row, binding)) throw new Error('guardian_effect_journal_binding_drift');
    const sequence = Number(this.#row?.sequence || 0) + 1;
    const effectDomain = String(fields.effect_domain || this.#row?.effect_domain || BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS).toUpperCase();
    if (!EFFECT_DOMAINS.has(effectDomain)) throw new Error('guardian_effect_domain_invalid');
    const next = {
      schema: BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA,
      version: BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION,
      ...binding,
      sequence,
      state,
      effect_domain: effectDomain,
      ...fields,
      recorded_at: new Date().toISOString(),
      automatic_retry_allowed: false,
      browser_authority: false,
      task_authority: false,
      scheduler_authority: false,
      release_authority: false,
      authority_effect: false,
    };
    await durableWriteJson(this.#path, next, { sequence });
    this.#row = validateRow(next, binding);
    return this.snapshot();
  }

  #beginTypedEffect(bindingSource, effectDomain, identityFactory, legacyDigest = false) {
    return this.#enqueue(async () => {
      const identity = identityFactory();
      // PROCESS preserves the exact historical digest payload. Typed machine
      // identities already include their effect_domain and therefore cannot
      // collide with a legacy process intent.
      const digest = sha256Json(legacyDigest ? identity : identity);
      if (this.resumableIntent()) {
        if (this.#row.effect_domain !== effectDomain || this.#row.plan_digest !== digest) throw new Error('guardian_effect_unresolved_intent_plan_drift');
        return this.snapshot();
      }
      if (this.unresolvedEffect()) throw new Error(`guardian_effect_unresolved:${this.#row.state}`);
      const effectGeneration = Number(this.#row?.effect_generation || 0) + 1;
      return this.#commit(bindingSource, 'INTENT_RECORDED', {
        effect_domain: effectDomain,
        effect_id: crypto.randomUUID(),
        effect_generation: effectGeneration,
        plan_digest: digest,
        plan: identity,
        physical_effect_attempted: false,
        effect_barrier_crossed: false,
        dispatched_pid: null,
        dispatched_process_incarnation_id: null,
        result: null,
      });
    });
  }

  beginEffect(bindingSource, plan) {
    return this.#beginTypedEffect(
      bindingSource,
      BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS,
      () => planIdentity(plan),
      true,
    );
  }

  beginMachineCopyEffect(bindingSource, plan) {
    return this.#beginTypedEffect(
      bindingSource,
      BROWSER_GUARDIAN_EFFECT_DOMAINS.MACHINE_COPY,
      () => machineCopyIdentity(plan),
    );
  }

  beginScmConfigEffect(bindingSource, plan) {
    return this.#beginTypedEffect(
      bindingSource,
      BROWSER_GUARDIAN_EFFECT_DOMAINS.SCM_CONFIG,
      () => scmConfigIdentity(plan),
    );
  }

  markEffectAttempted(bindingSource, effectId) {
    return this.#enqueue(async () => {
      if (!this.resumableIntent() || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_attempt_transition_invalid');
      return this.#commit(bindingSource, 'EFFECT_ATTEMPTED', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: null,
        dispatched_process_incarnation_id: null,
        result: null,
      });
    });
  }

  abandonUnattemptedIntent(bindingSource, effectId, reason = 'intent_superseded_before_effect_barrier') {
    return this.#enqueue(async () => {
      if (!this.resumableIntent() || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_abandon_transition_invalid');
      return this.#commit(bindingSource, 'NO_EFFECT_PROVEN', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: false,
        effect_barrier_crossed: false,
        dispatched_pid: null,
        dispatched_process_incarnation_id: null,
        result: String(reason || 'intent_superseded_before_effect_barrier').slice(0, 240),
      });
    });
  }

  markDispatched(bindingSource, effectId, { pid, process_incarnation_id = null, result = 'spawn_dispatched' } = {}) {
    return this.#enqueue(async () => {
      if (this.#row?.effect_domain !== BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS) throw new Error('guardian_effect_process_domain_required');
      if (String(this.#row?.state || '') !== 'EFFECT_ATTEMPTED' || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_dispatch_transition_invalid');
      const exactPid = Number(pid || 0);
      const incarnation = String(process_incarnation_id || '').trim() || null;
      if (!Number.isSafeInteger(exactPid) || exactPid < 1) throw new Error('guardian_effect_dispatched_pid_invalid');
      return this.#commit(bindingSource, 'EFFECT_DISPATCHED', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: exactPid,
        dispatched_process_incarnation_id: incarnation,
        result: String(result || 'spawn_dispatched').slice(0, 240),
      });
    });
  }

  confirmEffect(bindingSource, effectId, proof = {}) {
    return this.#enqueue(async () => {
      if (this.#row?.effect_domain !== BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS) throw new Error('guardian_effect_process_domain_required');
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED','EFFECT_DISPATCHED','AMBIGUOUS'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_confirm_transition_invalid');
      const release = releaseFrom(proof.release);
      if (release.release_id !== this.#row.plan.target_release.release_id || release.artifact_sha256 !== this.#row.plan.target_release.artifact_sha256) throw new Error('guardian_effect_confirm_release_drift');
      const pid = Number(proof.pid || 0);
      const incarnation = String(proof.process_incarnation_id || '').trim();
      if (!Number.isSafeInteger(pid) || pid < 1 || !incarnation || proof.exact_ready_binding !== true) throw new Error('guardian_effect_confirm_proof_invalid');
      const priorDispatchedPid = Number(this.#row.dispatched_pid || 0);
      if (Number.isSafeInteger(priorDispatchedPid) && priorDispatchedPid > 0 && priorDispatchedPid !== pid) throw new Error('guardian_effect_confirm_pid_drift');
      return this.#commit(bindingSource, 'CONFIRMED', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: priorDispatchedPid > 0 ? priorDispatchedPid : pid,
        dispatched_process_incarnation_id: incarnation,
        result: state === 'AMBIGUOUS' ? 'late_exact_ready_reconciliation' : 'exact_ready_successor_binding',
      });
    });
  }

  confirmMachineCopyEffect(bindingSource, effectId, proof = {}) {
    return this.#enqueue(async () => {
      if (this.#row?.effect_domain !== BROWSER_GUARDIAN_EFFECT_DOMAINS.MACHINE_COPY) throw new Error('guardian_machine_copy_domain_required');
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED','AMBIGUOUS'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_machine_copy_confirm_transition_invalid');
      const target = this.#row.plan?.target;
      const exactIdentity = String(proof.slot_id || '') === target.slot_id
        && String(proof.slot_path || '') === target.slot_path
        && String(proof.source_head || '').toLowerCase() === target.source_head
        && String(proof.guardian_manifest_sha256 || '').toLowerCase() === target.guardian_manifest_sha256;
      const exactFiles = exactBinaryReadback(proof, target, 'service')
        && exactBinaryReadback(proof, target, 'configurator');
      if (!exactIdentity
          || !exactFiles
          || proof.files_exact !== true
          || proof.exact_file_set !== true
          || proof.sha256_readback_proven !== true
          || proof.size_readback_proven !== true
          || proof.acl_machine_secure !== true
          || proof.final_path_inside_machine_root !== true) {
        throw new Error('guardian_machine_copy_confirm_proof_invalid');
      }
      return this.#commit(bindingSource, 'CONFIRMED', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: null,
        dispatched_process_incarnation_id: null,
        result: state === 'AMBIGUOUS' ? 'late_exact_machine_copy_reconciliation' : 'exact_machine_copy_readback',
      });
    });
  }

  confirmScmConfigEffect(bindingSource, effectId, proof = {}) {
    return this.#enqueue(async () => {
      if (this.#row?.effect_domain !== BROWSER_GUARDIAN_EFFECT_DOMAINS.SCM_CONFIG) throw new Error('guardian_scm_config_domain_required');
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED','AMBIGUOUS'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_scm_config_confirm_transition_invalid');
      const contract = this.#row.plan?.scm_contract;
      const target = this.#row.plan?.target;
      const exactConfig = proof.readback_proven === true
        && String(proof.service_name || '') === contract.service_name
        && String(proof.service_type || '') === contract.service_type
        && String(proof.start_type || '') === contract.start_type
        && String(proof.account || '') === contract.account
        && String(proof.binary_path || '') === contract.binary_path
        && String(proof.binary_sha256 || '').toLowerCase() === target.service_binary_sha256
        && proof.machine_secure_binary_path === true
        && String(proof.failure_reset_period || '') === contract.failure_reset_period
        && exactFailureActions(proof.failure_actions)
        && proof.last_failure_action_repeats === true
        && proof.non_crash_failure_actions === true
        && proof.reboot_action === false
        && proof.run_command_action === false
        && proof.service_start_stop_effect === false;
      if (!exactConfig) throw new Error('guardian_scm_config_confirm_proof_invalid');
      return this.#commit(bindingSource, 'CONFIRMED', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: null,
        dispatched_process_incarnation_id: null,
        result: state === 'AMBIGUOUS' ? 'late_exact_scm_config_reconciliation' : 'exact_scm_config_readback',
      });
    });
  }

  proveNoEffect(bindingSource, effectId, evidence = {}) {
    return this.#enqueue(async () => {
      if (this.#row?.effect_domain !== BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS) throw new Error('guardian_effect_typed_absence_proof_required');
      const state = String(this.#row?.state || '');
      if (!['INTENT_RECORDED','EFFECT_ATTEMPTED','EFFECT_DISPATCHED'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_no_effect_transition_invalid');
      if (evidence.effect_absent_proven !== true) throw new Error('guardian_effect_absence_proof_required');
      if (state === 'EFFECT_DISPATCHED') {
        const pid = Number(evidence.pid || 0);
        if (!Number.isSafeInteger(pid) || pid < 1 || pid !== Number(this.#row.dispatched_pid) || evidence.exact_pid_absent !== true) throw new Error('guardian_effect_dispatched_absence_proof_invalid');
      }
      return this.#commit(bindingSource, 'NO_EFFECT_PROVEN', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: state !== 'INTENT_RECORDED',
        effect_barrier_crossed: state !== 'INTENT_RECORDED',
        dispatched_pid: this.#row.dispatched_pid || null,
        dispatched_process_incarnation_id: this.#row.dispatched_process_incarnation_id || null,
        result: String(evidence.reason || 'exact_process_effect_absent').slice(0, 240),
      });
    });
  }

  markAmbiguous(bindingSource, effectId, detail = 'effect_outcome_unknown') {
    return this.#enqueue(async () => {
      const state = String(this.#row?.state || '');
      if (!['EFFECT_ATTEMPTED','EFFECT_DISPATCHED'].includes(state) || String(effectId || '') !== this.#row.effect_id) throw new Error('guardian_effect_ambiguous_transition_invalid');
      if (this.#row.effect_domain !== BROWSER_GUARDIAN_EFFECT_DOMAINS.PROCESS && state === 'EFFECT_DISPATCHED') {
        throw new Error('guardian_effect_machine_dispatch_state_invalid');
      }
      return this.#commit(bindingSource, 'AMBIGUOUS', {
        effect_domain: this.#row.effect_domain,
        effect_id: this.#row.effect_id,
        effect_generation: this.#row.effect_generation,
        plan_digest: this.#row.plan_digest,
        plan: this.#row.plan,
        physical_effect_attempted: true,
        effect_barrier_crossed: true,
        dispatched_pid: this.#row.dispatched_pid || null,
        dispatched_process_incarnation_id: this.#row.dispatched_process_incarnation_id || null,
        result: String(detail || 'effect_outcome_unknown').slice(0, 240),
      });
    });
  }
}

module.exports = Object.freeze({
  BROWSER_GUARDIAN_EFFECT_JOURNAL_SCHEMA,
  BROWSER_GUARDIAN_EFFECT_JOURNAL_VERSION,
  BROWSER_GUARDIAN_EFFECT_DOMAINS,
  journalPath,
  BrowserGuardianEffectJournal,
});
