import { createHash } from 'node:crypto';

const INVENTORY_SCHEMA = 'metaengine.a2-browser-operator.skill-resource-inventory.v1';
const RESOURCE_SCHEMA = 'metaengine.a2-browser-operator.skill-resource.v1';
const MAX_RESOURCES = 64;
const MAX_RESOURCE_BYTES = 256 * 1024;
const MAX_TOTAL_RESOURCE_BYTES = 2 * 1024 * 1024;
const MAX_INVENTORY_BYTES = 96 * 1024;
const MAX_FILENAME = 128;
const KINDS = Object.freeze({ references: 'REFERENCE', assets: 'ASSET', scripts: 'SCRIPT' });

function codeUnitCompare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function validateSkillFingerprint(value) {
  const text = String(value || '');
  if (!/^sha256:[0-9a-f]{64}$/.test(text)) throw new Error('skill_resource_skill_fingerprint_invalid');
  return text;
}

function snapshotResourceSource(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) throw new Error('skill_resource_source_invalid');
  const rawType = source.type;
  const rawExecutable = source.executable;
  const rawPath = source.path;
  const rawContent = source.content;
  return Object.freeze({ rawType, rawExecutable, rawPath, rawContent });
}

function snapshotSourceList(sources) {
  if (!Array.isArray(sources)) throw new Error('skill_resource_sources_invalid');
  const length = sources.length;
  if (!Number.isSafeInteger(length) || length < 0) throw new Error('skill_resource_sources_invalid');
  if (length > MAX_RESOURCES) throw new Error('skill_resource_sources_too_many');
  const snapshot = new Array(length);
  for (let index = 0; index < length; index += 1) snapshot[index] = sources[index];
  return Object.freeze(snapshot);
}

function normalizeResource(source) {
  const { rawType, rawExecutable, rawPath, rawContent } = snapshotResourceSource(source);
  if (rawType !== 'file') throw new Error('skill_resource_source_type_invalid');
  if (typeof rawExecutable !== 'boolean') throw new Error('skill_resource_executable_state_missing');
  const path = String(rawPath || '');
  if (path.startsWith('/') || path.includes('\\') || path.includes('\u0000')) throw new Error('skill_resource_path_invalid');
  const parts = path.split('/');
  if (parts.length !== 2 || !Object.prototype.hasOwnProperty.call(KINDS, parts[0])) throw new Error('skill_resource_path_invalid');
  const filename = parts[1];
  if (!filename || filename.length > MAX_FILENAME || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(filename) || filename.includes('..')) {
    throw new Error('skill_resource_filename_invalid');
  }
  if (typeof rawContent !== 'string') throw new Error('skill_resource_content_invalid');
  const content = rawContent.replace(/\r\n?/g, '\n');
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content)) throw new Error('skill_resource_control_character');
  const bytes = Buffer.byteLength(content);
  if (bytes > MAX_RESOURCE_BYTES) throw new Error('skill_resource_too_large');
  const digest = `sha256:${sha256(content)}`;
  return Object.freeze({
    path,
    kind: KINDS[parts[0]],
    content,
    bytes,
    digest,
    source_executable_bit: rawExecutable
  });
}

function normalizeResourceSet(sources) {
  const sourceSnapshot = snapshotSourceList(sources);
  const seen = new Set();
  let totalBytes = 0;
  const normalized = new Array(sourceSnapshot.length);
  for (let index = 0; index < sourceSnapshot.length; index += 1) {
    const resource = normalizeResource(sourceSnapshot[index]);
    if (seen.has(resource.path)) throw new Error('skill_resource_path_duplicate');
    seen.add(resource.path);
    totalBytes += resource.bytes;
    if (totalBytes > MAX_TOTAL_RESOURCE_BYTES) throw new Error('skill_resource_total_too_large');
    normalized[index] = resource;
  }
  return Object.freeze({ resources: Object.freeze(normalized), totalBytes });
}

function resourceRef(skillFingerprint, resource) {
  return `resource_${sha256(`a2-skill-resource\u0000${skillFingerprint}\u0000${resource.path}\u0000${resource.digest}`).slice(0, 24)}`;
}

function sealInventoryBytes(inventory) {
  let bytes = 0;
  for (let pass = 0; pass < 8; pass += 1) {
    inventory.inventory_bytes = bytes;
    const measured = Buffer.byteLength(JSON.stringify(inventory));
    if (measured === bytes) return measured;
    bytes = measured;
  }
  inventory.inventory_bytes = bytes;
  const measured = Buffer.byteLength(JSON.stringify(inventory));
  if (measured !== bytes) throw new Error('skill_resource_inventory_size_unstable');
  return measured;
}

