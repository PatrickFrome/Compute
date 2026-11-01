// W77 release-proof producer. SOURCE/STAGING is never installed release proof.
// This module is a sidecar handoff, not a second trust root, secret store or installer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { verifyForwardArchiveFiles } from './qa-forward-candidate-archive.mjs';
import { validateEmergencyMaintenanceTrustRoot } from '../src/emergency-maintenance-trust-root.mjs';
import {
  INSTALLED_RELEASE_ENVELOPE_W68,
  INSTALLED_RELEASE_MANIFEST_W68,
  INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68,
} from '../src/installed-executable-provenance-w68.mjs';
import { RESERVED_PACKAGE_IDENTITIES_W68 } from '../src/client-package-identity-w68.mjs';
import { RELEASE_FILES_W68, PACKAGE_CODE_FILE_W68, capturePackageCodeW68,
  verifyPackageCodeW68, validatePackageCodeManifestW68 } from '../src/installed-package-code-w68.mjs';

export const RELEASE_PROOF_FILES_W77 = RELEASE_FILES_W68;
export const RELEASE_PROOF_HANDOFF_SCHEMA_W77 = 'metaengine.browser.release-proof-external-handoff-w77.v2';
export const RELEASE_PROOF_SIGNER_BLOCK_W77 = 'EXISTING_PROTECTED_RELEASE_ROOT_SIGNING_CAPABILITY_NOT_WIRED';
const sha40 = /^[a-f0-9]{40}$/;
const sha256 = /^[a-f0-9]{64}$/;
const thumb = /^[a-f0-9]{40}$/;
const versionPattern = /^0\.7\.0-dev\.[1-9][0-9]*\.1$/;
const fields = Object.freeze([
  'schema','source_sha','package_version','exe_name','exe_sha256',
  'signer_thumbprint','installer_sha256','slsa_bundle_sha256','slsa_evidence_sha256','package_code_sha256',
]);
const digest = b => crypto.createHash('sha256').update(b).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) &&
  Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const valid = (value, pattern) => typeof value === 'string' && pattern.test(value);
const reject = reason => { throw new Error('w77_release_proof_' + reason); };
const repository = 'PatrickFrome/Compute';
const producerWorkflow = '.github/workflows/browser-windows-package-smoke.yml';
const producerBranch = 'physical/build-slsa-provenance-v1';
const preparedInputs = new WeakMap();
function positiveId(value) {
  if ((typeof value !== 'string' && typeof value !== 'number') ||
      (typeof value === 'number' && !Number.isSafeInteger(value)) ||
      !/^[1-9][0-9]*$/.test(String(value))) reject('positive_identity');
  return String(value);
}

// These paths are the existing builder/offline-runtime layout, not a host
// discovery list. Presence is necessary but does not qualify dependencies,
// installation, enrollment or a running service on a clean target machine.
export function requiredSelfContainedPayloadsW77(version, exeName = 'METAENGINE Browser Test.exe') {
  if (!valid(version, versionPattern) || RESERVED_PACKAGE_IDENTITIES_W68.includes(version) ||
      !['METAENGINE Browser Test.exe', 'METAENGINE-Browser.exe'].includes(exeName)) reject('self_contained_version_or_exe');
  const runtime = 'resources/client-state-runtime/';
  const postgres = runtime + 'runtime/postgresql/';
  return Object.freeze({
    browser_exe: exeName, browser_asar: 'resources/app.asar',
    codex_job_helper: 'resources/native-coding/codex-cli-job-runner.ps1',
    offline_manifest: runtime + 'offline-runtime-bundle.json',
    runtime_host: runtime + 'source/infra/client-state-runtime/runtime-host.mjs',
    fresh_pg17_initdb: runtime + 'source/infra/client-state-runtime/fresh-pg17-initdb.mjs',
    bundled_node: runtime + 'runtime/node/node.exe', bundled_deno: runtime + 'runtime/deno/deno.exe',
    pg17_postgres: postgres + 'bin/postgres.exe', pg17_psql: postgres + 'bin/psql.exe',
    pg17_initdb: postgres + 'bin/initdb.exe', pg17_pg_ctl: postgres + 'bin/pg_ctl.exe',
    pg17_pg_config: postgres + 'bin/pg_config.exe', pg17_plpgsql: postgres + 'lib/plpgsql.dll',
    pg17_catalog: postgres + 'share/postgres.bki',
    guardian_manifest: 'resources/guardian-native/guardian-native-manifest.json',
    guardian_service: 'resources/guardian-native/METAENGINEBrowserGuardian.exe',
    guardian_configurator: 'resources/guardian-native/METAENGINEBrowserGuardianConfigure.exe',
    guardian_bootstrap_binding: 'resources/guardian-bootstrap/guardian-machine-bootstrap-binding.json',
    guardian_bootstrap: 'resources/guardian-bootstrap/METAENGINE-Guardian-Bootstrap-' + version + '-x64.exe',
  });
}

export function validateRequiredSelfContainedPayloadsW77(manifest, { sourceSha, version,
  exeName = 'METAENGINE Browser Test.exe' } = {}) {
  validatePackageCodeManifestW68(manifest, { sourceSha, version, exeName });
  const roles = requiredSelfContainedPayloadsW77(version, exeName);
  for (const [role, relative] of Object.entries(roles)) {
    const entry = manifest.entries.find(row => row.path === relative);
    if (entry?.kind !== 'file' || entry.size < 1) reject('self_contained_payload_missing_' + role);
  }
  return Object.freeze({ scope: 'SOURCE_PAYLOAD_PRESENCE_ONLY', required_roles: roles,
    // The existing codex-job manifest describes only its process helper.
    // It declares no delivered Codex/Git executable/dependency role binding.
    unresolved_role_bindings: Object.freeze(['codex_cli_executable_and_dependencies',
      'git_executable_and_dependencies']),
    clean_machine_installation_qualified: false, authority_effect: false });
}

