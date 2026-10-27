#!/usr/bin/env node
// Independently materialize one immutable historical QA installer on a new
// GitHub-hosted Windows runner. This is not an installer producer or updater.
// All installation authority lives in the guarded entry below; exported source
// validators/filesystem tests cannot emit a physical qualification by themselves.
import fs from 'node:fs/promises';
import { constants, createReadStream } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify, parseArgs, isDeepStrictEqual } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const exec = promisify(execFile), require = createRequire(import.meta.url);
const SHA = /^[a-f0-9]{64}$/, HEAD = /^[a-f0-9]{40}$/, ID = /^[1-9][0-9]{0,19}$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => record(value) && Object.keys(value).sort().join('\0') === [...keys].sort().join('\0');
const fail = code => { const e = new Error('predecessor_materialization_' + code); e.code = e.message; throw e; };
const script = name => fileURLToPath(new URL(name, import.meta.url));
const TREE_SCHEMA = 'metaengine.browser.qa-installed-tree-fingerprint.v1';
const MAX_BYTES = 12 * 1024 ** 3, MAX_FILES = 25000;
export const PREDECESSOR_MATERIALIZATION_SCHEMA = 'metaengine.browser.predecessor-materialization.v1';
export const PREDECESSOR_QUALIFIER_WORKFLOW = '.github/workflows/browser-windows-predecessor-qualification.yml';
export const PREDECESSOR_QUALIFIER_REFS = Object.freeze([
  'refs/heads/work/preinstall-closure-20261027', 'refs/heads/work/preinstall-shared-inputs-20261027',
]);
export const PREDECESSOR_UNINSTALLER = 'Uninstall METAENGINE Browser Test.exe';
export const PREDECESSOR_DETACHED_PROOFS = Object.freeze([
  'metaengine-installed-release-proof.v2.json',
  'installer-slsa-provenance.bundle.json',
  'browser-package-slsa-provenance-evidence.json',
  'metaengine-installed-package-code.v1.json',
]);
export const ORIGINAL_PREDECESSOR = Object.freeze({
  repository: 'PatrickFrome/Compute',
  source_head: '601532ca50db02aa9089783dde157a93f484adf2',
  package_version: '0.7.0-dev.1784381341133.1',
  workflow: '.github/workflows/browser-windows-package-smoke.yml',
  run_id: '40382079975', run_number: 3927, run_attempt: 1, event: 'pull_request',
  artifact_id: '12679249312',
  artifact_name: 'metaengine-browser-windows-candidate-601532ca50db02aa9089783dde157a93f484adf2',
  artifact_sha256: '28126ee94d99c59040b1e2f5f215556d148da3f1933198ced5919323ce0881f4',
  artifact_bytes: 257692297,
  installer_name: 'METAENGINE-Browser-Test-Setup-0.7.0-dev.1784381341133.1-x64.exe',
  installer_sha256: '018cc4a4adf515b5cfc2b829b765aa14d171eaf1bf0e72ebd6e822df1f52d0dd',
  installer_bytes: 253438108,
  package_code_sha256: '6ad0cf0b0af0affd77888c6881e83784027ecd4a6be7711a656169822c8214c9',
  builder_config_source_path: 'apps/metaengine-browser/electron-builder.test.json',
  builder_config_source_sha256: '001d3b1727fea5280eec8fdbe14de451cfd41db0d00f8f2627009ef87e7893cd',
  builder_config_source_bytes: 3580,
  builder_config_sha256: '021cb1cc27dc7f9e46309c2fea925ef9127799da0bd18df1efab342128b63203',
  builder_config_bytes: 3729,
  bundle_sha256: 'c80525b60ff2c61e38f40d65f0b05fed38202367971bcfe80c25995d9507e757',
});

// GitHub serves the original LF Git blob. The historical Windows producer
// hashed its CRLF checkout bytes. Bind both identities, then insert CR before
// each LF byte only: no JSON parsing, whitespace normalization or fallback.
export function materializeOriginalBuilderConfig(sourceBytes, pin = ORIGINAL_PREDECESSOR) {
  if (!Buffer.isBuffer(sourceBytes) || sourceBytes.length !== pin.builder_config_source_bytes
    || sha(sourceBytes) !== pin.builder_config_source_sha256) fail('original_builder_config_source_digest');
  if (sourceBytes.includes(0x0d)) fail('original_builder_config_source_line_endings');
  const lineFeeds = sourceBytes.reduce((count, byte) => count + Number(byte === 0x0a), 0);
  const bytes = Buffer.alloc(sourceBytes.length + lineFeeds);
  let offset = 0;
  for (const byte of sourceBytes) {
    if (byte === 0x0a) bytes[offset++] = 0x0d;
    bytes[offset++] = byte;
  }
  if (bytes.length !== pin.builder_config_bytes || sha(bytes) !== pin.builder_config_sha256)
    fail('original_builder_config_materialization_digest');
  return { bytes, manifest: {
    source_path: pin.builder_config_source_path,
    source_sha256: sha(sourceBytes), source_bytes: sourceBytes.length,
    materialized_sha256: sha(bytes), materialized_bytes: bytes.length,
    materialization: 'LF_TO_CRLF_ONLY',
  } };
}

