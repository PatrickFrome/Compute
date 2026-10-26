// Hermetic source/filesystem controls. All executable-looking bytes, metadata
// and installer receipts below are synthetic fixtures, never installed evidence.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {offlineRuntimePackageFixture, HEAD, VERSION} from './fixtures/offline-runtime-package.mjs';
import {captureInstalledTreeFingerprint} from '../scripts/qa-installed-tree-fingerprint.mjs';
import {FORWARD_UNINSTALLER, validateForwardSidecar} from '../scripts/qa-forward-candidate-sidecar.mjs';
import {captureForwardCandidateEvidence, captureProducerContext,
  assertCaptureArtifact, assertFreshInstallReadback} from '../scripts/qa-forward-candidate-evidence.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const producer = {repository: 'PatrickFrome/Compute', workflow: '.github/workflows/browser-windows-package-smoke.yml',
  run_id: '434343', run_number: 3144, run_attempt: 1, event: 'push'};
const artifact = {id: '101', name: 'metaengine-browser-windows-candidate-' + HEAD, sha256: 'e'.repeat(64)};
const artifactMetadata = {id: 101, name: artifact.name, digest: 'sha256:' + artifact.sha256,
  expired: false, workflow_run: {id: 434343, head_sha: HEAD}};

async function fixture(t) {
  const f = await offlineRuntimePackageFixture(t);
  const candidateRoot = path.join(f.root, 'candidate/win-unpacked');
  await fs.mkdir(path.join(candidateRoot, 'resources'), {recursive: true});
  await f.copyBundle(path.join(candidateRoot, 'resources/client-state-runtime'));
  await fs.writeFile(path.join(candidateRoot, 'resources/app.asar'), 'synthetic-asar-not-an-executable');
  await fs.writeFile(path.join(candidateRoot, 'METAENGINE Browser Test.exe'), 'synthetic-browser-not-an-executable');
  await fs.writeFile(path.join(candidateRoot, '.included-hidden-file'), 'fixture-hidden');
  await fs.mkdir(path.join(candidateRoot, 'empty-directory'));
  const installedRoot = path.join(f.root, 'installed');
  await fs.cp(candidateRoot, installedRoot, {recursive: true});
  await fs.writeFile(path.join(installedRoot, FORWARD_UNINSTALLER), 'synthetic-generated-uninstaller');
  const installerName = `METAENGINE-Browser-Test-Setup-${VERSION}-x64.exe`;
  const installerBytes = 'synthetic-nsis-installer-not-executable';
  const installerSha256 = sha(installerBytes);
  const installerFile = await f.put('original/' + installerName, installerBytes);
  const publishedInstallerFile = await f.put('published/' + installerName, installerBytes);
  const installedInstallerFile = await f.put('published/candidate-setup.exe', installerBytes);
  const proof = {schema: 'metaengine.browser.windows-package-smoke.v3', source_head: HEAD, package_version: VERSION,
    installer_name: installerName, installer_sha256: installerSha256,
    client_state_runtime_bundle_sha256: f.manifest.bundle_sha256,
    version_probe_verified: true, guardian_native_staging_verified: true, guardian_native_built_by_before_pack: true,
    me2_ui_installed_verified: true, me2_daemon_installed_verified: true, client_state_runtime_packaged_resources_verified: true,
    signed: false, published: false, promotion_authorized: false, authority_effect: false};
  const fresh = {schema: 'metaengine.browser.forward-fresh-install-readback.v1', source_head: HEAD,
    package_version: VERSION, ...producer,
    install: {schema: 'metaengine.browser.bounded-package-install.v1', installer_sha256: installerSha256,
      installer_exit_code: 0, installer_pid: 123, timeout_seconds: 600, process_tree_scoped_job: true,
      descendant_cleanup_on_job_close: true, installed_payload_qualification_required: true, authority_effect: false}};
  const packageProofFile = await f.put('package-proof.json', JSON.stringify(proof));
  const freshInstallProofFile = await f.put('fresh-install.json', JSON.stringify(fresh));
  const installerEvidence = {schema: 'metaengine.browser.installer-provenance-acquired.v1',
    provenance_schema: 'metaengine.browser.installer-provenance.v3', source_head: HEAD, package_version: VERSION,
    provenance_run_id: producer.run_id, provenance_run_number: producer.run_number,
    provenance_run_attempt: producer.run_attempt, provenance_workflow: 'browser-windows-package-smoke.yml',
    installer_sha256: installerSha256, installer_name: installerName,
    build_identity_verified: true, dependency_resolution_verified: true, package_lock_verified: true,
    me2_ui_bun_lock_verified: true, blockmap_verified: true, config_verified: true,
    build_identity_sha256: '1'.repeat(64), dependency_resolution_sha256: '2'.repeat(64),
    package_lock_sha256: '3'.repeat(64), me2_ui_bun_lock_sha256: '4'.repeat(64)};
  const options = {sourceHead: HEAD, packageVersion: VERSION, producer: {...producer}, installerArtifact: {...artifact},
    candidateArtifactMetadata: structuredClone(artifactMetadata), installerEvidence,
    candidateRoot, installedRoot, installerFile, publishedInstallerFile, installedInstallerFile,
    packageProofFile, freshInstallProofFile, outputDirectory: path.join(f.root, 'sidecar')};
  return {...f, options, proof, fresh, installerSha256};
}

