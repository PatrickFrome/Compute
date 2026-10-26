#!/usr/bin/env node
// Capture the one Package Smoke install's migration evidence. This never builds,
// installs, retries an effect, or grants terminal/production qualification.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {verifyInstaller} from './installer-provenance.mjs';
import {captureInstalledTreeFingerprint} from './qa-installed-tree-fingerprint.mjs';
import {compareQaInstalledImage} from './qa-operator-install-recovery.mjs';
import {copyInstalledImageToFreshDirectory} from './qa-installed-image-snapshot.mjs';
import {verifyOfflineRuntimeBundle} from '../../../infra/client-state-runtime/offline-runtime-bundle.mjs';
import {
  FORWARD_SIDECAR_SCHEMA, FORWARD_UNINSTALLER, FORWARD_SIDECAR_LIMITS,
  captureForwardInventory, hashForwardFile, validateForwardSidecar, forwardPathCollisionKey,
} from './qa-forward-candidate-sidecar.mjs';

const WORKFLOW = '.github/workflows/browser-windows-package-smoke.yml';
const REPOSITORY = 'PatrickFrome/Compute';
const SHA = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const DECIMAL = /^[1-9][0-9]*$/;
const VERSION = /^0\.7\.0-dev\.[0-9]+\.1$/;
const RUNTIME = 'resources/client-state-runtime';
const digest = value => createHash('sha256').update(value).digest('hex');
const fail = code => {throw new Error('qa_forward_capture_' + code);};
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size
  && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.nlink === b.nlink;
const positive = value => Number.isSafeInteger(value) && value > 0;

function producerIdentity(producer) {
  if (producer?.repository !== REPOSITORY || producer.workflow !== WORKFLOW
      || typeof producer.run_id !== 'string' || !DECIMAL.test(producer.run_id)
      || !positive(producer.run_number) || producer.run_attempt !== 1
      || !['push', 'pull_request', 'workflow_dispatch'].includes(producer.event)) fail('producer_identity_invalid');
  return producer;
}

export function captureProducerContext(env, actualHead, platform = process.platform) {
  if (platform !== 'win32' || env.GITHUB_ACTIONS !== 'true'
      || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.RUNNER_OS !== 'Windows') fail('hosted_windows_required');
  if (!HEAD.test(env.FORWARD_SOURCE_HEAD || '') || actualHead !== env.FORWARD_SOURCE_HEAD
      || !VERSION.test(env.FORWARD_PACKAGE_VERSION || '')) fail('source_identity_invalid');
  if (!String(env.GITHUB_WORKFLOW_REF || '').startsWith(REPOSITORY + '/' + WORKFLOW + '@')) fail('workflow_identity_invalid');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_NUMBER', 'GITHUB_RUN_ATTEMPT']) {
    if (!DECIMAL.test(env[key] || '')) fail('producer_identity_invalid');
  }
  const producer = producerIdentity({repository: env.GITHUB_REPOSITORY, workflow: WORKFLOW,
    run_id: env.GITHUB_RUN_ID, run_number: Number(env.GITHUB_RUN_NUMBER),
    run_attempt: Number(env.GITHUB_RUN_ATTEMPT), event: env.GITHUB_EVENT_NAME});
  const sha256 = String(env.FORWARD_CANDIDATE_ARTIFACT_DIGEST || '').replace(/^sha256:/, '');
  if (!DECIMAL.test(env.FORWARD_CANDIDATE_ARTIFACT_ID || '') || !SHA.test(sha256)) fail('artifact_output_invalid');
  return {sourceHead: actualHead, packageVersion: env.FORWARD_PACKAGE_VERSION, producer,
    installerArtifact: {id: env.FORWARD_CANDIDATE_ARTIFACT_ID,
      name: 'metaengine-browser-windows-candidate-' + actualHead, sha256}};
}

export function assertCaptureArtifact(metadata, {sourceHead, producer, installerArtifact}) {
  producerIdentity(producer);
  if (!metadata || String(metadata.id) !== installerArtifact.id || metadata.name !== installerArtifact.name
      || metadata.digest !== 'sha256:' + installerArtifact.sha256 || metadata.expired !== false
      || String(metadata.workflow_run?.id) !== producer.run_id
      || metadata.workflow_run?.head_sha !== sourceHead) fail('candidate_artifact_binding_invalid');
  return true;
}

