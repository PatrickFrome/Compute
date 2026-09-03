import crypto from 'node:crypto';

export const BROWSER_GUARDIAN_BOOTSTRAP_PLAN_SCHEMA = 'metaengine.browser-guardian.bootstrap-plan.v1';
export const BROWSER_GUARDIAN_BOOTSTRAP_PROTOCOL_GENERATION = 1;

const SERVICE_NAME = 'METAENGINEBrowserGuardian';
const SERVICE_BINARY = 'METAENGINEBrowserGuardian.exe';
const CONFIGURATOR_BINARY = 'METAENGINEBrowserGuardianConfigure.exe';
const MACHINE_ROOT = '%ProgramFiles%\\METAENGINE\\Guardian';
const SHA256 = /^[0-9a-f]{64}$/;
const GIT_SHA = /^[0-9a-f]{40}$/;
const VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;

function zeroAuthority(action, reason, extra = {}) {
  return Object.freeze({
    schema: BROWSER_GUARDIAN_BOOTSTRAP_PLAN_SCHEMA,
    protocol_generation: BROWSER_GUARDIAN_BOOTSTRAP_PROTOCOL_GENERATION,
    action,
    reason,
    service_name: SERVICE_NAME,
    machine_root: MACHINE_ROOT,
    browser_authority: false,
    task_authority: false,
    page_model_text_authority: false,
    scheduler_authority: false,
    release_authority: false,
    service_configuration_authority: false,
    process_effect_authority: false,
    filesystem_effect_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
    ...extra,
  });
}

function exactReleaseProof(release) {
  if (!release || typeof release !== 'object') return { ok: false, reason: 'RELEASE_PROOF_MISSING' };
  if (release.verified_release !== true || release.physical_n_to_n_plus_1 !== true) {
    return { ok: false, reason: 'RELEASE_PHYSICAL_PROOF_MISSING' };
  }
  if (release.guardian_native_staging_verified !== true
      || release.guardian_native_release_assets_verified !== true
      || release.guardian_native_no_activation !== true
      || release.guardian_native_requires_machine_secure_copy !== true) {
    return { ok: false, reason: 'GUARDIAN_RELEASE_PROOF_INCOMPLETE' };
  }
  if (!GIT_SHA.test(String(release.source_head || ''))) return { ok: false, reason: 'SOURCE_HEAD_INVALID' };
  if (!VERSION.test(String(release.version || ''))) return { ok: false, reason: 'RELEASE_VERSION_INVALID' };
  if (!SHA256.test(String(release.guardian_manifest_sha256 || ''))) return { ok: false, reason: 'GUARDIAN_MANIFEST_DIGEST_INVALID' };
  if (release.staging_only !== true || release.service_activation_authorized !== false) {
    return { ok: false, reason: 'RELEASE_AUTHORITY_BOUNDARY_INVALID' };
  }
  if (release.required_machine_root !== MACHINE_ROOT) return { ok: false, reason: 'MACHINE_ROOT_DRIFT' };

  const rows = Array.isArray(release.binaries) ? release.binaries : [];
  if (rows.length !== 2) return { ok: false, reason: 'GUARDIAN_BINARY_CARDINALITY_INVALID' };
  const map = new Map();
  for (const row of rows) {
    const name = String(row?.name || '');
    const sha256 = String(row?.sha256 || '').toLowerCase();
    const size = Number(row?.size);
    if (!SHA256.test(sha256) || !Number.isSafeInteger(size) || size <= 0) {
      return { ok: false, reason: 'GUARDIAN_BINARY_PROOF_INVALID' };
    }
    if (map.has(name)) return { ok: false, reason: 'GUARDIAN_BINARY_DUPLICATE' };
    map.set(name, { name, sha256, size });
  }
  if (!map.has(SERVICE_BINARY) || !map.has(CONFIGURATOR_BINARY)) {
    return { ok: false, reason: 'GUARDIAN_BINARY_SET_INVALID' };
  }
  return {
    ok: true,
    source_head: String(release.source_head),
    version: String(release.version),
    manifest_sha256: String(release.guardian_manifest_sha256).toLowerCase(),
    binaries: Object.freeze([map.get(SERVICE_BINARY), map.get(CONFIGURATOR_BINARY)]),
  };
}

function slotId(sourceHead, manifestSha) {
  return `${sourceHead.slice(0, 16)}-${manifestSha.slice(0, 16)}`;
}

function slotPath(id) {
  return `${MACHINE_ROOT}\\slots\\${id}`;
}

function normalizeSlot(row) {
  if (!row || typeof row !== 'object') return null;
  return {
    slot_id: String(row.slot_id || ''),
    source_head: String(row.source_head || ''),
    guardian_manifest_sha256: String(row.guardian_manifest_sha256 || '').toLowerCase(),
    service_binary_sha256: String(row.service_binary_sha256 || '').toLowerCase(),
    configurator_binary_sha256: String(row.configurator_binary_sha256 || '').toLowerCase(),
    files_exact: row.files_exact === true,
    acl_machine_secure: row.acl_machine_secure === true,
    final_path_inside_machine_root: row.final_path_inside_machine_root === true,
  };
}

