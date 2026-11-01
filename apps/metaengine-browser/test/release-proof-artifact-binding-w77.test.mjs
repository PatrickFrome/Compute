// SOURCE/STAGING boundary fixtures only: these ZIP members are inert bytes,
// not signed packages, independently verified SLSA or release authorization.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {crc32} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {
  validateImmutableArtifactBindingW77,
  verifyImmutableArtifactBytesW77,
  createReleaseRootSigningRequestW77,
  runReleaseProofPreflightCliW77,
  probeProductionReleaseProofW77,
} from '../scripts/release-proof-producer-w77.mjs';

const SOURCE = 'a'.repeat(40);
const VERSION = '0.7.0-dev.999900003.1';
const RUN = '434343', ATTEMPT = '1', ARTIFACT = '123456';
const REPO = 'PatrickFrome/Compute';
const WORKFLOW = '.github/workflows/browser-windows-package-smoke.yml';
const BRANCH = 'physical/build-slsa-provenance-v1';
const INSTALLER = `METAENGINE-Browser-Test-Setup-${VERSION}-x64.exe`;
const INVENTORY = 'metaengine-installed-package-code.v1.json';
const BUNDLE = 'browser-slsa-provenance/installer-slsa-provenance.bundle.json';
const RECEIPT = 'browser-slsa-provenance/installer-slsa-provenance-receipt.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function metadata() {
  const archiveSha256 = 'b'.repeat(64);
  return {
    sourceSha: SOURCE, version: VERSION, runId: RUN, attempt: ATTEMPT,
    artifactId: ARTIFACT, archiveSha256,
    producerRun: {
      id: Number(RUN), run_attempt: Number(ATTEMPT),
      repository: {full_name: REPO}, path: WORKFLOW,
      head_branch: BRANCH, head_sha: SOURCE, event: 'push',
      status: 'completed', conclusion: 'success',
    },
    artifact: {
      id: Number(ARTIFACT), name: `metaengine-browser-windows-candidate-${SOURCE}`,
      digest: `sha256:${archiveSha256}`, expired: false,
      workflow_run: {id: Number(RUN), head_sha: SOURCE},
    },
  };
}

test('production probe distinguishes wired handoff from unqualified runtime and missing signer', () => {
  const probe = probeProductionReleaseProofW77();
  assert.equal(probe.disposition, 'BLOCKED');
  assert.equal(probe.immutable_artifact_handoff_wired, true);
  assert.equal(probe.immutable_artifact_handoff_runtime_qualified, false);
  assert.equal(probe.signing_request_transport_wired, true);
  assert.ok(probe.missing_capabilities.includes('IMMUTABLE_VERIFIED_GH_ARTIFACT_HANDOFF_RUNTIME_NOT_QUALIFIED'));
  assert.ok(probe.missing_capabilities.includes('EXISTING_PROTECTED_RELEASE_ROOT_SIGNING_CAPABILITY_NOT_WIRED'));
  assert.ok(probe.missing_capabilities.includes('EXTERNAL_SIDECAR_INSTALLED_PLACEMENT_UNPROVEN'));
  assert.equal(probe.production_sidecars_emitted, false);
  assert.equal(probe.installed_authority, false);
  assert.equal(probe.release_authorized, false);
  assert.equal(probe.authority_effect, false);
});

test('artifact metadata requires the exact completed producer and immutable archive pin', () => {
  assert.doesNotThrow(() => validateImmutableArtifactBindingW77(metadata()));
  const strings = metadata();
  strings.producerRun.id = RUN;
  strings.producerRun.run_attempt = ATTEMPT;
  strings.artifact.id = ARTIFACT;
  strings.artifact.workflow_run.id = RUN;
  assert.doesNotThrow(() => validateImmutableArtifactBindingW77(strings));
});

