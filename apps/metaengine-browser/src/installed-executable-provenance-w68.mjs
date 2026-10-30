// W68 v2: release-root-authenticated installed EXE AND package-code provenance.
// Never infer installed/release authority from a JSON "verified" bit,
// Authenticode Valid alone, an unsigned SLSA receipt, or source build SHA.
// A signed sidecar lives OUTSIDE the executable to avoid a self-hash cycle.
// All input files are fixed siblings of the OS executable, never page paths.
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { loadPackagedEmergencyMaintenanceTrustRoot, validateEmergencyMaintenanceTrustRoot } from './emergency-maintenance-trust-root.mjs';
import { readWindowsSignedExecutableW60 } from './host-native-owner-producers-w60.mjs';
import { RELEASE_FILES_W68, PACKAGE_CODE_MAX_MANIFEST_BYTES_W68,
  verifyPackageCodeW68 } from './installed-package-code-w68.mjs';

// v1 authenticated only the EXE, not executable JS/native resources. No v1
// fallback is permitted: it cannot gain package-code authority by upgrading.
export const INSTALLED_RELEASE_ENVELOPE_W68 = 'metaengine.browser.installed-release-envelope.v2';
export const INSTALLED_RELEASE_MANIFEST_W68 = 'metaengine.browser.installed-release-manifest.v2';
// Purpose separation prevents reuse of an emergency command signature as a
// release authorization under the same pre-existing Ed25519 trust root.
export const INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68 = 'METAENGINE_INSTALLED_RELEASE_MANIFEST_V2\u0000';
const SHA40 = /^[a-f0-9]{40}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const THUMBPRINT = /^[a-f0-9]{40}$/;
const VERSION = /^0\.7\.0-dev\.[0-9]+\.1$/;
const NAMES = RELEASE_FILES_W68;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const exact = (obj, fields) => isObject(obj) &&
  Object.keys(obj).sort().join('\0') === [...fields].sort().join('\0');
const clean = (value, re) => typeof value === 'string' && re.test(value);
const canon = data => Buffer.concat([
  Buffer.from(INSTALLED_RELEASE_SIGNATURE_DOMAIN_W68, 'utf8'),
  Buffer.from(JSON.stringify(data), 'utf8'),
]);

function sameStat(a, b) {
  return a.isFile() && b.isFile() && !a.isSymbolicLink() && !b.isSymbolicLink() &&
    a.nlink === 1 && b.nlink === 1 &&
    a.dev === b.dev && a.ino === b.ino && a.size === b.size &&
    a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}

async function readFixedRegularFile(file, base, io, maxBytes = 2_000_000) {
  if (path.dirname(file) !== base) return null;
  const before = await io.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > maxBytes || before.size < 1) return null;
  const resolved = await io.realpath(file);
  if (resolved.toLowerCase() !== file.toLowerCase()) return null;
  const bytes = await io.readFile(file);
  const after = await io.lstat(file);
  if (!sameStat(before, after) || bytes.length !== after.size ||
      (await io.realpath(file)).toLowerCase() !== file.toLowerCase()) return null;
  return { bytes, stat: after };
}

