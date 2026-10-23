import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { StringDecoder } from 'node:string_decoder';
import { CODEX_CLI_RUN_RECEIPT_SCHEMA, codexCliResultSchema, validateCodexCliResult } from './codex-cli-result-schema.mjs';
import { protectOwnerOnlyWindowsDirectory, verifyOwnerOnlyWindowsStorage } from './private-windows-storage-acl.mjs';

const SHA = /^[a-f0-9]{64}$/; const HEAD = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const fail = reason => new Error(`codex_cli_${reason}`);
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const inside = (root, target) => { const rel = path.relative(root, target); return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); };
const samePath = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const overlap = (a, b) => samePath(a, b) || inside(a, b) || inside(b, a);

export function codexCliEnvironment(codexHome, source = process.env) {
  if (!path.isAbsolute(codexHome || '')) throw fail('auth_home_absolute_required');
  const allowed = new Set(['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'USERPROFILE',
    'HOMEDRIVE', 'HOMEPATH', 'APPDATA', 'LOCALAPPDATA', 'PROGRAMFILES', 'PROGRAMFILES(X86)', 'COMSPEC',
    'LANG', 'LC_ALL', 'NUMBER_OF_PROCESSORS', 'PROCESSOR_ARCHITECTURE']);
  const env = Object.fromEntries(Object.entries(source).filter(([key, value]) => allowed.has(key.toUpperCase()) && typeof value === 'string'));
  return { ...env, CODEX_HOME: codexHome, NO_COLOR: '1', GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null', GIT_PAGER: 'cat' };
}

export function codexCliTemporaryEnvironment(environment, temporaryPath) {
  if (!path.isAbsolute(temporaryPath || '')) throw fail('temporary_path_absolute_required');
  return { ...environment, TEMP: temporaryPath, TMP: temporaryPath, TMPDIR: temporaryPath };
}

export function buildCodexCliArgv({ role, worktreePath, schemaPath, resultPath, model = null }) {
  if (!['IMPLEMENTER', 'CRITIC'].includes(role)) throw fail('role_invalid');
  for (const value of [worktreePath, schemaPath, resultPath]) if (!path.isAbsolute(value || '')) throw fail('argv_absolute_path_required');
  if (model !== null && !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(model)) throw fail('model_invalid');
  return ['-a', 'never', '--no-daemon', '-c', 'windows.sandbox="elevated"',
    '-c', 'sandbox_workspace_write.writable_roots=[]', '-c', 'sandbox_workspace_write.network_access=false',
    'exec', '--ignore-user-config',
    '--sandbox', role === 'CRITIC' ? 'read-only' : 'workspace-write', '--json', '--color', 'never',
    ...(model ? ['--model', model] : []), '--output-schema', schemaPath, '--output-last-message', resultPath,
    '-C', worktreePath, '-'];
}

async function durableJson(file, value, exclusive = false) {
  const handle = await fs.open(file, exclusive ? 'wx' : 'w', 0o600);
  try { await handle.writeFile(`${JSON.stringify(value)}\n`); await handle.sync(); } finally { await handle.close(); }
}

async function boundedRead(file, maxBytes) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maxBytes) throw fail('file_read_denied');
  const handle = await fs.open(file, 'r');
  try { const after = await handle.stat(); if (after.ino !== stat.ino || after.size !== stat.size) throw fail('file_changed_during_read');
    const bytes = await handle.readFile(); if (bytes.length > maxBytes) throw fail('file_too_large'); return bytes;
  } finally { await handle.close(); }
}

async function executableDigest(file) {
  const stat = await fs.lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024 * 1024) throw fail('executable_read_denied');
  const digest = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  const after = await fs.lstat(file);
  if (after.size !== stat.size || after.ino !== stat.ino || after.mtimeMs !== stat.mtimeMs) throw fail('executable_changed_during_hash');
  return digest.digest('hex');
}

async function git(cwd, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=', ...args], {
      cwd, env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'],
    });
    const chunks = []; let bytes = 0, overflow = false;
    const deadline = setTimeout(() => { overflow = true; child.kill(); }, 10000);
    child.stdout.on('data', data => { bytes += data.length; if (bytes > 1024 * 1024) { overflow = true; child.kill(); } else chunks.push(data); });
    child.stderr.on('data', () => {});
    child.once('error', () => { clearTimeout(deadline); reject(fail('git_spawn_failed')); });
    child.once('close', code => { clearTimeout(deadline); if (code !== 0 || overflow) reject(fail('git_read_failed')); else resolve(Buffer.concat(chunks)); });
  });
}

