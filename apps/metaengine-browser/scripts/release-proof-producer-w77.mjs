// W77 release-proof producer. SOURCE/STAGING is never installed release proof.
// This module is a sidecar handoff, not a second trust root, secret store or installer.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import {
  INSTALLED_RELEASE_ENVELOPE_W68,
  INSTALLED_RELEASE_MANIFEST_W68,
  INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68,
} from '../src/installed-executable-provenance-w68.mjs';
import { RESERVED_PACKAGE_IDENTITIES_W68 } from '../src/client-package-identity-w68.mjs';
import { RELEASE_FILES_W68, PACKAGE_CODE_FILE_W68, capturePackageCodeW68,
  verifyPackageCodeW68 } from '../src/installed-package-code-w68.mjs';

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

// The W68 consumer signs/verifies domain || JSON.stringify(manifest), in this
// exact property order. NO key-sorted or user-provided JSON serializer.
export function serializeReleaseManifestW77(manifest) {
  if (!exact(manifest, fields) || manifest.schema !== INSTALLED_RELEASE_MANIFEST_W68) reject('manifest_schema');
  if (!valid(manifest.source_sha, sha40)) reject('source_sha');
  if (!valid(manifest.package_version, versionPattern) ||
      RESERVED_PACKAGE_IDENTITIES_W68.includes(manifest.package_version)) reject('reserved_or_invalid_version');
  if (manifest.exe_name !== 'METAENGINE Browser Test.exe' &&
      manifest.exe_name !== 'METAENGINE-Browser.exe') reject('exe_name');
  for (const field of ['exe_sha256','installer_sha256','slsa_bundle_sha256','slsa_evidence_sha256','package_code_sha256']) {
    if (!valid(manifest[field], sha256)) reject(field);
  }
  if (!valid(manifest.signer_thumbprint, thumb)) reject('signer_thumbprint');
  const ordered = Object.fromEntries(fields.map(key => [key, manifest[key]]));
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
  serializeReleaseManifestW77(manifest);
  return Object.freeze({
    schema: RELEASE_PROOF_HANDOFF_SCHEMA_W77,
    source_sha: manifest.source_sha,
    package_version: manifest.package_version,
    prepackage_exe_sha256: manifest.exe_sha256,
    final_installer_sha256: manifest.installer_sha256,
    package_code_sha256: manifest.package_code_sha256,
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
      'IMMUTABLE_VERIFIED_GH_ARTIFACT_BYTES_HANDOFF_NOT_WIRED',
    ]),
    requires: Object.freeze([
      'existing protected Ed25519 signing capability matching packaged root',
      'independent gh attestation verify and exact source/run/artifact binding',
      'double signed EXE Authenticode/bytes/path observation',
      'exact final packaged-code inventory and full installed-tree readback',
      'external sidecar receipt installed by reviewed W78 package handoff',
    ]),
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
} = {}) {
  if (process.platform !== 'win32') reject('windows_only');
  if (!valid(sourceSha, sha40) || !valid(version, versionPattern) ||
      RESERVED_PACKAGE_IDENTITIES_W68.includes(version) ||
      packagedTrustRoot?.build_sha !== sourceSha) reject('trusted_source_binding');
  if (!path.isAbsolute(candidateRoot) || path.resolve(candidateRoot) !== candidateRoot ||
      !fs.lstatSync(candidateRoot).isDirectory() ||
      fs.lstatSync(candidateRoot).isSymbolicLink()) reject('candidate_directory');
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
  let receipt;
  try { receipt = JSON.parse(receiptBytes.toString('utf8').replace(/^\uFEFF/,'')); }
  catch { reject('receipt_json'); }
  validateExistingProducerReceiptW77({
    receipt,sourceSha,version,installerName,installerSha:digest(installerBytes),
    expectedRunId:runId,expectedAttempt:attempt,
  });
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
    const {fileURLToPath} = await import('node:url');
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
    return Object.freeze({
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
      release_root_signing_available:false,
      production_sidecars_emitted:false,
      installed_placement_verified:false,
      release_authorized:false,authority_effect:false,
    });
  } finally {
    fs.rmSync(temporary,{recursive:true,force:true});
  }
}