async function verifyCore({ executable, version, trustRoot, nativeRead, io, staging }) {
  try {
    if (!clean(version, VERSION) || !trustRoot || !clean(trustRoot.build_sha, SHA40)) return null;
    if (typeof executable !== 'string' || !path.isAbsolute(executable) ||
        executable.includes('\0') || !/\.exe$/i.test(executable)) return null;
    // Production accepts only a canonical local Windows drive executable.
    if (!staging && (!/^[A-Za-z]:\\/.test(executable) || executable.startsWith('\\\\'))) return null;
    const exe = path.resolve(executable);
    if (exe !== executable) return null;
    const base = path.dirname(exe);
    const beforeDir = await io.lstat(base);
    if (!beforeDir.isDirectory() || beforeDir.isSymbolicLink()) return null;
    const exeBefore = await io.lstat(exe);
    if (!exeBefore.isFile() || exeBefore.isSymbolicLink() || exeBefore.nlink !== 1) return null;
    if ((await io.realpath(exe)).toLowerCase() !== exe.toLowerCase()) return null;
    // OS signature + full-byte readback both BEFORE and AFTER inspecting signed sidecars.
    const first = await nativeRead(exe);
    if (!first || first.native_signature_verified !== true || first.exact_bytes_verified !== true ||
        !clean(first.installed_exe_sha256, SHA256) ||
        !clean(first.signer_thumbprint, THUMBPRINT)) return null;
    const [envelopeFile, bundleFile, evidenceFile, packageCodeFile] = await Promise.all(
      Object.values(NAMES).map(name => readFixedRegularFile(path.join(base, name), base, io,
        name === NAMES.packageCode ? PACKAGE_CODE_MAX_MANIFEST_BYTES_W68 : 2_000_000))
    );
    if (!envelopeFile || !bundleFile || !evidenceFile || !packageCodeFile) return null;
    const doc = JSON.parse(envelopeFile.bytes.toString('utf8'));
    if (!exact(doc, ['schema', 'manifest', 'signature_base64']) ||
        doc.schema !== INSTALLED_RELEASE_ENVELOPE_W68 ||
        typeof doc.signature_base64 !== 'string' ||
        !/^[A-Za-z0-9+/]{86}==$/.test(doc.signature_base64)) return null;
    const m = doc.manifest;
    const fields = ['schema','source_sha','package_version','exe_name','exe_sha256',
      'signer_thumbprint','installer_sha256','slsa_bundle_sha256','slsa_evidence_sha256','package_code_sha256'];
    if (!exact(m, fields) || m.schema !== INSTALLED_RELEASE_MANIFEST_W68 ||
        m.source_sha !== trustRoot.build_sha || m.package_version !== version ||
        m.exe_name !== path.basename(exe) ||
        !clean(m.exe_sha256, SHA256) || !clean(m.signer_thumbprint, THUMBPRINT) ||
        !clean(m.installer_sha256, SHA256) ||
        !clean(m.slsa_bundle_sha256, SHA256) || !clean(m.slsa_evidence_sha256, SHA256) ||
        !clean(m.package_code_sha256, SHA256) || m.package_code_sha256 !== hash(packageCodeFile.bytes) ||
        m.exe_sha256 !== first.installed_exe_sha256 ||
        m.signer_thumbprint !== first.signer_thumbprint ||
        m.slsa_bundle_sha256 !== hash(bundleFile.bytes) ||
        m.slsa_evidence_sha256 !== hash(evidenceFile.bytes)) return null;
    const signature = Buffer.from(doc.signature_base64, 'base64');
    if (signature.length !== 64 || signature.toString('base64') !== doc.signature_base64 ||
        !crypto.verify(null, canon(m), trustRoot.public_key, signature)) return null;
    const packageCode = await verifyPackageCodeW68(base, packageCodeFile.bytes, {
      sourceSha: m.source_sha, version, exeName: path.basename(exe),
    });

    // Independently check structure and all release bindings. These two files
    // are ROOT-SIGNED BY DIGEST, not a local "verified:true" trust root.
    const evidence = JSON.parse(evidenceFile.bytes.toString('utf8'));
    if (evidence.schema !== 'metaengine.browser-fabric.provenance-evidence.v1' ||
        evidence.verified !== true || evidence.builder_trusted !== true ||
        evidence.authority_effect !== false || evidence.source_sha !== m.source_sha ||
        evidence.subject_sha256 !== m.installer_sha256 ||
        evidence.predicate_type !== 'https://slsa.dev/provenance/v1' ||
        evidence.subject_name !== 'METAENGINE-Browser-Test-Setup-' + version + '-x64.exe') return null;
    const bundle = JSON.parse(bundleFile.bytes.toString('utf8'));
    if (!isObject(bundle) || !Array.isArray(bundle.dsseEnvelope?.signatures) ||
        bundle.dsseEnvelope.signatures.length < 1) return null;
    // No claim that JSON alone independently verifies Fulcio/Rekor/SLSA.
    // Release custody MUST sign the exact independently verified evidence
    // plus the bundle under the already-packaged Ed25519 root.
    const second = await nativeRead(exe);
    const exeAfter = await io.lstat(exe);
    const afterDir = await io.lstat(base);
    const sidecarsAfter = await Promise.all(Object.values(NAMES).map(name => io.lstat(path.join(base, name))));
    if (!sidecarsAfter.every((stat, index) => sameStat([envelopeFile, bundleFile, evidenceFile, packageCodeFile][index].stat, stat))) return null;
    if (!second || second.native_signature_verified !== true || second.exact_bytes_verified !== true ||
        second.installed_exe_sha256 !== first.installed_exe_sha256 ||
        second.signer_thumbprint !== first.signer_thumbprint ||
        !sameStat(exeBefore, exeAfter) ||
        beforeDir.dev !== afterDir.dev || beforeDir.ino !== afterDir.ino ||
        beforeDir.mtimeMs !== afterDir.mtimeMs || beforeDir.ctimeMs !== afterDir.ctimeMs ||
        !afterDir.isDirectory() || afterDir.isSymbolicLink() ||
        (await io.realpath(base)).toLowerCase() !== base.toLowerCase()) return null;
    // Last asynchronous fence includes every directory/file identity and
    // canonical path, not merely app.asar, after the second OS observation.
    await packageCode.fence();
    const proofIdentity = hash(Buffer.concat([canon(m), signature]));
    return Object.freeze({
      source: 'INSTALLED_EXE_NATIVE_VERIFIER',
      source_sha: m.source_sha,
      package_version: version,
      installed_exe_sha256: m.exe_sha256,
      // Derived from the fully verified canonical package tree, never a permit.
      installed_asar_sha256: packageCode.manifest.entries.find(entry => entry.path === 'resources/app.asar').sha256,
      signer_thumbprint: m.signer_thumbprint,
      proof_identity: proofIdentity,
      release_root_signature_verified: true,
      slsa_evidence_digest_bound: true,
      package_code_verified: true,
      package_code_sha256: m.package_code_sha256,
      package_code_file_count: packageCode.fileCount,
      // This is an on-disk observation; only the future independent native
      // Guardian can bind it to loaded code and enforce post-check custody.
      loaded_runtime_code_attested: false,
      // "independent SLSA verification" is performed upstream by gh
      // attestation verify; we NEVER derive it from a public JSON claim here.
      independent_slsa_crypto_verified_at_runtime: false,
      native_signature_verified: true,
      exact_bytes_verified: true,
      observed_at: new Date().toISOString(),
      authority_effect: false,
      ...(staging ? { fixture_classification: 'STAGING' } : {}),
    });
  } catch {
    return null;
  }
}