async function gitProof(root, env) {
  const head = (await git(root, ['rev-parse', 'HEAD'], env)).toString().trim();
  if (!HEAD.test(head)) throw fail('git_head_invalid');
  const status = await git(root, ['status', '--porcelain=v1', '-z', '--untracked-files=all', '--no-renames'], env);
  const rows = status.toString('utf8').split('\0').filter(Boolean);
  if (rows.length > 128) throw fail('changed_file_budget_exceeded');
  const files = []; let total = 0;
  for (const row of rows) {
    const relative = row.slice(3); const target = path.resolve(root, relative);
    if (row.length < 4 || !inside(root, target) || relative.split(/[\\/]/).includes('.git')) throw fail('git_path_invalid');
    let bytes = null;
    try {
      const physical = await fs.realpath(target);
      if (!inside(root, physical)) throw fail('changed_file_escape');
      // Reject all symlink ancestors, including a link whose destination stays inside.
      let current = root;
      for (const part of path.relative(root, target).split(path.sep)) {
        current = path.join(current, part); if ((await fs.lstat(current)).isSymbolicLink()) throw fail('changed_file_symlink');
      }
      bytes = await boundedRead(target, 512 * 1024); total += bytes.length;
      if (total > 4 * 1024 * 1024) throw fail('changed_byte_budget_exceeded');
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    files.push({ path: relative.replaceAll('\\', '/'), status: row.slice(0, 2), sha256: bytes === null ? null : hash(bytes), bytes: bytes?.length ?? 0 });
  }
  const diff = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD', '--'], env);
  return { head, status_sha256: hash(status), diff_sha256: hash(diff), changed_files: files,
    artifact_sha256: hash(JSON.stringify({ head, files, diff_sha256: hash(diff) })), clean: rows.length === 0 };
}

function leaseBinding(value, role) {
  if (!value || !UUID.test(value.task_id || '') || !/^agent_[a-z0-9-]{8,64}$/.test(value.agent_id || '')
    || !HEAD.test(value.base_sha || '') || !Number.isSafeInteger(value.lease_generation) || value.lease_generation < 1
    || !Number.isSafeInteger(value.agent_generation_epoch) || value.agent_generation_epoch < 1
    || !['IMPLEMENTER', 'CRITIC'].includes(role)) throw fail('lease_binding_invalid');
  return Object.freeze({ task_id: value.task_id, agent_id: value.agent_id, base_sha: value.base_sha,
    lease_generation: value.lease_generation, agent_generation_epoch: value.agent_generation_epoch, role });
}

function authorized(value, binding, root) {
  if (!value || value.authorized !== true || value.trust_namespace !== 'LOCAL_OPERATOR_QA'
    || !UUID.test(value.permit_id || '') || !/^S-1-/.test(value.user_sid || '')
    || !Number.isSafeInteger(value.owner_epoch) || value.owner_epoch < 1
    || !UUID.test(value.workspace_id || '') || !UUID.test(value.project_id || '')
    || !samePath(value.worktree_path || '', root) || !HEAD.test(value.base_sha || '')
    || Object.entries(binding).some(([key, expected]) => value[key] !== expected)
    || !Number.isFinite(Date.parse(value.expires_at)) || Date.parse(value.expires_at) <= Date.now()) throw fail('native_lease_authorization_denied');
  return value;
}

/**
 * One leased execution. No scheduler, task allocator, model retry, auth copying, or completion authority.
 * authorizeLease is private native composition; callers cannot supply a JSON approval.
 */
export function createCodexCliRunner({ executablePath, expectedExecutableSha256, codexHome, journalRoot,
  workerTempRoot, protectTemporaryStorage = protectOwnerOnlyWindowsDirectory, verifyTemporaryStorage = verifyOwnerOnlyWindowsStorage,
  authorizeLease, processController, model = null, timeoutMs = 600000, maxOutputBytes = 8 * 1024 * 1024 } = {}) {
  if (![executablePath, codexHome, journalRoot, workerTempRoot].every(value => path.isAbsolute(value || ''))
    || !SHA.test(expectedExecutableSha256 || '') || typeof authorizeLease !== 'function'
    || typeof processController?.spawn !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 1800000
    || typeof protectTemporaryStorage !== 'function' || typeof verifyTemporaryStorage !== 'function'
    || [journalRoot, codexHome, path.dirname(executablePath)].some(root => overlap(root, workerTempRoot))
    || !Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1024 || maxOutputBytes > 16 * 1024 * 1024) throw fail('composition_invalid');
  const env = codexCliEnvironment(codexHome);
  const keyOf = binding => hash(JSON.stringify({ task_id: binding.task_id, lease_generation: binding.lease_generation, role: binding.role }));
  const inspect = async binding => {
    const directory = path.join(journalRoot, keyOf(binding));
    try { return JSON.parse((await boundedRead(path.join(directory, 'receipt.json'), 256 * 1024)).toString()); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    try { const attempt = JSON.parse((await boundedRead(path.join(directory, 'attempt.json'), 65536)).toString());
      return { ...attempt, state: 'AMBIGUOUS', terminal_reason: 'PRIOR_ATTEMPT_REQUIRES_RECONCILIATION', automatic_retry_allowed: false };
    } catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
  };
  return Object.freeze({ inspect,
    async run(request, { signal } = {}) {
      const role = request?.role; const binding = leaseBinding(request?.lease, role);
      if (typeof request.prompt !== 'string' || !request.prompt.trim() || Buffer.byteLength(request.prompt) > 32000) throw fail('prompt_invalid');
      const prior = await inspect(binding); if (prior) return { ...prior, replayed: false, prior_attempt: true };
      if (signal?.aborted) throw fail('cancelled_before_attempt');
      const root = await fs.realpath(request.worktreePath);
      if (!samePath(root, request.worktreePath) || (await fs.lstat(root)).isSymbolicLink()) throw fail('worktree_path_invalid');
      if (inside(root, path.resolve(journalRoot)) || samePath(root, journalRoot)) throw fail('journal_inside_workspace');
      if (overlap(root, workerTempRoot)) throw fail('temporary_root_overlaps_workspace');
      const gitTop = (await git(root, ['rev-parse', '--show-toplevel'], env)).toString().trim();
      if (!samePath(gitTop, root) || !(await fs.lstat(path.join(root, '.git'))).isFile()) throw fail('managed_worktree_required');
      const gitDir = (await git(root, ['rev-parse', '--absolute-git-dir'], env)).toString().trim();
      if (!(await fs.lstat(path.join(gitDir, 'locked'))).isFile()) throw fail('locked_worktree_required');
      // A task cannot quietly enable project-local Codex configuration or hooks.
      try { await fs.lstat(path.join(root, '.codex', 'config.toml')); throw fail('project_config_not_permitted'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const permit = authorized(await authorizeLease({ phase: 'BEFORE_ATTEMPT', binding, worktreePath: root }), binding, root);
      if (await executableDigest(executablePath) !== expectedExecutableSha256) throw fail('executable_digest_mismatch');
      const before = await gitProof(root, env);
      if (before.head !== binding.base_sha) throw fail('base_head_mismatch');
      let subject = null;
      if (role === 'IMPLEMENTER' && !before.clean) throw fail('writer_worktree_dirty');
      if (role === 'CRITIC') {
        subject = await inspect({ ...request.subject, role: 'IMPLEMENTER' });
        if (subject?.state !== 'RESULT_READY' || subject.result?.outcome !== 'DONE'
          || subject.agent_id === binding.agent_id || subject.task_id === binding.task_id
          || subject.run_id !== request.subject?.run_id || subject.result_sha256 !== request.subject?.result_sha256
          || subject.git_after?.artifact_sha256 !== request.subject?.git_artifact_sha256
          || subject.git_after?.head !== request.subject?.source_head
          || before.artifact_sha256 !== request.subject?.git_artifact_sha256
          || before.head !== request.subject?.source_head) throw fail('independent_critic_subject_invalid');
      }
      await fs.mkdir(journalRoot, { recursive: true, mode: 0o700 });
      const directory = path.join(journalRoot, keyOf(binding));
      try { await fs.mkdir(directory, { mode: 0o700 }); }
      catch (error) { if (error.code !== 'EEXIST') throw error;
        return (await inspect(binding)) || { ...binding, state: 'AMBIGUOUS', terminal_reason: 'RESERVATION_EXISTS', automatic_retry_allowed: false };
      }
      const runId = crypto.randomUUID(); const schemaPath = path.join(directory, 'result-schema.json');
      const resultPath = path.join(directory, 'result.json');
      const startedAt = new Date().toISOString();
      const receipt = { schema: CODEX_CLI_RUN_RECEIPT_SCHEMA, provider: 'CODEX_CLI', trust_namespace: 'LOCAL_OPERATOR_QA',
        ...binding, run_id: runId, permit_id: permit.permit_id, owner_epoch: permit.owner_epoch, user_sid: permit.user_sid,
        workspace_id: permit.workspace_id, project_id: permit.project_id, worktree_path: root,
        executable_sha256: expectedExecutableSha256, sandbox_mode: role === 'CRITIC' ? 'read-only' : 'workspace-write',
        started_at: startedAt, state: 'RESERVED', git_before: before, subject_run_id: subject?.run_id || null,
        subject_result_sha256: subject?.result_sha256 || null, automatic_retry_allowed: false, production_qualified: false,
        subject_git_artifact_sha256: subject?.git_after?.artifact_sha256 || null, subject_source_head: subject?.git_after?.head || null,
        useful_work_verified: false, model_claim_authority: false, authority_effect: false };
      await durableJson(path.join(directory, 'attempt.json'), receipt, true);
      let handle = null, abortReason = null, eventError = null, outputBytes = 0, eventCount = 0, threadId = null,
        completedTurns = 0, failedTurns = 0, pending = '', timer = null, processResult = null;
      const decoder = new StringDecoder('utf8'); const stdoutHash = crypto.createHash('sha256');
      const stderrHash = crypto.createHash('sha256');
      const stdoutFile = await fs.open(path.join(directory, 'events.jsonl'), 'wx', 0o600);
      const stderrFile = await fs.open(path.join(directory, 'stderr.log'), 'wx', 0o600);
      let writes = Promise.resolve();
      const terminate = reason => { abortReason ||= reason; if (handle) void handle.terminate(reason).catch(() => {}); };
      const onAbort = () => terminate('CANCELLED');
      const parseLine = line => {
        if (!line.trim()) return;
        if (Buffer.byteLength(line) > 256 * 1024) throw fail('event_line_too_large');
        const event = JSON.parse(line); if (!event || typeof event.type !== 'string') throw fail('event_shape_invalid');
        eventCount++;
        if (event.type === 'thread.started') {
          if (!UUID.test(event.thread_id || '') || (threadId && threadId !== event.thread_id)) throw fail('thread_binding_invalid');
          threadId = event.thread_id;
        }
        if (event.type === 'turn.completed') completedTurns++;
        if (event.type === 'turn.failed' || event.type === 'error') failedTurns++;
      };
      const output = (channel, data) => {
        outputBytes += data.length;
        if (outputBytes > maxOutputBytes) { eventError ||= 'OUTPUT_BUDGET_EXCEEDED'; terminate(eventError); return; }
        (channel === 'stdout' ? stdoutHash : stderrHash).update(data);
        writes = writes.then(() => (channel === 'stdout' ? stdoutFile : stderrFile).write(data)).catch(() => {
          eventError ||= 'JOURNAL_WRITE_FAILED'; terminate(eventError);
        });
        if (channel === 'stdout') {
          pending += decoder.write(data);
          try { let index; while ((index = pending.indexOf('\n')) >= 0) { parseLine(pending.slice(0, index)); pending = pending.slice(index + 1); }
            if (Buffer.byteLength(pending) > 256 * 1024) throw fail('event_line_too_large');
          } catch { eventError ||= 'JSONL_INVALID'; terminate(eventError); }
        }
      };
      try {
        // Never grant the CLI sandbox write access to the shared Windows Temp,
        // journal, auth directory, or any repository-controlled temp location.
        let newTempRoot = false;
        try { await fs.mkdir(workerTempRoot, { mode: 0o700 }); newTempRoot = true; }
        catch (error) { if (error.code !== 'EEXIST') throw error; }
        if (!samePath(await fs.realpath(workerTempRoot), workerTempRoot)
          || (await fs.lstat(workerTempRoot)).isSymbolicLink()) throw fail('temporary_root_alias');
        if (newTempRoot) await protectTemporaryStorage(workerTempRoot);
        else await verifyTemporaryStorage(workerTempRoot, { operation: 'VERIFY_DIRECTORY' });
        const temporaryPath = path.join(workerTempRoot, runId); await fs.mkdir(temporaryPath, { mode: 0o700 });
        const temporaryEvidence = await protectTemporaryStorage(temporaryPath);
        if (temporaryEvidence?.owner_dacl_verified !== true) throw fail('temporary_storage_unverified');
        receipt.temporary_path = temporaryPath;
        receipt.temporary_storage_evidence_sha256 = hash(JSON.stringify(temporaryEvidence));
        const deadlineAt = new Date(Math.min(Date.now() + timeoutMs, Date.parse(permit.expires_at))).toISOString();
        receipt.execution_deadline = deadlineAt;
        await durableJson(schemaPath, codexCliResultSchema(role, subject?.result_sha256));
        const args = buildCodexCliArgv({ role, worktreePath: root, schemaPath, resultPath, model });
        timer = setTimeout(() => terminate('TIMEOUT'), timeoutMs + 30000);
        signal?.addEventListener('abort', onAbort, { once: true });
        if (signal?.aborted) throw fail('cancelled_before_spawn');
        handle = await processController.spawn({ executablePath, expectedExecutableSha256, args, cwd: root,
          env: codexCliTemporaryEnvironment(env, temporaryPath), timeoutMs, deadlineAt, runId, binding });
        handle.stdout.on('data', data => output('stdout', data)); handle.stderr.on('data', data => output('stderr', data));
        const proof = handle.proof;
        if (!proof || proof.tree_control_bound !== true || proof.started_suspended !== true || proof.user_sid !== permit.user_sid
          || proof.executable_sha256 !== expectedExecutableSha256 || !/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(proof.process_incarnation_id || '')) throw fail('native_process_proof_invalid');
        receipt.process = structuredClone(proof); receipt.pid = proof.pid; receipt.process_incarnation_id = proof.process_incarnation_id;
        receipt.job_id = proof.job_id;
        await durableJson(path.join(directory, 'process.json'), receipt, true);
        const recheck = authorized(await authorizeLease({ phase: 'BEFORE_RESUME', binding, worktreePath: root,
          process: structuredClone(proof), run_id: runId, temporary_path: temporaryPath,
          temporary_storage_evidence_sha256: receipt.temporary_storage_evidence_sha256 }), binding, root);
        if (recheck.permit_id !== permit.permit_id || recheck.owner_epoch !== permit.owner_epoch || abortReason || signal?.aborted) throw fail('lease_changed_before_resume');
        receipt.state = 'EXECUTION_STARTED';
        receipt.execution_deadline = new Date(Math.min(Date.parse(deadlineAt), Date.parse(recheck.expires_at))).toISOString();
        await durableJson(path.join(directory, 'execution-started.json'), receipt, true);
        await handle.resume(request.prompt, { deadlineAt: receipt.execution_deadline });
        processResult = await handle.completion;
        pending += decoder.end();
        try { if (pending.trim()) parseLine(pending); } catch { eventError ||= 'JSONL_INVALID'; }
        await writes;
        receipt.thread_id = threadId; receipt.event_count = eventCount; receipt.process_result = processResult;
        const after = await gitProof(root, env); receipt.git_after = after;
        const finalPermit = authorized(await authorizeLease({ phase: 'AFTER_EXECUTION', binding, worktreePath: root,
          process: receipt.process, run_id: runId, git_after: after }), binding, root);
        if (finalPermit.permit_id !== permit.permit_id || finalPermit.owner_epoch !== permit.owner_epoch) throw fail('lease_changed_after_execution');
        if (abortReason || eventError || processResult.exit_code !== 0 || processResult.reason
          || processResult.tree_cleanup_confirmed !== true || completedTurns !== 1 || failedTurns || !threadId) throw fail(abortReason || eventError || 'execution_not_proven');
        const resultBytes = await boundedRead(resultPath, 128 * 1024);
        receipt.result = validateCodexCliResult(JSON.parse(resultBytes.toString('utf8')), role, subject?.result_sha256);
        receipt.result_sha256 = hash(resultBytes);
        if (role === 'CRITIC' && before.artifact_sha256 !== after.artifact_sha256) throw fail('critic_workspace_changed');
        receipt.state = 'RESULT_READY'; receipt.terminal_reason = receipt.result.outcome === 'BLOCKED' ? 'MODEL_REPORTED_BLOCKED' : null;
      } catch (error) {
        if (handle) { await handle.terminate('RUN_FENCED').catch(() => {}); processResult ||= await handle.completion.catch(() => null); }
        await writes;
        receipt.state = 'AMBIGUOUS'; receipt.terminal_reason = abortReason || eventError || String(error?.message || 'RUN_FAILED').slice(0, 160);
        receipt.process_result = processResult;
        try { receipt.git_after = await gitProof(root, env); } catch { receipt.git_after = null; }
      } finally {
        clearTimeout(timer); signal?.removeEventListener('abort', onAbort);
        await writes; await stdoutFile.sync(); await stderrFile.sync(); await stdoutFile.close(); await stderrFile.close();
      }
      receipt.jsonl_sha256 = stdoutHash.digest('hex'); receipt.stderr_sha256 = stderrHash.digest('hex');
      receipt.output_bytes = outputBytes; receipt.finished_at = new Date().toISOString();
      await durableJson(path.join(directory, 'receipt.json'), receipt, true);
      return structuredClone(receipt);
    },
  });
}