function relativeName(name) {
  return typeof name === 'string' && name.length > 0 && name.length <= 1024 && name.split('/').length <= 40
    && name.split('/').every(p => p && p !== '.' && p !== '..' && !/[\\:\x00-\x1f<>"|?*]/.test(p)
      && !/[. ]$/.test(p) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p));
}
export function validatePredecessorRows(rows) {
  if (!Array.isArray(rows) || !rows.length || rows.length > 50000) fail('inventory_invalid');
  const seen = new Map(); let previous = '', total = 0, files = 0;
  for (const row of rows) {
    if (!Array.isArray(row) || !relativeName(row[0]) || row[0] <= previous || seen.has(row[0].toUpperCase())) fail('inventory_alias');
    previous = row[0];
    const parent = path.posix.dirname(row[0]);
    if (parent !== '.' && seen.get(parent.toUpperCase()) !== parent) fail('inventory_parent');
    if (row.length === 2 && row[1] === 'DIRECTORY') seen.set(row[0].toUpperCase(), row[0]);
    else {
      if (row.length !== 3 || !Number.isSafeInteger(row[1]) || row[1] < 0 || !SHA.test(row[2] || '')) fail('inventory_file');
      total += row[1]; files++; seen.set(row[0].toUpperCase(), null);
      if (total > MAX_BYTES || files > MAX_FILES) fail('inventory_bounds');
    }
  }
  if (!files) fail('inventory_empty');
  return { schema: TREE_SCHEMA, tree_sha256: sha(JSON.stringify({ schema: TREE_SCHEMA, files: rows })),
    file_count: files, total_bytes: total };
}
export function assertPredecessorHostedEnvironment({ env = process.env, platform = process.platform, expectedHead } = {}) {
  if (platform !== 'win32' || env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true' || env.RUNNER_OS !== 'Windows'
    || env.RUNNER_ENVIRONMENT !== 'github-hosted' || env.GITHUB_REPOSITORY !== ORIGINAL_PREDECESSOR.repository
    || !['workflow_dispatch', 'push'].includes(env.GITHUB_EVENT_NAME) || !PREDECESSOR_QUALIFIER_REFS.includes(env.GITHUB_REF)
    || !HEAD.test(expectedHead || '') || env.GITHUB_SHA !== expectedHead
    || !ID.test(env.GITHUB_RUN_ID || '') || env.GITHUB_RUN_ID === ORIGINAL_PREDECESSOR.run_id
    || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_ATTEMPT || '') || !/^[1-9][0-9]*$/.test(env.GITHUB_RUN_NUMBER || '')
    || !Number.isSafeInteger(Number(env.GITHUB_RUN_ATTEMPT)) || !Number.isSafeInteger(Number(env.GITHUB_RUN_NUMBER))
    || env.GITHUB_WORKFLOW_REF !== ORIGINAL_PREDECESSOR.repository + '/' + PREDECESSOR_QUALIFIER_WORKFLOW + '@' + env.GITHUB_REF
    || !/^\w:\\Windows$/i.test(env.SystemRoot || '')
    || !['APPDATA', 'LOCALAPPDATA', 'RUNNER_TEMP', 'GITHUB_WORKSPACE'].every(k => path.win32.isAbsolute(env[k] || '')))
    fail('disposable_hosted_windows_required');
  return { repository: env.GITHUB_REPOSITORY, workflow: PREDECESSOR_QUALIFIER_WORKFLOW, source_head: expectedHead,
    run_id: env.GITHUB_RUN_ID, run_number: Number(env.GITHUB_RUN_NUMBER), run_attempt: Number(env.GITHUB_RUN_ATTEMPT),
    event: env.GITHUB_EVENT_NAME, ref: env.GITHUB_REF, terminal_success_required_by_consumer: true };
}
export function assertOriginalPredecessorMetadata(run, artifact, artifacts, pin = ORIGINAL_PREDECESSOR) {
  if (!record(run) || String(run.id) !== pin.run_id || run.head_sha !== pin.source_head || run.path !== pin.workflow
    || run.repository?.full_name !== pin.repository || run.run_attempt !== pin.run_attempt || run.run_number !== pin.run_number
    || run.event !== pin.event || run.status !== 'completed' || run.conclusion !== 'success'
    || !Number.isFinite(Date.parse(run.run_started_at)) || !Number.isFinite(Date.parse(run.updated_at))) fail('original_producer_unqualified');
  if (!record(artifact) || String(artifact.id) !== pin.artifact_id || artifact.name !== pin.artifact_name
    || artifact.expired !== false || artifact.digest !== 'sha256:' + pin.artifact_sha256 || artifact.size_in_bytes !== pin.artifact_bytes
    || String(artifact.workflow_run?.id) !== pin.run_id || artifact.workflow_run?.head_sha !== pin.source_head
    || !Number.isFinite(Date.parse(artifact.created_at)) || Date.parse(artifact.created_at) < Date.parse(run.run_started_at)
    || Date.parse(artifact.created_at) > Date.parse(run.updated_at)) fail('original_artifact_unqualified');
  if (!Array.isArray(artifacts) || artifacts.filter(a => a.name === pin.artifact_name).length !== 1
    || !artifacts.some(a => String(a.id) === pin.artifact_id && a.name === pin.artifact_name)) fail('original_artifact_ambiguous');
  return true;
}
export function assertStrictPredecessorVerification(value, pin = ORIGINAL_PREDECESSOR) {
  if (value?.schema !== 'metaengine.browser.installer-provenance-acquired.v1' || value.source_head !== pin.source_head
    || value.package_version !== pin.package_version || value.installer_sha256 !== pin.installer_sha256
    || value.installer_name !== pin.installer_name || value.installer_bytes !== pin.installer_bytes
    || String(value.provenance_run_id) !== pin.run_id || Number(value.provenance_run_number) !== pin.run_number
    || Number(value.provenance_run_attempt) !== pin.run_attempt || value.provenance_workflow !== path.posix.basename(pin.workflow)
    || value.provenance_schema !== 'metaengine.browser.installer-provenance.v3'
    || !['build_identity_verified', 'dependency_resolution_verified', 'package_lock_verified', 'me2_ui_bun_lock_verified',
      'blockmap_verified', 'config_verified'].every(k => value[k] === true)) fail('strict_installer_verification_required');
  return true;
}