// Shape checks alone are not GitHub authentication. The production entrypoint
// below obtains BOTH documents itself through the fixed GitHub CLI GET route.
export function validateImmutableArtifactBindingW77({ producerRun, artifact,
  sourceSha, version, runId, attempt, artifactId, archiveSha256 } = {}) {
  const run = positiveId(runId), tries = positiveId(attempt), id = positiveId(artifactId);
  if (!valid(sourceSha, sha40) || !valid(archiveSha256, sha256) ||
      !valid(version, versionPattern) || RESERVED_PACKAGE_IDENTITIES_W68.includes(version)) reject('artifact_identity');
  if (!object(producerRun) || producerRun.repository?.full_name !== repository ||
      producerRun.path !== producerWorkflow || producerRun.head_branch !== producerBranch ||
      producerRun.head_sha !== sourceSha || producerRun.event !== 'push' ||
      producerRun.status !== 'completed' || producerRun.conclusion !== 'success' ||
      positiveId(producerRun.id) !== run || positiveId(producerRun.run_attempt) !== tries) reject('artifact_producer');
  if (!object(artifact) || positiveId(artifact.id) !== id ||
      artifact.name !== 'metaengine-browser-windows-candidate-' + sourceSha ||
      artifact.digest !== 'sha256:' + archiveSha256 || artifact.expired !== false ||
      !object(artifact.workflow_run) || positiveId(artifact.workflow_run.id) !== run ||
      artifact.workflow_run.head_sha !== sourceSha) reject('artifact_metadata');
  return Object.freeze({ source_sha: sourceSha, package_version: version,
    producer_run_id: run, producer_run_attempt: tries, artifact_id: id,
    artifact_name: artifact.name, archive_sha256: archiveSha256,
    producer_terminal_success: true, semantic_shape_checked_only: true,
    cryptographic_verification_claimed: false, authority_effect: false });
}

// Reuse the existing streaming ZIP parser and complete local-tree readback.
// This accepts inert bytes in tests and makes no SLSA or signing claim. In the
// production path its archive pin must first agree with live GitHub metadata.
export async function verifyImmutableArtifactBytesW77({ archivePath, archiveSha256,
  candidateRoot, sourceSha, version, runId, attempt } = {}) {
  if (!valid(sourceSha, sha40) || !valid(version, versionPattern) ||
      RESERVED_PACKAGE_IDENTITIES_W68.includes(version)) reject('artifact_identity');
  positiveId(runId); positiveId(attempt);
  const readback = await verifyForwardArchiveFiles({ archiveFile: archivePath,
    archiveSha256, directory: candidateRoot });
  const installerName = 'METAENGINE-Browser-Test-Setup-' + version + '-x64.exe';
  const required = [installerName, PACKAGE_CODE_FILE_W68,
    'browser-slsa-provenance/' + RELEASE_PROOF_FILES_W77.bundle,
    'browser-slsa-provenance/installer-slsa-provenance-receipt.json'];
  const digests = required.map(name => {
    const rows = readback.files.filter(row => row[0] === name && row.length === 3);
    if (rows.length !== 1) reject('artifact_member_missing');
    return rows[0][2];
  });
  const held = [archivePath, candidateRoot, ...readback.files.map(row => path.join(candidateRoot, ...row[0].split('/')))]
    .map(file => [file, fs.lstatSync(file, { bigint: true })]);
  const ancestors = new Map();
  for (const directory of [path.dirname(archivePath), path.dirname(candidateRoot)]) {
    for (let current = directory;; current = path.dirname(current)) {
      const stat = fs.lstatSync(current, { bigint: true });
      if (stat.isSymbolicLink() || !stat.isDirectory()) reject('artifact_ancestor_alias');
      ancestors.set(current, stat);
      if (current === path.dirname(current)) break;
    }
  }
  const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
  const assertHeld = () => {
    for (const [file, before] of held) {
      const after = fs.lstatSync(file, { bigint: true });
      if (after.isSymbolicLink() || !sameIdentity(before, after) ||
          before.size !== after.size || before.mtimeNs !== after.mtimeNs ||
          before.ctimeNs !== after.ctimeNs || before.nlink !== after.nlink ||
          (before.isFile() ? !after.isFile() || after.nlink !== 1n : !after.isDirectory())) {
        reject('materialized_file_changed');
      }
    }
    for (const [directory, before] of ancestors) {
      const after = fs.lstatSync(directory, { bigint: true });
      if (after.isSymbolicLink() || !after.isDirectory() || !sameIdentity(before, after)) reject('artifact_ancestor_alias');
    }
  };
  const slsaDirectory = path.join(candidateRoot, 'browser-slsa-provenance');
  let receipt;
  try { receipt = JSON.parse(checkedFile(path.join(slsaDirectory,
    'installer-slsa-provenance-receipt.json'), slsaDirectory).toString('utf8').replace(/^\uFEFF/, '')); }
  catch { reject('producer_receipt_json'); }
  validateExistingProducerReceiptW77({ receipt, sourceSha, version, installerName,
    installerSha: digests[0], expectedRunId: runId, expectedAttempt: attempt });
  assertHeld();
  const fence = async () => {
    assertHeld();
    const after = await verifyForwardArchiveFiles({ archiveFile: archivePath,
      archiveSha256, directory: candidateRoot });
    if (after.tree_sha256 !== readback.tree_sha256) reject('artifact_tree_changed');
    assertHeld();
  };
  // The first verifier returns data rather than its retained descriptors.
  // Recheck after taking our own pins so that the handoff has no unobserved
  // interval between the shared verifier and this function's custody fence.
  await fence();
  return Object.freeze({ archive_sha256: archiveSha256, installer_sha256: digests[0],
    package_code_sha256: digests[1], bundle_sha256: digests[2], receipt_sha256: digests[3],
    full_archive_file_membership_verified: true, cryptographic_verification_claimed: false,
    authority_effect: false, fence });
}

