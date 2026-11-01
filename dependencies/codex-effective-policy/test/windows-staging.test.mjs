// Hermetic SYNTHETIC PE/summary tests; these do not build or qualify a Windows binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {MAX_BINARY_BYTES, UPSTREAM, NO_MODEL_CASES, PROMPT_CASES, validatePe, inspectBinary, validateProbes, validateMetadata, stageArtifact} from '../windows-staging.mjs';

const here = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(here, '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sha = 'a'.repeat(64), head = 'b'.repeat(40), tree = 'c'.repeat(40);
function syntheticPe() {
  const data = Buffer.alloc(1024), pe = 128;
  data.writeUInt16LE(0x5a4d); data.writeUInt32LE(pe, 60); data.writeUInt32LE(0x4550, pe);
  data.writeUInt16LE(0x8664, pe + 4); data.writeUInt16LE(1, pe + 6); data.writeUInt16LE(240, pe + 20);
  data.writeUInt16LE(2, pe + 22); data.writeUInt16LE(0x20b, pe + 24); data.writeUInt32LE(512, pe + 24 + 60);
  data.writeUInt32LE(512, pe + 24 + 240 + 16); data.writeUInt32LE(512, pe + 24 + 240 + 20);
  return data;
}
function syntheticSummaries(imageSha = sha) {
  const common = {platform: 'win32', upstream_commit: UPSTREAM, binary_sha256: imageSha, native_process_custody_qualified: false, windows_binary_qualified: false, evidence_directory: 'PRIVATE_MUST_NOT_BE_STAGED'};
  return {
    noModel: {...common, status: 'NO_MODEL_BARRIER_CHECKS_PASS', binary_kind: 'cli', model_response_requests: 0,
      cases: NO_MODEL_CASES.map((name, i) => ({name, exit_code: i === 0 ? 0 : 1, policy_events: i < 5 ? 1 : 0, http_requests: 0, model_requests: 0, task_bytes_sent: 0, nonce: 'PRIVATE_NONCE'}))},
    prompt: {...common, status: 'ROOT_PROMPT_TRANSPORT_CHECKS_PASS', binary_kind: 'root codex --no-daemon exec', original_prompt_sha256: sha,
      real_model_calls: 0, mock_model_post_requests: 1, pre_ack_http_or_websocket_requests: 0, pre_ack_tcp_connections: 0, orphan_fixture_traffic: 0,
      cases: PROMPT_CASES.map((name, i) => ({name, exit_code: i === 0 ? 0 : i >= 8 ? null : 1, signal: i >= 8 ? 'SIGKILL' : null, original_prompt_sha256: sha,
        transmitted_prompt_sha256: i === 0 ? sha : null, policy_events: i === 6 || i === 7 ? 0 : 1, deadline_expired: i >= 8, deadline_resets: 0,
        model_post_requests: i === 0 ? 1 : 0, post_ack_http_requests: i === 0 ? 1 : 0, tcp_connections: i === 0 ? 1 : 0,
        pre_ack_http_or_websocket_requests: 0, pre_ack_tcp_connections: 0, websocket_requests: 0}))},
  };
}
async function syntheticMetadata() {
  const pinBytes = await fs.readFile(path.join(here, 'source-pin.json')), pin = JSON.parse(pinBytes);
  const sourceFiles = {};
  for (const name of Object.keys(pin.inputs)) sourceFiles[name] = digest(await fs.readFile(path.join(here, name)));
  return {schema: 'metaengine.codex.windows-build-inputs.v1', compute: {head, tree}, upstream: {commit: UPSTREAM, tree: pin.tree}, source_pin_sha256: digest(pinBytes),
    inputs_sha256: digest(JSON.stringify(pin.inputs)), normalized_lock_sha256: pin.workspace_lock.normalized_sha256,
    source_files: sourceFiles, upstream_files: {'SYNTHETIC_METADATA': sha}, v8: {'SYNTHETIC_METADATA': sha},
    tools: {rustc: {sha256: sha, version: 'rustc 1.95.0 SYNTHETIC'}, cargo: {sha256: sha, version: 'cargo 1.95.0 SYNTHETIC'}, linker: {sha256: sha}, node: {sha256: sha, version: 'v24.21.0'}},
    build: {target: 'x86_64-pc-windows-msvc', profile: 'release', cwd: '.codex-effective-policy-build/source/codex-rs', argv: ['cargo', '+1.95.0', 'build', '--locked', '--release', '--target', 'x86_64-pc-windows-msvc', '-p', 'codex-cli', '--bin', 'codex']},
    runner: {sdk: 'SYNTHETIC', ucrt: 'SYNTHETIC', image_os: 'SYNTHETIC', image_version: 'SYNTHETIC'},
    run: {repository: 'PatrickFrome/Compute', sha: head, ref: 'refs/heads/synthetic', id: '1', attempt: '1', workflow_ref: 'PatrickFrome/Compute/.github/workflows/codex-effective-policy-windows-staging.yml@refs/heads/synthetic'}};
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codex-synthetic-staging-'));
  t.after(() => fs.rm(root, {recursive: true, force: true}));
  const binary = path.join(root, 'SYNTHETIC-NOT-EXECUTABLE.exe'); await fs.writeFile(binary, syntheticPe());
  const before = await inspectBinary(binary), metadata = await syntheticMetadata();
  return {root, binary, before, metadata, currentMetadata: structuredClone(metadata), ...syntheticSummaries(before.sha256), destination: path.join(root, 'synthetic-output')};
}

test('synthetic AMD64 PE32+ header and unchanged 512 MiB bound', () => {
  assert.equal(validatePe(syntheticPe(), 1024).machine, 'AMD64:0x8664'); assert.equal(MAX_BINARY_BYTES, 536870912);
});
for (const [name, mutate, size] of [
  ['zero', () => {}, 0], ['oversize', () => {}, MAX_BINARY_BYTES + 1],
  ['ELF', b => b.writeUInt16LE(0x457f), 1024], ['bad offset', b => b.writeUInt32LE(0xffffffff, 60), 1024],
  ['x86', b => b.writeUInt16LE(0x14c, 132), 1024], ['ARM64', b => b.writeUInt16LE(0xaa64, 132), 1024],
  ['signature', b => b.writeUInt32LE(0, 128), 1024], ['DLL', b => b.writeUInt16LE(0x2002, 150), 1024],
  ['not executable', b => b.writeUInt16LE(0, 150), 1024], ['PE32', b => b.writeUInt16LE(0x10b, 152), 1024],
  ['optional header', b => b.writeUInt16LE(2, 148), 1024], ['sections', b => b.writeUInt16LE(0, 134), 1024],
  ['section table', b => b.writeUInt16LE(96, 134), 1024], ['headers size', b => b.writeUInt32LE(0xffffffff, 212), 1024],
  ['section raw data', b => b.writeUInt32LE(0xffffffff, 412), 1024],
]) test(`PE refuses ${name}`, () => {const b = syntheticPe(); mutate(b); assert.throws(() => validatePe(b, size));});
test('PE refuses short header before offset reads', () => {for (const n of [0, 2, 63, 100, 391]) assert.throws(() => validatePe(syntheticPe().subarray(0, n), 1024));});
test('binary inspection streams real file bytes; rejects directory, link and sparse oversize', async t => {
  const f = await fixture(t); assert.equal(f.before.sha256, digest(syntheticPe()));
  await assert.rejects(inspectBinary(f.root));
  const link = path.join(f.root, 'link.exe');
  // File symlinks require developer mode on Windows; a junction to a directory tests the same lstat rejection there.
  await fs.symlink(process.platform === 'win32' ? f.root : f.binary, link, process.platform === 'win32' ? 'junction' : 'file');
  await assert.rejects(inspectBinary(link));
  await fs.truncate(f.binary, MAX_BINARY_BYTES + 1); await assert.rejects(inspectBinary(f.binary), /size bound/);
});
test('Cargo-style hardlinked artifact is inspected, but mutation through its alias refuses staging', async t => {
  const f = await fixture(t), alias = path.join(f.root, 'deps-root.exe'); await fs.link(f.binary, alias);
  f.before = await inspectBinary(f.binary); assert.equal(f.before.file_identity.nlink, 2); assert.equal(f.before.sha256, digest(syntheticPe()));
  await fs.appendFile(alias, 'changed through Cargo alias');
  await assert.rejects(stageArtifact(f), /binary changed/); await assert.rejects(fs.stat(f.destination), {code: 'ENOENT'});
});
test('summary projection removes all private paths/nonces and preserves nonqualification', () => {
  const {noModel, prompt} = syntheticSummaries(); const value = validateProbes(noModel, prompt, {sha256: sha});
  assert.equal(value.no_model.cases.length, 8); assert.equal(value.prompt.cases.length, 10);
  assert.ok(!JSON.stringify(value).includes('PRIVATE')); assert.equal(value.prompt.windows_binary_qualified, false);
});
for (const [name, mutate] of [
  ['wrong hash', f => f.noModel.binary_sha256 = 'd'.repeat(64)], ['Linux', f => f.prompt.platform = 'linux'],
  ['legacy red', f => f.prompt.status = 'EXPECTED_LEGACY_DUPLICATE_ACK_CONTAMINATION_REPRODUCED'],
  ['missing case', f => f.noModel.cases.pop()], ['duplicate case', f => f.prompt.cases[1] = {...f.prompt.cases[0]}],
  ['missing field', f => delete f.noModel.model_response_requests], ['network', f => f.noModel.cases[1].http_requests = 1],
  ['task bytes', f => f.noModel.cases[1].task_bytes_sent = 1], ['model traffic', f => f.prompt.cases[1].model_post_requests = 1],
  ['pre ACK TCP', f => f.prompt.cases[0].pre_ack_tcp_connections = 1], ['orphan', f => f.prompt.orphan_fixture_traffic = 1],
  ['invented qualification', f => f.prompt.windows_binary_qualified = true], ['wrong prompt', f => f.prompt.cases[0].transmitted_prompt_sha256 = 'e'.repeat(64)],
  ['deadline restart', f => f.prompt.cases[9].deadline_resets = 1], ['failed success', f => f.prompt.cases[0].exit_code = 1],
  ['success without policy', f => f.prompt.cases[0].policy_events = 0], ['malformed digest with policy', f => f.prompt.cases[7].policy_events = 1],
  ['deadline without termination', f => {delete f.prompt.cases[9].exit_code; delete f.prompt.cases[9].signal;}],
  ['deadline null without signal', f => f.prompt.cases[9].signal = null],
]) test(`probe summaries refuse ${name}`, () => {const f = syntheticSummaries(); mutate(f); assert.throws(() => validateProbes(f.noModel, f.prompt, {sha256: sha}));});
for (const [name, mutate] of [
  ['wrong source', f => f.compute.head = tree], ['missing tree', f => delete f.compute.tree], ['wrong upstream', f => f.upstream.commit = head],
  ['debug build', f => f.build.profile = 'debug'], ['missing locked', f => f.build.argv.splice(3, 1)], ['missing tool', f => delete f.tools.linker],
  ['wrong compiler', f => f.tools.rustc.version = 'rustc 1.96.0'], ['missing SDK', f => delete f.runner.sdk], ['wrong workflow', f => f.run.workflow_ref = 'unbound'],
]) test(`build metadata refuses ${name}`, async () => {const f = await syntheticMetadata(); mutate(f); assert.throws(() => validateMetadata(f));});
test('synthetic staging allowlist, hashes, nonqualification and no overwrite', async t => {
  const f = await fixture(t), receipt = await stageArtifact(f);
  assert.deepEqual((await fs.readdir(f.destination)).sort(), ['LICENSE', 'NOTICE', 'codex.exe', 'no_model.json', 'prompt.json', 'receipt.json', 'source-pin.json', 'upstream.patch'].sort());
  assert.equal(receipt.qualified, false); assert.ok(receipt.not_qualified.includes('runtime admission')); assert.match(receipt.future_overlay, /new exact build/);
  assert.equal(receipt.binary.staged_sha256, digest(syntheticPe()));
  for (const name of ['no_model', 'prompt']) assert.equal(receipt.summaries_sha256[name], digest(await fs.readFile(path.join(f.destination, `${name}.json`))));
  await assert.rejects(stageArtifact(f), /EEXIST/); assert.ok(await fs.stat(path.join(f.destination, 'receipt.json')));
});
for (const failure of ['image drift', 'input drift', 'summary failure', 'staged source drift']) test(`${failure} cannot leave a staged artifact`, async t => {
  const f = await fixture(t);
  if (failure === 'image drift') await fs.appendFile(f.binary, 'changed');
  if (failure === 'input drift') f.currentMetadata.source_pin_sha256 = 'd'.repeat(64);
  if (failure === 'summary failure') f.prompt.cases.pop();
  if (failure === 'staged source drift') {f.metadata.source_pin_sha256 = 'd'.repeat(64); f.currentMetadata = structuredClone(f.metadata);}
  await assert.rejects(stageArtifact(f)); await assert.rejects(fs.stat(f.destination), {code: 'ENOENT'});
});
test('real CLI refuses Linux without staging (pure tests remain portable)', {skip: process.platform === 'win32'}, () => {
  const result = spawnSync(process.execPath, [path.join(here, 'windows-staging.mjs'), 'record'], {encoding: 'utf8', env: {PATH: process.env.PATH}, timeout: 10000});
  assert.equal(result.status, 1); assert.match(result.stderr, /STAGING_FAILED/);
});
test('workflow source pins, least privilege, exact release cwd and success-only allowlisted upload', async () => {
  const text = await fs.readFile(path.join(repo, '.github/workflows/codex-effective-policy-windows-staging.yml'), 'utf8');
  assert.match(text, /permissions:\n  contents: read\n/); assert.equal((text.match(/permissions:/g) ?? []).length, 1);
  assert.match(text, /runs-on: windows-2025/); assert.match(text, /timeout-minutes: 90/);
  const actions = [...text.matchAll(/uses: ([^\s]+)/g)].map(m => m[1]);
  assert.deepEqual(actions, ['actions/checkout@9c091bb21b7c1c1d1991bb908d89e4e9dddfe3e0', 'actions/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020', 'dtolnay/rust-toolchain@e081816240890017053eacbb1bdf337761dc5582', 'actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a']);
  assert.match(text, /persist-credentials: false/); assert.match(text, /set-safe-directory: false/);
  assert.match(text, /working-directory: \.codex-effective-policy-build\/source\/codex-rs/);
  assert.match(text, /cargo \+1\.95\.0 build --locked --release --target x86_64-pc-windows-msvc -p codex-cli --bin codex/);
  assert.match(text, /path: \.codex-effective-policy-build\/staging\/\*/); assert.match(text, /overwrite: false/);
  assert.match(text, /if-no-files-found: error/); assert.match(text, /node-version: 24\.21\.0/);
  assert.doesNotMatch(text, /secrets\.|id-token:|attestations:|write-all|contents: write|pull_request_target|schedule:|always\(\)|continue-on-error:|reserve.*version|gh release|cargo update|--manifest-path|RUSTFLAGS:/);
  for (const probe of ['no-model-probe.mjs', 'root-prompt-transport-probe.mjs']) assert.ok(text.includes(probe));
  assert.doesNotMatch(text, /root-bootstrap-probe|joint-root-policy|legacy-red/);
});
