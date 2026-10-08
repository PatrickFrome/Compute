#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const SCHEMA = 'metaengine.browser.composed-sbom-evidence.v1';
const SHA256 = /^[a-f0-9]{64}$/;
const SHA40 = /^[a-f0-9]{40}$/;

function fail(code) { throw new Error(code); }

function readJson(filePath, code) {
  let value;
  try {
    value = JSON.parse(fs.readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
  } catch {
    fail(code);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(code);
  return value;
}

function required(value, code) {
  const text = String(value ?? '').trim();
  if (!text) fail(code);
  return text;
}

function sha(value, code) {
  const text = required(value, code).toLowerCase();
  if (!SHA256.test(text)) fail(code);
  return text;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Bytes(bytes) {
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function property(name, value) {
  return { name, value: String(value) };
}

function componentRef(prefix, version, digest) {
  return `metaengine:${prefix}:${version}:${digest}`;
}

function normalizeNpmDocument(document) {
  if (document?.bomFormat !== 'CycloneDX') fail('composed_sbom_npm_format_invalid');
  if (!String(document.specVersion || '').startsWith('1.')) fail('composed_sbom_npm_spec_invalid');
  const root = document.metadata?.component;
  if (!root || typeof root !== 'object') fail('composed_sbom_npm_root_missing');
  if (!required(root['bom-ref'], 'composed_sbom_npm_root_ref_missing')) fail('composed_sbom_npm_root_ref_missing');
  return {
    root,
    components: Array.isArray(document.components) ? document.components : [],
    dependencies: Array.isArray(document.dependencies) ? document.dependencies : [],
  };
}

function normalizeUi(manifest, sourceHead) {
  if (manifest.schema !== 'me2.ui-bundle-manifest.v1') fail('composed_sbom_ui_schema_invalid');
  if (required(manifest.git_sha, 'composed_sbom_ui_source_missing').toLowerCase() !== sourceHead) fail('composed_sbom_ui_source_mismatch');
  const version = required(manifest.ui_version, 'composed_sbom_ui_version_missing');
  const digest = sha(manifest.content_sha256, 'composed_sbom_ui_sha_invalid');
  const buildId = required(manifest.build_id, 'composed_sbom_ui_build_id_missing');
  return {
    ref: componentRef('me2-ui', version, digest),
    component: {
      type: 'application',
      'bom-ref': componentRef('me2-ui', version, digest),
      name: 'METAENGINE ME2 UI',
      version,
      hashes: [{ alg: 'SHA-256', content: digest }],
      properties: [
        property('metaengine:source_head', sourceHead),
        property('metaengine:build_id', buildId),
        property('metaengine:size_bytes', Number(manifest.size_bytes || 0)),
      ],
    },
  };
}

function normalizeDaemon(manifest, sourceHead) {
  if (manifest.schema !== 'metaengine.browser.me2-daemon-package.v1') fail('composed_sbom_daemon_schema_invalid');
  if (required(manifest.source_head, 'composed_sbom_daemon_source_missing').toLowerCase() !== sourceHead) fail('composed_sbom_daemon_source_mismatch');
  if (manifest.authority_effect !== false) fail('composed_sbom_daemon_authority_invalid');
  const version = required(manifest.daemon_version, 'composed_sbom_daemon_version_missing');
  const digest = sha(manifest.executable_sha256, 'composed_sbom_daemon_sha_invalid');
  const ref = componentRef('me2-daemon', version, digest);
  return {
    ref,
    component: {
      type: 'application',
      'bom-ref': ref,
      name: 'METAENGINE ME2 Daemon',
      version,
      hashes: [{ alg: 'SHA-256', content: digest }],
      properties: [
        property('metaengine:source_head', sourceHead),
        property('metaengine:build_bun_version', required(manifest.build_bun_version, 'composed_sbom_daemon_bun_missing')),
        property('metaengine:runtime_embedded', manifest.runtime_embedded === true),
        property('metaengine:external_bun_required', manifest.external_bun_required === true),
        property('metaengine:probe_only_entrypoint', required(manifest.probe_only_entrypoint, 'composed_sbom_daemon_probe_missing')),
        property('metaengine:authority_effect', false),
      ],
    },
  };
}

function normalizeGuardian(manifest, sourceHead, packageVersion) {
  if (manifest.schema !== 'metaengine.browser.guardian-native-staging-manifest.v1') fail('composed_sbom_guardian_schema_invalid');
  if (required(manifest.source_head, 'composed_sbom_guardian_source_missing').toLowerCase() !== sourceHead) fail('composed_sbom_guardian_source_mismatch');
  if (required(manifest.package_version, 'composed_sbom_guardian_version_missing') !== packageVersion) fail('composed_sbom_guardian_version_mismatch');
  if (manifest.staging_only !== true || manifest.service_activation_authorized !== false || manifest.authority_effect !== false) {
    fail('composed_sbom_guardian_authority_invalid');
  }
  const binaries = Array.isArray(manifest.binaries) ? manifest.binaries : [];
  if (binaries.length !== 2) fail('composed_sbom_guardian_binary_count_invalid');
  const expected = new Set(['METAENGINEBrowserGuardian.exe', 'METAENGINEBrowserGuardianConfigure.exe']);
  const output = [];
  for (const row of binaries) {
    const name = required(row.name, 'composed_sbom_guardian_binary_name_invalid');
    if (!expected.delete(name)) fail('composed_sbom_guardian_binary_name_invalid');
    const digest = sha(row.sha256, 'composed_sbom_guardian_binary_sha_invalid');
    const role = required(row.role, 'composed_sbom_guardian_binary_role_invalid');
    const ref = componentRef(
      name === 'METAENGINEBrowserGuardian.exe' ? 'guardian-service' : 'guardian-configurator',
      packageVersion,
      digest,
    );
    output.push({
      ref,
      digest,
      name,
      component: {
        type: 'application',
        'bom-ref': ref,
        name,
        version: packageVersion,
        hashes: [{ alg: 'SHA-256', content: digest }],
        properties: [
          property('metaengine:source_head', sourceHead),
          property('metaengine:guardian_role', role),
          property('metaengine:staging_only', true),
          property('metaengine:authority_effect', false),
        ],
      },
    });
  }
  if (expected.size !== 0) fail('composed_sbom_guardian_binary_missing');
  return output;
}

function normalizeBootstrap(binding, sourceHead, packageVersion, guardian) {
  if (binding.schema !== 'metaengine.browser-guardian.machine-bootstrap-binding.v1') fail('composed_sbom_bootstrap_schema_invalid');
  if (required(binding.source_head, 'composed_sbom_bootstrap_source_missing').toLowerCase() !== sourceHead) fail('composed_sbom_bootstrap_source_mismatch');
  if (required(binding.package_version, 'composed_sbom_bootstrap_version_missing') !== packageVersion) fail('composed_sbom_bootstrap_version_mismatch');
  if (binding.embedded_assets_only !== true || binding.explicit_elevated_install_required !== true || binding.automatic_retry_allowed !== false || binding.authority_effect !== false) {
    fail('composed_sbom_bootstrap_authority_invalid');
  }
  const service = guardian.find((x) => x.name === 'METAENGINEBrowserGuardian.exe');
  const configurator = guardian.find((x) => x.name === 'METAENGINEBrowserGuardianConfigure.exe');
  if (sha(binding.service_sha256, 'composed_sbom_bootstrap_service_sha_invalid') !== service.digest) fail('composed_sbom_bootstrap_service_sha_mismatch');
  if (sha(binding.configurator_sha256, 'composed_sbom_bootstrap_configurator_sha_invalid') !== configurator.digest) fail('composed_sbom_bootstrap_configurator_sha_mismatch');
  const digest = sha(binding.bootstrap_sha256, 'composed_sbom_bootstrap_sha_invalid');
  const ref = componentRef('guardian-bootstrap', packageVersion, digest);
  return {
    ref,
    component: {
      type: 'application',
      'bom-ref': ref,
      name: required(binding.bootstrap_name, 'composed_sbom_bootstrap_name_missing'),
      version: packageVersion,
      hashes: [{ alg: 'SHA-256', content: digest }],
      properties: [
        property('metaengine:source_head', sourceHead),
        property('metaengine:explicit_elevated_install_required', true),
        property('metaengine:automatic_retry_allowed', false),
        property('metaengine:authority_effect', false),
      ],
    },
  };
}

function validateProvenance(provenance, sourceHead, packageVersion) {
  if (provenance.schema !== 'metaengine.browser.installer-provenance.v3') fail('composed_sbom_provenance_schema_invalid');
  if (required(provenance.source_head, 'composed_sbom_provenance_source_missing').toLowerCase() !== sourceHead) fail('composed_sbom_provenance_source_mismatch');
  if (required(provenance.package_version, 'composed_sbom_provenance_version_missing') !== packageVersion) fail('composed_sbom_provenance_version_mismatch');
  const installerSha = sha(provenance.installer_sha256, 'composed_sbom_installer_sha_invalid');
  const buildIdentitySha = sha(provenance.build_identity_sha256, 'composed_sbom_build_identity_sha_invalid');
  const lockSha = sha(provenance.package_lock_sha256, 'composed_sbom_lock_sha_invalid');
  const dependencySha = sha(provenance.dependency_resolution_sha256, 'composed_sbom_dependency_sha_invalid');
  return { installerSha, buildIdentitySha, lockSha, dependencySha };
}

function normalizeOfflineRuntime(manifest, proof, manifestBytes, sourceHead, packageVersion) {
  if (manifest.schema !== 'compute.runtime-offline-bundle.v1'
    || proof.schema !== 'metaengine.browser.packaged-client-state-runtime-proof.v1') fail('composed_sbom_offline_schema_invalid');
  if (proof.source_head !== sourceHead || proof.package_version !== packageVersion) fail('composed_sbom_offline_source_version_mismatch');
  if (manifest.platform !== 'win32' || manifest.arch !== 'x64'
    || manifest.source_root !== 'source' || manifest.entry !== 'source/infra/client-state-runtime/runtime-host.mjs'
    || manifest.deno_dir !== 'runtime/deno-cache'
    || JSON.stringify(manifest.executables) !== JSON.stringify({ node: 'runtime/node/node.exe', deno: 'runtime/deno/deno.exe', postgres_bin: 'runtime/postgresql/bin' })
    || proof.runtime_verifier_relative_path !== 'infra/client-state-runtime/offline-runtime-bundle.mjs'
    || !SHA256.test(proof.runtime_verifier_sha256 || '')) fail('composed_sbom_offline_layout_invalid');
  if (proof.protected_asar_binding_present !== true || proof.packaged_resources_verified !== true
    || proof.publisher_provenance_verified !== false || proof.installed_client_qualified !== false
    || proof.authority_effect !== false || manifest.policy?.authority_effect !== false
    || manifest.policy.database_included !== false || manifest.policy.private_config_included !== false
    || manifest.policy.credentials_included !== false || manifest.policy.publisher_provenance_verified !== false
    || manifest.policy.installed_client_qualified !== false) fail('composed_sbom_offline_proof_invalid');
  const { bundle_sha256: bundleDigest, schema, resource_inventory_sha256: inventoryDigest, ...rest } = manifest;
  if (sha256Bytes(Buffer.from(JSON.stringify({ schema, resource_inventory_sha256: inventoryDigest, ...rest }))) !== bundleDigest
    || sha256Bytes(Buffer.from(JSON.stringify({ schema: 'compute.runtime-offline-resource-inventory.v1', ...rest }))) !== inventoryDigest) fail('composed_sbom_offline_manifest_digest_mismatch');
  const manifestDigest = sha256Bytes(manifestBytes);
  if (proof.bundle_manifest_sha256 !== manifestDigest) fail('composed_sbom_offline_manifest_bytes_mismatch');
  for (const key of ['bundle_sha256', 'source_bundle_sha256', 'reviewed_startup_source_sha256', 'reviewed_startup_files_sha256', 'resource_inventory_sha256']) {
    if (sha(manifest[key], 'composed_sbom_offline_digest_invalid') !== proof[key]) fail('composed_sbom_offline_proof_binding_mismatch');
  }
  if (!Array.isArray(manifest.files) || manifest.files.length < 1 || manifest.files.length > 10000) fail('composed_sbom_offline_inventory_invalid');
  const groups = new Map(['source', 'node', 'deno', 'postgresql', 'deno_cache'].map(name => [name, []]));
  const names = new Set();
  let size = 0;
  for (const row of manifest.files) {
    if (!row || typeof row.path !== 'string' || row.path.includes('\\')
      || !row.path.split('/').every(part => /^[A-Za-z0-9_@+.-]+$/.test(part) && part !== '.' && part !== '..' && !part.startsWith('.'))
      || names.has(row.path.toLowerCase()) || !groups.has(row.component) || !SHA256.test(row.sha256 || '')
      || !Number.isSafeInteger(row.bytes) || row.bytes < 0 || row.bytes > 256 * 1024 * 1024) fail('composed_sbom_offline_inventory_invalid');
    names.add(row.path.toLowerCase());
    groups.get(row.component).push(row);
    size += row.bytes;
  }
  if (size > 2 ** 31 || proof.resource_file_count !== manifest.files.length || proof.resource_size_bytes !== size
    || [...groups.values()].some(rows => rows.length === 0)) fail('composed_sbom_offline_resource_count_mismatch');
  for (const [component, executable] of [['node', 'runtime/node/node.exe'], ['deno', 'runtime/deno/deno.exe'], ['postgresql', 'runtime/postgresql/bin/postgres.exe']]) {
    if (!groups.get(component).some(row => row.path === executable)
      || !groups.get(component).some(row => row.path === `licenses/${component}.txt`)) fail('composed_sbom_offline_required_resource_missing');
  }
  if (!groups.get('source').some(row => row.path === 'source/runtime-source-bundle.json')
    || !groups.get('source').some(row => row.path === manifest.entry)
    || !groups.get('deno_cache').some(row => row.path === 'runtime/deno-cache/npm/registry.npmjs.org/postgres/3.4.7/package.json')) fail('composed_sbom_offline_required_resource_missing');
  const make = (name, componentVersion, digest, type, properties = [], licenses = []) => {
    const ref = componentRef(name, componentVersion, digest);
    return { ref, component: { type, 'bom-ref': ref, name, version: componentVersion,
      hashes: [{ alg: 'SHA-256', content: digest }], ...(licenses.length ? { licenses } : {}),
      properties: [property('metaengine:source_head', sourceHead), property('metaengine:authority_effect', false), ...properties] } };
  };
  const output = [make('METAENGINE Client State Offline Runtime', packageVersion, bundleDigest, 'application', [
    property('metaengine:manifest_sha256', manifestDigest), property('metaengine:resource_inventory_sha256', inventoryDigest),
    property('metaengine:resource_file_count', manifest.files.length), property('metaengine:size_bytes', size),
    property('metaengine:publisher_provenance_verified', false), property('metaengine:installed_client_qualified', false),
  ]), make('METAENGINE Client State Reviewed Source', packageVersion, manifest.source_bundle_sha256, 'file', [
    property('metaengine:reviewed_startup_source_sha256', manifest.reviewed_startup_source_sha256),
    property('metaengine:reviewed_startup_files_sha256', manifest.reviewed_startup_files_sha256),
  ])];
  for (const [name, component, executable] of [
    ['Node.js', 'node', 'runtime/node/node.exe'],
    ['Deno', 'deno', 'runtime/deno/deno.exe'],
    ['PostgreSQL', 'postgresql', 'runtime/postgresql/bin/postgres.exe'],
  ]) {
    const origin = manifest.component_origins?.[component];
    if (!origin || !/^\d+\.\d+\.\d+$/.test(origin.version || '') || !SHA256.test(origin.archive_sha256 || '')
      || origin.verification !== 'RECORDED_ORIGIN_NOT_PUBLISHER_ATTESTATION') fail('composed_sbom_offline_origin_invalid');
    let url;
    try { url = new URL(origin.url); } catch { fail('composed_sbom_offline_origin_invalid'); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('composed_sbom_offline_origin_invalid');
    const rows = groups.get(component);
    const binary = rows.find(row => row.path === executable);
    const licenseFile = rows.find(row => row.path === `licenses/${component}.txt`);
    output.push(make(name, origin.version, binary.sha256, 'application', [
      property('metaengine:resource_inventory_sha256', sha256Bytes(Buffer.from(canonicalJson(rows)))),
      property('metaengine:resource_file_count', rows.length), property('metaengine:recorded_origin_url', url.href),
      property('metaengine:recorded_origin_archive_sha256', origin.archive_sha256),
      property('metaengine:origin_verification', origin.verification),
      property('metaengine:license_file', licenseFile.path), property('metaengine:license_sha256', licenseFile.sha256),
    ], [{ license: { name: `Bundled ${name} license resource` } }]));
  }
  const cacheRows = groups.get('deno_cache');
  output.push(make('postgres', '3.4.7', sha256Bytes(Buffer.from(canonicalJson(cacheRows))), 'library', [
    property('metaengine:offline_deno_cache', true), property('metaengine:resource_file_count', cacheRows.length),
  ]));
  return { components: output, manifestDigest, bundleDigest, inventoryDigest, fileCount: manifest.files.length, size };
}

export function createComposedSbom({
  npmSbomPath,
  npmEvidencePath,
  uiManifestPath,
  daemonManifestPath,
  guardianManifestPath,
  bootstrapBindingPath,
  installerProvenancePath,
  offlineRuntimeManifestPath,
  offlineRuntimeProofPath,
  sourceHead,
  packageVersion,
} = {}) {
  const head = required(sourceHead, 'composed_sbom_source_head_missing').toLowerCase();
  if (!SHA40.test(head)) fail('composed_sbom_source_head_invalid');
  const version = required(packageVersion, 'composed_sbom_package_version_missing');

  const npmDoc = readJson(npmSbomPath, 'composed_sbom_npm_unreadable');
  const npmEvidence = readJson(npmEvidencePath, 'composed_sbom_npm_evidence_unreadable');
  const npm = normalizeNpmDocument(npmDoc);
  if (npmEvidence.schema !== 'metaengine.browser.npm-sbom-evidence.v1') fail('composed_sbom_npm_evidence_schema_invalid');
  if (required(npmEvidence.source_head, 'composed_sbom_npm_evidence_source_missing').toLowerCase() !== head) fail('composed_sbom_npm_evidence_source_mismatch');
  if (required(npmEvidence.package_version, 'composed_sbom_npm_evidence_version_missing') !== version) fail('composed_sbom_npm_evidence_version_mismatch');
  const npmSemantic = sha(npmEvidence.semantic_inventory_sha256, 'composed_sbom_npm_semantic_sha_invalid');

  const provenance = readJson(installerProvenancePath, 'composed_sbom_provenance_unreadable');
  const p = validateProvenance(provenance, head, version);
  if (p.lockSha !== String(npmEvidence.package_lock_sha256 || '').toLowerCase()) fail('composed_sbom_lock_binding_mismatch');
  if (p.dependencySha !== String(npmEvidence.dependency_resolution_sha256 || '').toLowerCase()) fail('composed_sbom_dependency_binding_mismatch');

  const ui = normalizeUi(readJson(uiManifestPath, 'composed_sbom_ui_unreadable'), head);
  const daemon = normalizeDaemon(readJson(daemonManifestPath, 'composed_sbom_daemon_unreadable'), head);
  const guardian = normalizeGuardian(readJson(guardianManifestPath, 'composed_sbom_guardian_unreadable'), head, version);
  const bootstrap = normalizeBootstrap(readJson(bootstrapBindingPath, 'composed_sbom_bootstrap_unreadable'), head, version, guardian);
  if (Boolean(offlineRuntimeManifestPath) !== Boolean(offlineRuntimeProofPath)) fail('composed_sbom_offline_inputs_pair_required');
  const offlineRuntime = offlineRuntimeManifestPath ? normalizeOfflineRuntime(
    readJson(offlineRuntimeManifestPath, 'composed_sbom_offline_manifest_unreadable'),
    readJson(offlineRuntimeProofPath, 'composed_sbom_offline_proof_unreadable'),
    fs.readFileSync(offlineRuntimeManifestPath), head, version,
  ) : null;

  const rootRef = `metaengine:browser:${version}`;
  const npmRootRef = required(npm.root['bom-ref'], 'composed_sbom_npm_root_ref_missing');
  const firstParty = [ui, daemon, ...guardian, bootstrap, ...(offlineRuntime?.components || [])];
  const assemblyRefs = [npmRootRef, ...firstParty.map((x) => x.ref)];

  const composed = {
    '$schema': 'http://cyclonedx.org/schema/bom-1.5.schema.json',
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    version: 1,
    metadata: {
      component: {
        type: 'application',
        'bom-ref': rootRef,
        name: 'METAENGINE Browser',
        version,
        hashes: [{ alg: 'SHA-256', content: p.installerSha }],
        properties: [
          property('metaengine:source_head', head),
          property('metaengine:build_identity_sha256', p.buildIdentitySha),
          property('metaengine:package_lock_sha256', p.lockSha),
          property('metaengine:dependency_resolution_sha256', p.dependencySha),
          property('metaengine:npm_semantic_inventory_sha256', npmSemantic),
          property('metaengine:composition_complete', false),
          property('metaengine:authority_effect', false),
        ],
      },
    },
    components: [
      npm.root,
      ...npm.components,
      ...firstParty.map((x) => x.component),
    ],
    dependencies: [
      { ref: rootRef, dependsOn: [...assemblyRefs].sort() },
      ...npm.dependencies,
    ],
    compositions: [
      {
        aggregate: 'incomplete',
        assemblies: [...assemblyRefs].sort(),
      },
    ],
  };

  const semantic = {
    schema: 'metaengine.browser.composed-sbom-semantic-inventory.v1',
    root: composed.metadata.component,
    components: [...composed.components].sort((a, b) => String(a['bom-ref'] || '').localeCompare(String(b['bom-ref'] || ''))),
    dependencies: [...composed.dependencies].map((row) => ({
      ref: row.ref,
      dependsOn: Array.isArray(row.dependsOn) ? [...row.dependsOn].sort() : [],
    })).sort((a, b) => String(a.ref).localeCompare(String(b.ref))),
    compositions: composed.compositions,
  };
  const semanticSha = sha256Bytes(Buffer.from(canonicalJson(semantic), 'utf8'));

  const evidence = {
    schema: SCHEMA,
    source_head: head,
    package_version: version,
    installer_sha256: p.installerSha,
    build_identity_sha256: p.buildIdentitySha,
    package_lock_sha256: p.lockSha,
    dependency_resolution_sha256: p.dependencySha,
    npm_semantic_inventory_sha256: npmSemantic,
    composed_semantic_inventory_sha256: semanticSha,
    npm_component_count: npm.components.length,
    first_party_component_count: firstParty.length,
    offline_runtime_component_count: offlineRuntime?.components.length || 0,
    offline_runtime_resource_file_count: offlineRuntime?.fileCount ?? null,
    offline_runtime_resource_size_bytes: offlineRuntime?.size ?? null,
    offline_runtime_bundle_sha256: offlineRuntime?.bundleDigest ?? null,
    offline_runtime_manifest_sha256: offlineRuntime?.manifestDigest ?? null,
    offline_runtime_resource_inventory_sha256: offlineRuntime?.inventoryDigest ?? null,
    offline_runtime_packaged_resources_verified: Boolean(offlineRuntime),
    total_component_count: composed.components.length,
    composition_aggregate: 'incomplete',
    authority_effect: false,
  };

  return { sbom: composed, evidence };
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) continue;
    const key = token.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i += 1; }
  }
  return out;
}

async function main() {
  const a = parseArgs(process.argv.slice(2));
  const result = createComposedSbom({
    npmSbomPath: a['npm-sbom'],
    npmEvidencePath: a['npm-evidence'],
    uiManifestPath: a['ui-manifest'],
    daemonManifestPath: a['daemon-manifest'],
    guardianManifestPath: a['guardian-manifest'],
    bootstrapBindingPath: a['bootstrap-binding'],
    installerProvenancePath: a.provenance,
    offlineRuntimeManifestPath: a['offline-runtime-manifest'],
    offlineRuntimeProofPath: a['offline-runtime-proof'],
    sourceHead: a['source-head'],
    packageVersion: a['package-version'],
  });
  const sbomJson = JSON.stringify(result.sbom, null, 2) + '\n';
  const evidenceJson = JSON.stringify(result.evidence, null, 2) + '\n';
  if (a.out) fs.writeFileSync(path.resolve(String(a.out)), sbomJson, 'utf8');
  if (a.evidence) fs.writeFileSync(path.resolve(String(a.evidence)), evidenceJson, 'utf8');
  process.stdout.write(JSON.stringify(result.evidence) + '\n');
}

if (Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    process.stderr.write(JSON.stringify({
      schema: 'metaengine.browser.composed-sbom-error.v1',
      code: String(error?.message || error).split(':')[0],
      authority_effect: false,
    }) + '\n');
    process.exitCode = 1;
  });
}

export { SCHEMA, canonicalJson };