async function readLiveArtifactBinding({ sourceSha, version, runId, attempt, artifactId, archiveSha256 }) {
  // Validate before interpolating any path component. Never accept a supplied
  // API response, alternate hostname, callback verifier, token or API base.
  positiveId(runId); positiveId(attempt); positiveId(artifactId);
  const { spawnSync } = await import('node:child_process');
  const read = endpoint => {
    const result = spawnSync('gh', ['api', '--hostname', 'github.com', '--method', 'GET',
      '-H', 'Accept: application/vnd.github+json', '-H', 'X-GitHub-Api-Version: 2022-11-28', endpoint],
    { encoding: 'utf8', shell: false, windowsHide: true, timeout: 30000,
      maxBuffer: 2_000_000, stdio: ['ignore', 'pipe', 'pipe'] });
    if (result.error || result.status !== 0) reject('live_github_metadata');
    try { return JSON.parse(result.stdout); } catch { reject('live_github_metadata_json'); }
  };
  const producerRun = read('repos/' + repository + '/actions/runs/' + positiveId(runId));
  const artifact = read('repos/' + repository + '/actions/artifacts/' + positiveId(artifactId));
  const binding = validateImmutableArtifactBindingW77({ producerRun, artifact,
    sourceSha, version, runId, attempt, artifactId, archiveSha256 });
  if (!Number.isSafeInteger(artifact.size_in_bytes) || artifact.size_in_bytes < 22 ||
      !Number.isSafeInteger(producerRun.run_number) || producerRun.run_number < 1) reject('live_github_size_or_run_number');
  return { binding, size: artifact.size_in_bytes, runNumber: producerRun.run_number };
}

async function requireIndependentGhCli() {
  const { spawnSync } = await import('node:child_process');
  const result = spawnSync('gh', ['attestation', 'verify', '--help'], {
    encoding: 'utf8', shell: false, windowsHide: true, timeout: 15000,
    maxBuffer: 100000, stdio: ['ignore', 'pipe', 'pipe'] });
  if (result.error || result.status !== 0 ||
      ['--signer-digest', '--source-digest', '--source-ref', '--cert-oidc-issuer',
        '--deny-self-hosted-runners', '--predicate-type', '--bundle', '--format']
        .some(flag => !result.stdout?.includes(flag))) reject('gh_attestation_cli_unavailable');
}

// The W68 consumer signs/verifies domain || JSON.stringify(manifest), in this
// exact property order. NO key-sorted or user-provided JSON serializer.
// Snapshot only declared own DATA properties before checking any value.
// Getters can return one SHA during validation and another for the signed
// bytes. Hidden or Symbol properties must not silently evade the wire schema.
function snapshotReleaseManifestW77(manifest) {
  if (!object(manifest) || ![Object.prototype, null].includes(Object.getPrototypeOf(manifest))) {
    reject('manifest_shape');
  }
  const descriptors = Object.getOwnPropertyDescriptors(manifest);
  if (Reflect.ownKeys(descriptors).length !== fields.length ||
      fields.some(key => !Object.hasOwn(descriptors, key) ||
        !Object.hasOwn(descriptors[key], 'value') || descriptors[key].enumerable !== true)) {
    reject('manifest_shape');
  }
  return Object.fromEntries(fields.map(key => [key, descriptors[key].value]));
}

function validatedReleaseManifestW77(manifest) {
  const ordered = snapshotReleaseManifestW77(manifest);
  if (ordered.schema !== INSTALLED_RELEASE_MANIFEST_W68) reject('manifest_schema');
  if (!valid(ordered.source_sha, sha40)) reject('source_sha');
  if (!valid(ordered.package_version, versionPattern) ||
      RESERVED_PACKAGE_IDENTITIES_W68.includes(ordered.package_version)) reject('reserved_or_invalid_version');
  if (ordered.exe_name !== 'METAENGINE Browser Test.exe' &&
      ordered.exe_name !== 'METAENGINE-Browser.exe') reject('exe_name');
  for (const field of ['exe_sha256','installer_sha256','slsa_bundle_sha256','slsa_evidence_sha256','package_code_sha256']) {
    if (!valid(ordered[field], sha256)) reject(field);
  }
  if (!valid(ordered.signer_thumbprint, thumb)) reject('signer_thumbprint');
  return ordered;
}

export function serializeReleaseManifestW77(manifest) {
  const ordered = validatedReleaseManifestW77(manifest);
  return Buffer.concat([
    Buffer.from(INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68, 'utf8'),
    Buffer.from(JSON.stringify(ordered), 'utf8'),
  ]);
}

function checkedFile(filename, parent) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename) ||
      path.resolve(filename) !== filename || path.dirname(filename) !== parent) reject('file_path');
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size < 1 ||
      stat.size > 400_000_000 || fs.realpathSync.native(filename).toLowerCase() !== filename.toLowerCase()) {
    reject('unsafe_artifact_path');
  }
  const bytes = fs.readFileSync(filename);
  const after = fs.lstatSync(filename);
  if (stat.dev !== after.dev || stat.ino !== after.ino || stat.size !== after.size ||
      stat.mtimeMs !== after.mtimeMs || stat.ctimeMs !== after.ctimeMs ||
      after.isSymbolicLink() || !after.isFile() || after.nlink !== 1 ||
      fs.realpathSync.native(filename).toLowerCase() !== filename.toLowerCase() ||
      bytes.length !== stat.size) reject('artifact_toctou');
  return bytes;
}

