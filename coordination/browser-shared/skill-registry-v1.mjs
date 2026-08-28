import { createHash } from 'node:crypto';
import { compileSkillCatalog, hydrateSkillInstructions } from './skill-manifest-v1.mjs';
import { compileSkillPackageIdentity, revalidateSkillPackageIdentity, SKILL_PACKAGE_LIMITS } from './skill-package-identity-v1.mjs';

const REGISTRY_SCHEMA = 'metaengine.a2-browser-operator.skill-registry-snapshot.v1';
const HYDRATION_SCHEMA = 'metaengine.a2-browser-operator.skill-registry-instructions.v1';
const MAX_SKILLS = 128;
const MAX_REGISTRY_BYTES = 256 * 1024;

function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateSkillName(value) {
  if (typeof value !== 'string') throw new Error('skill_registry_name_invalid');
  const name = value.trim();
  if (!name || name !== value || name.length > 64 || !/^(?!-)(?!.*--)[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
    throw new Error('skill_registry_name_invalid');
  }
  return name;
}

function snapshotSkillNames(value) {
  if (!Array.isArray(value)) throw new Error('skill_registry_names_invalid');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length > MAX_SKILLS) throw new Error('skill_registry_names_too_many');
  const names = new Array(length);
  const seen = new Set();
  for (let index = 0; index < length; index += 1) {
    const name = validateSkillName(value[index]);
    if (seen.has(name)) throw new Error('skill_registry_name_duplicate');
    seen.add(name);
    names[index] = name;
  }
  names.sort(codeUnitCompare);
  return Object.freeze(names);
}

function snapshotPackageFile(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('skill_registry_package_file_invalid');
  const path = source.path;
  const type = source.type;
  const executable = source.executable;
  const bytesInput = source.bytes;
  if (!(bytesInput instanceof Uint8Array)) throw new Error('skill_registry_package_bytes_invalid');
  return Object.freeze({ path, type, executable, bytes: Buffer.from(bytesInput) });
}

function snapshotPackageFiles(value) {
  if (!Array.isArray(value)) throw new Error('skill_registry_package_invalid');
  const length = value.length;
  if (!Number.isSafeInteger(length) || length < 1 || length > SKILL_PACKAGE_LIMITS.maxPackageFiles) {
    throw new Error('skill_registry_package_file_count_invalid');
  }
  const files = new Array(length);
  for (let index = 0; index < length; index += 1) files[index] = snapshotPackageFile(value[index]);
  return Object.freeze(files);
}

function skillSourceFromSnapshot(skillName, files) {
  let skillBytes = null;
  for (const file of files) {
    if (file.path === 'SKILL.md') {
      if (skillBytes) throw new Error('skill_registry_skill_file_duplicate');
      skillBytes = file.bytes;
    }
  }
  if (!skillBytes) throw new Error('skill_registry_skill_file_missing');
  let content;
  try {
    content = new TextDecoder('utf-8', { fatal: true }).decode(skillBytes);
  } catch {
    throw new Error('skill_registry_skill_utf8_invalid');
  }
  return Object.freeze({ path: `${skillName}/SKILL.md`, content });
}

function sealRegistryBytes(registry) {
  let bytes = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    registry.registry_bytes = bytes;
    const measured = Buffer.byteLength(JSON.stringify(registry));
    if (measured === bytes) return measured;
    bytes = measured;
  }
  registry.registry_bytes = bytes;
  const measured = Buffer.byteLength(JSON.stringify(registry));
  if (measured !== bytes) throw new Error('skill_registry_size_unstable');
  return measured;
}

function validateRegistryFingerprint(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) throw new Error('skill_registry_expected_fingerprint_invalid');
  return value;
}

function validateSkillRef(value) {
  if (typeof value !== 'string' || !/^skill_[0-9a-f]{24}$/.test(value)) throw new Error('skill_registry_skill_ref_invalid');
  return value;
}