test('capture measures producer fixture tree and generated uninstaller, stages full image, and never claims terminal success', async t => {
  const f = await fixture(t);
  const before = await captureInstalledTreeFingerprint(f.options.installedRoot);
  const result = await captureForwardCandidateEvidence(f.options);
  const manifestBytes = await fs.readFile(path.join(f.options.outputDirectory, 'forward-install-sidecar.json'));
  const manifest = JSON.parse(manifestBytes);
  validateForwardSidecar(manifest);
  assert.equal(result.manifest_sha256, sha(manifestBytes));
  assert.equal(result.state, 'CAPTURED_PENDING_PRODUCER_COMPLETION');
  assert.equal(result.producer_terminal_success, false);
  assert.equal(result.terminal_success_required, true);
  assert.equal(result.production_authorized, false);
  assert.equal(result.authority_effect, false);
  assert.equal(manifest.runtime.bundle_sha256, f.manifest.bundle_sha256);
  assert.equal(manifest.installer.sha256, f.installerSha256);
  assert.deepEqual(manifest.producer, producer);
  assert.deepEqual(manifest.installer_artifact, artifact);
  assert.equal(manifest.uninstaller.measurement, 'NSIS_GENERATED_AFTER_FRESH_INSTALL');
  assert.equal(manifest.uninstaller.sha256, sha('synthetic-generated-uninstaller'));
  assert.equal(manifest.uninstaller.installer_sha256, f.installerSha256);
  assert.equal(manifest.installed_image.installed_tree_sha256, before.tree_sha256);
  assert.ok(manifest.image.files.some(row => row[0] === '.included-hidden-file'));
  assert.ok(manifest.image.files.some(row => row[0] === 'empty-directory' && row[1] === 'DIRECTORY'));
  assert.ok(!manifest.image.files.some(row => row[0] === FORWARD_UNINSTALLER));
  await assert.rejects(fs.lstat(path.join(f.options.outputDirectory, 'win-unpacked', FORWARD_UNINSTALLER)), {code: 'ENOENT'});
  assert.equal((await captureInstalledTreeFingerprint(f.options.installedRoot)).tree_sha256, before.tree_sha256);
  assert.deepEqual((await fs.readdir(f.options.outputDirectory)).sort(), ['forward-install-sidecar.json', 'win-unpacked']);
  assert.equal(manifestBytes.includes(Buffer.from(f.root)), false, 'public manifest contains no absolute private runner paths');
  await assert.rejects(captureForwardCandidateEvidence(f.options), /output_exists_requires_readback/);
});