// Called unconditionally by ordinary Windows afterAllArtifactBuild, after the
// ASAR/fuses/resource checks. The inventory stays OUTSIDE win-unpacked and the
// final installer: no recursive hash or invented signing/placement capability.
export async function writePackagedCodeInventoryW77({ appOutDir, outDir, sourceSha, version, exeName }) {
  if (!path.isAbsolute(outDir) || path.resolve(outDir) !== outDir ||
      path.dirname(appOutDir) !== outDir || !fs.lstatSync(outDir).isDirectory() ||
      fs.lstatSync(outDir).isSymbolicLink()) reject('inventory_output_path');
  const code = await capturePackageCodeW68(appOutDir, { sourceSha, version, exeName });
  const outputPath = path.join(outDir, PACKAGE_CODE_FILE_W68);
  // Existing artifacts are immutable, never silently replaced.
  fs.writeFileSync(outputPath, code.bytes, { flag: 'wx', mode: 0o600 });
  await code.fence();
  if (!checkedFile(outputPath, outDir).equals(code.bytes)) reject('inventory_write_readback');
  return Object.freeze({ path: outputPath, package_code_sha256: code.sha256,
    file_count: code.fileCount, size_bytes: code.totalBytes,
    installed_authority: false, release_authorized: false, authority_effect: false });
}

// Independently verified SLSA evidence is produced by the EXISTING trusted
// browser-windows-package-smoke verifier. This is ONLY a semantic/digest gate.
// Calling this function on user JSON never confers GH cryptographic trust.
export function validateSlsaEvidenceBytesW77({ evidenceBytes, bundleBytes, installerBytes,
  sourceSha, version, installerName }) {
  if (!valid(sourceSha, sha40) || !valid(version, versionPattern) ||
      RESERVED_PACKAGE_IDENTITIES_W68.includes(version)) reject('source_or_version');
  if (installerName !== 'METAENGINE-Browser-Test-Setup-' + version + '-x64.exe') reject('installer_name');
  let e, b;
  try { e = JSON.parse(evidenceBytes.toString('utf8')); b = JSON.parse(bundleBytes.toString('utf8')); }
  catch { reject('slsa_json'); }
  if (e.schema !== 'metaengine.browser-fabric.provenance-evidence.v1' ||
      e.verified !== true || e.builder_trusted !== true || e.authority_effect !== false ||
      e.predicate_type !== 'https://slsa.dev/provenance/v1' ||
      e.source_sha !== sourceSha || e.subject_name !== installerName ||
      e.subject_sha256 !== digest(installerBytes) ||
      !object(b) || !Array.isArray(b.dsseEnvelope?.signatures) ||
      b.dsseEnvelope.signatures.length < 1) reject('slsa_semantics');
  return Object.freeze({ installer_sha256: digest(installerBytes),
    bundle_sha256: digest(bundleBytes), evidence_sha256: digest(evidenceBytes),
    semantic_shape_checked_only: true, cryptographic_verification_claimed: false });
}

// The existing GitHub-hosted packaging workflow pins its own signer workflow,
// source digest/ref and rejects self-hosted runners before producing evidence.
// This exact immutable evidence linkage is required at the handoff boundary.
export function validateExistingProducerReceiptW77({ receipt, sourceSha, version,
  installerName, installerSha, expectedRunId, expectedAttempt }) {
  if (!exact(receipt, [
    'schema','source_head','source_ref','event','workflow','run_id','run_number',
    'run_attempt','package_version','installer_name','installer_sha256',
    'attestation_id','attestation_url','bundle_name','promotion_authorized',
    'release_published','authority_effect',
  ]) || receipt.schema !== 'metaengine.browser.package-slsa-provenance-receipt.v1' ||
      receipt.source_head !== sourceSha ||
      receipt.source_ref !== 'refs/heads/physical/build-slsa-provenance-v1' ||
      receipt.event !== 'push' ||
      receipt.workflow !== '.github/workflows/browser-windows-package-smoke.yml' ||
      String(receipt.run_id) !== String(expectedRunId) ||
      String(receipt.run_attempt) !== String(expectedAttempt) ||
      receipt.package_version !== version || receipt.installer_name !== installerName ||
      receipt.installer_sha256 !== installerSha ||
      receipt.bundle_name !== RELEASE_PROOF_FILES_W77.bundle ||
      receipt.promotion_authorized !== false || receipt.release_published !== false ||
      receipt.authority_effect !== false) reject('producer_receipt');
  return true;
}

export function createExternalReleaseProofHandoffW77(manifest) {
  const stable = validatedReleaseManifestW77(manifest);
  return Object.freeze({
    schema: RELEASE_PROOF_HANDOFF_SCHEMA_W77,
    source_sha: stable.source_sha,
    package_version: stable.package_version,
    prepackage_exe_sha256: stable.exe_sha256,
    final_installer_sha256: stable.installer_sha256,
    package_code_sha256: stable.package_code_sha256,
    detached_sidecar_files: Object.freeze(Object.values(RELEASE_PROOF_FILES_W77)),
    installer_bytes_are_immutable: true,
    never_embed_installer_self_digest: true,
    sidecars_must_be_delivered_external_to_final_installer: true,
    // W78 package owner must bind a trusted *existing* installer placement
    // mechanism. Copying unsigned JSON next to the installed EXE is NOT enough.
    installed_placement_verified: false,
    existing_installer_placement_capability: 'UNKNOWN',
    installed_authority: false,
    release_authorized: false,
    authority_effect: false,
  });
}

