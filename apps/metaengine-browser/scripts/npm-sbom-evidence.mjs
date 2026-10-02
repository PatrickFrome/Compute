#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const EVIDENCE_SCHEMA = 'metaengine.browser.npm-sbom-evidence.v1';
const SHA256_RE = /^[a-f0-9]{64}$/;
const SHA40_RE = /^[a-f0-9]{40}$/;

function fail(code) {
  throw new Error(code);
}

function readJson(filePath, code) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    fail(code);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key]);
    return out;
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function optionalString(value) {
  const text = String(value ?? '').trim();
  return text || null;
}

function normalizeHashes(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      alg: optionalString(item.alg),
      content: optionalString(item.content)?.toLowerCase() || null,
    }))
    .filter((item) => item.alg && item.content)
    .sort((a, b) => `${a.alg}:${a.content}`.localeCompare(`${b.alg}:${b.content}`));
}

function normalizeComponent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('npm_sbom_component_invalid');
  return {
    bom_ref: optionalString(value['bom-ref']),
    type: optionalString(value.type),
    group: optionalString(value.group),
    name: optionalString(value.name),
    version: optionalString(value.version),
    purl: optionalString(value.purl),
    scope: optionalString(value.scope),
    hashes: normalizeHashes(value.hashes),
  };
}

function componentKey(component) {
  return [
    component.bom_ref || '',
    component.purl || '',
    component.group || '',
    component.name || '',
    component.version || '',
    component.type || '',
    component.scope || '',
  ].join('|');
}

function componentPackageName(component) {
  if (!component?.name) return null;
  if (component.name.startsWith('@')) return component.name;
  if (component.group && component.group.startsWith('@')) {
    return `${component.group}/${component.name}`;
  }
  return component.name;
}

function normalizeDependencies(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      ref: optionalString(item.ref),
      depends_on: Array.isArray(item.dependsOn)
        ? [...new Set(item.dependsOn.map(optionalString).filter(Boolean))].sort()
        : [],
    }))
    .filter((item) => item.ref)
    .sort((a, b) => a.ref.localeCompare(b.ref));
}

function loadLockMaterial(filePath) {
  const value = readJson(filePath, 'npm_sbom_lock_material_unreadable');
  if (value.schema !== 'metaengine.browser.package-lock-material.v1') fail('npm_sbom_lock_material_schema_invalid');
  if (!SHA256_RE.test(String(value.package_lock_sha256 || '').toLowerCase())) fail('npm_sbom_lock_material_sha_invalid');
  if (!String(value.package_name || '').trim()) fail('npm_sbom_lock_material_name_invalid');
  if (!String(value.package_version || '').trim()) fail('npm_sbom_lock_material_version_invalid');
  if (!String(value.npm_version || '').trim()) fail('npm_sbom_lock_material_npm_version_invalid');
  if (value.authority_effect !== false) fail('npm_sbom_lock_material_authority_invalid');
  return value;
}

function loadDependencyResolution(filePath) {
  const value = readJson(filePath, 'npm_sbom_dependency_resolution_unreadable');
  if (value.schema !== 'metaengine.browser.dependency-resolution.v1') fail('npm_sbom_dependency_resolution_schema_invalid');
  if (!SHA256_RE.test(String(value.dependency_resolution_sha256 || '').toLowerCase())) fail('npm_sbom_dependency_resolution_sha_invalid');
  if (!String(value.root_name || '').trim()) fail('npm_sbom_dependency_resolution_name_invalid');
  if (!String(value.root_version || '').trim()) fail('npm_sbom_dependency_resolution_version_invalid');
  if (!String(value.npm_version || '').trim()) fail('npm_sbom_dependency_resolution_npm_version_invalid');
  if (value.authority_effect !== false) fail('npm_sbom_dependency_resolution_authority_invalid');
  return value;
}