// These expectations are taken only from the already authenticated ORIGINAL
// artifact. No installed observation is allowed to choose its own expectation.
export function deriveOriginalPredecessorExpectations(manifestBytes, archiveRows, pin = ORIGINAL_PREDECESSOR) {
  validatePredecessorRows(archiveRows);
  if (!Buffer.isBuffer(manifestBytes) || manifestBytes.length > 32 * 1024 ** 2 || sha(manifestBytes) !== pin.package_code_sha256)
    fail('original_code_manifest_digest');
  let doc; try { doc = JSON.parse(manifestBytes); } catch { fail('original_code_manifest_json'); }
  if (!exact(doc, ['schema', 'source_sha', 'package_version', 'exe_name', 'entries'])
    || doc.schema !== 'metaengine.browser.installed-package-code.v1' || doc.source_sha !== pin.source_head
    || doc.package_version !== pin.package_version || doc.exe_name !== 'METAENGINE Browser Test.exe' || !Array.isArray(doc.entries))
    fail('original_code_manifest_binding');
  const codeRows = doc.entries.map(e => {
    if (e?.kind === 'directory' && exact(e, ['path', 'kind'])) return [e.path, 'DIRECTORY'];
    if (e?.kind === 'file' && exact(e, ['path', 'kind', 'size', 'sha256'])) return [e.path, e.size, e.sha256];
    fail('original_code_manifest_entry');
  });
  validatePredecessorRows(codeRows);
  const reserved = [...PREDECESSOR_DETACHED_PROOFS, PREDECESSOR_UNINSTALLER].map(s => s.toUpperCase());
  if (codeRows.some(r => reserved.includes(r[0].toUpperCase()) || r[0].toLowerCase() === 'resources/app'
    || r[0].toLowerCase().startsWith('resources/app/'))) fail('original_code_manifest_reserved');
  for (const name of [doc.exe_name, 'resources/app.asar', 'resources/client-state-runtime/offline-runtime-bundle.json'])
    if (!codeRows.some(r => r[0] === name && r.length === 3 && r[1] > 0)) fail('original_code_manifest_incomplete');
  const proofBindings = PREDECESSOR_DETACHED_PROOFS.map(name => {
    const matches = archiveRows.filter(r => path.posix.basename(r[0]).toUpperCase() === name.toUpperCase());
    if (matches.length > 1 || (matches.length === 1 && (matches[0].length !== 3
      || ![name, 'browser-slsa-provenance/' + name].includes(matches[0][0])))) fail('detached_proof_original_ambiguous');
    const row = matches[0];
    if (name === 'metaengine-installed-package-code.v1.json'
      && (!row || row[0] !== name || row[2] !== pin.package_code_sha256 || row[1] !== manifestBytes.length)) fail('detached_manifest_binding');
    // Detached proofs are published beside the installer and are not necessarily
    // embedded in it. Their absence is permitted; their presence requires the
    // exact original bytes. The code closure itself has no optional entries.
    return row ? { name, state: 'ORIGINAL_BYTES_OR_ABSENT', original_artifact_path: row[0], size: row[1], sha256: row[2] }
      : { name, state: 'ABSENT_FROM_ORIGINAL_ARTIFACT' };
  });
  return { codeRows, proofBindings };
}
export function assertPredecessorInstalledRows(expected, installedRows) {
  validatePredecessorRows(expected.codeRows); validatePredecessorRows(installedRows);
  if (!Array.isArray(expected.proofBindings) || expected.proofBindings.length !== PREDECESSOR_DETACHED_PROOFS.length
    || !isDeepStrictEqual(expected.proofBindings.map(p => p.name), PREDECESSOR_DETACHED_PROOFS)) fail('detached_proof_contract');
  const imageRows = [...expected.codeRows], proofReadbacks = [];
  for (const proof of expected.proofBindings) {
    const found = installedRows.filter(r => r[0].toUpperCase() === proof.name.toUpperCase());
    if (proof.state === 'ABSENT_FROM_ORIGINAL_ARTIFACT') { if (found.length) fail('unbound_detached_proof'); }
    else if (proof.state !== 'ORIGINAL_BYTES_OR_ABSENT' || found.length > 1 || found.length === 1
      && !isDeepStrictEqual(found[0], [proof.name, proof.size, proof.sha256])) fail('detached_proof_changed');
    if (found.length) imageRows.push([proof.name, proof.size, proof.sha256]);
    proofReadbacks.push({ ...proof, readback: found.length ? 'PRESENT_ORIGINAL_BYTES_VERIFIED' : 'ABSENCE_VERIFIED' });
  }
  const uninstaller = installedRows.filter(r => r[0].toUpperCase() === PREDECESSOR_UNINSTALLER.toUpperCase());
  if (uninstaller.length !== 1 || uninstaller[0][0] !== PREDECESSOR_UNINSTALLER || uninstaller[0].length !== 3
    || uninstaller[0][1] < 1) fail('uninstaller_readback_missing');
  imageRows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
  if (!isDeepStrictEqual(installedRows.filter(r => r[0] !== PREDECESSOR_UNINSTALLER), imageRows)) fail('installed_original_image_mismatch');
  return { imageRows, proofReadbacks, uninstaller: { name: PREDECESSOR_UNINSTALLER, size: uninstaller[0][1], sha256: uninstaller[0][2],
    measurement: 'INDEPENDENT_DISPOSABLE_FRESH_INSTALL' } };
}
export function assertPredecessorBoundedInstall(value, pin = ORIGINAL_PREDECESSOR) {
  if (value?.schema !== 'metaengine.browser.bounded-package-install.v1' || value.installer_sha256 !== pin.installer_sha256
    || value.installer_exit_code !== 0 || !Number.isSafeInteger(value.installer_pid) || value.installer_pid < 1
    || value.process_tree_scoped_job !== true || value.descendant_cleanup_on_job_close !== true
    || value.installed_payload_qualification_required !== true || value.authority_effect !== false) fail('bounded_install_unconfirmed');
  return true;
}