for (const [label, mutate] of [
  ['foreign repository', x => { x.producerRun.repository.full_name = 'other/Compute'; }],
  ['foreign workflow', x => { x.producerRun.path = '.github/workflows/other.yml'; }],
  ['foreign source branch', x => { x.producerRun.head_branch = 'main'; }],
  ['pull request event', x => { x.producerRun.event = 'pull_request'; }],
  ['unfinished producer', x => { x.producerRun.status = 'in_progress'; }],
  ['failed producer', x => { x.producerRun.conclusion = 'failure'; }],
  ['cancelled producer', x => { x.producerRun.conclusion = 'cancelled'; }],
  ['null producer conclusion', x => { x.producerRun.conclusion = null; }],
  ['foreign source commit', x => { x.producerRun.head_sha = 'c'.repeat(40); }],
  ['wrong run', x => { x.producerRun.id += 1; }],
  ['wrong attempt', x => { x.producerRun.run_attempt += 1; }],
  ['wrong artifact id', x => { x.artifact.id += 1; }],
  ['wrong artifact name', x => { x.artifact.name += '-other'; }],
  ['wrong artifact source', x => { x.artifact.name = `metaengine-browser-windows-candidate-${'c'.repeat(40)}`; }],
  ['wrong archive digest', x => { x.artifact.digest = 'sha256:' + 'c'.repeat(64); }],
  ['bare archive digest', x => { x.artifact.digest = x.archiveSha256; }],
  ['noncanonical digest prefix', x => { x.artifact.digest = 'SHA256:' + x.archiveSha256; }],
  ['expired artifact', x => { x.artifact.expired = true; }],
  ['missing expiration evidence', x => { delete x.artifact.expired; }],
  ['foreign artifact run', x => { x.artifact.workflow_run.id += 1; }],
  ['foreign artifact source', x => { x.artifact.workflow_run.head_sha = 'c'.repeat(40); }],
  ['missing artifact run binding', x => { delete x.artifact.workflow_run; }],
  ['invalid source sha', x => { x.sourceSha = SOURCE.toUpperCase(); }],
  ['invalid version', x => { x.version = '0.7.0'; }],
  ['reserved version 37781000062', x => { x.version = '0.7.0-dev.37781000062.1'; }],
  ['reserved version 842024784850', x => { x.version = '0.7.0-dev.842024784850.1'; }],
]) test('rejects ' + label + ' in immutable producer metadata', () => {
  const input = metadata(); mutate(input);
  assert.throws(() => validateImmutableArtifactBindingW77(input), /w77_release_proof_/);
});

for (const bad of ['0', '-1', '01', '+1', '1.0', '1e3', ' 1', '1 ', '', null, true, Number.MAX_SAFE_INTEGER + 1]) {
  for (const field of ['runId', 'attempt', 'artifactId']) {
    test(`rejects noncanonical ${field} ${JSON.stringify(bad)} even when metadata agrees`, () => {
      const input = metadata(); input[field] = bad;
      if (field === 'runId') input.producerRun.id = input.artifact.workflow_run.id = bad;
      if (field === 'attempt') input.producerRun.run_attempt = bad;
      if (field === 'artifactId') input.artifact.id = bad;
      assert.throws(() => validateImmutableArtifactBindingW77(input), /w77_release_proof_/);
    });
  }
}

// Independent minimal stored-ZIP writer, following the existing archive suite's
// standard local/central/EOCD pattern. No production archive/fixture is modified.
function zip(entries) {
  const local = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.name), bytes = Buffer.from(entry.bytes ?? '');
    const crc = crc32(bytes), header = Buffer.alloc(30), record = Buffer.alloc(46);
    header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x800, 6); header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(bytes.length, 18); header.writeUInt32LE(bytes.length, 22);
    header.writeUInt16LE(name.length, 26);
    record.writeUInt32LE(0x02014b50); record.writeUInt16LE((3 << 8) | 20, 4);
    record.writeUInt16LE(20, 6); record.writeUInt16LE(0x800, 8);
    record.writeUInt32LE(crc, 16); record.writeUInt32LE(bytes.length, 20);
    record.writeUInt32LE(bytes.length, 24); record.writeUInt16LE(name.length, 28);
    record.writeUInt32LE(((entry.mode ?? 0o100644) << 16) >>> 0, 38);
    record.writeUInt32LE(offset, 42);
    local.push(header, name, bytes); central.push(record, name);
    offset += header.length + name.length + bytes.length;
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50); end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, directory, end]);
}

