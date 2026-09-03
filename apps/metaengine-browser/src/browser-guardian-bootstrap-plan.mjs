import crypto from 'node:crypto';

export const BROWSER_GUARDIAN_BOOTSTRAP_PLAN_SCHEMA = 'metaengine.browser-guardian.bootstrap-plan.v1';
export const BROWSER_GUARDIAN_BOOTSTRAP_PROTOCOL_GENERATION = 2;
export const BROWSER_GUARDIAN_RELEASE_BUNDLE_SCHEMA = 'metaengine.browser-guardian.verified-release-bundle.v1';

const SERVICE_NAME = 'METAENGINEBrowserGuardian';
const SERVICE_BINARY = 'METAENGINEBrowserGuardian.exe';
const CONFIGURATOR_BINARY = 'METAENGINEBrowserGuardianConfigure.exe';
const VERIFIED_MANIFEST = 'verified-self-update-manifest.json';
const GUARDIAN_MANIFEST = 'guardian-native-staging-manifest.json';
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

function lowerSha(value) {
  const raw = String(value || '').trim().toLowerCase();
  const normalized = raw.startsWith('sha256:') ? raw.slice(7) : raw;
  return SHA256.test(normalized) ? normalized : null;
}

function exactAssetMap(release) {
  const rows = Array.isArray(release?.assets) ? release.assets : [];
  const out = new Map();
  for (const row of rows) {
    const name = String(row?.name || '').trim();
    if (!name) return { ok: false, reason: 'RELEASE_ASSET_NAME_INVALID' };
    if (out.has(name)) return { ok: false, reason: 'RELEASE_ASSET_DUPLICATE' };
    const sha256 = lowerSha(row?.digest ?? row?.sha256);
    const size = Number(row?.size);
    if (!sha256 || !Number.isSafeInteger(size) || size <= 0) return { ok: false, reason: 'RELEASE_ASSET_PROOF_INVALID' };
    out.set(name, Object.freeze({ name, sha256, size }));
  }
  return { ok: true, assets: out };
}

function exactGuardianManifest(value) {
  if (!value || value.schema !== 'metaengine.browser.guardian-native-staging-manifest.v1') return { ok: false, reason: 'GUARDIAN_MANIFEST_SCHEMA_INVALID' };
  if (!GIT_SHA.test(String(value.source_head || ''))) return { ok: false, reason: 'SOURCE_HEAD_INVALID' };
  if (!VERSION.test(String(value.package_version || ''))) return { ok: false, reason: 'GUARDIAN_PACKAGE_VERSION_INVALID' };
  if (value.staging_only !== true
      || value.service_activation_authorized !== false
      || value.service_installation_authorized !== false
      || value.service_start_authorized !== false
      || value.user_writable_service_activation_forbidden !== true
      || value.requires_machine_secure_copy !== true
      || value.authority_effect !== false) {
    return { ok: false, reason: 'RELEASE_AUTHORITY_BOUNDARY_INVALID' };
  }
  if (value.required_machine_root !== MACHINE_ROOT) return { ok: false, reason: 'MACHINE_ROOT_DRIFT' };
  if (value.exact_service_binary_name !== SERVICE_BINARY) return { ok: false, reason: 'SERVICE_BINARY_NAME_DRIFT' };

  const rows = Array.isArray(value.binaries) ? value.binaries : [];
  if (rows.length !== 2) return { ok: false, reason: 'GUARDIAN_BINARY_CARDINALITY_INVALID' };
  const map = new Map();
  for (const row of rows) {
    const name = String(row?.name || '');
    const sha256 = lowerSha(row?.sha256);
    const size = Number(row?.size);
    if (!sha256 || !Number.isSafeInteger(size) || size <= 0 || row?.staged_only !== true) {
      return { ok: false, reason: 'GUARDIAN_BINARY_PROOF_INVALID' };
    }
    if (map.has(name)) return { ok: false, reason: 'GUARDIAN_BINARY_DUPLICATE' };
    map.set(name, Object.freeze({ name, sha256, size }));
  }
  if (!map.has(SERVICE_BINARY) || !map.has(CONFIGURATOR_BINARY)) return { ok: false, reason: 'GUARDIAN_BINARY_SET_INVALID' };
  return {
    ok: true,
    source_head: String(value.source_head),
    version: String(value.package_version),
    binaries: Object.freeze([map.get(SERVICE_BINARY), map.get(CONFIGURATOR_BINARY)]),
  };
}

/**
 * Pure release-evidence verifier. The caller supplies parsed JSON plus SHA-256
 * values calculated from the exact fetched bytes. This function cross-binds
 * those byte digests to GitHub release asset metadata, then cross-binds the
 * self-update manifest to the Guardian manifest and both native assets.
 * It performs no fetch, filesystem, release, SCM, or process effect.
 */