/**
 * Callable from trusted W67 Host/Guardian ONLY, after Owner before/after fences.
 * Absent actual signed release sidecars or packaged root => null/UNKNOWN.
 * No custom path, signer, root or callback injection in this production API.
 */
export async function readVerifiedInstalledExecutableW68(app) {
  if (process.platform !== 'win32' || app?.isPackaged !== true || typeof app.getVersion !== 'function') return null;
  let root;
  try { root = loadPackagedEmergencyMaintenanceTrustRoot(); } catch { return null; }
  return verifyCore({
    executable: process.execPath, version: app.getVersion(), trustRoot: root,
    nativeRead: exe => readWindowsSignedExecutableW60(exe),
    io: fs, staging: false,
  });
}

/**
 * Disposable cryptographic test only. Always marked STAGING, never Owner proof.
 * Caller-supplied roots / readers are categorically prohibited above.
 */
export async function verifyStagingInstalledExecutableW68({
  executable, version, testTrustRoot, testNativeRead,
} = {}) {
  if (typeof testNativeRead !== 'function') return null;
  let root;
  try { root = validateEmergencyMaintenanceTrustRoot(testTrustRoot); } catch { return null; }
  return verifyCore({ executable, version, trustRoot: root,
    nativeRead: testNativeRead, io: fs, staging: true });
}