export function createNpmSbomEvidence({
  sbomPath,
  packageJsonPath,
  packageLockMaterialPath,
  dependencyResolutionPath,
  sourceHead = null,
} = {}) {
  if (!sbomPath) fail('npm_sbom_path_missing');
  if (!packageJsonPath) fail('npm_sbom_package_json_path_missing');
  if (!packageLockMaterialPath) fail('npm_sbom_package_lock_material_path_missing');
  if (!dependencyResolutionPath) fail('npm_sbom_dependency_resolution_path_missing');

  const sbomBytes = fs.readFileSync(path.resolve(String(sbomPath)));
  let sbom;
  try {
    sbom = JSON.parse(sbomBytes.toString('utf8'));
  } catch {
    fail('npm_sbom_json_invalid');
  }
  if (!sbom || typeof sbom !== 'object' || Array.isArray(sbom)) fail('npm_sbom_json_invalid');
  if (sbom.bomFormat !== 'CycloneDX') fail('npm_sbom_format_invalid');
  if (!/^1\.[5-9]$/.test(String(sbom.specVersion || ''))) fail('npm_sbom_spec_version_invalid');
  if (!Number.isSafeInteger(Number(sbom.version)) || Number(sbom.version) < 1) fail('npm_sbom_document_version_invalid');

  const pkg = readJson(path.resolve(String(packageJsonPath)), 'npm_sbom_package_json_invalid');
  const packageName = String(pkg.name || '').trim();
  const packageVersion = String(pkg.version || '').trim();
  if (!packageName) fail('npm_sbom_package_name_invalid');
  if (!packageVersion) fail('npm_sbom_package_version_invalid');

  const lock = loadLockMaterial(path.resolve(String(packageLockMaterialPath)));
  const dependency = loadDependencyResolution(path.resolve(String(dependencyResolutionPath)));

  if (lock.package_name !== packageName || dependency.root_name !== packageName) fail('npm_sbom_root_name_binding_mismatch');
  if (lock.package_version !== packageVersion || dependency.root_version !== packageVersion) fail('npm_sbom_root_version_binding_mismatch');
  if (lock.npm_version !== dependency.npm_version) fail('npm_sbom_npm_version_binding_mismatch');

  const root = normalizeComponent(sbom.metadata?.component || {});
  if (componentPackageName(root) !== packageName) fail('npm_sbom_metadata_root_name_mismatch');
  if (root.version !== packageVersion) fail('npm_sbom_metadata_root_version_mismatch');
  if (root.type !== 'application') fail('npm_sbom_metadata_root_type_invalid');

  const components = Array.isArray(sbom.components)
    ? sbom.components.map(normalizeComponent).sort((a, b) => componentKey(a).localeCompare(componentKey(b)))
    : [];
  if (components.length < 1) fail('npm_sbom_components_missing');

  const dependencies = normalizeDependencies(sbom.dependencies);
  const dependencyRelationCount = dependencies.reduce((sum, item) => sum + item.depends_on.length, 0);

  const semanticInventory = {
    schema: 'metaengine.browser.npm-sbom-semantic-inventory.v1',
    bom_format: 'CycloneDX',
    spec_version: String(sbom.specVersion),
    root,
    components,
    dependencies,
  };
  const semanticInventorySha256 = sha256Bytes(Buffer.from(canonicalJson(semanticInventory), 'utf8'));
  const rawSbomSha256 = sha256Bytes(sbomBytes);

  const normalizedSourceHead = sourceHead == null ? null : String(sourceHead).trim().toLowerCase();
  if (normalizedSourceHead && !SHA40_RE.test(normalizedSourceHead)) fail('npm_sbom_source_head_invalid');

  return Object.freeze({
    schema: EVIDENCE_SCHEMA,
    source_head: normalizedSourceHead,
    package_name: packageName,
    package_version: packageVersion,
    bom_format: 'CycloneDX',
    spec_version: String(sbom.specVersion),
    raw_sbom_sha256: rawSbomSha256,
    raw_sbom_bytes: sbomBytes.length,
    semantic_inventory_sha256: semanticInventorySha256,
    component_count: components.length,
    dependency_node_count: dependencies.length,
    dependency_relation_count: dependencyRelationCount,
    serial_number_present: Boolean(optionalString(sbom.serialNumber)),
    metadata_timestamp_present: Boolean(optionalString(sbom.metadata?.timestamp)),
    package_lock_sha256: String(lock.package_lock_sha256).toLowerCase(),
    dependency_resolution_sha256: String(dependency.dependency_resolution_sha256).toLowerCase(),
    npm_version: String(lock.npm_version),
    authority_effect: false,
  });
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else {
      out[key] = next;
      i += 1;
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const evidence = createNpmSbomEvidence({
    sbomPath: args.sbom,
    packageJsonPath: args['package-json'] || 'package.json',
    packageLockMaterialPath: args['package-lock-material'],
    dependencyResolutionPath: args['dependency-resolution'],
    sourceHead: args['source-head'] || null,
  });
  const json = JSON.stringify(evidence, null, 2) + '\n';
  if (args.out && args.out !== true) fs.writeFileSync(path.resolve(String(args.out)), json, 'utf8');
  process.stdout.write(JSON.stringify(evidence) + '\n');
}

const direct = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (direct) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      schema: 'metaengine.browser.npm-sbom-evidence-error.v1',
      code: String(error?.message || error).split(':')[0],
      message: String(error?.message || error).slice(0, 1000),
      authority_effect: false,
    }) + '\n');
    process.exitCode = 1;
  });
}

export { EVIDENCE_SCHEMA, canonicalJson };