export function verifyBrowserGuardianReleaseBundle(bundle) {
  if (!bundle || bundle.schema !== BROWSER_GUARDIAN_RELEASE_BUNDLE_SCHEMA) return Object.freeze({ ok: false, reason: 'RELEASE_BUNDLE_SCHEMA_INVALID' });
  const self = bundle.verified_self_update;
  const guardian = bundle.guardian_native;
  const github = bundle.github_release;
  if (!self || !guardian || !github) return Object.freeze({ ok: false, reason: 'RELEASE_BUNDLE_INCOMPLETE' });

  const selfSha = lowerSha(self.sha256);
  const guardianSha = lowerSha(guardian.sha256);
  if (!selfSha) return Object.freeze({ ok: false, reason: 'VERIFIED_MANIFEST_DIGEST_INVALID' });
  if (!guardianSha) return Object.freeze({ ok: false, reason: 'GUARDIAN_MANIFEST_DIGEST_INVALID' });

  const m = self.manifest;
  if (!m || m.schema !== 'metaengine.browser.self-update-e2e-manifest.v2') return Object.freeze({ ok: false, reason: 'VERIFIED_MANIFEST_SCHEMA_INVALID' });
  const sourceHead = String(m.git_sha || '');
  const version = String(m.version || '');
  if (!GIT_SHA.test(sourceHead)) return Object.freeze({ ok: false, reason: 'SOURCE_HEAD_INVALID' });
  if (!VERSION.test(version)) return Object.freeze({ ok: false, reason: 'RELEASE_VERSION_INVALID' });
  for (const field of [
    'physical_n_to_n_plus_1',
    'guardian_native_staging_present',
    'guardian_native_staging_verified',
    'guardian_native_no_activation',
    'guardian_native_requires_machine_secure_copy',
    'guardian_native_release_assets_verified',
  ]) {
    if (m[field] !== true) return Object.freeze({ ok: false, reason: `VERIFIED_MANIFEST_FIELD_MISSING:${field}` });
  }
  if (m.production_safe !== false || String(m.update_channel || '') !== 'dev') return Object.freeze({ ok: false, reason: 'RELEASE_CHANNEL_BOUNDARY_INVALID' });
  if (lowerSha(m.guardian_native_manifest_sha256) !== guardianSha) return Object.freeze({ ok: false, reason: 'GUARDIAN_MANIFEST_DIGEST_DRIFT' });
  if (String(m.guardian_native_package_version || '') !== version) return Object.freeze({ ok: false, reason: 'GUARDIAN_PACKAGE_VERSION_DRIFT' });

  const parsedGuardian = exactGuardianManifest(guardian.manifest);
  if (!parsedGuardian.ok) return Object.freeze(parsedGuardian);
  if (parsedGuardian.source_head !== sourceHead) return Object.freeze({ ok: false, reason: 'GUARDIAN_SOURCE_HEAD_DRIFT' });
  if (parsedGuardian.version !== version) return Object.freeze({ ok: false, reason: 'GUARDIAN_PACKAGE_VERSION_DRIFT' });

  if (github.draft !== false || github.prerelease !== true) return Object.freeze({ ok: false, reason: 'GITHUB_RELEASE_STATE_INVALID' });
  if (String(github.target_commitish || '') !== sourceHead) return Object.freeze({ ok: false, reason: 'GITHUB_RELEASE_SOURCE_DRIFT' });
  if (String(github.tag_name || '') !== `v${version}`) return Object.freeze({ ok: false, reason: 'GITHUB_RELEASE_TAG_DRIFT' });
  const releaseAssets = exactAssetMap(github);
  if (!releaseAssets.ok) return Object.freeze(releaseAssets);

  const required = new Map([
    [VERIFIED_MANIFEST, { sha256: selfSha, size: Number(self.size) }],
    [GUARDIAN_MANIFEST, { sha256: guardianSha, size: Number(guardian.size) }],
  ]);
  for (const row of parsedGuardian.binaries) required.set(row.name, { sha256: row.sha256, size: row.size });
  for (const [name, expected] of required) {
    if (!Number.isSafeInteger(expected.size) || expected.size <= 0) return Object.freeze({ ok: false, reason: `RELEASE_EVIDENCE_SIZE_INVALID:${name}` });
    const asset = releaseAssets.assets.get(name);
    if (!asset) return Object.freeze({ ok: false, reason: `RELEASE_ASSET_MISSING:${name}` });
    if (asset.sha256 !== expected.sha256) return Object.freeze({ ok: false, reason: `RELEASE_ASSET_DIGEST_DRIFT:${name}` });
    if (asset.size !== expected.size) return Object.freeze({ ok: false, reason: `RELEASE_ASSET_SIZE_DRIFT:${name}` });
  }

  return Object.freeze({
    ok: true,
    source_head: sourceHead,
    version,
    verified_self_update_manifest_sha256: selfSha,
    guardian_manifest_sha256: guardianSha,
    github_tag: String(github.tag_name),
    binaries: parsedGuardian.binaries,
    staging_only: true,
    requires_machine_secure_copy: true,
    authority_effect: false,
  });
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
  if (externalStop || desiredRunning === false) return zeroAuthority('HOLD_EXTERNAL_STOP', 'EXTERNAL_STOP_OR_DISABLED');

  const proof = verifyBrowserGuardianReleaseBundle(release);
  if (!proof.ok) return zeroAuthority('HOLD_RELEASE_UNVERIFIED', proof.reason);

  const serviceBinary = proof.binaries.find((row) => row.name === SERVICE_BINARY);
  const configuratorBinary = proof.binaries.find((row) => row.name === CONFIGURATOR_BINARY);
  const id = slotId(proof.source_head, proof.guardian_manifest_sha256);
  const target = Object.freeze({
    slot_id: id,
    slot_path: slotPath(id),
    source_head: proof.source_head,
    version: proof.version,
    github_tag: proof.github_tag,
    verified_self_update_manifest_sha256: proof.verified_self_update_manifest_sha256,
    guardian_manifest_sha256: proof.guardian_manifest_sha256,
    service_binary_sha256: serviceBinary.sha256,
    service_binary_size: serviceBinary.size,
    configurator_binary_sha256: configuratorBinary.sha256,
    configurator_binary_size: configuratorBinary.size,
  });

  const service = observed?.service && typeof observed.service === 'object' ? observed.service : { exists: false };
  const slots = Array.isArray(observed?.slots) ? observed.slots.map(normalizeSlot).filter(Boolean) : [];
  const matching = slots.filter((row) => row.slot_id === target.slot_id);
  if (matching.length > 1) return zeroAuthority('HOLD_MACHINE_STATE_AMBIGUOUS', 'TARGET_SLOT_DUPLICATE', { target });
  const slot = matching[0] || null;

  if (service.exists === true && service.service_name !== SERVICE_NAME) return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_NAME_DRIFT', { target });
  if (service.exists === true && service.account !== 'LocalSystem') return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_ACCOUNT_DRIFT', { target });
  if (service.exists === true && service.service_type !== 'SERVICE_WIN32_OWN_PROCESS') return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_TYPE_DRIFT', { target });
  if (service.exists === true && service.machine_secure_path !== true) return zeroAuthority('HOLD_SERVICE_IDENTITY_DRIFT', 'SERVICE_PATH_NOT_MACHINE_SECURE', { target });

  if (activeServiceMatches(service, target) && slotReady(slot, target)) return zeroAuthority('NOOP_ACTIVE_EXACT', 'TARGET_ALREADY_ACTIVE', { target });
  if (slot && !slotMatches(slot, target)) return zeroAuthority('HOLD_SLOT_IDENTITY_DRIFT', 'TARGET_SLOT_CONTENT_DRIFT', { target });
  if (slot && !slotReady(slot, target)) return zeroAuthority('VERIFY_TARGET_SLOT', 'TARGET_SLOT_REQUIRES_READBACK', { target });

  if (!slot) {
    return zeroAuthority('COPY_EXACT_RELEASE_ASSETS', 'TARGET_SLOT_ABSENT', {
      target,
      copy_contract: Object.freeze({
        source: 'VERIFIED_GITHUB_RELEASE_ASSETS_ONLY',
        source_tag: proof.github_tag,
        overwrite_existing: false,
        require_sha256_readback: true,
        require_size_readback: true,
        require_machine_acl_readback: true,
        require_final_path_readback: true,
      }),
    });
  }

  if (service.exists !== true) return zeroAuthority('APPLY_SCM_CONFIG_EXACT_SLOT', 'TARGET_SLOT_READY_SERVICE_ABSENT', { target });
  if (!activeServiceMatches(service, target)) return zeroAuthority('HOLD_EXISTING_SERVICE_DIFFERENT_RELEASE', 'EXACT_REPLACEMENT_PROTOCOL_REQUIRED', { target });
  return zeroAuthority('HOLD_MACHINE_STATE_AMBIGUOUS', 'UNCLASSIFIED_MACHINE_STATE', { target });
}

export function digestBrowserGuardianBootstrapTarget(target) {
  const stable = JSON.stringify({
    slot_id: target?.slot_id || null,
    slot_path: target?.slot_path || null,
    source_head: target?.source_head || null,
    github_tag: target?.github_tag || null,
    verified_self_update_manifest_sha256: target?.verified_self_update_manifest_sha256 || null,
    guardian_manifest_sha256: target?.guardian_manifest_sha256 || null,
    service_binary_sha256: target?.service_binary_sha256 || null,
    configurator_binary_sha256: target?.configurator_binary_sha256 || null,
  });
  return crypto.createHash('sha256').update(stable).digest('hex');
}