async function fixture(t, {editReceipt, installerBytes} = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'w77-artifact-SOURCE-STAGING-')));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const candidateRoot = path.join(root, 'candidate');
  await fs.mkdir(path.join(candidateRoot, 'browser-slsa-provenance'), {recursive: true});
  const installer = installerBytes ?? Buffer.from('SOURCE/STAGING inert installer; never executable or signed');
  const receipt = {
    schema: 'metaengine.browser.package-slsa-provenance-receipt.v1',
    source_head: SOURCE, source_ref: `refs/heads/${BRANCH}`,
    event: 'push', workflow: WORKFLOW, run_id: Number(RUN), run_number: 123,
    run_attempt: Number(ATTEMPT), package_version: VERSION,
    installer_name: INSTALLER, installer_sha256: digest(installer),
    attestation_id: 'SOURCE_STAGING_NOT_A_LIVE_ATTESTATION',
    attestation_url: 'SOURCE_STAGING_NOT_A_LIVE_ATTESTATION',
    bundle_name: path.basename(BUNDLE),
    promotion_authorized: false, release_published: false, authority_effect: false,
  };
  if (editReceipt) editReceipt(receipt);
  const entries = [
    {name: INSTALLER, bytes: installer},
    {name: INVENTORY, bytes: Buffer.from('{"fixture_classification":"SOURCE_STAGING","inert_inventory":true}')},
    {name: BUNDLE, bytes: Buffer.from('{"fixture_classification":"SOURCE_STAGING","not_a_verified_bundle":true}')},
    {name: RECEIPT, bytes: Buffer.from(JSON.stringify(receipt))},
  ];
  for (const entry of entries) await fs.writeFile(path.join(candidateRoot, entry.name), entry.bytes);
  const archivePath = path.join(root, 'candidate.zip'), archive = zip(entries);
  await fs.writeFile(archivePath, archive);
  const args = {archivePath, archiveSha256: digest(archive), candidateRoot,
    sourceSha: SOURCE, version: VERSION, runId: RUN, attempt: ATTEMPT};
  return {root, candidateRoot, entries, archive, archivePath, args,
    verify: extra => verifyImmutableArtifactBytesW77({...args, ...extra})};
}

test('real ZIP and complete local membership bind all required handoff bytes without a trust claim', async t => {
  const f = await fixture(t), result = await f.verify();
  assert.equal(result.archive_sha256, f.args.archiveSha256);
  assert.equal(result.installer_sha256, digest(f.entries[0].bytes));
  assert.equal(result.package_code_sha256, digest(f.entries[1].bytes));
  assert.equal(result.bundle_sha256, digest(f.entries[2].bytes));
  assert.equal(result.receipt_sha256, digest(f.entries[3].bytes));
  assert.equal(result.full_archive_file_membership_verified, true);
  assert.equal(result.authority_effect, false);
  assert.notEqual(result.cryptographic_verification_claimed, true);
  assert.notEqual(result.gh_cryptographic_verification_executed, true);
  assert.notEqual(result.release_authorized, true);
  assert.equal(typeof result.fence, 'function');
  await result.fence();
});

test('installer larger than the bounded JSON-member ceiling uses complete streaming archive verification', async t => {
  const installerBytes = Buffer.alloc(32 * 1024 * 1024 + 1, 0x53);
  const f = await fixture(t, {installerBytes}), result = await f.verify();
  assert.equal(result.installer_sha256, digest(installerBytes));
  assert.equal(result.full_archive_file_membership_verified, true);
  assert.equal(result.authority_effect, false);
  await result.fence();
});

test('archive tampering fails its retained digest before accepting local files', async t => {
  const f = await fixture(t);
  const altered = Buffer.from(f.archive); altered[0] ^= 1;
  await fs.writeFile(f.archivePath, altered);
  await assert.rejects(f.verify(), /archive_digest_mismatch/);
});

