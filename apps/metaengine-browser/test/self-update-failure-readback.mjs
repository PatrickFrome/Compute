// Failure-only, read-only observations. This helper never installs, launches a
// Browser, repairs a journal, or treats absent evidence as a successful effect.
import fs from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';

const require = createRequire(import.meta.url);
const HASH = /^[a-f0-9]{64}$/;
const HEAD = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const VERSION = /^\d+\.\d+\.\d+-dev\.\d+\.1$/;
const MAX_JSON = 65536;
const MAX_ASAR = 512 * 1024 * 1024;
const STATES = new Set(['PREPARED', 'INSTALLING', 'SUCCESSOR_BOOTED', 'QUALIFIED',
  'AMBIGUOUS_INSTALL', 'QUARANTINED', 'SUPERSEDED']);
const observations = new Set(['READABLE', 'ABSENT', 'OVERSIZE', 'UNSAFE_PATH', 'CHANGED', 'INVALID_JSON', 'UNREADABLE']);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const safeVersion = value => typeof value === 'string' && value.length <= 96 && VERSION.test(value) ? value : null;
const safeHash = value => typeof value === 'string' && HASH.test(value) ? value : null;
const safeHead = value => typeof value === 'string' && HEAD.test(value) ? value : null;
const boolean = value => typeof value === 'boolean' ? value : null;
const mode = value => ['NORMAL', 'PROBE_ONLY'].includes(value) ? value : null;
const safeState = value => STATES.has(value) ? value : null;
const fail = code => { throw Object.assign(new Error(code), {code}); };
const stamp = stat => [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs, stat.birthtimeMs].join(':');

async function regularFile(file, maximum) {
  if (!path.isAbsolute(file || '')) fail('UNSAFE_PATH');
  let cursor = path.parse(file).root;
  for (const part of path.relative(cursor, file).split(path.sep).filter(Boolean)) {
    cursor = path.join(cursor, part);
    const stat = await fs.lstat(cursor);
    if (stat.isSymbolicLink()) fail('UNSAFE_PATH');
    if (cursor === file) {
      if (!stat.isFile() || stat.nlink !== 1) fail('UNSAFE_PATH');
      if (stat.size > maximum) fail('OVERSIZE');
      return stat;
    }
    if (!stat.isDirectory()) fail('UNSAFE_PATH');
  }
  fail('UNSAFE_PATH');
}
function readFailure(error) {
  if (error?.code === 'ENOENT') return {observation: 'ABSENT'};
  return {observation: observations.has(error?.code) ? error.code : 'UNREADABLE'};
}
async function readJson(file, maximum = MAX_JSON) {
  let handle;
  try {
    const before = await regularFile(file, maximum);
    handle = await fs.open(file, 'r');
    if (stamp(await handle.stat()) !== stamp(before)) fail('CHANGED');
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const part = await handle.read(bytes, length, bytes.length - length, length);
      if (!part.bytesRead) break;
      length += part.bytesRead;
    }
    if (length !== before.size || stamp(await handle.stat()) !== stamp(before)
      || stamp(await regularFile(file, maximum)) !== stamp(before)) fail('CHANGED');
    const raw = bytes.subarray(0, length);
    let value;
    try { value = JSON.parse(raw.toString('utf8').replace(/^\uFEFF/, '')); }
    catch { return {observation: 'INVALID_JSON', bytes: length, sha256: hash(raw)}; }
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {observation: 'INVALID_JSON', bytes: length, sha256: hash(raw)};
    }
    return {observation: 'READABLE', bytes: length, sha256: hash(raw), value};
  } catch (error) { return readFailure(error); }
  finally { await handle?.close().catch(() => {}); }
}

async function readInstalledImage(archive) {
  try {
    const before = await regularFile(archive, MAX_ASAR);
    const digest = createHash('sha256');
    let bytes = 0;
    for await (const chunk of createReadStream(archive)) {
      bytes += chunk.length;
      if (bytes > MAX_ASAR || bytes > before.size) fail('CHANGED');
      digest.update(chunk);
    }
    const asar = require('@electron/asar');
    if (typeof asar.uncache !== 'function') fail('UNREADABLE');
    asar.uncache(archive);
    const entry = asar.statFile(archive, 'package.json', false);
    if (!entry || !Number.isSafeInteger(entry.size) || entry.size < 1 || entry.size > MAX_JSON
      || entry.unpacked || 'files' in entry || 'link' in entry) fail('UNREADABLE');
    const raw = asar.extractFile(archive, 'package.json', false);
    if (!Buffer.isBuffer(raw) || raw.length !== entry.size) fail('CHANGED');
    const pkg = JSON.parse(raw.toString('utf8'));
    if (bytes !== before.size || stamp(await regularFile(archive, MAX_ASAR)) !== stamp(before)) fail('CHANGED');
    return {observation: 'READABLE', bytes, sha256: digest.digest('hex'), version: safeVersion(pkg?.version)};
  } catch (error) { return readFailure(error); }
}