// Production is fail closed: the packaged emergency root contains PUBLIC key
// only. Neither the real release-root signing interface nor authenticated NSIS
// sidecar placement is present in the inspected existing release pipeline.
// No signing secret, env flag, injectable signer, new key or private path here.
export function probeProductionReleaseProofW77() {
  return Object.freeze({
    schema: 'metaengine.browser.release-proof-producer-capability-w77.v1',
    disposition: 'BLOCKED',
    missing_capabilities: Object.freeze([
      RELEASE_PROOF_SIGNER_BLOCK_W77,
      'EXTERNAL_SIDECAR_INSTALLED_PLACEMENT_UNPROVEN',
      'IMMUTABLE_VERIFIED_GH_ARTIFACT_HANDOFF_RUNTIME_NOT_QUALIFIED',
      'PACKAGED_CODEX_CLI_AND_GIT_ROLE_BINDINGS_NOT_DECLARED',
    ]),
    requires: Object.freeze([
      'existing protected Ed25519 signing capability matching packaged root',
      'independent gh attestation verify and exact source/run/artifact binding',
      'double signed EXE Authenticode/bytes/path observation',
      'exact final packaged-code inventory and full installed-tree readback',
      'external sidecar receipt installed by reviewed W78 package handoff',
    ]),
    immutable_artifact_handoff_wired: true,
    immutable_artifact_handoff_runtime_qualified: false,
    signing_request_transport_wired: true,
    self_contained_payload_presence_guard_wired: true,
    clean_machine_installation_qualified: false,
    production_sidecars_emitted: false,
    installed_authority: false,
    release_authorized: false,
    authority_effect: false,
  });
}

// This test emitter accepts a disposable TEST key and never claims it came
// from the release root. It cannot be used as a production signer. Its output
// is a cryptographically real Ed25519 fixture for the real W68 reader.
export async function emitStagingReleaseProofW77({ outputDir, exePath, installerPath, bundlePath,
  evidencePath, sourceSha, version, signerThumbprint, testPrivateKey }) {
  if (!testPrivateKey || testPrivateKey.type !== 'private' ||
      testPrivateKey.asymmetricKeyType !== 'ed25519') reject('staging_key');
  if (!path.isAbsolute(outputDir) || path.resolve(outputDir) !== outputDir ||
      !fs.lstatSync(outputDir).isDirectory()) reject('staging_directory');
  const exeBytes = checkedFile(exePath, outputDir);
  const installerBytes = checkedFile(installerPath, outputDir);
  const bundleBytes = checkedFile(bundlePath, outputDir);
  const evidenceBytes = checkedFile(evidencePath, outputDir);
  const packageCodePath = path.join(outputDir, PACKAGE_CODE_FILE_W68);
  const packageCodeBytes = checkedFile(packageCodePath, outputDir);
  const slsa = validateSlsaEvidenceBytesW77({ evidenceBytes, bundleBytes, installerBytes,
    sourceSha, version, installerName: path.basename(installerPath) });
  const packageCode = await verifyPackageCodeW68(outputDir, packageCodeBytes, {
    sourceSha, version, exeName: path.basename(exePath),
  });
  const manifest = Object.fromEntries(fields.map(key => [key, {
    schema: INSTALLED_RELEASE_MANIFEST_W68, source_sha: sourceSha, package_version: version,
    exe_name: path.basename(exePath), exe_sha256: digest(exeBytes),
    signer_thumbprint: signerThumbprint, installer_sha256: slsa.installer_sha256,
    slsa_bundle_sha256: slsa.bundle_sha256, slsa_evidence_sha256: slsa.evidence_sha256,
    package_code_sha256: digest(packageCodeBytes),
  }[key]]));
  const signedBytes = serializeReleaseManifestW77(manifest);
  const signature = crypto.sign(null, signedBytes, testPrivateKey).toString('base64');
  const envelope = { schema: INSTALLED_RELEASE_ENVELOPE_W68,
    manifest, signature_base64: signature };
  const envelopePath = path.join(outputDir, RELEASE_PROOF_FILES_W77.envelope);
  if (fs.existsSync(envelopePath)) reject('staging_output_already_exists');
  await packageCode.fence();
  fs.writeFileSync(envelopePath, JSON.stringify(envelope), { flag: 'wx', mode: 0o600 });
  return Object.freeze({ fixture_classification: 'STAGING',
    envelope_path: envelopePath,
    envelope_sha256: digest(fs.readFileSync(envelopePath)),
    handoff: createExternalReleaseProofHandoffW77(manifest),
    release_authorized: false, installed_authority: false, authority_effect: false });
}


// Production input preflight is callable ONLY in a Windows packaging sandbox.
// It executes the pre-existing GitHub/Sigstore CLI verifier AND the existing
// browser SLSA semantic validator over its freshly captured stdout, never over
// an independently supplied JSON "verified" flag. It DOES NOT sign or install.
export function buildPinnedGhVerifyArgsW77({ installer, bundle, sourceSha }) {
  if (!valid(sourceSha, sha40) || typeof installer !== 'string' ||
      typeof bundle !== 'string' || !path.isAbsolute(installer) ||
      !path.isAbsolute(bundle)) reject('gh_cli_arguments');
  return Object.freeze([
    'attestation','verify',installer,
    '--repo','PatrickFrome/Compute',
    '--bundle',bundle,
    '--signer-workflow','PatrickFrome/Compute/.github/workflows/browser-windows-package-smoke.yml',
    '--signer-digest',sourceSha,
    '--source-digest',sourceSha,
    '--source-ref','refs/heads/physical/build-slsa-provenance-v1',
    '--cert-oidc-issuer','https://token.actions.githubusercontent.com',
    '--deny-self-hosted-runners',
    '--predicate-type','https://slsa.dev/provenance/v1',
    '--format','json',
  ]);
}