for (const [label, mutate, pattern] of [
  ['original installer substitution', async f => fs.appendFile(f.options.installerFile, 'changed'), /installer_bytes_mismatch/],
  ['published installer substitution', async f => fs.appendFile(f.options.publishedInstallerFile, 'changed'), /installer_bytes_mismatch/],
  ['actually invoked installer substitution', async f => fs.appendFile(f.options.installedInstallerFile, 'changed'), /installer_bytes_mismatch/],
  ['candidate ASAR substitution', async f => fs.appendFile(path.join(f.options.candidateRoot, 'resources/app.asar'), 'changed'), /candidate_image_mismatch/],
  ['installed ASAR substitution', async f => fs.appendFile(path.join(f.options.installedRoot, 'resources/app.asar'), 'changed'), /candidate_image_mismatch/],
  ['candidate runtime substitution', async f => fs.appendFile(path.join(f.options.candidateRoot, 'resources/client-state-runtime/runtime/node/node.exe'), 'changed'), /file_digest_mismatch/],
  ['installed runtime substitution', async f => fs.appendFile(path.join(f.options.installedRoot, 'resources/client-state-runtime/runtime/postgresql/lib/plpgsql.dll'), 'changed'), /candidate_image_mismatch/],
  ['missing generated uninstaller', async f => fs.rm(path.join(f.options.installedRoot, FORWARD_UNINSTALLER)), /ENOENT/],
  ['extra installed file', async f => fs.writeFile(path.join(f.options.installedRoot, 'unlisted'), 'changed'), /candidate_image_mismatch/],
  ['candidate contains uninstaller', async f => fs.writeFile(path.join(f.options.candidateRoot, FORWARD_UNINSTALLER), 'fake'), /candidate_contains_uninstaller/],
  ['weakened strict installer proof', async f => {f.options.installerEvidence.package_lock_verified = false;}, /strict_installer_evidence_required/],
  ['foreign installer evidence', async f => {f.options.installerEvidence.provenance_run_id = '2';}, /installer_evidence_binding_invalid/],
  ['wrong producer artifact digest', async f => {f.options.candidateArtifactMetadata.digest = 'sha256:' + 'f'.repeat(64);}, /candidate_artifact_binding_invalid/],
  ['failed fresh install', async f => {f.fresh.install.installer_exit_code = 23; await fs.writeFile(f.options.freshInstallProofFile, JSON.stringify(f.fresh));}, /fresh_install_unverified/],
  ['fresh receipt from another run', async f => {f.fresh.run_id = '2'; await fs.writeFile(f.options.freshInstallProofFile, JSON.stringify(f.fresh));}, /fresh_install_binding_invalid/],
  ['fresh receipt from stale attempt', async f => {f.fresh.run_attempt = 2; await fs.writeFile(f.options.freshInstallProofFile, JSON.stringify(f.fresh));}, /fresh_install_binding_invalid/],
  ['fresh receipt from another source', async f => {f.fresh.source_head = 'b'.repeat(40); await fs.writeFile(f.options.freshInstallProofFile, JSON.stringify(f.fresh));}, /fresh_install_binding_invalid/],
  ['unverified package readback', async f => {f.proof.version_probe_verified = false; await fs.writeFile(f.options.packageProofFile, JSON.stringify(f.proof));}, /package_fresh_readback_required/],
  ['wrong package version', async f => {f.proof.package_version = '0.7.0-dev.2.1'; await fs.writeFile(f.options.packageProofFile, JSON.stringify(f.proof));}, /package_proof_binding_invalid/],
]) {
  test('capture rejects ' + label + ' before a complete sidecar is written', async t => {
    const f = await fixture(t);
    await mutate(f);
    await assert.rejects(captureForwardCandidateEvidence(f.options), pattern);
    await assert.rejects(fs.lstat(path.join(f.options.outputDirectory, 'forward-install-sidecar.json')), {code: 'ENOENT'});
  });
}

