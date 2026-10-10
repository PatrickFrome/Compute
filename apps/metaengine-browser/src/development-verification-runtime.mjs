import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import candidateModule from './candidate-capsule.cjs';
import { verificationCanonical as canonical, verificationDigest as digest } from './development-verification-sqlite-journal.mjs';

const { verifyCandidateCapsule } = candidateModule;
const MAX_SOURCE_BYTES = 64 * 1024 * 1024;
const MAX_EDIT_BYTES = 4 * 1024 * 1024;
const SHA40 = /^[0-9a-f]{40}$/;
const SHA256 = /^sha256:[0-9a-f]{64}$/;
const inFlight = new Map();

function fail(code) { throw new Error(`development_verification_${code}`); }
function normalizedPath(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || /[\\:\x00-\x1f<>"|?*]/.test(value)) fail('path_invalid');
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.toLowerCase() === '.git' ||
      /[ .]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment))) fail('path_invalid');
  return value;
}
function bounded(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(`${label}_invalid`);
  return value;
}
function same(a, b) { return canonical(a) === canonical(b); }
function processAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error?.code !== 'ESRCH'; }
}
function git(repoRoot, args, maxBuffer = 2 * 1024 * 1024, input) {
  const env = { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_REPLACE_OBJECTS: '1' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  try {
    return execFileSync('git', ['-c', 'core.fsmonitor=false', '-C', repoRoot, ...args], {
      input, maxBuffer, timeout: 30000, windowsHide: true, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch { fail('git_read_failed'); }
}
function normalizeEdits(capsule, edits, editablePrefixes) {
  if (!Array.isArray(edits) || edits.length !== capsule.components.length) fail('edit_manifest_mismatch');
  let total = 0;
  const byPath = new Map();
  for (const edit of edits) {
    if (!edit || Object.getPrototypeOf(edit) !== Object.prototype) fail('edit_invalid');
    const name = normalizedPath(edit.path);
    if (!editablePrefixes.some(prefix => name.startsWith(prefix))) fail('edit_scope_denied');
    if (byPath.has(name.toLowerCase())) fail('edit_duplicate');
    if (edit.content_base64 !== null && (typeof edit.content_base64 !== 'string' || edit.content_base64.length > Math.ceil(MAX_EDIT_BYTES * 4 / 3))) fail('edit_bytes_invalid');
    const bytes = edit.content_base64 === null ? null : Buffer.from(edit.content_base64, 'base64');
    if (bytes && bytes.toString('base64') !== edit.content_base64) fail('edit_bytes_invalid');
    total += bytes?.length || 0;
    if (total > MAX_EDIT_BYTES) fail('edit_bytes_exceeded');
    byPath.set(name.toLowerCase(), { path: name, bytes });
  }
  return capsule.components.map(component => {
    const edit = byPath.get(normalizedPath(component.path).toLowerCase());
    if (!edit || edit.path !== component.path || (component.change === 'DELETE') !== (edit.bytes === null)) fail('edit_manifest_mismatch');
    if (edit.bytes && digest(edit.bytes) !== component.digest) fail('edit_digest_mismatch');
    return { ...component, bytes: edit.bytes };
  });
}
function normalizeCatalog(catalog) {
  if (!catalog || Object.getPrototypeOf(catalog) !== Object.prototype || !Object.keys(catalog).length) fail('catalog_invalid');
  return Object.fromEntries(Object.entries(catalog).map(([id, row]) => {
    if (!/^[A-Z][A-Z0-9_.:-]{0,63}$/.test(id) || !row || Object.getPrototypeOf(row) !== Object.prototype ||
        typeof row.executable !== 'string' || !row.executable || row.executable.length > 512 || /[\x00-\x1f]/.test(row.executable) ||
        !Array.isArray(row.args) || row.args.length > 64 || row.args.some(arg => typeof arg !== 'string' || arg.length > 4096 || arg.includes('\0'))) fail('catalog_invalid');
    const cwd = row.cwd == null || row.cwd === '.' ? '.' : normalizedPath(row.cwd);
    return [id, { id, executable: row.executable, args: [...row.args], cwd,
      timeout_ms: bounded(row.timeout_ms ?? 30000, 100, 900000, 'step_timeout'),
    }];
  }));
}
function manifest(files) {
  return files.map(file => ({ path: file.path, mode: file.mode, bytes: file.bytes.length, digest: digest(file.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
}
async function readMaterialized(root) {
  const files = [];
  let bytes = 0;
  async function walk(dir, prefix = '') {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const name = normalizedPath(prefix + entry.name);
      const full = path.join(dir, entry.name);
      const stat = await fs.lstat(full);
      if (stat.isSymbolicLink() || stat.nlink !== 1 && stat.isFile()) fail('snapshot_special_file');
      if (stat.isDirectory()) await walk(full, `${name}/`);
      else if (stat.isFile()) {
        const content = await fs.readFile(full);
        bytes += content.length;
        if (bytes > MAX_SOURCE_BYTES || files.length >= 20000) fail('snapshot_size_exceeded');
        files.push({ path: name, bytes: content });
      } else fail('snapshot_special_file');
    }
  }
  await walk(root);
  return files.map(file => ({ path: file.path, bytes: file.bytes.length, digest: digest(file.bytes) })).sort((a, b) => a.path.localeCompare(b.path));
}
function resultReceipt(stepId, observed, outputLimit) {
  if (!observed || Object.getPrototypeOf(observed) !== Object.prototype ||
      !(observed.exit_code === null || Number.isSafeInteger(observed.exit_code) && observed.exit_code >= 0 && observed.exit_code <= 255) ||
      typeof observed.timed_out !== 'boolean' || typeof observed.output_limit_exceeded !== 'boolean' ||
      !(typeof observed.stdout === 'string' || Buffer.isBuffer(observed.stdout)) ||
      !(typeof observed.stderr === 'string' || Buffer.isBuffer(observed.stderr))) fail('executor_result_invalid');
  const stdout = Buffer.from(observed.stdout);
  const stderr = Buffer.from(observed.stderr);
  if (stdout.length + stderr.length > outputLimit) fail('executor_output_exceeded');
  return {
    step_id: stepId, exit_code: observed.exit_code, timed_out: observed.timed_out,
    output_limit_exceeded: observed.output_limit_exceeded,
    passed: observed.exit_code === 0 && !observed.timed_out && !observed.output_limit_exceeded,
    stdout_bytes: stdout.length, stdout_digest: digest(stdout), stderr_bytes: stderr.length, stderr_digest: digest(stderr),
  };
}
function teardownReceipt(observation) {
  if (!observation || observation.stopped !== true || observation.persistent_state_deleted !== true) fail('executor_teardown_unconfirmed');
  return { stopped: true, persistent_state_deleted: true, observation_digest: digest(observation) };
}

/** Candidate inputs contain only digest-bound file bytes and verification IDs.
 * Commands, source/edit scopes, repository identity and executor are host-owned.
 * The injected executor MUST enforce its own isolation, bounded subprocess tree,
 * private writable layer, environment and output budgets. This prerequisite
 * runtime does not qualify an executor or grant any promotion/lease authority.
 * No arbitrary host subprocess executor is shipped or activated by this module.
 */
export class DevelopmentVerificationRuntime {
  #options;
  #ownerToken = crypto.randomBytes(16).toString('hex');
  #clock;
  constructor({ repoRoot, repository, sourcePaths, editablePrefixes, snapshotRoot, catalog, executor, journal, clock = () => Date.now(), outputLimitBytes = 1024 * 1024 } = {}) {
    if (typeof repoRoot !== 'string' || !path.isAbsolute(repoRoot) || typeof snapshotRoot !== 'string' || !path.isAbsolute(snapshotRoot) ||
        !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository || '') ||
        !Array.isArray(sourcePaths) || !sourcePaths.length || sourcePaths.length > 20000 ||
        !Array.isArray(editablePrefixes) || !editablePrefixes.length || editablePrefixes.length > 64 ||
        !executor || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(executor.executor_id || '') || !SHA256.test(executor.configuration_digest || '') ||
        ['createSession', 'runStep', 'stop', 'recover'].some(name => typeof executor[name] !== 'function') ||
        !journal || ['find', 'read', 'append'].some(name => typeof journal[name] !== 'function') || typeof clock !== 'function') fail('configuration_invalid');
    const paths = sourcePaths.map(normalizedPath).sort();
    if (new Set(paths.map(name => name.toLowerCase())).size !== paths.length) fail('source_path_duplicate');
    const prefixes = editablePrefixes.map(prefix => `${normalizedPath(String(prefix).replace(/\/$/, ''))}/`).sort();
    bounded(outputLimitBytes, 1024, 16 * 1024 * 1024, 'output_limit');
    this.#options = { repoRoot: path.resolve(repoRoot), repository, sourcePaths: paths, editablePrefixes: prefixes,
      snapshotRoot: path.resolve(snapshotRoot), catalog: normalizeCatalog(catalog), executor, journal, outputLimitBytes };
    this.#clock = clock;
  }
  #at() { return new Date(this.#clock()).toISOString(); }
  #append(events, kind, data) {
    const prior = events[0];
    const event = this.#options.journal.append({ schema: 'metaengine.development-verification.journal-event.v1',
      run_id: prior.run_id, sequence: events.length + 1, idempotency_key: prior.idempotency_key,
      binding_digest: prior.binding_digest, kind, at: this.#at(), data });
    events.push(event);
    return event;
  }
  #receipt(events, state, { reason = null, teardown = null, input_manifest_digest = null, output_manifest_digest = null } = {}) {
    const first = events[0];
    const core = { schema: 'metaengine.development-verification.receipt.v1', run_id: first.run_id,
      candidate_id: first.data.candidate_id, source_head: first.data.source_head, binding_digest: first.binding_digest,
      executor_id: first.data.executor_id, executor_configuration_digest: first.data.executor_configuration_digest,
      state, reason, input_manifest_digest, output_manifest_digest,
      steps: events.filter(event => event.kind === 'STEP_RESULT').map(event => event.data),
      pending_step_id: events.at(-1).kind === 'STEP_INTENT' ? events.at(-1).data.step_id : null,
      teardown, started_at: first.at, completed_at: this.#at(),
      evidence_origin: 'HOST_OBSERVED_TRUSTED_EXECUTOR', isolation_qualification: 'NOT_ESTABLISHED_BY_THIS_RECEIPT',
      automatic_retry_allowed: false, promotion_authorized: false, authority_effect: false };
    const receipt = { ...core, receipt_digest: digest(core) };
    this.#append(events, 'TERMINAL', { receipt });
    return Object.freeze(receipt);
  }
  async #checkRoots() {
    const options = this.#options;
    if (await fs.realpath(options.repoRoot) !== options.repoRoot || await fs.realpath(options.snapshotRoot) !== options.snapshotRoot) fail('root_reparse_denied');
    const relative = path.relative(options.repoRoot, options.snapshotRoot);
    if (!relative || !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)) fail('snapshot_root_inside_repository');
  }
  #readSource(sourceHead) {
    const options = this.#options;
    const current = git(options.repoRoot, ['rev-parse', '--verify', 'HEAD']).toString('ascii').trim();
    if (!SHA40.test(sourceHead) || current !== sourceHead) fail('source_head_changed');
    let inventory;
    try { inventory = new TextDecoder('utf-8', { fatal: true }).decode(git(options.repoRoot, ['ls-tree', '-rz', '--full-tree', sourceHead])); }
    catch { fail('source_inventory_invalid'); }
    const rows = inventory.split('\0').filter(Boolean);
    const wanted = new Set(options.sourcePaths);
    const selected = [];
    for (const row of rows) {
      const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t(.+)$/.exec(row);
      if (!match) fail('source_inventory_invalid');
      if (!wanted.has(match[4])) continue;
      normalizedPath(match[4]);
      if (!['100644', '100755'].includes(match[1]) || match[2] !== 'blob') fail('source_special_file');
      selected.push({ path: match[4], mode: match[1], oid: match[3] });
    }
    if (selected.length !== wanted.size) fail('source_path_missing');
    const objects = git(options.repoRoot, ['cat-file', '--batch'], MAX_SOURCE_BYTES + selected.length * 128, selected.map(row => `${row.oid}\n`).join(''));
    let offset = 0;
    let bytes = 0;
    const files = selected.map(row => {
      const newline = objects.indexOf(10, offset);
      if (newline < offset) fail('source_blob_invalid');
      const header = objects.subarray(offset, newline).toString('ascii').split(' ');
      const length = Number(header[2]);
      if (header[0] !== row.oid || header[1] !== 'blob' || !Number.isSafeInteger(length) || length < 0) fail('source_blob_invalid');
      bytes += length;
      if (bytes > MAX_SOURCE_BYTES || newline + length + 1 >= objects.length || objects[newline + length + 1] !== 10) fail('source_size_exceeded');
      const content = Buffer.from(objects.subarray(newline + 1, newline + 1 + length));
      if (crypto.createHash('sha1').update(`blob ${length}\0`).update(content).digest('hex') !== row.oid) fail('source_blob_identity_mismatch');
      offset = newline + length + 2;
      return { path: row.path, mode: row.mode, bytes: content };
    });
    if (offset !== objects.length || git(options.repoRoot, ['rev-parse', '--verify', 'HEAD']).toString('ascii').trim() !== sourceHead) fail('source_head_changed');
    return files;
  }
  async #snapshot(runId, sourceFiles, edits) {
    const byPath = new Map(sourceFiles.map(file => [file.path, file]));
    for (const edit of edits) {
      const previous = byPath.get(edit.path);
      if (edit.change === 'CREATE' && previous || edit.change !== 'CREATE' && !previous) fail('edit_precondition_failed');
      if (edit.change === 'DELETE') {
        if (digest(previous.bytes) !== edit.digest) fail('delete_digest_mismatch');
        byPath.delete(edit.path);
      } else byPath.set(edit.path, { path: edit.path, mode: previous?.mode || '100644', bytes: edit.bytes });
    }
    const files = [...byPath.values()].sort((a, b) => a.path.localeCompare(b.path));
    const fileNames = new Set(files.map(file => file.path.toLowerCase()));
    if (fileNames.size !== files.length ||
        files.some(file => file.path.split('/').slice(0, -1).some((_, index, segments) => fileNames.has(segments.slice(0, index + 1).join('/').toLowerCase()))) ||
        files.reduce((sum, file) => sum + file.bytes.length, 0) > MAX_SOURCE_BYTES) fail('output_manifest_invalid');
    const root = path.join(this.#options.snapshotRoot, runId);
    await fs.mkdir(root, { mode: 0o700 });
    for (const file of files) {
      const target = path.join(root, ...file.path.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
      await fs.writeFile(target, file.bytes, { flag: 'wx', mode: file.mode === '100755' ? 0o500 : 0o400 });
    }
    return { root, input_manifest_digest: digest(manifest(sourceFiles)), output_manifest_digest: digest(manifest(files)),
      contentManifest: manifest(files).map(({ mode, ...row }) => row) };
  }
  async #removeSnapshot(runId) {
    await this.#checkRoots();
    const target = path.join(this.#options.snapshotRoot, runId);
    let stat;
    try { stat = await fs.lstat(target); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
    if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(target) !== target) fail('snapshot_cleanup_reparse_denied');
    await fs.rm(target, { recursive: true, force: true });
  }
  async run(request = {}) {
    if (!request || Object.getPrototypeOf(request) !== Object.prototype ||
        Object.keys(request).sort().join('|') !== ['idempotency_key', 'capsule', 'edits'].sort().join('|')) fail('request_invalid');
    const { idempotency_key, capsule, edits } = request;
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{3,127}$/.test(idempotency_key || '')) fail('key_invalid');
    await this.#checkRoots();
    const options = this.#options;
    verifyCandidateCapsule(capsule, { repository: options.repository, head: capsule?.source?.head, ref: capsule?.source?.ref });
    const normalizedEdits = normalizeEdits(capsule, edits, options.editablePrefixes);
    const steps = capsule.verification_plan.map(step => options.catalog[step.id]);
    if (steps.some(step => !step)) fail('step_not_registered');
    const binding = { candidate_digest: capsule.digest, source_head: capsule.source.head,
      edits: normalizedEdits.map(({ bytes, ...row }) => row), catalog: steps,
      source_paths: options.sourcePaths, editable_prefixes: options.editablePrefixes,
      repository: options.repository, repo_root: options.repoRoot, snapshot_root: options.snapshotRoot,
      executor_id: options.executor.executor_id, executor_configuration_digest: options.executor.configuration_digest,
      output_limit_bytes: options.outputLimitBytes };
    const bindingDigest = digest(binding);
    const runId = `verification_${digest({ idempotency_key, binding_digest: bindingDigest }).slice(7)}`;
    const previous = options.journal.find(idempotency_key);
    if (previous.length) {
      if (previous[0].binding_digest !== bindingDigest || previous[0].run_id !== runId) fail('idempotency_binding_changed');
      if (previous.at(-1).kind === 'TERMINAL') return Object.freeze(previous.at(-1).data.receipt);
      fail('unfinished_requires_explicit_recovery');
    }
    if (inFlight.has(runId)) fail('already_running');
    inFlight.set(runId, this.#ownerToken);
    const events = [];
    try {
      const sessionKey = `verify_${runId.slice('verification_'.length)}`;
      const first = options.journal.append({ schema: 'metaengine.development-verification.journal-event.v1', run_id: runId,
        sequence: 1, idempotency_key, binding_digest: bindingDigest, kind: 'INTENT', at: this.#at(),
        data: { owner_pid: process.pid, owner_token: this.#ownerToken, session_key: sessionKey,
          candidate_id: capsule.candidate_id, source_head: capsule.source.head,
          executor_id: options.executor.executor_id, executor_configuration_digest: options.executor.configuration_digest,
          snapshot_root: options.snapshotRoot,
          step_ids: steps.map(step => step.id) } });
      events.push(first);
      let session = null;
      let snapshot = null;
      let teardown = null;
      let state = 'FAILED';
      let reason = null;
      try {
        snapshot = await this.#snapshot(runId, this.#readSource(capsule.source.head), normalizedEdits);
        session = await options.executor.createSession({ session_key: sessionKey, snapshot_dir: snapshot.root,
          snapshot_digest: snapshot.output_manifest_digest, output_limit_bytes: options.outputLimitBytes });
        this.#append(events, 'SESSION', { session_id: session?.session_id });
        state = 'PASSED';
        for (const step of steps) {
          if (!same(await readMaterialized(snapshot.root), snapshot.contentManifest)) fail('snapshot_changed');
          this.#append(events, 'STEP_INTENT', { step_id: step.id });
          const observed = await options.executor.runStep({ session_key: sessionKey, session_id: session.session_id,
            step: structuredClone(step), output_limit_bytes: options.outputLimitBytes });
          const result = resultReceipt(step.id, observed, options.outputLimitBytes);
          if (!same(await readMaterialized(snapshot.root), snapshot.contentManifest)) fail('snapshot_changed');
          this.#append(events, 'STEP_RESULT', result);
          if (!result.passed) { state = 'FAILED'; reason = 'required_step_failed'; break; }
        }
      } catch (error) { state = events.at(-1)?.kind === 'STEP_INTENT' || session ? 'AMBIGUOUS' : 'FAILED'; reason = String(error?.message || error).slice(0, 240); }
      try {
        const observation = session ? await options.executor.stop({ session_key: sessionKey, session_id: session.session_id }) :
          await options.executor.recover({ session_key: sessionKey });
        teardown = teardownReceipt(observation);
        await this.#removeSnapshot(runId);
      } catch (error) { state = 'AMBIGUOUS'; reason = String(error?.message || error).slice(0, 240); }
      return this.#receipt(events, state, { reason, teardown, input_manifest_digest: snapshot?.input_manifest_digest || null, output_manifest_digest: snapshot?.output_manifest_digest || null });
    } finally { inFlight.delete(runId); }
  }
  async recover(runId) {
    const options = this.#options;
    const events = options.journal.read(runId);
    if (!events.length) fail('run_not_found');
    if (events.at(-1).kind === 'TERMINAL') return Object.freeze(events.at(-1).data.receipt);
    const first = events[0];
    if (first.data.executor_id !== options.executor.executor_id || first.data.executor_configuration_digest !== options.executor.configuration_digest || first.data.snapshot_root !== options.snapshotRoot) fail('recovery_configuration_changed');
    if (inFlight.has(runId) || processAlive(first.data.owner_pid)) fail('recovery_owner_still_alive');
    let teardown = null;
    let reason = 'process_crash_execution_not_replayed';
    try {
      teardown = teardownReceipt(await options.executor.recover({ session_key: first.data.session_key }));
      await this.#removeSnapshot(runId);
    } catch (error) { reason = `recovery_teardown_unconfirmed:${String(error?.message || error)}`.slice(0, 240); }
    return this.#receipt(events, 'AMBIGUOUS', { reason, teardown });
  }
}