export async function prepareIndependentlyVerifiedReleaseInputsW77({
  candidateRoot, exePath, sourceSha, version, runId, attempt, packagedTrustRoot,
  artifactId, archivePath, archiveSha256,
} = {}) {
  if (process.platform !== 'win32') reject('windows_only');
  if (!valid(sourceSha, sha40) || !valid(version, versionPattern) ||
      RESERVED_PACKAGE_IDENTITIES_W68.includes(version) ||
      packagedTrustRoot?.build_sha !== sourceSha) reject('trusted_source_binding');
  const trustRoot = validateEmergencyMaintenanceTrustRoot(packagedTrustRoot);
  await requireIndependentGhCli();
  if (!path.isAbsolute(candidateRoot) || path.resolve(candidateRoot) !== candidateRoot ||
      !fs.lstatSync(candidateRoot).isDirectory() ||
      fs.lstatSync(candidateRoot).isSymbolicLink()) reject('candidate_directory');
  const artifactArguments = { sourceSha, version, runId, attempt, artifactId, archiveSha256 };
  const liveBefore = await readLiveArtifactBinding(artifactArguments);
  const archiveBytes = await verifyImmutableArtifactBytesW77({ archivePath, archiveSha256,
    candidateRoot, sourceSha, version, runId, attempt });
  if (fs.lstatSync(archivePath).size !== liveBefore.size) reject('artifact_archive_size');
  const installerName = 'METAENGINE-Browser-Test-Setup-' + version + '-x64.exe';
  const installerPath = path.join(candidateRoot,installerName);
  const slsaDir = path.join(candidateRoot,'browser-slsa-provenance');
  const bundlePath = path.join(slsaDir,RELEASE_PROOF_FILES_W77.bundle);
  const receiptPath = path.join(slsaDir,'installer-slsa-provenance-receipt.json');
  const packageCodePath = path.join(candidateRoot,PACKAGE_CODE_FILE_W68);
  const exeParent = path.dirname(exePath || '');
  if (!path.isAbsolute(exePath || '') || path.resolve(exePath) !== exePath ||
      path.basename(exePath) !== 'METAENGINE Browser Test.exe' ||
      fs.lstatSync(exeParent).isSymbolicLink() || fs.lstatSync(slsaDir).isSymbolicLink()) {
    reject('prepackage_exe_path');
  }
  const stablePaths = [candidateRoot,slsaDir,exeParent,exePath,installerPath,bundlePath,receiptPath,packageCodePath];
  const stableBefore = stablePaths.map(file => fs.lstatSync(file));
  const installerBytes = checkedFile(installerPath,candidateRoot);
  const bundleBytes = checkedFile(bundlePath,slsaDir);
  const receiptBytes = checkedFile(receiptPath,slsaDir);
  const exeBytes = checkedFile(exePath,exeParent);
  const packageCodeBytes = checkedFile(packageCodePath,candidateRoot);
  const packageCode = await verifyPackageCodeW68(exeParent, packageCodeBytes, {
    sourceSha, version, exeName: path.basename(exePath),
  });
  const payloadPresence = validateRequiredSelfContainedPayloadsW77(packageCode.manifest, {
    sourceSha, version, exeName: path.basename(exePath) });
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString('utf8').replace(/^\uFEFF/,'')); }
  catch { reject('receipt_json'); }
  validateExistingProducerReceiptW77({
    receipt,sourceSha,version,installerName,installerSha:digest(installerBytes),
    expectedRunId:runId,expectedAttempt:attempt,
  });
  if (receipt.run_number !== liveBefore.runNumber) reject('producer_run_number');
  const {spawnSync} = await import('node:child_process');
  const os = await import('node:os');
  const {readWindowsSignedExecutableW60} =
    await import('../src/host-native-owner-producers-w60.mjs');
  const first = await readWindowsSignedExecutableW60(exePath);
  if (first?.native_signature_verified !== true || first?.exact_bytes_verified !== true ||
      first.installed_exe_sha256 !== digest(exeBytes) ||
      !valid(first.signer_thumbprint, thumb)) reject('os_authenticode_before');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(),'metaengine-w77-slsa-verify-'));
  try {
    const verification = path.join(temporary,'verification.json');
    const evidence = path.join(temporary,'evidence.json');
    const gh = spawnSync('gh',buildPinnedGhVerifyArgsW77({
      installer:installerPath,bundle:bundlePath,sourceSha,
    }),{encoding:'utf8',shell:false,windowsHide:true,timeout:120000,maxBuffer:2_000_000,
      stdio:['ignore','pipe','pipe']});
    if (gh.error || gh.status !== 0 || typeof gh.stdout !== 'string' ||
        gh.stdout.length < 8 || gh.stdout.length > 2_000_000) reject('independent_gh_slsa_verify');
    fs.writeFileSync(verification,gh.stdout,{flag:'wx',mode:0o600});
    // On Windows file:///C:/... URL pathname has a leading slash; use fileURLToPath.
    const verifierPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)),
      '../../../scripts/browser-slsa-provenance-verification.mjs');
    const verifierStat = fs.lstatSync(verifierPath);
    if (!verifierStat.isFile() || verifierStat.isSymbolicLink()) reject('existing_slsa_verifier_missing_or_reparse');
    const args = [verifierPath,
      '--verification',verification,
      '--expected-source-sha',sourceSha,
      '--expected-source-ref','refs/heads/physical/build-slsa-provenance-v1',
      '--expected-installer-name',installerName,
      '--expected-installer-sha256',digest(installerBytes),
      '--expected-run-id',String(runId),
      '--expected-run-attempt',String(attempt),
      '--expected-repository','PatrickFrome/Compute',
      '--expected-workflow-path','.github/workflows/browser-windows-package-smoke.yml',
      '--verifier-id','metaengine-w77-independent-package-slsa:' + String(runId) + ':' + String(attempt),
      '--out',evidence];
    const verificationResult=spawnSync(process.execPath,args,{
      encoding:'utf8',shell:false,windowsHide:true,timeout:30000,maxBuffer:100000,
      stdio:['ignore','pipe','pipe']});
    if (verificationResult.error || verificationResult.status !== 0) reject('semantic_slsa_verifier');
    const evidenceBytes = checkedFile(evidence,temporary);
    const slsa = validateSlsaEvidenceBytesW77({
      evidenceBytes,bundleBytes,installerBytes,sourceSha,version,installerName,
    });
    const second = await readWindowsSignedExecutableW60(exePath);
    if (second?.native_signature_verified !== true || second?.exact_bytes_verified !== true ||
        second.installed_exe_sha256 !== first.installed_exe_sha256 ||
        second.signer_thumbprint !== first.signer_thumbprint ||
        digest(checkedFile(exePath,exeParent)) !== first.installed_exe_sha256 ||
        digest(checkedFile(installerPath,candidateRoot)) !== slsa.installer_sha256 ||
        digest(checkedFile(bundlePath,slsaDir)) !== slsa.bundle_sha256 ||
        digest(checkedFile(receiptPath,slsaDir)) !== digest(receiptBytes) ||
        digest(checkedFile(packageCodePath,candidateRoot)) !== packageCode.sha256) reject('postverification_toctou');
    const stableAfter = stablePaths.map(file => fs.lstatSync(file));
    if (!stableBefore.every((before,index) => {
      const after = stableAfter[index];
      return before.dev === after.dev && before.ino === after.ino &&
        before.size === after.size && before.nlink === after.nlink &&
        before.mtimeMs === after.mtimeMs && before.ctimeMs === after.ctimeMs &&
        before.isSymbolicLink() === false && after.isSymbolicLink() === false;
    })) reject('physical_file_or_directory_toctou');
    await packageCode.fence();
    await archiveBytes.fence();
    const liveAfter = await readLiveArtifactBinding(artifactArguments);
    if (JSON.stringify(liveBefore) !== JSON.stringify(liveAfter)) reject('live_github_binding_changed');
    // Metadata reads are asynchronous too; retain the file and tree bindings
    // through those reads before returning inputs or branding a request.
    await archiveBytes.fence();
    await packageCode.fence();
    const prepared = Object.freeze({
      classification:'VERIFIED_INPUTS_ONLY',
      source_sha:sourceSha, package_version:version,
      exe_sha256:first.installed_exe_sha256,signer_thumbprint:first.signer_thumbprint,
      installer_sha256:slsa.installer_sha256,
      slsa_bundle_sha256:slsa.bundle_sha256,
      slsa_evidence_sha256:slsa.evidence_sha256,
      package_code_sha256:packageCode.sha256,
      package_code_bytes:Buffer.from(packageCodeBytes),
      // Only this function executes the actual independent verifier.
      gh_cryptographic_verification_executed:true,
      evidence_bytes:Buffer.from(evidenceBytes),
      bundle_bytes:Buffer.from(bundleBytes),
      receipt_sha256:digest(receiptBytes),
      immutable_artifact: liveAfter.binding,
      full_archive_file_membership_verified:true,
      public_key_spki_sha256:trustRoot.public_key_spki_sha256,
      payload_presence:payloadPresence,
      release_root_signing_available:false,
      production_sidecars_emitted:false,
      installed_placement_verified:false,
      release_authorized:false,authority_effect:false,
    });
    // Only an actual successful preflight can create a signing request in this
    // process. A JSON object bearing verified:true cannot enter that boundary.
    const manifest = { schema: INSTALLED_RELEASE_MANIFEST_W68, source_sha: sourceSha,
      package_version: version, exe_name: path.basename(exePath),
      exe_sha256: prepared.exe_sha256, signer_thumbprint: prepared.signer_thumbprint,
      installer_sha256: prepared.installer_sha256, slsa_bundle_sha256: prepared.slsa_bundle_sha256,
      slsa_evidence_sha256: prepared.slsa_evidence_sha256, package_code_sha256: prepared.package_code_sha256 };
    preparedInputs.set(prepared, { manifest: Object.freeze(manifest), root: trustRoot,
      binding: liveAfter.binding, payloadPresence,
      fence: async () => { await archiveBytes.fence(); await packageCode.fence(); } });
    return prepared;
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}

