// Build observations only. This is NOT a signing, native-custody or runtime-admission authority.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants} from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepare} from './prepare.mjs';

export const MAX_BINARY_BYTES = 536870912;
export const UPSTREAM = '3b01b36fa5eb96ba82a776bd3c2fc57f8969181f';
const UPSTREAM_TREE = 'd22150f47f6f6d6b1332583987e862981c951388';
const TARGET = 'x86_64-pc-windows-msvc';
const TOOLCHAIN = '1.95.0';
const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const build = path.join(repo, '.codex-effective-policy-build');
const source = path.join(build, 'source');
const privateRoot = path.join(build, 'windows-run');
const workflow = '.github/workflows/codex-effective-policy-windows-staging.yml';
const hex = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const same = (a, b, label) => assert.deepEqual(a, b, label);
const identity = s => ({dev: String(s.dev), ino: String(s.ino), nlink: s.nlink, size: s.size, mtime_ms: s.mtimeMs, ctime_ms: s.ctimeMs});
export const NO_MODEL_CASES = ['inspect_open_stdin', 'reject_nonce', 'reject_context', 'reject_unknown_field', 'reject_eof', 'reject_invalid_nonce', 'reject_disabled_exec_server', 'reject_remote_exec_server'];
export const PROMPT_CASES = ['exact_prompt_after_ack', 'ack_then_eof_without_original_prompt', 'duplicate_ack_rejected', 'tampered_prompt_rejected', 'wrong_original_digest_rejected', 'oversize_prompt_rejected', 'missing_digest_argument_rejected', 'malformed_digest_argument_rejected', 'fixed_deadline_before_ack', 'fixed_deadline_after_ack_before_prompt'];
const V8_MANIFEST = `rusty_v8_ptrcomp_sandbox_release_${TARGET}.sha256`;
const V8_NAMES = [`rusty_v8_ptrcomp_sandbox_release_${TARGET}.lib.gz`, `src_binding_ptrcomp_sandbox_release_${TARGET}.rs`];
const V8_MANIFEST_HASH = 'a4d6221dddb4b5724b23411eaac47caf6095489fbf9d126f65b33cef96a0a8ef';
const REMAINING = ['Authenticode/signing', 'SLSA/authorized attestation', 'clean reproducibility', 'native process/environment custody', 'Windows sandbox/Job cleanup/watchdog', 'production argv/configuration equivalence', 'full helper/resource packaging', 'package lock integration', 'runtime admission', 'installation'];

// Read only a bounded header; the whole executable is never buffered.
export function validatePe(header, size) {
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= MAX_BINARY_BYTES, 'binary size bound');
  assert.ok(header.length >= 64 && header.readUInt16LE(0) === 0x5a4d, 'MZ header');
  const pe = header.readUInt32LE(60);
  assert.ok(pe >= 64 && pe <= 65536 - 264 && pe + 264 <= header.length && pe + 264 <= size, 'PE offset/truncation');
  assert.equal(header.readUInt32LE(pe), 0x4550, 'PE signature');
  assert.equal(header.readUInt16LE(pe + 4), 0x8664, 'PE AMD64 machine');
  const sections = header.readUInt16LE(pe + 6), optional = header.readUInt16LE(pe + 20);
  assert.ok(sections > 0 && sections <= 96 && optional >= 240 && optional <= 4096, 'PE sections/optional header');
  const sectionEnd = pe + 24 + optional + sections * 40;
  assert.ok(sectionEnd <= size && sectionEnd <= header.length, 'PE section table truncation');
  const flags = header.readUInt16LE(pe + 22);
  assert.ok((flags & 2) !== 0 && (flags & 0x2000) === 0, 'PE must be executable, not DLL');
  assert.equal(header.readUInt16LE(pe + 24), 0x20b, 'PE32+ magic');
  const headersSize = header.readUInt32LE(pe + 24 + 60);
  assert.ok(headersSize >= sectionEnd && headersSize <= size, 'PE headers size');
  for (let i = 0; i < sections; i++) {
    const section = pe + 24 + optional + i * 40;
    const rawSize = header.readUInt32LE(section + 16), rawOffset = header.readUInt32LE(section + 20);
    assert.ok(rawSize === 0 || (rawOffset >= headersSize && rawOffset + rawSize <= size), 'PE section data truncation');
  }
  return {machine: 'AMD64:0x8664', format: 'PE32+', executable: true, dll: false};
}

