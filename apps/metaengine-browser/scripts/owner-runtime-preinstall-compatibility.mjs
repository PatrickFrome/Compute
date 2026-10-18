#!/usr/bin/env node
// Read-only QA installer compatibility fence, NOT a provenance signer or Owner
// migration. A pinned Owner from an older runtime must not be silently
// stranded by a new package. Only an externally reviewed upgrade can rebind it.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { localStateProviderOwnerFile, validateLocalStateProviderConfig } from '../src/local-state-provider-policy.mjs';

const require = createRequire(import.meta.url);
const SHA = /^[a-f0-9]{64}$/;
const err = code => { throw new Error(code); };

export function classifyExistingOwnerPin(owner, candidate, expectedInstalledResources) {
  if (!candidate || !SHA.test(candidate.bundle_sha256 || '')
    || typeof candidate.package_version !== 'string'
    || !path.isAbsolute(expectedInstalledResources || '')) err('candidate_binding_invalid');
  if (owner === null) return Object.freeze({ state: 'NO_OWNER', install_compatible: true });
  let validated;
  try { validated = validateLocalStateProviderConfig(owner); }
  catch { err('owner_config_invalid'); }
  if (!validated.runtime_host) err('owner_runtime_host_unbound');
  const actualPath = path.resolve(validated.runtime_host.bundle_directory);
  const expectedPath = path.resolve(expectedInstalledResources, 'client-state-runtime');
  const same = process.platform === 'win32'
    ? actualPath.toLowerCase() === expectedPath.toLowerCase() : actualPath === expectedPath;
  if (!same) err('owner_runtime_path_mismatch');
  if (validated.runtime_host.expected_bundle_sha256 !== candidate.bundle_sha256) {
    err('owner_runtime_digest_mismatch');
  }
  return Object.freeze({ state: 'OWNER_PIN_MATCHES', install_compatible: true });
}

async function fixedOwnerRead() {
  const file = localStateProviderOwnerFile({ env: process.env });
  if (!file) err('owner_location_unavailable');
  let info;
  try { info = await fs.lstat(file); }
  catch (e) {
    if (e?.code === 'ENOENT') return null;
    err('owner_file_unreadable');
  }
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size < 1 || info.size > 16384) {
    err('owner_file_not_regular');
  }
  try { return JSON.parse(await fs.readFile(file, 'utf8')); }
  catch { err('owner_file_invalid_json'); }
}

const PROOF_SCHEMA = 'metaengine.browser.qa-owner-preinstall-compatibility.v1';
const failClosed = reason => {
  process.stdout.write(JSON.stringify({ schema: PROOF_SCHEMA, state: 'BLOCKED',
    reason: /^[a-z][a-z0-9_]{1,80}$/.test(reason) ? reason : 'preflight_unverified',
    installer_effect_attempted: false, owner_mutated: false,
    provenance_verified: false, authority_effect: false }) + '\n');
  process.exitCode = 3;
};

export async function runPreflight({ candidateResources, expectedVersion, installedResources }) {
  for (const value of [candidateResources, installedResources]) {
    if (typeof value !== 'string' || !path.isAbsolute(value)) err('preflight_path_invalid');
  }
  if (!/^\d+\.\d+\.\d+-dev\.\d+\.1$/.test(expectedVersion || '')) err('preflight_version_invalid');
  const archiveFile = path.join(candidateResources, 'app.asar');
  const archive = await fs.lstat(archiveFile).catch(() => null);
  if (!archive?.isFile() || archive.isSymbolicLink() || archive.nlink !== 1 || archive.size < 1
    || archive.size > 200 * 1024 * 1024) err('candidate_asar_invalid');
  // Uses the same resource verification as post-package CI. Staged QA bytes
  // have NOT been independently bound to the NSIS installer or a release root.
  let pkg, verifierBytes;
  try {
    const asar = require('@electron/asar');
    pkg = JSON.parse(asar.extractFile(archiveFile, 'package.json').toString('utf8'));
    verifierBytes = asar.extractFile(archiveFile, path.normalize('infra/client-state-runtime/offline-runtime-bundle.mjs'));
  } catch { err('candidate_asar_metadata_unreadable'); }
  if (pkg?.version !== expectedVersion) err('candidate_version_mismatch');
  const binding = pkg?.metaengineClientStateRuntime;
  if (!/^[a-f0-9]{40}$/.test(binding?.source_head_sha || '')) err('candidate_source_head_invalid');
  try {
    const { assertPackagedOfflineRuntimeBinding } = require('./offline-runtime-package-binding.cjs');
    await assertPackagedOfflineRuntimeBinding(binding, {
      expectedHead: binding.source_head_sha, packageVersion: expectedVersion,
      resourcesDir: candidateResources, verifierBytes,
    });
  } catch { err('candidate_offline_bundle_unverified'); }
  const owner = await fixedOwnerRead();
  const compatibility = classifyExistingOwnerPin(owner, binding, installedResources);
  return Object.freeze({
    schema: PROOF_SCHEMA, state: 'COMPATIBLE', owner_state: compatibility.state,
    source_head: binding.source_head_sha, package_version: expectedVersion,
    bundle_sha256: binding.bundle_sha256, installer_effect_attempted: false,
    installer_payload_correspondence_verified: false, production_authorized: false,
    owner_mutated: false, automatic_rebind_allowed: false, authority_effect: false,
  });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const values = process.argv.slice(2);
  if (values.length !== 6
    || values[0] !== '--candidate-resources' || values[2] !== '--expected-version'
    || values[4] !== '--installed-resources') {
    failClosed('preflight_arguments_invalid');
  } else {
    runPreflight({ candidateResources: values[1], expectedVersion: values[3], installedResources: values[5] })
      .then(result => process.stdout.write(JSON.stringify(result) + '\n'))
      .catch(error => failClosed(String(error?.message || 'preflight_unverified')));
  }
}