// A transport contract for the existing protected signer, NOT a signer or a
// new trusted key. The signer must compare this fingerprint with its existing
// configured key, sign these exact bytes, and return a detached signature.
export async function createReleaseRootSigningRequestW77(prepared) {
  const state = preparedInputs.get(prepared);
  if (!state) reject('independently_prepared_inputs_required');
  await state.fence();
  const payload = serializeReleaseManifestW77(state.manifest);
  return Object.freeze({ schema: 'metaengine.browser.release-root-signing-request-w77.v1',
    execution_scope: 'RELEASE_CUSTODY_ONLY',
    algorithm: 'Ed25519', public_key_spki_sha256: state.root.public_key_spki_sha256,
    manifest: state.manifest, payload_base64: payload.toString('base64'), payload_sha256: digest(payload),
    immutable_artifact: state.binding,
    payload_presence: state.payloadPresence,
    release_root_signing_available: false, production_sidecars_emitted: false,
    installed_placement_verified: false, release_authorized: false, authority_effect: false });
}

// Source-only parser for a possible external protected-signing result.
// This does NOT authenticate the caller, custody, invocation, replay, or the
// Ed25519 signature. A separate approved signer interface and retained
// execution evidence must precede ANY production envelope or installation.
const releaseSignResultFieldsW77 = Object.freeze([
  'schema','operation','request_sha256','signing_input_sha256',
  'public_key_spki_sha256','signature_algorithm','signature_base64',
  'invocation_id','implementation_revision','release_authorized','authority_effect',
]);
export function parseUntrustedReleaseSignerResultW77(rawBytes) {
  if (!Buffer.isBuffer(rawBytes) || rawBytes.length < 1 || rawBytes.length > 4096) {
    reject('sign_result_wire');
  }
  const wire = rawBytes.toString('utf8');
  if (!Buffer.from(wire,'utf8').equals(rawBytes)) reject('sign_result_wire');
  let result;
  try { result = JSON.parse(wire); } catch { reject('sign_result_json'); }
  // JSON.parse alone accepts duplicate keys. Exact byte canonicalization and
  // key order reject duplicates, hidden extra fields, BOM and added whitespace.
  if (!object(result) || Object.keys(result).join('\0') !== releaseSignResultFieldsW77.join('\0') ||
      JSON.stringify(result) !== wire) reject('sign_result_wire');
  if (result.schema !== 'metaengine.browser.release-proof-sign-result-w77.v1' ||
      result.operation !== 'sign_installed_release_manifest_v2' ||
      !valid(result.request_sha256, sha256) ||
      !valid(result.signing_input_sha256, sha256) ||
      !valid(result.public_key_spki_sha256, sha256) ||
      result.signature_algorithm !== 'Ed25519' ||
      result.release_authorized !== false || result.authority_effect !== false) {
    reject('sign_result_fields');
  }
  if (typeof result.invocation_id !== 'string' ||
      result.invocation_id.length < 1 || result.invocation_id.length > 256 ||
      !result.invocation_id.trim() || /[\u0000-\u001f\u007f]/.test(result.invocation_id) ||
      !valid(result.implementation_revision, /^(?:[a-f0-9]{40}|sha256:[a-f0-9]{64})$/) ||
      !valid(result.signature_base64, /^[A-Za-z0-9+/]{86}==$/)) {
    reject('sign_result_identity_or_signature');
  }
  const signature = Buffer.from(result.signature_base64, 'base64');
  if (signature.length !== 64 || signature.toString('base64') !== result.signature_base64) {
    reject('sign_result_signature_encoding');
  }
  return Object.freeze({
    classification: 'SOURCE_PARSE_ONLY',
    request_sha256: result.request_sha256,
    signing_input_sha256: result.signing_input_sha256,
    public_key_spki_sha256: result.public_key_spki_sha256,
    signature_base64: result.signature_base64,
    signature_bytes_sha256: digest(signature),
    invocation_id: result.invocation_id,
    implementation_revision: result.implementation_revision,
    cryptographic_signature_verified: false,
    signer_invocation_authenticated: false,
    installed_placement_verified: false,
    release_authorized: false,
    authority_effect: false,
  });
}