const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
const sameFile = (a, b) => sameIdentity(a, b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.nlink === b.nlink;
export async function predecessorPhysicalPath(file, { directory = false, missingLeaf = false } = {}) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || file.startsWith('\\\\')) fail('absolute_physical_path_required');
  const absolute = path.resolve(file); let cursor = path.parse(absolute).root;
  const components = path.relative(cursor, absolute).split(path.sep).filter(Boolean);
  for (let i = 0; i < components.length; i++) {
    cursor = path.join(cursor, components[i]); let stat;
    try { stat = await fs.lstat(cursor, { bigint: true }); }
    catch (error) { if (missingLeaf && i === components.length - 1 && error.code === 'ENOENT') return absolute; throw error; }
    const isDir = i !== components.length - 1 || directory;
    if (stat.isSymbolicLink() || stat.ino <= 0n || (isDir ? !stat.isDirectory() : !stat.isFile() || stat.nlink !== 1n)) fail('path_alias_or_type');
    const real = await fs.lstat(await fs.realpath(cursor), { bigint: true });
    if (!sameIdentity(stat, real)) fail('path_physical_identity');
  }
  return absolute;
}
async function absent(file) { try { await fs.lstat(file); fail('prior_attempt_or_state'); } catch (e) { if (e.code !== 'ENOENT') throw e; } }
async function absentPhysicalTree(file) {
  // The installer may create a missing Programs directory. Every existing
  // ancestor must still be physical before it is allowed to choose that path.
  if (!path.isAbsolute(file || '') || file.startsWith('\\\\')) fail('absolute_physical_path_required');
  let cursor = path.parse(file).root;
  for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part); let info;
    try { info = await fs.lstat(cursor, { bigint: true }); }
    catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink() || info.ino <= 0n
      || !sameIdentity(info, await fs.lstat(await fs.realpath(cursor), { bigint: true }))) fail('path_alias_or_type');
  }
  fail('prior_attempt_or_state');
}
async function hashFile(file) {
  await predecessorPhysicalPath(file); const before = await fs.lstat(file, { bigint: true });
  if (before.size > BigInt(MAX_BYTES)) fail('file_too_large');
  const h = createHash('sha256'); for await (const chunk of createReadStream(file)) h.update(chunk);
  if (!sameFile(before, await fs.lstat(file, { bigint: true }))) fail('file_changed');
  return h.digest('hex');
}
async function durable(file, value) {
  await predecessorPhysicalPath(file, { missingLeaf: true }); const handle = await fs.open(file, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(value, null, 2) + '\n'); await handle.sync(); } finally { await handle.close(); }
}
export async function capturePredecessorRows(root) {
  await predecessorPhysicalPath(root, { directory: true }); const rows = []; let total = 0;
  async function visit(dir, prefix = '') {
    const before = await fs.lstat(dir, { bigint: true });
    for (const name of (await fs.readdir(dir)).sort()) {
      const rel = prefix ? prefix + '/' + name : name;
      if (!relativeName(rel) || rows.length >= 50000) fail('tree_bounds_or_name');
      const file = path.join(dir, name), info = await fs.lstat(file, { bigint: true });
      if (info.isSymbolicLink()) fail('tree_link');
      if (info.isDirectory()) { rows.push([rel, 'DIRECTORY']); await visit(file, rel); }
      else {
        if (!info.isFile() || info.nlink !== 1n || info.size < 0n || info.size > BigInt(MAX_BYTES)) fail('tree_file_type');
        const size = Number(info.size); total += size; if (total > MAX_BYTES) fail('tree_bytes');
        rows.push([rel, size, await hashFile(file)]);
      }
    }
    const after = await fs.lstat(dir, { bigint: true });
    if (!sameFile(before, after) || !after.isDirectory()) fail('tree_changed');
  }
  await visit(root); rows.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); validatePredecessorRows(rows); return rows;
}
export async function materializeVerifiedPredecessor({ installedRoot, destination, expected }) {
  await predecessorPhysicalPath(installedRoot, { directory: true });
  await predecessorPhysicalPath(destination, { directory: true, missingLeaf: true }); await absent(destination);
  const source = await fs.realpath(installedRoot), parent = await fs.realpath(path.dirname(destination));
  const target = path.join(parent, path.basename(destination));
  const inside = (a, b) => { const r = path.relative(a, b); return r === '' || !r.startsWith('..' + path.sep) && r !== '..' && !path.isAbsolute(r); };
  if (inside(source, target) || inside(target, source)) fail('materialization_roots_overlap');
  const before = await capturePredecessorRows(installedRoot), resolved = assertPredecessorInstalledRows(expected, before);
  await fs.mkdir(destination, { mode: 0o700 });
  for (const row of resolved.imageRows) {
    const from = path.join(installedRoot, ...row[0].split('/')), to = path.join(destination, ...row[0].split('/'));
    await predecessorPhysicalPath(to, { directory: row.length === 2, missingLeaf: true });
    if (row.length === 2) { await fs.mkdir(to, { mode: 0o700 }); continue; }
    await predecessorPhysicalPath(from); const stat = await fs.lstat(from, { bigint: true });
    await fs.copyFile(from, to, constants.COPYFILE_EXCL);
    if (!sameFile(stat, await fs.lstat(from, { bigint: true })) || await hashFile(to) !== row[2]) fail('materialization_file_changed');
  }
  const [after, copied] = await Promise.all([capturePredecessorRows(installedRoot), capturePredecessorRows(destination)]);
  if (!isDeepStrictEqual(before, after) || !isDeepStrictEqual(copied, resolved.imageRows)) fail('materialization_changed');
  return { installedRows: before, imageRows: copied, uninstaller: resolved.uninstaller, proofReadbacks: resolved.proofReadbacks,
    source_unchanged: true, copied_tree_verified: true };
}