export function createSkillRegistry(sourceAdapter) {
  if (!sourceAdapter || typeof sourceAdapter !== 'object' || Array.isArray(sourceAdapter)) throw new Error('skill_registry_source_invalid');
  const listSkillNames = sourceAdapter.listSkillNames;
  const readSkillPackage = sourceAdapter.readSkillPackage;
  if (typeof listSkillNames !== 'function' || typeof readSkillPackage !== 'function') throw new Error('skill_registry_source_invalid');

  let currentSnapshot = null;
  let refreshPromise = null;

  async function readFreshPackage(skillName) {
    let rawFiles;
    try {
      rawFiles = await readSkillPackage(skillName);
    } catch {
      throw new Error('skill_registry_source_read_failed');
    }
    return snapshotPackageFiles(rawFiles);
  }

  async function buildCandidate() {
    let rawNames;
    try {
      rawNames = await listSkillNames();
    } catch {
      throw new Error('skill_registry_source_list_failed');
    }
    const names = snapshotSkillNames(rawNames);
    const semanticSources = [];
    const identities = new Map();

    // Deliberately sequential: package limits bound per-skill memory and the source adapter is never stampede-loaded.
    for (const name of names) {
      const files = await readFreshPackage(name);
      const identity = compileSkillPackageIdentity(name, files);
      const source = skillSourceFromSnapshot(name, files);
      semanticSources.push(source);
      identities.set(name, identity);
    }

    const semanticCatalog = compileSkillCatalog(semanticSources);
    const skills = semanticCatalog.skills.map((entry) => {
      const identity = identities.get(entry.name);
      if (!identity || identity.semantic_skill_fingerprint !== entry.skill_fingerprint) {
        throw new Error('skill_registry_semantic_identity_mismatch');
      }
      return Object.freeze({
        skill_ref: entry.skill_ref,
        name: entry.name,
        description: entry.description,
        semantic_skill_fingerprint: identity.semantic_skill_fingerprint,
        package_manifest_digest: identity.package_manifest_digest,
        package_raw_bytes: identity.total_raw_bytes,
        package_file_count: identity.file_count,
        instructions_available: true,
        provenance_verified: false,
        source_locator_embedded: false,
        content_embedded: false,
        tainted_skill_data: true,
        authority_effect: false,
        execution_eligible: false,
        script_execution_exposed: false
      });
    });
    const frozenSkills = Object.freeze(skills);
    const registryFingerprint = `sha256:${sha256(JSON.stringify(frozenSkills))}`;
    const registry = {
      schema: REGISTRY_SCHEMA,
      status: 'SUPPORTED',
      skill_count: frozenSkills.length,
      registry_fingerprint: registryFingerprint,
      semantic_catalog_fingerprint: semanticCatalog.catalog_fingerprint,
      registry_bytes: 0,
      progressive_disclosure: true,
      transactional_refresh: true,
      fresh_package_revalidation_required: true,
      package_identity_bound: true,
      source_adapter_daemon_owned: true,
      ambient_filesystem_access: false,
      source_locators_embedded: false,
      full_instructions_embedded: false,
      provenance_verified: false,
      authority_effect: false,
      execution_eligible: false,
      script_execution_exposed: false,
      skills: frozenSkills
    };
    const bytes = sealRegistryBytes(registry);
    if (bytes > MAX_REGISTRY_BYTES) throw new Error('skill_registry_too_large');
    return Object.freeze({ ...registry, skills: frozenSkills });
  }

  async function refresh() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const candidate = await buildCandidate();
      currentSnapshot = candidate;
      return candidate;
    })();
    try {
      return await refreshPromise;
    } finally {
      refreshPromise = null;
    }
  }

  function snapshot() {
    if (!currentSnapshot) throw new Error('skill_registry_not_ready');
    return currentSnapshot;
  }

  async function hydrateInstructions(skillRefInput, { expectedRegistryFingerprint } = {}) {
    const skillRef = validateSkillRef(skillRefInput);
    const expectedFingerprint = validateRegistryFingerprint(expectedRegistryFingerprint);
    const capturedSnapshot = snapshot();
    if (capturedSnapshot.registry_fingerprint !== expectedFingerprint) throw new Error('skill_registry_snapshot_stale');
    const descriptor = capturedSnapshot.skills.find((entry) => entry.skill_ref === skillRef);
    if (!descriptor) throw new Error('skill_registry_skill_ref_stale');

    const files = await readFreshPackage(descriptor.name);
    revalidateSkillPackageIdentity(descriptor.name, files, {
      expectedPackageManifestDigest: descriptor.package_manifest_digest,
      expectedSemanticSkillFingerprint: descriptor.semantic_skill_fingerprint
    });
    const source = skillSourceFromSnapshot(descriptor.name, files);
    const hydrated = hydrateSkillInstructions(source, {
      expectedSkillRef: descriptor.skill_ref,
      expectedFingerprint: descriptor.semantic_skill_fingerprint
    });

    if (!currentSnapshot || currentSnapshot.registry_fingerprint !== capturedSnapshot.registry_fingerprint) {
      throw new Error('skill_registry_snapshot_rotated');
    }

    return Object.freeze({
      schema: HYDRATION_SCHEMA,
      registry_fingerprint: capturedSnapshot.registry_fingerprint,
      skill_ref: descriptor.skill_ref,
      name: descriptor.name,
      semantic_skill_fingerprint: descriptor.semantic_skill_fingerprint,
      package_manifest_digest: descriptor.package_manifest_digest,
      instructions: hydrated.instructions,
      instruction_bytes: hydrated.instruction_bytes,
      instruction_lines: hydrated.instruction_lines,
      fresh_package_revalidated: true,
      provenance_verified: false,
      tainted_skill_data: true,
      authority_effect: false,
      execution_eligible: false,
      script_execution_exposed: false,
      declared_tool_permissions_honored: false
    });
  }

  return Object.freeze({
    source_adapter_daemon_owned: true,
    ambient_filesystem_access: false,
    refresh,
    snapshot,
    hydrateInstructions
  });
}

export const SKILL_REGISTRY_LIMITS = Object.freeze({
  maxSkills: MAX_SKILLS,
  maxRegistryBytes: MAX_REGISTRY_BYTES
});