test('retained fence rejects replacement of ZIP even when replacement bytes preserve its digest', async t => {
  const f = await fixture(t), result = await f.verify(), replacement = f.archivePath + '.replacement';
  await fs.writeFile(replacement, f.archive);
  await fs.rename(replacement, f.archivePath);
  await assert.rejects(result.fence(), /materialized_file_changed|archive_changed/);
});

for (const name of [INSTALLER, INVENTORY, BUNDLE, RECEIPT]) {
  test('local byte drift fails archive equality for ' + name, async t => {
    const f = await fixture(t), file = path.join(f.candidateRoot, name);
    const bytes = await fs.readFile(file); bytes[0] ^= 1;
    await fs.writeFile(file, bytes);
    await assert.rejects(f.verify(), /materialized_bytes_changed/);
  });
  test('missing required member fails for ' + name, async t => {
    const f = await fixture(t);
    await fs.unlink(path.join(f.candidateRoot, name));
    await assert.rejects(f.verify(), /materialized_entry_missing/);
  });
  test('retained fence rejects later replacement of ' + name, async t => {
    const f = await fixture(t), result = await f.verify();
    const file = path.join(f.candidateRoot, name), replacement = file + '.replacement';
    await fs.writeFile(replacement, await fs.readFile(file));
    await fs.rename(replacement, file);
    await assert.rejects(result.fence(), /materialized_(?:file|directory)_changed/);
  });
}

test('full archive membership rejects an unlisted local file', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.candidateRoot, 'unlisted-code.dll'), 'SOURCE/STAGING inert extra bytes');
  await assert.rejects(f.verify(), /materialized_unlisted_entry/);
});

test('full archive membership rejects an archive member missing locally', async t => {
  const f = await fixture(t), archive = zip([...f.entries, {name: 'extra-code.dll', bytes: 'inert'}]);
  await fs.writeFile(f.archivePath, archive);
  await assert.rejects(f.verify({archiveSha256: digest(archive)}), /materialized_entry_missing/);
});

test('a renamed installer cannot satisfy the fixed version-derived handoff', async t => {
  const f = await fixture(t), differentName = INSTALLER.replace(VERSION, '0.7.0-dev.999900004.1');
  const entries = f.entries.map(entry => entry.name === INSTALLER ? {...entry, name: differentName} : entry);
  await fs.rename(path.join(f.candidateRoot, INSTALLER), path.join(f.candidateRoot, differentName));
  const archive = zip(entries); await fs.writeFile(f.archivePath, archive);
  await assert.rejects(f.verify({archiveSha256: digest(archive)}));
});

for (const [label, editReceipt] of [
  ['source', r => { r.source_head = 'c'.repeat(40); }],
  ['run', r => { r.run_id += 1; }],
  ['attempt', r => { r.run_attempt += 1; }],
  ['installer digest', r => { r.installer_sha256 = 'c'.repeat(64); }],
  ['workflow', r => { r.workflow = '.github/workflows/other.yml'; }],
  ['authority', r => { r.authority_effect = true; }],
]) test('matching archive and files still reject foreign receipt ' + label, async t => {
  const f = await fixture(t, {editReceipt});
  await assert.rejects(f.verify(), /producer_receipt/);
});

test('local hardlinked file cannot become immutable handoff bytes', async t => {
  const f = await fixture(t), file = path.join(f.candidateRoot, INVENTORY);
  await fs.link(file, path.join(f.root, 'inventory-hardlink'));
  await assert.rejects(f.verify(), /materialized_regular_file_required|unsafe_artifact_path/);
});

test('local symlink cannot become immutable handoff bytes', async t => {
  const f = await fixture(t), file = path.join(f.candidateRoot, BUNDLE), outside = path.join(f.root, 'outside-bundle');
  await fs.rename(file, outside);
  try { await fs.symlink(outside, file, 'file'); }
  catch (error) {
    if (['EPERM', 'EACCES'].includes(error.code)) return t.skip('symlink creation unavailable');
    throw error;
  }
  await assert.rejects(f.verify(), /materialized_link_or_reparse|unsafe_artifact_path/);
});