// Read-only operator entrypoint. Uses the SAME public key file packaged by the
// ordinary beforePack hook. No private-key argument, injected signer, API base,
// fixture switch, artifact resolution by latest, installation or publication.
export async function runReleaseProofPreflightCliW77(argv) {
  const names = ['candidate-root', 'exe', 'source-sha', 'version', 'run-id', 'attempt',
    'artifact-id', 'archive', 'archive-sha256'];
  const options = {};
  if (argv.length !== names.length * 2) reject('cli_arguments');
  for (let i = 0; i < argv.length; i += 2) {
    const name = argv[i]?.slice(2);
    if (argv[i] !== '--' + name || !names.includes(name) || Object.hasOwn(options, name) ||
        typeof argv[i + 1] !== 'string' || !argv[i + 1] || argv[i + 1].startsWith('--')) reject('cli_arguments');
    options[name] = argv[i + 1];
  }
  if (process.platform !== 'win32') reject('windows_only');
  const publicPath = fileURLToPath(new URL('../build/emergency-maintenance-public-key.pem', import.meta.url));
  const publicBytes = checkedFile(publicPath, path.dirname(publicPath));
  if (publicBytes.includes(Buffer.from('PRIVATE KEY'))) reject('public_key_only');
  const key = crypto.createPublicKey(publicBytes);
  const root = { schema: 'metaengine.emergency-maintenance-trust-root.v1',
    build_sha: options['source-sha'], ed25519_public_key_pem: publicBytes.toString('utf8'),
    public_key_spki_sha256: digest(key.export({ type: 'spki', format: 'der' })) };
  const prepared = await prepareIndependentlyVerifiedReleaseInputsW77({
    candidateRoot: options['candidate-root'], exePath: options.exe, sourceSha: options['source-sha'],
    version: options.version, runId: options['run-id'], attempt: options.attempt,
    artifactId: options['artifact-id'], archivePath: options.archive,
    archiveSha256: options['archive-sha256'], packagedTrustRoot: root });
  return createReleaseRootSigningRequestW77(prepared);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runReleaseProofPreflightCliW77(process.argv.slice(2)).then(result => {
    process.stdout.write(JSON.stringify(result) + '\n');
  }).catch(error => {
    // Child process output may contain provider diagnostics or credentials.
    // Keep it private and return one stable failure code to the operator.
    const reason = /^w77_release_proof_[a-z0-9_]+$/.test(error?.message || '')
      ? error.message : 'w77_release_proof_preflight_failed';
    process.stderr.write(reason + '\n');
    process.exitCode = 1;
  });
}