test('capture refuses output inside a source tree and physical aliases', async t => {
  const f = await fixture(t);
  await assert.rejects(captureForwardCandidateEvidence({...f.options,
    outputDirectory: path.join(f.options.candidateRoot, 'sidecar')}), /disjoint_directories_required/);
  const alias = path.join(f.root, 'alias');
  await fs.symlink(f.options.installedRoot, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(captureForwardCandidateEvidence({...f.options, installedRoot: alias}), /directory_alias_forbidden/);
  const external = await f.put('outside.dat', 'outside');
  await fs.link(external, path.join(f.options.candidateRoot, 'hardlinked.dat'));
  await assert.rejects(captureForwardCandidateEvidence(f.options), /hardlink|regular|physical/);
});

function environment() {
  return {GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows',
    GITHUB_REPOSITORY: producer.repository, GITHUB_EVENT_NAME: producer.event,
    GITHUB_WORKFLOW_REF: producer.repository + '/' + producer.workflow + '@refs/heads/fixture',
    GITHUB_RUN_ID: producer.run_id, GITHUB_RUN_NUMBER: String(producer.run_number), GITHUB_RUN_ATTEMPT: '1',
    FORWARD_SOURCE_HEAD: HEAD, FORWARD_PACKAGE_VERSION: VERSION,
    FORWARD_CANDIDATE_ARTIFACT_ID: artifact.id, FORWARD_CANDIDATE_ARTIFACT_DIGEST: artifact.sha256};
}

test('production entry binds hosted Windows, exact workflow/source and first attempt', () => {
  assert.deepEqual(captureProducerContext(environment(), HEAD, 'win32'), {sourceHead: HEAD, packageVersion: VERSION,
    producer, installerArtifact: artifact});
  for (const changes of [{RUNNER_ENVIRONMENT: 'self-hosted'}, {GITHUB_ACTIONS: 'false'}, {RUNNER_OS: 'Linux'},
    {GITHUB_RUN_ATTEMPT: '2'}, {GITHUB_RUN_NUMBER: '0'}, {GITHUB_RUN_ID: '01'},
    {GITHUB_REPOSITORY: 'foreign/Compute'}, {GITHUB_WORKFLOW_REF: 'PatrickFrome/Compute/.github/workflows/other.yml@main'},
    {FORWARD_SOURCE_HEAD: 'b'.repeat(40)}, {FORWARD_CANDIDATE_ARTIFACT_ID: 'latest'},
    {FORWARD_CANDIDATE_ARTIFACT_DIGEST: 'bad'}, {GITHUB_EVENT_NAME: 'workflow_run'}]) {
    assert.throws(() => captureProducerContext({...environment(), ...changes}, HEAD, 'win32'), /qa_forward_capture_/);
  }
  assert.throws(() => captureProducerContext(environment(), HEAD, 'linux'), /hosted_windows_required/);
});

test('capture metadata requires original artifact ID/run/source/digest and a successful bounded installer', () => {
  const context = {sourceHead: HEAD, packageVersion: VERSION, producer, installerArtifact: artifact};
  assert.equal(assertCaptureArtifact(artifactMetadata, context), true);
  for (const changes of [{id: 102}, {name: artifact.name + '-old'}, {expired: true}, {digest: null},
    {workflow_run: {id: 2, head_sha: HEAD}}, {workflow_run: {id: 434343, head_sha: 'b'.repeat(40)}}]) {
    assert.throws(() => assertCaptureArtifact({...artifactMetadata, ...changes}, context), /candidate_artifact_binding_invalid/);
  }
  assert.throws(() => assertFreshInstallReadback({}, {...context, installerSha256: '1'.repeat(64)}), /fresh_install_binding_invalid/);
});

test('workflow hook follows actual install, stages only image evidence and retains immutable candidate gates', async () => {
  const workflow = await fs.readFile(fileURLToPath(new URL('../../../.github/workflows/browser-windows-package-smoke.yml', import.meta.url)), 'utf8');
  const candidate = workflow.indexOf('- name: Publish immutable candidate for parallel downstream qualification');
  const install = workflow.indexOf('- name: Install exact-head package and prove Browser plus inert Guardian payload');
  const capture = workflow.indexOf('- name: Capture same-producer forward candidate image after successful fresh install');
  const upload = workflow.indexOf('- name: Publish immutable forward candidate sidecar');
  const later = workflow.indexOf('- name: Qualify normal installed first-run');
  assert.ok(candidate >= 0 && install > candidate && capture > install && upload > capture && later > upload);
  assert.match(workflow.slice(candidate, install), /id: immutable_candidate/);
  assert.doesNotMatch(workflow.slice(candidate, install), /win-unpacked|forward-install-sidecar/);
  const hooks = workflow.slice(capture, later);
  assert.match(hooks, /steps\.immutable_candidate\.outputs\.artifact-id/);
  assert.match(hooks, /steps\.immutable_candidate\.outputs\.artifact-digest/);
  assert.match(hooks, /include-hidden-files: true/);
  assert.match(hooks, /overwrite: false/);
  assert.match(hooks, /if-no-files-found: error/);
  assert.match(hooks, /success\(\) && steps\.forward_sidecar_capture\.outcome == 'success'/);
  assert.doesNotMatch(hooks, /continue-on-error|always\(\)|electron-builder|install-package-bounded/);
  assert.match(workflow.slice(install, capture), /install=\$installProof/);
});

test('CLI cannot manufacture production capture on an ordinary local checkout', () => {
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const script = fileURLToPath(new URL('../scripts/qa-forward-candidate-evidence.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, 'capture'], {env: {...process.env,
    GITHUB_WORKSPACE: repo, GITHUB_ACTIONS: 'false', GH_TOKEN: 'synthetic-secret-must-not-appear'}, encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /hosted_windows_required/);
  assert.doesNotMatch(result.stderr, /synthetic-secret-must-not-appear/);
});