function metadata(input) {
  return {
    observation: observations.has(input?.observation) ? input.observation : 'UNREADABLE',
    bytes: Number.isSafeInteger(input?.bytes) && input.bytes >= 0 ? input.bytes : null,
    sha256: safeHash(input?.sha256),
  };
}
function receiptProjection(input, kind) {
  const value = input?.observation === 'READABLE' ? input.value : null;
  const schema = kind === 'transaction' ? 'metaengine.self-update.transaction.v1'
    : kind === 'pre_install' ? 'metaengine.self-update.pre-install-receipt.v1'
    : 'metaengine.self-update.successor-receipt.v1';
  const valid = value?.schema === schema;
  const out = {...metadata(input), schema_matches: valid};
  if (!valid) return out;
  out.version = safeVersion(kind === 'transaction' ? value.target_version : value.version);
  out.authority_effect = boolean(value.authority_effect);
  if (kind === 'transaction') {
    out.state = safeState(value.state);
    out.source_version = safeVersion(value.source_version);
    out.transaction_id = typeof value.transaction_id === 'string' && UUID.test(value.transaction_id) ? value.transaction_id : null;
    out.automatic_retry_allowed = boolean(value.automatic_retry_allowed);
    out.physical_effect_attempted = boolean(value.evidence?.physical_effect_attempted);
  } else {
    out.successor_startup = mode(value.successor_startup);
    if (kind === 'pre_install') {
      out.available_version = safeVersion(value.available_version);
      out.metadata_verified = boolean(value.metadata_verified);
      out.restart_gate_safe = boolean(value.restart_gate_safe);
    } else {
      out.primary_instance = boolean(value.primary_instance);
      out.app_id_matches = value.app_id === 'com.metaengine.browser.test';
      out.pre_install_receipt_sha256 = safeHash(value.pre_install_receipt_sha256);
    }
  }
  return out;
}

export function projectSelfUpdateFailureReadback({context, preInstall, transaction, successor, installedImage} = {}) {
  const target = safeVersion(context?.target_version);
  const baseline = safeVersion(context?.baseline_version);
  const pre = receiptProjection(preInstall, 'pre_install');
  const journal = receiptProjection(transaction, 'transaction');
  const next = receiptProjection(successor, 'successor');
  const installed = {...metadata(installedImage), package_version: safeVersion(installedImage?.version)};
  const baselineHash = safeHash(context?.baseline_asar_sha256);
  installed.matches_baseline_bytes = installed.observation === 'READABLE' && installed.sha256 && baselineHash
    ? installed.sha256 === baselineHash : null;
  installed.target_version_observed = installed.observation === 'READABLE' && target
    ? installed.package_version === target : null;
  // Version metadata and a changed archive do not attest all target image bytes.
  installed.exact_target_bytes_verified = false;
  installed.installed_executable_verified = false;
  const preBound = Boolean(target && pre.schema_matches && pre.version === target
    && pre.available_version === target && pre.metadata_verified === true && pre.restart_gate_safe === true
    && pre.authority_effect === false && pre.successor_startup !== null && pre.sha256);
  const successorBound = Boolean(preBound && next.schema_matches && next.version === target
    && next.primary_instance === true && next.app_id_matches === true && next.authority_effect === false
    && next.successor_startup === pre.successor_startup && next.pre_install_receipt_sha256 === pre.sha256);
  let classification = 'INSTALLED_IMAGE_UNPROVEN';
  if (successorBound) classification = 'SUCCESSOR_RECEIPT_PRESENT_REQUIRES_QUALIFICATION';
  else if (installed.matches_baseline_bytes === true) classification = 'BASELINE_BYTES_PRESENT_SUCCESSOR_UNPROVEN';
  else if (installed.target_version_observed === true) classification = 'TARGET_VERSION_PRESENT_SUCCESSOR_UNPROVEN';
  else if (installed.matches_baseline_bytes === false) classification = 'CHANGED_IMAGE_SUCCESSOR_UNPROVEN';
  return {
    schema: 'metaengine.browser.self-update-failure-readback.v1',
    classification,
    source_head: safeHead(context?.source_head),
    baseline_version: baseline,
    target_version: target,
    pre_install: pre,
    transaction: journal,
    successor: next,
    installed_image: installed,
    pre_install_binding_observed: preBound,
    successor_binding_observed: successorBound,
    installer_result_observed: false,
    installation_outcome_proven: false,
    old_uninstaller_execution_observed: false,
    capture_only: true,
    verification_succeeded: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  };
}

function validateContext(value) {
  if (value?.schema !== 'metaengine.self-update.failure-context.v1'
    || !path.isAbsolute(value.profile_path || '') || !path.isAbsolute(value.installed_asar_path || '')
    || path.basename(value.installed_asar_path) !== 'app.asar'
    || path.basename(path.dirname(value.installed_asar_path)) !== 'resources'
    || !safeVersion(value.baseline_version) || !safeVersion(value.target_version)
    || !safeHash(value.baseline_asar_sha256) || !safeHead(value.source_head)) fail('CONTEXT_UNAVAILABLE');
  return value;
}

export async function collectSelfUpdateFailureReadback(context) {
  validateContext(context);
  const read = name => readJson(path.join(context.profile_path, name));
  const [preInstall, transaction, successor, installedImage] = await Promise.all([
    read('metaengine-self-update-pre-install-receipt-v1.json'),
    read('metaengine-self-update-transaction-v1.json'),
    read('metaengine-self-update-successor-receipt-v1.json'),
    readInstalledImage(context.installed_asar_path),
  ]);
  return projectSelfUpdateFailureReadback({context, preInstall, transaction, successor, installedImage});
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4 || process.argv[2] !== '--context') fail('CONTEXT_UNAVAILABLE');
    const read = await readJson(path.resolve(process.argv[3]), 8192);
    if (read.observation !== 'READABLE') fail('CONTEXT_UNAVAILABLE');
    const result = await collectSelfUpdateFailureReadback(read.value);
    const output = JSON.stringify(result);
    if (Buffer.byteLength(output) > 16384) fail('OUTPUT_OVERSIZE');
    process.stdout.write(output + '\n');
  } catch {
    process.stdout.write(JSON.stringify({
      schema: 'metaengine.browser.self-update-failure-readback.v1',
      classification: 'CAPTURE_UNAVAILABLE', capture_only: true, verification_succeeded: false,
      installation_outcome_proven: false, automatic_retry_allowed: false, authority_effect: false,
    }) + '\n');
  }
}