function privateEnv({ token = false } = {}) {
  const env = {};
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH', 'TEMP', 'TMP', 'PATH', 'Path', 'APPDATA', 'LOCALAPPDATA'])
    if (typeof process.env[key] === 'string') env[key] = process.env[key];
  if (token) env.ME2_GITHUB_TOKEN = process.env.ME2_GITHUB_TOKEN;
  return env;
}
async function child(file, args, { timeout = 120000, token = false, maxBuffer = 4 * 1024 ** 2 } = {}) {
  try {
    const pending = exec(file, args, { windowsHide: true, shell: false, timeout, maxBuffer, env: privateEnv({ token }) });
    pending.child?.stdin?.end(); return (await pending).stdout.replace(/^\uFEFF/, '').trim();
  } catch { fail('child_operation_unconfirmed'); }
}
const powershell = (args, options) => child(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ['-NoLogo', '-NoProfile', '-NonInteractive', ...args], options);
async function psJson(program) {
  const raw = await powershell(['-EncodedCommand', Buffer.from(program, 'utf16le').toString('base64')]);
  try { return JSON.parse(raw); } catch { fail('native_json_unconfirmed'); }
}
async function githubJson(route) {
  const token = process.env.ME2_GITHUB_TOKEN;
  if (typeof token !== 'string' || !token || !route.startsWith('/repos/PatrickFrome/Compute/')) fail('github_access_required');
  let response;
  try { response = await fetch('https://api.github.com' + route, { headers: { Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' }, redirect: 'error', signal: AbortSignal.timeout(30000) }); }
  catch { fail('github_read_unconfirmed'); }
  if (!response.ok) fail('github_read_unconfirmed');
  const text = await response.text(); if (text.length > 16 * 1024 ** 2) fail('github_response_bounds');
  try { return JSON.parse(text); } catch { fail('github_json_unconfirmed'); }
}
async function originalMetadata() {
  const p = ORIGINAL_PREDECESSOR, base = '/repos/' + p.repository;
  const run = await githubJson(base + '/actions/runs/' + p.run_id);
  const artifact = await githubJson(base + '/actions/artifacts/' + p.artifact_id), artifacts = [];
  let expectedTotal;
  for (let page = 1; page <= 10; page++) {
    const list = await githubJson(base + '/actions/runs/' + p.run_id + '/artifacts?per_page=100&page=' + page);
    if (!Array.isArray(list.artifacts) || !Number.isSafeInteger(list.total_count) || list.total_count < 1 || list.total_count > 1000
      || expectedTotal !== undefined && expectedTotal !== list.total_count) fail('artifact_listing_unconfirmed');
    expectedTotal = list.total_count; artifacts.push(...list.artifacts);
    if (artifacts.length >= expectedTotal) break;
  }
  if (artifacts.length !== expectedTotal || new Set(artifacts.map(a => String(a.id))).size !== artifacts.length) fail('artifact_listing_incomplete');
  assertOriginalPredecessorMetadata(run, artifact, artifacts); return { run, artifact };
}

// Zip reader has no executable interpretation. It validates the complete member
// inventory before creating any output, bounds expansion, and writes each file
// exclusively. The original archive itself stays SHA-pinned before/after.
const EXTRACT_ORIGINAL_PY = String.raw`import sys,os,json,zipfile,stat,hashlib,re
archive,target,expected=sys.argv[1:]
if os.path.lexists(target): raise RuntimeError('target_exists')
def digest(f):
 h=hashlib.sha256()
 while True:
  b=f.read(1024*1024)
  if not b: break
  h.update(b)
 return h.hexdigest()
with open(archive,'rb') as source:
 before=os.fstat(source.fileno())
 if digest(source)!=expected: raise RuntimeError('archive_digest')
 source.seek(0)
 with zipfile.ZipFile(source) as z:
  items=z.infolist()
  if not 1<=len(items)<=5000: raise RuntimeError('entry_limit')
  seen={}; entries=[]; total=0; dirs={}
  for item in items:
   name=item.filename[:-1] if item.is_dir() else item.filename
   parts=name.split('/')
   if not name or len(name)>1024 or len(parts)>40 or any(not p or p in ('.','..') or re.search(r'[\\:\x00-\x1f<>"|?*]',p) or p[-1:] in ('.',' ') or re.match(r'^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)',p,re.I) for p in parts): raise RuntimeError('entry_path')
   key=name.upper(); mode=stat.S_IFMT(item.external_attr>>16)
   if key in seen or item.orig_filename!=item.filename or item.flag_bits&1 or mode not in (0,stat.S_IFREG,stat.S_IFDIR) or item.external_attr&0x400: raise RuntimeError('entry_alias_or_type')
   if mode==stat.S_IFDIR and not item.is_dir() or mode==stat.S_IFREG and item.is_dir(): raise RuntimeError('entry_type_mismatch')
   if item.file_size<0 or item.file_size>12*1024**3: raise RuntimeError('entry_size')
   if item.is_dir() and item.file_size: raise RuntimeError('directory_data')
   total+=item.file_size
   if total>12*1024**3: raise RuntimeError('archive_size')
   seen[key]=(name,item.is_dir()); entries.append((name,item))
   for n in range(1,len(parts)):
    parent='/'.join(parts[:n]); pk=parent.upper()
    if pk in dirs and dirs[pk]!=parent: raise RuntimeError('parent_alias')
    dirs[pk]=parent
  for key,name in dirs.items():
   if key in seen and seen[key]!=(name,True): raise RuntimeError('parent_file_alias')
  os.mkdir(target); rows=[]
  all_dirs=set(dirs.values())|set(name for name,item in entries if item.is_dir())
  for name in sorted(all_dirs,key=lambda x:(x.count('/'),x)):
   os.mkdir(os.path.join(target,*name.split('/'))); rows.append([name,'DIRECTORY'])
  for name,item in entries:
   if item.is_dir(): continue
   h=hashlib.sha256(); count=0
   with z.open(item) as inp, open(os.path.join(target,*name.split('/')),'xb') as out:
    while True:
     b=inp.read(1024*1024)
     if not b: break
     count+=len(b)
     if count>item.file_size: raise RuntimeError('entry_expansion')
     out.write(b); h.update(b)
   if count!=item.file_size: raise RuntimeError('entry_truncated')
   rows.append([name,count,h.hexdigest()])
 source.seek(0)
 after=os.fstat(source.fileno())
 if digest(source)!=expected or any(getattr(before,k)!=getattr(after,k) for k in ('st_dev','st_ino','st_size','st_mtime_ns','st_ctime_ns')): raise RuntimeError('archive_changed')
print(json.dumps(sorted(rows,key=lambda x:x[0]),separators=(',',':')))
`;

const CLEAN_PROFILE_PS = String.raw`$ErrorActionPreference='Stop'
if([Environment]::GetFolderPath('ApplicationData') -ine $env:APPDATA -or [Environment]::GetFolderPath('LocalApplicationData') -ine $env:LOCALAPPDATA){throw 'profile_redirect'}
$id='c32f3891-2b9e-5a4a-bd4f-5173b65b39bb'
foreach($hive in @([Microsoft.Win32.RegistryHive]::CurrentUser,[Microsoft.Win32.RegistryHive]::LocalMachine)){
 foreach($view in @([Microsoft.Win32.RegistryView]::Registry32,[Microsoft.Win32.RegistryView]::Registry64)){
  $base=[Microsoft.Win32.RegistryKey]::OpenBaseKey($hive,$view)
  try{foreach($prefix in @('Software','Software\Microsoft\Windows\CurrentVersion\Uninstall')){
   $k=$base.OpenSubKey(($prefix+'\'+$id));if($null -ne $k){$k.Dispose();throw 'registration_present'}
  }}finally{$base.Dispose()}
 }
}
if(@(Get-CimInstance Win32_Process -Filter "Name LIKE 'METAENGINE%' OR Name='postgres.exe'" -ErrorAction Stop).Count){throw 'process_present'}
if(@(Get-Service -ErrorAction Stop | Where-Object Name -eq 'METAENGINEBrowserGuardian').Count){throw 'guardian_present'}
foreach($s in @((Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\METAENGINE Browser Test.lnk'),(Join-Path ([Environment]::GetFolderPath('Desktop')) 'METAENGINE Browser Test.lnk'))){if(Test-Path -LiteralPath $s){throw 'shortcut_present'}}
@{empty_profile=$true;registration_absent=$true;processes_absent=$true;guardian_absent=$true}|ConvertTo-Json -Compress`;
async function cleanPreflight(installedRoot) {
  for (const dir of [process.env.APPDATA, process.env.LOCALAPPDATA, process.env.RUNNER_TEMP]) await predecessorPhysicalPath(dir, { directory: true });
  for (const file of [installedRoot, path.join(process.env.APPDATA, '@metaengine', 'browser-shell'),
    path.join(process.env.LOCALAPPDATA, 'METAENGINE')]) await absentPhysicalTree(file);
  const value = await psJson(CLEAN_PROFILE_PS);
  if (!['empty_profile', 'registration_absent', 'processes_absent', 'guardian_absent'].every(k => value[k] === true)) fail('clean_profile_unconfirmed');
  return value;
}
async function processReadback(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) fail('installer_pid_invalid');
  const value = await psJson(String.raw`$ErrorActionPreference='Stop'
if(@(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}' -ErrorAction Stop).Count){throw 'installer_still_present'}
if(@(Get-CimInstance Win32_Process -Filter "Name LIKE 'METAENGINE%' OR Name='postgres.exe'" -ErrorAction Stop).Count){throw 'runtime_process_present'}
if(@(Get-Service -ErrorAction Stop | Where-Object Name -eq 'METAENGINEBrowserGuardian').Count){throw 'guardian_present'}
@{installer_process_absent=$true;browser_and_postgres_absent=$true;guardian_service_absent=$true}|ConvertTo-Json -Compress`);
  if (!['installer_process_absent', 'browser_and_postgres_absent', 'guardian_service_absent'].every(k => value[k] === true)) fail('process_cleanup_unconfirmed');
  return value;
}
function subtree(rows, prefix) {
  const selected = rows.filter(r => r[0].startsWith(prefix + '/')).map(r => [r[0].slice(prefix.length + 1), ...r.slice(1)]);
  return validatePredecessorRows(selected).tree_sha256;
}
export function predecessorFailureSummary(error) {
  return { schema: PREDECESSOR_MATERIALIZATION_SCHEMA,
    state: error?.effectStarted ? 'HOLD_EFFECT_OUTCOME_UNQUALIFIED' : 'BLOCKED',
    reason: /^predecessor_materialization_[a-z_]+$/.test(error?.code || '') ? error.code : 'predecessor_materialization_operation_unconfirmed',
    hold_recorded: error?.holdRecorded === true,
    automatic_retry_allowed: false, physical_migration_qualified: false };
}

export async function qualifyPredecessorMaterialization({ workDirectory, outputDirectory, expectedQualifierHead } = {}) {
  const qualification = assertPredecessorHostedEnvironment({ expectedHead: expectedQualifierHead });
  if (process.versions.node !== '24.21.0') fail('qualifier_node_version');
  const repositoryRoot = fileURLToPath(new URL('../../../', import.meta.url));
  if ((await child('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'])) !== expectedQualifierHead
    || await child('git', ['-C', repositoryRoot, 'status', '--porcelain', '--untracked-files=no'])) fail('qualifier_source_changed');
  const qualifierRun = await githubJson('/repos/' + qualification.repository + '/actions/runs/' + qualification.run_id);
  if (String(qualifierRun.id) !== qualification.run_id || qualifierRun.head_sha !== expectedQualifierHead || qualifierRun.path !== PREDECESSOR_QUALIFIER_WORKFLOW
    || qualifierRun.repository?.full_name !== qualification.repository || qualifierRun.run_attempt !== qualification.run_attempt
    || qualifierRun.run_number !== qualification.run_number || qualifierRun.event !== qualification.event
    || qualifierRun.head_branch !== qualification.ref.slice('refs/heads/'.length)
    || !['queued', 'in_progress'].includes(qualifierRun.status)) fail('qualifier_run_binding');
  const temp = await fs.realpath(await predecessorPhysicalPath(process.env.RUNNER_TEMP, { directory: true }));
  const withinTemp = async file => {
    await predecessorPhysicalPath(file, { directory: true, missingLeaf: true });
    const actual = path.join(await fs.realpath(path.dirname(file)), path.basename(file)), rel = path.relative(temp, actual);
    if (!rel || rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) fail('temporary_output_scope');
    await absent(file); return actual;
  };
  const work = await withinTemp(workDirectory), out = await withinTemp(outputDirectory);
  const rel = path.relative(work, out), back = path.relative(out, work);
  if (!rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel))
    || (!back.startsWith('..' + path.sep) && back !== '..' && !path.isAbsolute(back))) fail('work_output_overlap');
  const attempt = path.join(temp, 'metaengine-predecessor-' + qualification.run_id + '-' + qualification.run_attempt + '.intent.json');
  await absent(attempt); await fs.mkdir(work, { mode: 0o700 });
  let effectStarted = false;
  try {
    const original = await originalMetadata(), pin = ORIGINAL_PREDECESSOR;
    const acquisition = path.join(work, 'original'); await fs.mkdir(acquisition, { mode: 0o700 });
    await child(process.execPath, [script('installer-provenance.mjs'), 'download', '--repository', pin.repository,
      '--run-id', pin.run_id, '--artifact', pin.artifact_name, '--artifact-id', pin.artifact_id, '--out', acquisition],
    { token: true, timeout: 180000 });
    const archive = path.join(acquisition, 'artifact.zip');
    if ((await fs.stat(archive)).size !== pin.artifact_bytes || await hashFile(archive) !== pin.artifact_sha256) fail('original_archive_digest');
    const payload = path.join(work, 'original-payload');
    let archiveRows; try { archiveRows = JSON.parse(await child('python', ['-c', EXTRACT_ORIGINAL_PY, archive, payload, pin.artifact_sha256], { timeout: 180000 })); }
    catch { fail('original_archive_materialization'); }
    validatePredecessorRows(archiveRows);
    if (!isDeepStrictEqual(await capturePredecessorRows(payload), archiveRows) || await hashFile(archive) !== pin.artifact_sha256) fail('original_archive_materialization');
    const configResponse = await githubJson('/repos/' + pin.repository + '/contents/' + pin.builder_config_source_path + '?ref=' + pin.source_head);
    if (configResponse.encoding !== 'base64' || typeof configResponse.content !== 'string') fail('original_builder_config_missing');
    const configSourceBytes = Buffer.from(configResponse.content.replace(/\s/g, ''), 'base64');
    const { bytes: configBytes, manifest: originalBuilderConfig } = materializeOriginalBuilderConfig(configSourceBytes, pin);
    const config = path.join(work, 'original-builder-config.json'); await fs.writeFile(config, configBytes, { flag: 'wx', mode: 0o600 });
    const strictVerify = async () => {
      const result = JSON.parse(await child(process.execPath, [script('installer-provenance.mjs'), 'verify', '--dir', payload,
        '--state', path.join(work, 'strict-acquired.json'), '--expect-head', pin.source_head, '--expect-run-id', pin.run_id,
        '--expect-run-number', String(pin.run_number), '--expect-run-attempt', String(pin.run_attempt),
        '--expect-workflow', path.posix.basename(pin.workflow), '--config', config], { timeout: 180000 }));
      assertStrictPredecessorVerification(result); return result;
    };
    await strictVerify();
    const manifestFile = path.join(payload, 'metaengine-installed-package-code.v1.json');
    const manifestBytes = await fs.readFile(await predecessorPhysicalPath(manifestFile));
    const expected = deriveOriginalPredecessorExpectations(manifestBytes, archiveRows);
    const { verifyPackageCodeW68, validatePackageCodeManifestW68 } = await import('../src/installed-package-code-w68.mjs');
    validatePackageCodeManifestW68(JSON.parse(manifestBytes), { sourceSha: pin.source_head, version: pin.package_version, exeName: 'METAENGINE Browser Test.exe' });
    const installedRoot = path.join(process.env.LOCALAPPDATA, 'Programs', 'METAENGINE Browser Test');
    const preflight = await cleanPreflight(installedRoot);
    await strictVerify(); await originalMetadata();
    if ((await child('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'])) !== expectedQualifierHead
      || await child('git', ['-C', repositoryRoot, 'status', '--porcelain', '--untracked-files=no'])) fail('qualifier_source_changed');
    if (await hashFile(archive) !== pin.artifact_sha256 || !isDeepStrictEqual(await capturePredecessorRows(payload), archiveRows)) fail('original_inputs_changed');
    await cleanPreflight(installedRoot);
    await durable(attempt, { schema: 'metaengine.browser.predecessor-materialization-intent.v1', state: 'EFFECT_PENDING',
      qualification, installer_sha256: pin.installer_sha256, automatic_retry_allowed: false });
    effectStarted = true;
    const install = JSON.parse(await powershell(['-File', script('install-package-bounded.ps1'), '-InstallerPath', path.join(payload, pin.installer_name),
      '-ExpectedSha256', pin.installer_sha256, '-TimeoutSeconds', '1800'], { timeout: 1850000 }));
    assertPredecessorBoundedInstall(install);
    const cleanup = await processReadback(install.installer_pid);
    for (const file of [path.join(process.env.APPDATA, '@metaengine', 'browser-shell'), path.join(process.env.LOCALAPPDATA, 'METAENGINE')]) await absent(file);
    const code = await verifyPackageCodeW68(installedRoot, manifestBytes, { sourceSha: pin.source_head, version: pin.package_version, exeName: 'METAENGINE Browser Test.exe' });
    await code.fence();
    const installedRows = await capturePredecessorRows(installedRoot);
    const measuredUninstaller = assertPredecessorInstalledRows(expected, installedRows).uninstaller;
    const asar = require('@electron/asar'), asarFile = path.join(installedRoot, 'resources', 'app.asar');
    asar.uncache(asarFile);
    const packaged = JSON.parse(asar.extractFile(asarFile, 'package.json'));
    if (packaged.version !== pin.package_version) fail('installed_asar_version');
    const { verifyOfflineRuntimeBundle } = await import('../../../infra/client-state-runtime/offline-runtime-bundle.mjs');
    const runtime = path.join(installedRoot, 'resources', 'client-state-runtime');
    await verifyOfflineRuntimeBundle({ bundleDirectory: runtime, expectedBundleDigest: pin.bundle_sha256 });
    const { observeWindowsNsisEffects } = await import('./qa-nsis-external-effects.mjs');
    const nsis = await observeWindowsNsisEffects({ expectedVersion: pin.package_version });
    const registryParent = path.join(process.env.LOCALAPPDATA, 'METAENGINE');
    const registryState = path.join(registryParent, 'client-state-qa-upgrade-' + randomUUID());
    await absent(registryParent); await fs.mkdir(registryParent, { mode: 0o700 }); await fs.mkdir(registryState, { mode: 0o700 });
    const registration = JSON.parse(await powershell(['-File', script('qa-forward-registration.ps1'), '-Mode', 'Observe',
      '-StateDirectory', registryState, '-ExpectedVersion', pin.package_version]));
    if (registration.schema !== 'metaengine.operator.forward-registration.v1' || registration.state !== 'OBSERVED'
      || registration.key_count !== 2 || registration.mutation !== false || !SHA.test(registration.digest || '')) fail('registration_unconfirmed');
    // Only empty directories created above are removed. No uninstaller, process
    // termination, registry retirement, Owner publication or database launch.
    await fs.rmdir(registryState); await fs.rmdir(registryParent);
    const staged = path.join(work, 'qualified-artifact'); await fs.mkdir(staged, { mode: 0o700 });
    const materialized = await materializeVerifiedPredecessor({ installedRoot, destination: path.join(staged, 'win-unpacked'), expected });
    if (!isDeepStrictEqual(materialized.uninstaller, measuredUninstaller)) fail('uninstaller_changed');
    await verifyOfflineRuntimeBundle({ bundleDirectory: path.join(staged, 'win-unpacked', 'resources', 'client-state-runtime'), expectedBundleDigest: pin.bundle_sha256 });
    await code.fence(); await processReadback(install.installer_pid);
    if (!isDeepStrictEqual(await capturePredecessorRows(installedRoot), materialized.installedRows)) fail('installed_tree_changed');
    await strictVerify(); await originalMetadata();
    if ((await child('git', ['-C', repositoryRoot, 'rev-parse', 'HEAD'])) !== expectedQualifierHead
      || await child('git', ['-C', repositoryRoot, 'status', '--porcelain', '--untracked-files=no'])) fail('qualifier_source_changed');
    const image = validatePredecessorRows(materialized.imageRows), installed = validatePredecessorRows(materialized.installedRows);
    const result = {
      schema: PREDECESSOR_MATERIALIZATION_SCHEMA, state: 'DISPOSABLE_PREDECESSOR_MATERIALIZED',
      qualification, original_producer: { repository: pin.repository, workflow: pin.workflow, source_head: pin.source_head,
        run_id: pin.run_id, run_number: pin.run_number, run_attempt: pin.run_attempt, event: pin.event, terminal_success_verified: true },
      original_artifact: { id: pin.artifact_id, name: pin.artifact_name, sha256: pin.artifact_sha256, bytes: pin.artifact_bytes },
      source_head: pin.source_head, package_version: pin.package_version,
      installer: { name: pin.installer_name, sha256: pin.installer_sha256, bytes: pin.installer_bytes },
      original_builder_config: originalBuilderConfig,
      original_package_code: { file: 'metaengine-installed-package-code.v1.json', sha256: pin.package_code_sha256,
        original_manifest_verified: true, strict_installer_provenance_verified: true },
      detached_proofs: materialized.proofReadbacks,
      image: { root: 'win-unpacked', ...image, files: materialized.imageRows },
      asar_sha256: materialized.imageRows.find(r => r[0] === 'resources/app.asar')[2],
      runtime: { bundle_sha256: pin.bundle_sha256, semantic_verification: true,
        tree_sha256: subtree(materialized.imageRows, 'resources/client-state-runtime'),
        postgres_tree_sha256: subtree(materialized.imageRows, 'resources/client-state-runtime/runtime/postgresql') },
      uninstaller: { ...measuredUninstaller, installer_sha256: pin.installer_sha256, qualification_run_id: qualification.run_id },
      qualification_installed_image: { schema: 'metaengine.browser.predecessor-installed-image.v1',
        installed_tree_sha256: installed.tree_sha256, file_count: installed.file_count, total_bytes: installed.total_bytes,
        candidate_tree_sha256: image.tree_sha256, uninstaller_sha256: measuredUninstaller.sha256,
        original_expected_code_verified: true, detached_proofs_verified: true, full_tree_verified: true },
      bounded_install: { schema: install.schema, installer_exit_code: 0, process_tree_scoped_job: true,
        descendant_cleanup_on_job_close: true, timeout_seconds: install.timeout_seconds },
      process_readback: cleanup, registry: registration, nsis, preflight,
      source_unchanged: true, copied_tree_verified: true, rebuilt: false, original_producer_modified: false,
      installed_owner_or_pg_qualified: false, physical_migration_qualified: false,
      production_authorized: false, authority_effect: false, automatic_retry_allowed: false,
    };
    await durable(path.join(staged, 'predecessor-materialization.json'), result);
    await predecessorPhysicalPath(out, { directory: true, missingLeaf: true }); await absent(out); await fs.rename(staged, out);
    await durable(path.join(work, 'completed.json'), { schema: PREDECESSOR_MATERIALIZATION_SCHEMA,
      state: result.state, qualification, manifest_sha256: sha(JSON.stringify(result, null, 2) + '\n'),
      physical_migration_qualified: false, terminal_success_required_by_consumer: true });
    return result;
  } catch (error) {
    const reason = /^predecessor_materialization_[a-z_]+$/.test(error?.code || '') ? error.code : 'predecessor_materialization_operation_unconfirmed';
    let holdRecorded = false;
    try { await durable(path.join(work, 'failure.json'), { schema: PREDECESSOR_MATERIALIZATION_SCHEMA,
      state: effectStarted ? 'HOLD_EFFECT_OUTCOME_UNQUALIFIED' : 'BLOCKED_BEFORE_INSTALL', reason,
      automatic_retry_allowed: false, physical_migration_qualified: false, qualification }); holdRecorded = effectStarted; }
    catch { /* Existing effect intent is retained; never claim a recorded HOLD. */ }
    const failure = new Error(reason); failure.code = reason; failure.effectStarted = effectStarted; failure.holdRecorded = holdRecorded; throw failure;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  (async () => {
    const { values } = parseArgs({ options: { work: { type: 'string' }, out: { type: 'string' }, 'expected-qualifier-head': { type: 'string' } }, strict: true });
    const result = await qualifyPredecessorMaterialization({ workDirectory: values.work, outputDirectory: values.out,
      expectedQualifierHead: values['expected-qualifier-head'] });
    process.stdout.write(JSON.stringify({ schema: result.schema, state: result.state, source_head: result.source_head,
      qualification_run_id: result.qualification.run_id, terminal_success_required_by_consumer: true,
      physical_migration_qualified: false, production_authorized: false }) + '\n');
  })().catch(error => {
    process.stderr.write(JSON.stringify(predecessorFailureSummary(error)) + '\n');
    process.exitCode = 1;
  });
}