function compileInventoryFromNormalized(skillFingerprint, normalizedSet) {
  const resources = normalizedSet.resources.map((resource) => Object.freeze({
    resource_ref: resourceRef(skillFingerprint, resource),
    relative_path: resource.path,
    resource_kind: resource.kind,
    resource_digest: resource.digest,
    resource_bytes: resource.bytes,
    source_executable_bit: resource.source_executable_bit,
    content_embedded: false,
    tainted_skill_data: true,
    authority_effect: false,
    execution_eligible: false,
    script_execution_exposed: false
  })).sort((a, b) => codeUnitCompare(a.relative_path, b.relative_path) || codeUnitCompare(a.resource_ref, b.resource_ref));

  const inventoryFingerprint = `sha256:${sha256(JSON.stringify({ skill_fingerprint: skillFingerprint, resources }))}`;
  const inventory = {
    schema: INVENTORY_SCHEMA,
    skill_fingerprint: skillFingerprint,
    inventory_fingerprint: inventoryFingerprint,
    resource_count: resources.length,
    total_resource_bytes: normalizedSet.totalBytes,
    inventory_bytes: 0,
    content_embedded: false,
    scripts_inert: true,
    source_snapshot_once: true,
    authority_effect: false,
    execution_eligible: false,
    script_execution_exposed: false,
    resources
  };
  const bytes = sealInventoryBytes(inventory);
  if (bytes > MAX_INVENTORY_BYTES) throw new Error('skill_resource_inventory_too_large');
  return Object.freeze({ ...inventory, resources: Object.freeze(resources) });
}

export function compileSkillResourceInventory(skillFingerprintInput, sources) {
  const skillFingerprint = validateSkillFingerprint(skillFingerprintInput);
  const normalizedSet = normalizeResourceSet(sources);
  return compileInventoryFromNormalized(skillFingerprint, normalizedSet);
}

export function hydrateSkillResource(skillFingerprintInput, sources, {
  expectedInventoryFingerprint,
  expectedResourceRef,
  expectedResourceDigest
} = {}) {
  const skillFingerprint = validateSkillFingerprint(skillFingerprintInput);
  if (typeof expectedResourceRef !== 'string' || !/^resource_[0-9a-f]{24}$/.test(expectedResourceRef)) throw new Error('skill_resource_ref_invalid');
  const normalizedSet = normalizeResourceSet(sources);
  const inventory = compileInventoryFromNormalized(skillFingerprint, normalizedSet);
  if (expectedInventoryFingerprint != null && inventory.inventory_fingerprint !== expectedInventoryFingerprint) {
    throw new Error('skill_resource_inventory_stale');
  }
  const descriptor = inventory.resources.find((entry) => entry.resource_ref === expectedResourceRef);
  if (!descriptor) throw new Error('skill_resource_ref_stale');
  if (expectedResourceDigest != null && descriptor.resource_digest !== expectedResourceDigest) throw new Error('skill_resource_digest_stale');
  const resource = normalizedSet.resources.find((entry) => entry.path === descriptor.relative_path);
  if (!resource || resource.digest !== descriptor.resource_digest) throw new Error('skill_resource_digest_stale');
  return Object.freeze({
    schema: RESOURCE_SCHEMA,
    skill_fingerprint: skillFingerprint,
    inventory_fingerprint: inventory.inventory_fingerprint,
    resource_ref: descriptor.resource_ref,
    relative_path: descriptor.relative_path,
    resource_kind: descriptor.resource_kind,
    resource_digest: descriptor.resource_digest,
    resource_bytes: descriptor.resource_bytes,
    content: resource.content,
    source_executable_bit: descriptor.source_executable_bit,
    source_snapshot_once: true,
    tainted_skill_data: true,
    authority_effect: false,
    execution_eligible: false,
    script_execution_exposed: false
  });
}

export const SKILL_RESOURCE_LIMITS = Object.freeze({
  maxResources: MAX_RESOURCES,
  maxResourceBytes: MAX_RESOURCE_BYTES,
  maxTotalResourceBytes: MAX_TOTAL_RESOURCE_BYTES,
  maxInventoryBytes: MAX_INVENTORY_BYTES,
  maxFilename: MAX_FILENAME
});