async function openRegular(file, limit) {
  const name = path.resolve(file), before = await fs.lstat(name);
  assert.ok(before.isFile() && !before.isSymbolicLink(), 'regular nonlink file required');
  assert.equal(await fs.realpath(name), name, 'file path traverses link');
  assert.ok(before.size > 0 && before.size <= limit, 'file size bound');
  const handle = await fs.open(name, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try { same(identity(await handle.stat()), identity(before), 'file replaced during open'); }
  catch (error) { await handle.close(); throw error; }
  return {handle, before, name};
}

export async function inspectBinary(file, {pe = true, limit = MAX_BINARY_BYTES} = {}) {
  const {handle, before, name} = await openRegular(file, limit);
  try {
    let headerInfo = {};
    if (pe) {
      // Cargo 1.95 hardlinks root artifacts out of deps. Record links and detect drift;
      // this staging observation does not establish exclusive native file custody.
      const header = Buffer.alloc(Math.min(65536, before.size));
      const {bytesRead} = await handle.read(header, 0, header.length, 0);
      headerInfo = validatePe(header.subarray(0, bytesRead), before.size);
    }
    const digest = createHash('sha256'); let count = 0;
    for await (const chunk of handle.createReadStream({start: 0, end: before.size - 1, autoClose: false})) { digest.update(chunk); count += chunk.length; }
    same(count, before.size, 'file truncated during hash');
    same(identity(await handle.stat()), identity(before), 'file drift during hash');
    same(identity(await fs.lstat(name)), identity(before), 'file replaced during hash');
    return {size_bytes: before.size, sha256: digest.digest('hex'), ...headerInfo, file_identity: identity(before)};
  } finally { await handle.close(); }
}
async function bytes(file, limit = 1024 * 1024) {
  const {handle, before, name} = await openRegular(file, limit);
  try {
    const value = Buffer.alloc(before.size); let offset = 0;
    while (offset < value.length) {
      const {bytesRead} = await handle.read(value, offset, value.length - offset, offset);
      assert.ok(bytesRead > 0, 'metadata truncated'); offset += bytesRead;
    }
    same(identity(await handle.stat()), identity(before), 'metadata drift');
    same(identity(await fs.lstat(name)), identity(before), 'metadata replaced');
    return value;
  } finally { await handle.close(); }
}
const readJson = async file => JSON.parse((await bytes(file, 65536)).toString('utf8'));
const digestFile = async (file, limit) => (await inspectBinary(file, {pe: false, limit})).sha256;
const select = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
function exactCases(summary, names) {
  assert.ok(Array.isArray(summary.cases), 'missing cases');
  same(summary.cases.map(c => c.name).sort(), [...names].sort(), 'missing/duplicate/unexpected case');
}
function common(summary, image) {
  same(summary.platform, 'win32'); same(summary.upstream_commit, UPSTREAM);
  same(summary.binary_sha256, image.sha256); assert.match(image.sha256, hex);
  same(summary.native_process_custody_qualified, false); same(summary.windows_binary_qualified, false);
}

export function validateProbes(noModel, prompt, image) {
  common(noModel, image); common(prompt, image);
  same(noModel.status, 'NO_MODEL_BARRIER_CHECKS_PASS'); same(noModel.binary_kind, 'cli');
  same(prompt.status, 'ROOT_PROMPT_TRANSPORT_CHECKS_PASS'); same(prompt.binary_kind, 'root codex --no-daemon exec');
  exactCases(noModel, NO_MODEL_CASES); exactCases(prompt, PROMPT_CASES);
  same(noModel.model_response_requests, 0);
  for (const c of noModel.cases) {
    for (const key of ['model_requests', 'task_bytes_sent', 'http_requests']) same(c[key], 0, key);
    assert.ok(Number.isInteger(c.exit_code) && (c.name === NO_MODEL_CASES[0] ? c.exit_code === 0 : c.exit_code !== 0), 'no-model exit');
    same(c.policy_events, NO_MODEL_CASES.indexOf(c.name) < 5 ? 1 : 0);
  }
  for (const key of ['real_model_calls', 'pre_ack_http_or_websocket_requests', 'pre_ack_tcp_connections', 'orphan_fixture_traffic']) same(prompt[key], 0, key);
  same(prompt.mock_model_post_requests, 1);
  assert.match(prompt.original_prompt_sha256, hex);
  for (const c of prompt.cases) {
    for (const key of ['pre_ack_http_or_websocket_requests', 'pre_ack_tcp_connections', 'websocket_requests', 'deadline_resets']) same(c[key], 0, key);
    const success = c.name === PROMPT_CASES[0], deadline = c.name.startsWith('fixed_deadline_');
    same(c.model_post_requests, success ? 1 : 0); same(c.deadline_expired, deadline);
    same(c.original_prompt_sha256, prompt.original_prompt_sha256);
    if (c.name === 'fixed_deadline_before_ack') assert.ok(c.policy_events === 0 || c.policy_events === 1, 'policy event count');
    else same(c.policy_events, ['missing_digest_argument_rejected', 'malformed_digest_argument_rejected'].includes(c.name) ? 0 : 1, 'policy event count');
    for (const key of ['post_ack_http_requests', 'tcp_connections']) assert.ok(Number.isInteger(c[key]) && (success ? c[key] >= 1 : c[key] === 0), key);
    if (!deadline) {
      same(c.signal, null);
      assert.ok(Number.isInteger(c.exit_code) && (success ? c.exit_code === 0 : c.exit_code !== 0), 'prompt exit');
    } else {
      assert.ok(c.signal === null || c.signal === 'SIGKILL', 'deadline termination signal');
      assert.ok((Number.isInteger(c.exit_code) && c.exit_code !== 0) || (c.exit_code === null && c.signal === 'SIGKILL'), 'deadline must terminate child');
    }
    if (success) same(c.transmitted_prompt_sha256, prompt.original_prompt_sha256);
  }
  // Closed output projection: no fixture paths, environment, raw stdout or request bodies.
  const baseKeys = ['status', 'platform', 'binary_kind', 'binary_sha256', 'upstream_commit', 'native_process_custody_qualified', 'windows_binary_qualified'];
  return {
    no_model: {...select(noModel, [...baseKeys, 'model_response_requests']), cases: noModel.cases.map(c => select(c, ['name', 'exit_code', 'policy_events', 'http_requests', 'model_requests', 'task_bytes_sent']))},
    prompt: {...select(prompt, [...baseKeys, 'original_prompt_sha256', 'real_model_calls', 'mock_model_post_requests', 'pre_ack_http_or_websocket_requests', 'pre_ack_tcp_connections', 'orphan_fixture_traffic']), cases: prompt.cases.map(c => select(c, ['name', 'exit_code', 'signal', 'transmitted_prompt_sha256', 'policy_events', 'deadline_expired', 'deadline_resets', 'model_post_requests', 'post_ack_http_requests', 'websocket_requests', 'tcp_connections', 'pre_ack_http_or_websocket_requests', 'pre_ack_tcp_connections']))},
  };
}

function command(executable, args, cwd = repo) {
  const result = spawnSync(executable, args, {cwd, encoding: 'utf8', shell: false, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024});
  assert.ok(!result.error && result.status === 0, `identity command failed: ${path.basename(executable)}`);
  return result.stdout.trim();
}
function required(name, pattern = /^[^\r\n\x00]{1,300}$/) {
  const value = process.env[name]; assert.match(value ?? '', pattern, `missing/invalid ${name}`); return value;
}
export function validateMetadata(value) {
  assert.equal(value.schema, 'metaengine.codex.windows-build-inputs.v1');
  for (const key of ['head', 'tree']) assert.match(value.compute[key] ?? '', /^[a-f0-9]{40}$/);
  same(value.upstream.commit, UPSTREAM); same(value.upstream.tree, UPSTREAM_TREE);
  same(value.build, {target: TARGET, profile: 'release', cwd: '.codex-effective-policy-build/source/codex-rs', argv: ['cargo', '+1.95.0', 'build', '--locked', '--release', '--target', TARGET, '-p', 'codex-cli', '--bin', 'codex']});
  for (const key of ['source_pin_sha256', 'inputs_sha256', 'normalized_lock_sha256']) assert.match(value[key] ?? '', hex);
  for (const group of ['source_files', 'upstream_files', 'v8']) {
    assert.ok(value[group] && Object.keys(value[group]).length > 0, `missing ${group}`);
    for (const digest of Object.values(value[group])) assert.match(digest, hex);
  }
  for (const key of ['rustc', 'cargo', 'linker', 'node']) assert.match(value.tools[key]?.sha256 ?? '', hex);
  assert.match(value.tools.rustc.version ?? '', /^rustc 1\.95\.0 /);
  assert.match(value.tools.cargo.version ?? '', /^cargo 1\.95\.0 /);
  same(value.tools.node.version, 'v24.21.0');
  for (const key of ['sdk', 'ucrt', 'image_os', 'image_version']) assert.match(value.runner[key] ?? '', /^[^\r\n\x00]{1,300}$/);
  same(value.run.repository, 'PatrickFrome/Compute'); same(value.run.sha, value.compute.head);
  for (const key of ['id', 'attempt']) assert.match(value.run[key] ?? '', /^[1-9][0-9]*$/);
  assert.match(value.run.ref ?? '', /^refs\/heads\/[A-Za-z0-9_./-]+$/);
  same(value.run.workflow_ref, `${value.run.repository}/${workflow}@${value.run.ref}`);
  return value;
}

async function collectMetadata() {
  assert.equal(process.platform, 'win32'); assert.equal(process.arch, 'x64');
  for (const key of Object.keys(process.env)) assert.ok(!/^(RUSTFLAGS|RUSTC|RUSTDOC|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_.*|CARGO_PROFILE_.*|CARGO_TARGET_.*_RUSTFLAGS|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER)$/i.test(key), 'unapproved Rust flags/wrapper');
  same(required('RUSTUP_TOOLCHAIN'), TOOLCHAIN); same(required('LIBSQLITE3_FLAGS'), 'SQLITE_DISABLE_INTRINSIC');
  same(required('CARGO_INCREMENTAL'), '0');
  for (const name of ['config', 'config.toml']) {
    assert.equal(await fs.lstat(path.join(required('CARGO_HOME'), name)).catch(error => { if (error.code === 'ENOENT') return null; throw error; }), null, 'unexpected Cargo home config');
  }
  same(required('STABLE_GIT_COMMIT'), UPSTREAM);
  const git = args => command('git', ['-c', 'core.hooksPath=', '-c', 'core.fsmonitor=false', ...args]);
  const [head, tree] = git(['rev-parse', 'HEAD', 'HEAD^{tree}']).split(/\r?\n/);
  same(head, required('GITHUB_SHA'), 'checkout differs from run source');
  same(git(['status', '--porcelain', '--untracked-files=all']), '', 'Compute checkout is dirty');
  const prepared = await prepare({check: true});
  const pinBytes = await bytes(path.join(here, 'source-pin.json'));
  const pin = JSON.parse(pinBytes); same(pin.commit, UPSTREAM); same(pin.tree, UPSTREAM_TREE); same(pin.rust_toolchain, TOOLCHAIN);
  const sourceFiles = {};
  for (const name of [...Object.keys(pin.inputs), 'prepare.mjs', 'windows-staging.mjs', 'test/no-model-probe.mjs', 'test/root-prompt-transport-probe.mjs', 'test/prepare.test.mjs', 'test/windows-staging.test.mjs']) sourceFiles[name] = await digestFile(path.join(here, name));
  sourceFiles[workflow] = await digestFile(path.join(repo, workflow));
  const upstreamFiles = {};
  for (const name of ['codex-rs/Cargo.toml', 'codex-rs/rust-toolchain.toml', 'codex-rs/.cargo/config.toml', '.github/actions/setup-msvc-env/setup-msvc-env.ps1', 'third_party/v8/rusty_v8_150_4_0_release_manifests.sha256']) upstreamFiles[name] = await digestFile(path.join(source, name));
  const lock = await digestFile(path.join(source, 'codex-rs/Cargo.lock')); same(lock, pin.workspace_lock.normalized_sha256);
  const v8 = {}, manifestBytes = await bytes(path.join(build, 'v8', V8_MANIFEST), 65536);
  v8[V8_MANIFEST] = hash(manifestBytes); same(v8[V8_MANIFEST], V8_MANIFEST_HASH);
  const entries = manifestBytes.toString('utf8').trimEnd().split(/\r?\n/).map(line => /^([a-f0-9]{64})  ([^\s/\\]+)$/.exec(line));
  assert.ok(entries.every(Boolean)); same(entries.map(e => e[2]).sort(), [...V8_NAMES].sort());
  for (const entry of entries) { v8[entry[2]] = await digestFile(path.join(build, 'v8', entry[2]), 1073741824); same(v8[entry[2]], entry[1]); }
  same(path.resolve(required('RUSTY_V8_ARCHIVE')), path.join(build, 'v8', V8_NAMES[0]));
  same(path.resolve(required('RUSTY_V8_SRC_BINDING_PATH')), path.join(build, 'v8', V8_NAMES[1]));
  const tools = {};
  for (const name of ['rustc', 'cargo']) {
    const executable = command('rustup', ['which', '--toolchain', TOOLCHAIN, name]);
    tools[name] = {sha256: await digestFile(executable), version: command(executable, [name === 'rustc' ? '-vV' : '--version'])};
  }
  assert.ok(tools.rustc.version.includes(`host: ${TARGET}`), 'rustc host mismatch');
  tools.linker = {sha256: await digestFile(required('CARGO_TARGET_X86_64_PC_WINDOWS_MSVC_LINKER'))};
  tools.node = {sha256: await digestFile(process.execPath), version: process.version};
  return validateMetadata({schema: 'metaengine.codex.windows-build-inputs.v1', compute: {head, tree}, upstream: {commit: pin.commit, tree: pin.tree},
    source_pin_sha256: hash(pinBytes), inputs_sha256: prepared.inputs_sha256, normalized_lock_sha256: lock, source_files: sourceFiles, upstream_files: upstreamFiles, v8,
    build: {target: TARGET, profile: 'release', cwd: '.codex-effective-policy-build/source/codex-rs', argv: ['cargo', '+1.95.0', 'build', '--locked', '--release', '--target', TARGET, '-p', 'codex-cli', '--bin', 'codex']}, tools,
    runner: {sdk: required('WindowsSDKVersion'), ucrt: required('UCRTVersion'), image_os: required('ImageOS'), image_version: required('ImageVersion')},
    run: {repository: required('GITHUB_REPOSITORY'), sha: required('GITHUB_SHA'), ref: required('GITHUB_REF'), id: required('GITHUB_RUN_ID'), attempt: required('GITHUB_RUN_ATTEMPT'), workflow_ref: required('GITHUB_WORKFLOW_REF')}});
}

export async function stageArtifact({binary, before, metadata, currentMetadata, noModel, prompt, destination}) {
  validateMetadata(metadata); validateMetadata(currentMetadata); same(metadata, currentMetadata, 'build inputs changed');
  const after = await inspectBinary(binary); same(after, before, 'binary changed since pre-probe inspection');
  const sanitized = validateProbes(noModel, prompt, before);
  // Validate everything before creating output. A failure removes only the new directory we own.
  await fs.mkdir(destination);
  try {
    await fs.copyFile(binary, path.join(destination, 'codex.exe'), constants.COPYFILE_EXCL);
    const copy = await inspectBinary(path.join(destination, 'codex.exe'));
    same(copy.sha256, before.sha256); same(copy.size_bytes, before.size_bytes);
    same(await inspectBinary(binary), before, 'binary changed during copy');
    for (const name of ['LICENSE', 'NOTICE', 'upstream.patch', 'source-pin.json']) {
      const content = await bytes(path.join(here, name));
      same(hash(content), name === 'source-pin.json' ? metadata.source_pin_sha256 : metadata.source_files[name], 'staged source drift');
      await fs.writeFile(path.join(destination, name), content, {flag: 'wx'});
    }
    const summaryHashes = {};
    for (const [name, value] of Object.entries(sanitized)) {
      const content = json(value); summaryHashes[name] = hash(content);
      await fs.writeFile(path.join(destination, `${name}.json`), content, {flag: 'wx'});
    }
    const receipt = {status: 'OBSERVED_BUILD_AND_PROTOCOL_STAGING', ...metadata,
      schema: 'metaengine.codex.windows-staging.v1', binary: {before, after, staged_sha256: copy.sha256}, summaries_sha256: summaryHashes,
      scope: 'Root CLI only; Cargo hardlinks permitted, not exclusive file custody. Configured loopback provider observations, not general OS egress or full-prompt-without-EOF hold. Node child termination is not Job/descendant cleanup proof.',
      qualified: false, not_qualified: REMAINING, future_overlay: 'Any changed policy overlay/input requires a new exact build/probe artifact and identity review.'};
    await fs.writeFile(path.join(destination, 'receipt.json'), json(receipt), {flag: 'wx'});
    return receipt;
  } catch (error) { await fs.rm(destination, {recursive: true, force: true}); throw error; }
}

async function main(mode) {
  assert.ok(['record', 'inspect', 'stage'].includes(mode), 'usage: windows-staging.mjs record|inspect|stage');
  const currentMetadata = await collectMetadata();
  if (mode === 'record') {
    await fs.mkdir(privateRoot); // Refuse stale receipts and fixture logs.
    await fs.writeFile(path.join(privateRoot, 'metadata.json'), json(currentMetadata), {flag: 'wx'});
  } else {
    const metadata = await readJson(path.join(privateRoot, 'metadata.json'));
    same(metadata, currentMetadata, 'build metadata drift');
    const binary = path.join(required('CARGO_TARGET_DIR'), TARGET, 'release/codex.exe');
    if (mode === 'inspect') await fs.writeFile(path.join(privateRoot, 'before.json'), json(await inspectBinary(binary)), {flag: 'wx'});
    else await stageArtifact({binary, before: await readJson(path.join(privateRoot, 'before.json')), metadata, currentMetadata,
      noModel: await readJson(path.join(privateRoot, 'no-model.json')), prompt: await readJson(path.join(privateRoot, 'prompt.json')), destination: path.join(build, 'staging')});
  }
  console.log(JSON.stringify({status: `${mode.toUpperCase()}_PASS`, windows_qualified: false, runtime_admission: 'CLOSED'}));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.length === 3 ? process.argv[2] : '').catch(error => {
    console.error(JSON.stringify({status: 'STAGING_FAILED', reason: String(error.message).split('\n')[0].slice(0, 200), qualified: false})); process.exitCode = 1;
  });
}