// The endpoint is fixed and ID-addressed. No latest lookup, ambient API-base
// override, token-bearing redirect, or retry of an ambiguous response.
async function readCaptureArtifact(context, token) {
  if (!token) fail('github_token_required');
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}/actions/artifacts/${context.installerArtifact.id}`, {
    headers: {Authorization: 'Bearer ' + token, Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'metaengine-forward-candidate-capture'},
    redirect: 'error', signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) fail('candidate_artifact_read_failed');
  let bytes = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    bytes += chunk.length;
    if (bytes > 1024 * 1024) fail('artifact_metadata_limit');
    chunks.push(chunk);
  }
  let metadata;
  try {metadata = JSON.parse(Buffer.concat(chunks).toString('utf8'));}
  catch {fail('artifact_metadata_invalid');}
  assertCaptureArtifact(metadata, context);
  return metadata;
}

async function physicalDirectory(directory) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.startsWith('\\\\')) fail('absolute_local_path_required');
  const absolute = path.resolve(directory);
  for (let cursor = absolute;; cursor = path.dirname(cursor)) {
    const info = await fs.lstat(cursor);
    if (!info.isDirectory() || info.isSymbolicLink()) fail('directory_alias_forbidden');
    if (path.dirname(cursor) === cursor) break;
  }
  const real = await fs.realpath(absolute);
  const [a, b] = await Promise.all([fs.lstat(absolute), fs.lstat(real)]);
  if (a.dev !== b.dev || a.ino !== b.ino) fail('directory_identity_changed');
  return real;
}

function within(parent, child) {
  const rel = path.relative(parent, child);
  return rel === '' || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + path.sep));
}

async function outputBoundary(candidateRoot, installedRoot, outputDirectory) {
  const candidate = await physicalDirectory(candidateRoot);
  const installed = await physicalDirectory(installedRoot);
  if (!path.isAbsolute(outputDirectory || '')) fail('absolute_local_path_required');
  const parent = await physicalDirectory(path.dirname(outputDirectory));
  const output = path.join(parent, path.basename(outputDirectory));
  for (const [a, b] of [[candidate, installed], [candidate, output], [installed, output]]) {
    if (within(a, b) || within(b, a)) fail('disjoint_directories_required');
  }
  try {await fs.lstat(output); fail('output_exists_requires_readback');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  return {candidate, installed, output};
}

async function readJson(file) {
  await physicalDirectory(path.dirname(file));
  const before = await fs.lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1
      || before.size < 1 || before.size > FORWARD_SIDECAR_LIMITS.maxManifestBytes) fail('metadata_file_invalid');
  const pin = await hashForwardFile(file, {maxBytes: FORWARD_SIDECAR_LIMITS.maxManifestBytes});
  const bytes = await fs.readFile(file);
  if (digest(bytes) !== pin || !same(before, await fs.lstat(file))) fail('metadata_changed');
  let value;
  try {value = JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/, ''));}
  catch {fail('metadata_json_invalid');}
  return {value, sha256: pin};
}

export function assertFreshInstallReadback(fresh, {sourceHead, packageVersion, producer, installerSha256}) {
  if (fresh?.schema !== 'metaengine.browser.forward-fresh-install-readback.v1'
      || fresh.source_head !== sourceHead || fresh.package_version !== packageVersion
      || fresh.repository !== producer.repository || fresh.workflow !== producer.workflow
      || fresh.run_id !== producer.run_id || fresh.run_number !== producer.run_number
      || fresh.run_attempt !== producer.run_attempt || fresh.event !== producer.event) fail('fresh_install_binding_invalid');
  const installed = fresh.install;
  if (installed?.schema !== 'metaengine.browser.bounded-package-install.v1'
      || installed.installer_sha256 !== installerSha256 || installed.installer_exit_code !== 0
      || !positive(installed.installer_pid) || !positive(installed.timeout_seconds) || installed.timeout_seconds > 1800
      || installed.process_tree_scoped_job !== true || installed.descendant_cleanup_on_job_close !== true
      || installed.installed_payload_qualification_required !== true || installed.authority_effect !== false) fail('fresh_install_unverified');
}

function assertInstallerEvidence(evidence, context, installerSha256, installerName) {
  if (evidence?.schema !== 'metaengine.browser.installer-provenance-acquired.v1'
      || evidence.provenance_schema !== 'metaengine.browser.installer-provenance.v3'
      || evidence.source_head !== context.sourceHead || evidence.package_version !== context.packageVersion
      || String(evidence.provenance_run_id) !== context.producer.run_id
      || evidence.provenance_run_number !== context.producer.run_number
      || evidence.provenance_run_attempt !== context.producer.run_attempt
      || evidence.provenance_workflow !== 'browser-windows-package-smoke.yml'
      || evidence.installer_sha256 !== installerSha256 || evidence.installer_name !== installerName) fail('installer_evidence_binding_invalid');
  for (const flag of ['build_identity_verified', 'dependency_resolution_verified', 'package_lock_verified',
    'me2_ui_bun_lock_verified', 'blockmap_verified', 'config_verified']) {
    if (evidence[flag] !== true) fail('strict_installer_evidence_required');
  }
  for (const field of ['build_identity_sha256', 'dependency_resolution_sha256', 'package_lock_sha256', 'me2_ui_bun_lock_sha256']) {
    if (!SHA.test(evidence[field] || '')) fail('strict_installer_evidence_required');
  }
}

// This filesystem core is also exercised on explicitly synthetic, inert fixture
// trees. Only main() supplies real hosted-run context and verifyInstaller output.
// It never interprets fixture success as evidence for a built Windows installer.
export async function captureForwardCandidateEvidence(options) {
  const {sourceHead, packageVersion, producer, installerArtifact, candidateArtifactMetadata,
    installerFile, publishedInstallerFile, installedInstallerFile, packageProofFile,
    freshInstallProofFile, installerEvidence} = options;
  const context = {sourceHead, packageVersion, producer: producerIdentity(producer), installerArtifact};
  if (!HEAD.test(sourceHead || '') || !VERSION.test(packageVersion || '')
      || typeof installerArtifact?.id !== 'string' || !DECIMAL.test(installerArtifact.id)
      || installerArtifact.name !== 'metaengine-browser-windows-candidate-' + sourceHead
      || !SHA.test(installerArtifact.sha256 || '')) fail('identity_invalid');
  assertCaptureArtifact(candidateArtifactMetadata, context);
  const {candidate, installed, output} = await outputBoundary(options.candidateRoot, options.installedRoot, options.outputDirectory);
  const installerName = `METAENGINE-Browser-Test-Setup-${packageVersion}-x64.exe`;
  if (path.basename(installerFile) !== installerName || path.basename(publishedInstallerFile) !== installerName
      || path.basename(installedInstallerFile) !== 'candidate-setup.exe') fail('installer_name_invalid');
  const installerSha256 = await hashForwardFile(installerFile);
  for (const file of [publishedInstallerFile, installedInstallerFile]) {
    if (await hashForwardFile(file) !== installerSha256) fail('installer_bytes_mismatch');
  }
  assertInstallerEvidence(installerEvidence, context, installerSha256, installerName);
  const packageRead = await readJson(packageProofFile), freshRead = await readJson(freshInstallProofFile);
  const proof = packageRead.value;
  if (proof?.schema !== 'metaengine.browser.windows-package-smoke.v3' || proof.source_head !== sourceHead
      || proof.package_version !== packageVersion || proof.installer_name !== installerName
      || proof.installer_sha256 !== installerSha256) fail('package_proof_binding_invalid');
  for (const flag of ['version_probe_verified', 'guardian_native_staging_verified', 'guardian_native_built_by_before_pack',
    'me2_ui_installed_verified', 'me2_daemon_installed_verified', 'client_state_runtime_packaged_resources_verified']) {
    if (proof[flag] !== true) fail('package_fresh_readback_required');
  }
  for (const flag of ['signed', 'published', 'promotion_authorized', 'authority_effect']) {
    if (proof[flag] !== false) fail('package_authority_invalid');
  }
  assertFreshInstallReadback(freshRead.value, {...context, installerSha256});
  const image = await captureForwardInventory(candidate);
  if (image.files.some(row => forwardPathCollisionKey(row[0]) === forwardPathCollisionKey(FORWARD_UNINSTALLER))) fail('candidate_contains_uninstaller');
  const asarSha256 = await hashForwardFile(path.join(candidate, 'resources/app.asar'));
  const runtimeRoot = path.join(candidate, RUNTIME);
  const runtimeBundle = await verifyOfflineRuntimeBundle({bundleDirectory: runtimeRoot,
    expectedBundleDigest: proof.client_state_runtime_bundle_sha256});
  const runtime = {bundle_sha256: runtimeBundle.manifest.bundle_sha256,
    tree_sha256: (await captureInstalledTreeFingerprint(runtimeRoot)).tree_sha256,
    postgres_tree_sha256: (await captureInstalledTreeFingerprint(path.join(runtimeRoot, 'runtime/postgresql'))).tree_sha256};
  // This expectation is learned exclusively from the producer's fresh install.
  // Consumers must use this pinned value, never their own successor's bytes.
  const uninstallerFile = path.join(installed, FORWARD_UNINSTALLER);
  const uninstallerSha256 = await hashForwardFile(uninstallerFile);
  const installedImage = await compareQaInstalledImage(candidate, installed, {expectedUninstallerSha256: uninstallerSha256});
  const manifest = {schema: FORWARD_SIDECAR_SCHEMA, source_head: sourceHead, package_version: packageVersion,
    producer: {...producer}, installer_artifact: {...installerArtifact},
    installer: {name: installerName, sha256: installerSha256}, asar_sha256: asarSha256, runtime,
    image: {root: 'win-unpacked', schema: image.schema, tree_sha256: image.tree_sha256, files: image.files},
    uninstaller: {name: FORWARD_UNINSTALLER, sha256: uninstallerSha256,
      measurement: 'NSIS_GENERATED_AFTER_FRESH_INSTALL', installer_sha256: installerSha256},
    installed_image: installedImage};
  validateForwardSidecar(manifest);
  await fs.mkdir(output, {recursive: false, mode: 0o700});
  const copy = await copyInstalledImageToFreshDirectory(candidate, path.join(output, 'win-unpacked'));
  if (copy.tree_sha256 !== image.tree_sha256 || copy.copied_tree_verified !== true) fail('staged_image_drift');
  // Pin all inputs through the final readback, including installed bytes after
  // the potentially lengthy copy. Partial output is retained without a manifest.
  if ((await captureForwardInventory(path.join(output, 'win-unpacked'))).tree_sha256 !== image.tree_sha256
      || (await captureInstalledTreeFingerprint(installed)).tree_sha256 !== installedImage.installed_tree_sha256
      || await hashForwardFile(uninstallerFile) !== uninstallerSha256) fail('image_changed_during_capture');
  for (const file of [installerFile, publishedInstallerFile, installedInstallerFile]) {
    if (await hashForwardFile(file) !== installerSha256) fail('installer_changed_during_capture');
  }
  if ((await readJson(packageProofFile)).sha256 !== packageRead.sha256
      || (await readJson(freshInstallProofFile)).sha256 !== freshRead.sha256) fail('proof_changed_during_capture');
  const bytes = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
  if (bytes.length > FORWARD_SIDECAR_LIMITS.maxManifestBytes) fail('manifest_size_limit');
  const manifestFile = path.join(output, 'forward-install-sidecar.json');
  const handle = await fs.open(manifestFile, 'wx', 0o600);
  try {await handle.writeFile(bytes); await handle.sync();} finally {await handle.close();}
  return {schema: 'metaengine.browser.forward-candidate-capture.v1',
    state: 'CAPTURED_PENDING_PRODUCER_COMPLETION', source_head: sourceHead, package_version: packageVersion,
    producer: {...producer}, installer_artifact: {...installerArtifact}, manifest_sha256: digest(bytes),
    candidate_tree_sha256: image.tree_sha256, installer_sha256: installerSha256,
    uninstaller_sha256: uninstallerSha256, file_count: image.file_count, total_bytes: image.total_bytes,
    terminal_success_required: true, producer_terminal_success: false,
    production_authorized: false, authority_effect: false};
}

async function main() {
  if (process.argv.length !== 3 || process.argv[2] !== 'capture') fail('usage_capture_only');
  // All production locations are fixed from the hosted job, not user CLI paths.
  const workspace = process.env.GITHUB_WORKSPACE;
  if (!path.isAbsolute(workspace || '')) fail('workspace_required');
  const actualHead = String(execFileSync('git', ['rev-parse', 'HEAD'], {cwd: workspace,
    encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe']})).trim();
  const context = captureProducerContext(process.env, actualHead);
  const appRoot = path.join(workspace, 'apps/metaengine-browser');
  const temporary = await physicalDirectory(process.env.RUNNER_TEMP);
  const local = await physicalDirectory(process.env.LOCALAPPDATA);
  const outputDirectory = path.join(temporary, 'forward-candidate-sidecar');
  const candidateRoot = path.join(appRoot, 'dist-test/win-unpacked');
  const installedRoot = path.join(local, 'Programs/METAENGINE Browser Test');
  await outputBoundary(candidateRoot, installedRoot, outputDirectory);
  const candidateArtifactMetadata = await readCaptureArtifact(context, process.env.GH_TOKEN);
  const installerFile = path.join(appRoot, 'dist-test', `METAENGINE-Browser-Test-Setup-${context.packageVersion}-x64.exe`);
  const verificationFile = path.join(temporary, 'forward-candidate-installer-verification.json');
  try {await fs.lstat(verificationFile); fail('verification_exists_requires_readback');}
  catch (error) {if (error.code !== 'ENOENT') throw error;}
  // Run the unchanged strict v3 verifier against original dist-test (one NSIS
  // EXE), not RUNNER_TEMP which also contains the candidate-setup.exe copy.
  const installerEvidence = await verifyInstaller({installer: installerFile,
    provenance: path.join(temporary, 'installer-provenance.json'), state: verificationFile,
    blockmap: installerFile + '.blockmap', config: path.join(appRoot, 'electron-builder.test.json'),
    'expect-head': context.sourceHead, 'expect-run-id': context.producer.run_id,
    'expect-run-number': String(context.producer.run_number), 'expect-run-attempt': String(context.producer.run_attempt),
    'expect-workflow': 'browser-windows-package-smoke.yml',
    'build-identity': path.join(temporary, 'build-identity.json'),
    'dependency-resolution': path.join(temporary, 'dependency-resolution.json'),
    'package-lock-material': path.join(temporary, 'package-lock-material.json'),
    'package-json': path.join(temporary, 'package.json'), 'package-lock': path.join(temporary, 'package-lock.json'),
    'me2-ui-bun-lock': path.join(temporary, 'me2-ui-bun.lock')});
  const receipt = await captureForwardCandidateEvidence({...context, candidateArtifactMetadata,
    candidateRoot, installedRoot, outputDirectory, installerFile, installerEvidence,
    publishedInstallerFile: path.join(temporary, path.basename(installerFile)),
    installedInstallerFile: path.join(temporary, 'candidate-setup.exe'),
    packageProofFile: path.join(temporary, 'windows-package-proof.json'),
    freshInstallProofFile: path.join(temporary, 'forward-fresh-install-readback.json')});
  if (!path.isAbsolute(process.env.GITHUB_OUTPUT || '')) fail('github_output_required');
  await fs.appendFile(process.env.GITHUB_OUTPUT, `manifest_sha256=${receipt.manifest_sha256}\n`);
  process.stdout.write(JSON.stringify(receipt) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => {
    // Do not export raw metadata, private runner paths, token or response body.
    const code = /^(?:qa_forward_capture|qa_forward_sidecar|qa_tree|qa_operator_image|offline_bundle)_[a-z_]+$/.test(error.message)
      ? error.message : 'qa_forward_capture_failed';
    process.stderr.write(JSON.stringify({schema: 'metaengine.browser.forward-candidate-capture-error.v1', code}) + '\n');
    process.exitCode = 1;
  });
}