test('archive symlink entry fails even with matching payload and outer digest', async t => {
  const f = await fixture(t), archive = zip(f.entries.map(entry => entry.name === INVENTORY
    ? {...entry, mode: 0o120777} : entry));
  await fs.writeFile(f.archivePath, archive);
  await assert.rejects(f.verify({archiveSha256: digest(archive)}), /link_or_special/);
});

for (const [label, prepared] of [
  ['absent input', undefined],
  ['null input', null],
  ['empty input', {}],
  ['verified booleans', {classification: 'VERIFIED_INPUTS_ONLY', verified: true,
    gh_cryptographic_verification_executed: true, full_archive_file_membership_verified: true}],
  ['complete-looking serialized input', {
    classification: 'VERIFIED_INPUTS_ONLY', source_sha: SOURCE, package_version: VERSION,
    exe_sha256: 'a'.repeat(64), signer_thumbprint: 'b'.repeat(40),
    installer_sha256: 'c'.repeat(64), slsa_bundle_sha256: 'd'.repeat(64),
    slsa_evidence_sha256: 'e'.repeat(64), package_code_sha256: 'f'.repeat(64),
    public_key_spki_sha256: 'a'.repeat(64), gh_cryptographic_verification_executed: true,
    full_archive_file_membership_verified: true, immutable_artifact: {
      producer_terminal_success: true, archive_sha256: 'b'.repeat(64),
    }, release_root_signing_available: false, production_sidecars_emitted: false,
    installed_placement_verified: false, release_authorized: false, authority_effect: false,
  }],
]) test('signing request rejects ' + label + ' without genuine in-process preflight custody', async () => {
  await assert.rejects(createReleaseRootSigningRequestW77(prepared),
    /w77_release_proof_independently_prepared_inputs_required/);
});

function cliArgs() {
  const root = path.resolve('SOURCE-STAGING-never-read');
  return ['--candidate-root', root, '--exe', path.join(root, 'METAENGINE Browser Test.exe'),
    '--source-sha', SOURCE, '--version', VERSION, '--run-id', RUN, '--attempt', ATTEMPT,
    '--artifact-id', ARTIFACT, '--archive', path.join(root, 'candidate.zip'), '--archive-sha256', 'b'.repeat(64)];
}

for (const option of ['--private-key', '--signer', '--fixture', '--api-host', '--api-base']) {
  test('CLI rejects unsupported option ' + option + ' before any preflight', async () => {
    const argv = cliArgs(); argv[0] = option;
    await assert.rejects(runReleaseProofPreflightCliW77(argv), /w77_release_proof_cli_arguments/);
  });
}

for (const [label, mutate] of [
  ['duplicate argument', argv => { argv[2] = argv[0]; }],
  ['missing argument pair', argv => { argv.splice(-2); }],
  ['extra argument pair', argv => { argv.push('--signer', 'SOURCE-STAGING-never-used'); }],
  ['single-dash option', argv => { argv[0] = '-candidate-root'; }],
  ['empty value', argv => { argv[1] = ''; }],
  ['option in value position', argv => { argv[1] = '--private-key'; }],
]) test('CLI rejects ' + label + ' before any preflight', async () => {
  const argv = cliArgs(); mutate(argv);
  await assert.rejects(runReleaseProofPreflightCliW77(argv), /w77_release_proof_cli_arguments/);
});

test('CLI refuses unsupported platform before filesystem, GitHub or verifier access', {
  skip: process.platform === 'win32' ? 'unsupported-platform refusal applies outside Windows' : false,
}, async () => {
  await assert.rejects(runReleaseProofPreflightCliW77(cliArgs()), /w77_release_proof_windows_only/);
});

test('actual CLI reports the stable argument refusal code and no stdout for rejected input', () => {
  const script = fileURLToPath(new URL('../scripts/release-proof-producer-w77.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [script, '--private-key', 'SOURCE-STAGING-never-read'], {
    encoding: 'utf8', shell: false, timeout: 10000, maxBuffer: 100000,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.equal(result.stderr, 'w77_release_proof_cli_arguments\n');
});