function slotMatches(slot, target) {
  return slot
    && slot.slot_id === target.slot_id
    && slot.source_head === target.source_head
    && slot.guardian_manifest_sha256 === target.guardian_manifest_sha256
    && slot.service_binary_sha256 === target.service_binary_sha256
    && slot.configurator_binary_sha256 === target.configurator_binary_sha256;
}

function slotReady(slot, target) {
  return slotMatches(slot, target)
    && slot.files_exact
    && slot.acl_machine_secure
    && slot.final_path_inside_machine_root;
}

function activeServiceMatches(service, target) {
  if (!service || service.exists !== true) return false;
  return service.service_name === SERVICE_NAME
    && service.account === 'LocalSystem'
    && service.service_type === 'SERVICE_WIN32_OWN_PROCESS'
    && service.binary_path === `${target.slot_path}\\${SERVICE_BINARY}`
    && String(service.binary_sha256 || '').toLowerCase() === target.service_binary_sha256
    && service.machine_secure_path === true;
}

export function planBrowserGuardianBootstrap({
  desiredRunning = true,
  externalStop = false,
  release,
  observed = {},
} = {}) {
  if (externalStop || desiredRunning === false) {
    return zeroAuthority('HOLD_EXTERNAL_STOP', 'EXTERNAL_STOP_OR_DISABLED');
  }

  const proof = exactReleaseProof(release);
  if (!proof.ok) return zeroAuthority('HOLD_RELEASE_UNVERIFIED', proof.reason);

  const serviceBinary = proof.binaries.find((row) => row.name === SERVICE_BINARY);
  const configuratorBinary = proof.binaries.find((row) => row.name === CONFIGURATOR_BINARY);
  const id = slotId(proof.source_head, proof.manifest_sha256);
  const target = Object.freeze({
    slot_id: id,
    slot_path: slotPath(id),
    source_head: proof.source_head,
    version: proof.version,
    guardian_manifest_sha256: proof.manifest_sha256,
    service_binary_sha256: serviceBinary.sha256,
    service_binary_size: serviceBinary.size,
    configurator_binary_sha256: configuratorBinary.sha256,
    configurator_binary_size: configuratorBinary.size,
  });

  const service = observed?.service && typeof observed.service === 'object' ? observed.service : { exists: false };
  const slots = Array.isArray(observed?.slots) ? observed.slots.map(normalizeSlot).filter(Boolean) : [];
  const matching = slots.filter((row) => row.slot_id === target.slot_id);
  if (matching.length > 1) {
    return zeroAuthority('HOLD_MACHINE_STATE_AMBIGUOUS', 'TARGET_SLOT_DUPLICATE', { target });
  }
  const slot = matching[0] || null;

  if (service.exists === true && service.service_name !== SERVICE_NAME) {
    return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_NAME_DRIFT', { target });
  }
  if (service.exists === true && service.account !== 'LocalSystem') {
    return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_ACCOUNT_DRIFT', { target });
  }
  if (service.exists === true && service.service_type !== 'SERVICE_WIN32_OWN_PROCESS') {
    return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_TYPE_DRIFT', { target });
  }
  if (service.exists === true && service.machine_secure_path !== true) {
    return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_PATH_NOT_MACHINE_SECURE', { target });
  }

  if (activeServiceMatches(service, target) && slotReady(slot, target)) {
    return zeroAuthority('NOOP_ACTIVE_EXACT', 'TARGET_ALREADY_ACTIVE', { target });
  }

  if (slot && !slotMatches(slot, target)) {
    return zeroAuthority('HOLD_SLOT_IDENTITY_DRIFT', 'TARGET_SLOT_CONTENT_DRIFT', { target });
  }
  if (slot && !slotReady(slot, target)) {
    return zeroAuthority('VERIFY_TARGET_SLOT', 'TARGET_SLOT_REQUIRES_READBACK', { target });
  }

  if (!slot) {
    return zeroAuthority('COPY_EXACT_RELEASE_ASSETS', 'TARGET_SLOT_ABSENT', {
      target,
      copy_contract: Object.freeze({
        source: 'VERIFIED_RELEASE_ASSETS_ONLY',
        destination: target.slot_path,
        overwrite_existing: false,
        require_sha256_readback: true,
        require_size_readback: true,
        require_machine_acl_readback: true,
        require_final_path_readback: true,
      }),
    });
  }

  if (service.exists !== true) {
    return zeroAuthority('APPLY_SCM_CONFIG_EXACT_SLOT', 'TARGET_SLOT_READY_SERVICE_ABSENT', { target });
  }

  if (!activeServiceMatches(service, target)) {
    return zeroAuthority('HOLD_EXISTING_SERVICE_DIFFERENT_RELEASE', 'EXACT_REPLACEMENT_PROTOCOL_REQUIRED', { target });
  }

  return zeroAuthority('HOLD_MACHINE_STATE_AMBIGUOUS', 'UNCLASSIFIED_MACHINE_STATE', { target });
}

export function digestBrowserGuardianBootstrapTarget(target) {
  const stable = JSON.stringify({
    slot_id: target?.slot_id || null,
    slot_path: target?.slot_path || null,
    source_head: target?.source_head || null,
    guardian_manifest_sha256: target?.guardian_manifest_sha256 || null,
    service_binary_sha256: target?.service_binary_sha256 || null,
    configurator_binary_sha256: target?.configurator_binary_sha256 || null,
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}
