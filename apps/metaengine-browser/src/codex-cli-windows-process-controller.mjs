import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = reason => new Error(`codex_cli_process_${reason}`);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const validDigest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export function resolveCodexCliJobRuntime({ moduleUrl = import.meta.url, resourcesPath = process.resourcesPath } = {}) {
  const modulePath = fileURLToPath(moduleUrl);
  if (/\.asar(?:[\\/]|$)/i.test(modulePath)) {
    if (!path.isAbsolute(resourcesPath || '')) throw fail('packaged_resources_required');
    return Object.freeze({ helperPath: path.join(resourcesPath, 'native-coding', 'codex-cli-job-runner.ps1'),
      manifestPath: fileURLToPath(new URL('../native-coding-job-runtime.json', moduleUrl)), templatePath: null });
  }
  return Object.freeze({ helperPath: fileURLToPath(new URL('../native-dist/codex-cli/codex-cli-job-runner.ps1', moduleUrl)),
    manifestPath: fileURLToPath(new URL('../native-dist/codex-cli/manifest.json', moduleUrl)),
    templatePath: resolveCodexCliJobHelperSource({ moduleUrl }) });
}

export function resolveCodexCliJobHelper(options) { return resolveCodexCliJobRuntime(options).helperPath; }

// Source assertions and explicit build preparation read this template. Runtime
// launch must resolve the prepared, manifest-bound output instead.
export function resolveCodexCliJobHelperSource({ moduleUrl = import.meta.url } = {}) {
  if (/\.asar(?:[\\/]|$)/i.test(fileURLToPath(moduleUrl))) throw fail('packaged_source_template_unavailable');
  return fileURLToPath(new URL('../scripts/codex-cli-job-runner.ps1', moduleUrl));
}

function readBoundedFile(file, limit, reason) {
  try {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.size < 1 || stat.size > limit) throw fail(reason);
    const bytes = fs.readFileSync(file);
    if (bytes.length < 1 || bytes.length > limit) throw fail(reason);
    return bytes;
  } catch { throw fail(reason); }
}

export function verifyCodexCliJobHelper({ helperPath, expectedHelperSha256, moduleUrl = import.meta.url, resourcesPath = process.resourcesPath } = {}) {
  if (helperPath !== undefined) {
    if (!path.isAbsolute(helperPath || '') || !validDigest(expectedHelperSha256)) throw fail('helper_pin_required');
    const bytes = readBoundedFile(helperPath, 4 * 1024 * 1024, 'helper_unreadable');
    if (sha256(bytes) !== expectedHelperSha256) throw fail('helper_digest_mismatch');
    return Object.freeze({ helperPath, helperSha256: expectedHelperSha256 });
  }
  if (expectedHelperSha256 !== undefined) throw fail('helper_pin_requires_explicit_path');
  const runtime = resolveCodexCliJobRuntime({ moduleUrl, resourcesPath });
  let manifest;
  try { manifest = JSON.parse(readBoundedFile(runtime.manifestPath, 16384, 'runtime_unprepared').toString('utf8')); }
  catch (error) { if (error.message === 'codex_cli_process_runtime_unprepared') throw error; throw fail('runtime_manifest_invalid'); }
  if (manifest?.schema !== 'metaengine.codex-cli.job-runtime.v1' || manifest.build_mode !== 'PRECOMPILED_FRAMEWORK_CSHARP'
    || !['template_sha256', 'csharp_sha256', 'assembly_sha256', 'helper_sha256', 'compiler_executable_sha256'].every(key => validDigest(manifest[key])))
    throw fail('runtime_manifest_invalid');
  if (runtime.templatePath && sha256(readBoundedFile(runtime.templatePath, 1024 * 1024, 'runtime_template_unreadable')) !== manifest.template_sha256)
    throw fail('runtime_template_changed');
  const bytes = readBoundedFile(runtime.helperPath, 4 * 1024 * 1024, 'runtime_unprepared');
  if (sha256(bytes) !== manifest.helper_sha256) throw fail('helper_digest_mismatch');
  return Object.freeze({ helperPath: runtime.helperPath, helperSha256: manifest.helper_sha256 });
}

/** A private process controller, not an OS sandbox or a lease issuer. */
export function createCodexCliWindowsProcessController({ helperPath, expectedHelperSha256,
  powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  startupTimeoutMs = 30000 } = {}) {
  if (process.platform !== 'win32') throw fail('windows_required');
  if (!path.isAbsolute(helperPath ?? resolveCodexCliJobHelper()) || !path.isAbsolute(powershellPath)) throw fail('absolute_paths_required');
  if (helperPath !== undefined && !validDigest(expectedHelperSha256)) throw fail('helper_pin_required');
  if (helperPath === undefined && expectedHelperSha256 !== undefined) throw fail('helper_pin_requires_explicit_path');
  return Object.freeze({
    async spawn(spec) {
      if (!path.isAbsolute(spec.executablePath || '') || !path.isAbsolute(spec.cwd || '')
        || !Array.isArray(spec.args) || spec.args.some(v => typeof v !== 'string' || v.includes('\0'))
        || !/^[a-f0-9]{64}$/.test(spec.expectedExecutableSha256 || '')
        || !/^[a-f0-9-]{36}$/.test(spec.runId || '')
        || (spec.deadlineAt != null && !Number.isFinite(Date.parse(spec.deadlineAt)))
        || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 100 || spec.timeoutMs > 1800000) throw fail('spec_invalid');
      // Revalidate immediately before every launch. A missing/stale preparation
      // cannot trigger compilation, choose a cache or fall back to the template.
      const verified = verifyCodexCliJobHelper({ helperPath, expectedHelperSha256 });
      const helper = spawn(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', verified.helperPath], {
        cwd: spec.cwd, env: spec.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout = new PassThrough(); const stderr = new PassThrough();
      let proof = null, resumeIssued = false, resumed = false, terminationIssued = false, cancellation = null;
      let finished = false, pending = '', terminal = null, helperErrorBytes = 0, failureReason = null;
      let resolveReady, rejectReady, resolveCompletion;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const completion = new Promise(resolve => { resolveCompletion = resolve; });
      const end = (reason, exitCode = null, helperSignal = null) => {
        if (finished) return; finished = true; clearTimeout(startupTimer);
        if (!proof) rejectReady(fail(failureReason || reason || 'not_started'));
        stdout.end(); stderr.end();
        if (terminal && pending.length) failureReason ||= 'CONTROLLER_PROTOCOL_INVALID';
        resolveCompletion((terminal && !failureReason && exitCode === 0 && helperSignal === null && !pending.length) ? terminal : { exit_code: exitCode, signal: null, reason: failureReason || reason,
          tree_cleanup_confirmed: false, process_tree_control: 'WINDOWS_JOB_OBJECT' });
      };
      const stop = reason => { failureReason ||= reason; helper.kill(); };
      const protocolFailure = () => stop('CONTROLLER_PROTOCOL_INVALID');
      const startupTimer = setTimeout(() => stop('CONTROLLER_STARTUP_TIMEOUT'), startupTimeoutMs);
      const frame = value => {
        if (failureReason) return;
        if (!value || typeof value !== 'object' || terminal) return protocolFailure();
        if (value.type === 'ready') {
          if (proof || !Number.isSafeInteger(value.pid) || value.pid < 1
            || value.process_incarnation_id !== `pid:${value.pid}:created_100ns:${String(value.process_incarnation_id || '').split(':')[3]}`
            || !/^pid:[1-9][0-9]*:created_100ns:[1-9][0-9]{16,18}$/.test(value.process_incarnation_id || '')
            || value.executable_sha256 !== spec.expectedExecutableSha256
            || path.resolve(value.executable_path || '').toLowerCase() !== path.resolve(spec.executablePath).toLowerCase()
            || value.tree_control_bound !== true || value.started_suspended !== true
            || value.process_tree_control !== 'WINDOWS_JOB_OBJECT'
            || value.job_bound_before_resume !== true || value.job_id !== spec.runId || !/^S-1-/.test(value.user_sid || '')) return protocolFailure();
          const {type,...nativeProof}=value;
          proof = Object.freeze(nativeProof); clearTimeout(startupTimer); resolveReady(proof);
        } else if (value.type === 'resumed') {
          if (!proof || !resumeIssued || cancellation || resumed) return protocolFailure(); resumed = true;
        } else if (value.type === 'output') {
          if (!proof || !resumed || !['stdout', 'stderr'].includes(value.channel)
            || typeof value.data_b64 !== 'string' || value.data_b64.length > 8192
            || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data_b64)) return protocolFailure();
          (value.channel === 'stdout' ? stdout : stderr).write(Buffer.from(value.data_b64, 'base64'));
        } else if (value.type === 'suspended_cancelled') {
          const accounting = value.job_accounting;
          if (!proof || !cancellation || resumeIssued || resumed
            || value.cancellation_id !== cancellation.id || value.reason !== cancellation.reason
            || value.run_id !== proof.job_id || value.job_id !== proof.job_id || value.pid !== proof.pid
            || value.process_incarnation_id !== proof.process_incarnation_id
            || value.exit_code !== 125 || value.process_exit_confirmed !== true || value.never_resumed !== true
            || value.handles_closed !== true || value.tree_cleanup_confirmed !== true
            || value.process_tree_control !== 'WINDOWS_JOB_OBJECT'
            || !accounting || accounting.active_processes !== 0 || accounting.total_processes !== 1
            || !Number.isSafeInteger(accounting.total_terminated_processes)
            || accounting.total_terminated_processes < 0 || accounting.total_terminated_processes > accounting.total_processes) return protocolFailure();
          const { type, ...receipt } = value;
          terminal = { ...receipt, signal: null };
        } else if (value.type === 'exit') {
          if (!proof || !resumed || terminal || !Number.isSafeInteger(value.exit_code)) return protocolFailure();
          terminal = { exit_code: value.exit_code, signal: null, reason: value.reason || null,
            tree_cleanup_confirmed: value.tree_cleanup_confirmed === true, process_tree_control: 'WINDOWS_JOB_OBJECT' };
        } else if (value.type === 'error') { failureReason = 'NATIVE_JOB_FAILED'; }
        else protocolFailure();
      };
      helper.stdout.setEncoding('utf8');
      helper.stdout.on('data', chunk => {
        if (finished) return;
        if (terminal && chunk.length) return protocolFailure();
        pending += chunk;
        let index;
        while ((index = pending.indexOf('\n')) >= 0 && !finished) {
          const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
          try { if (line) frame(JSON.parse(line)); else if (terminal) protocolFailure(); } catch { protocolFailure(); }
        }
        if (pending.length > 65536) protocolFailure();
      });
      // Compiler/host errors are never exported as task output; keep them bounded.
      helper.stderr.on('data', chunk => { helperErrorBytes += chunk.length; if (helperErrorBytes > 65536) protocolFailure(); });
      helper.stdin.on('error', () => { if (!finished) stop('CONTROLLER_INPUT_FAILED'); });
      helper.once('error', () => { failureReason ||= 'CONTROLLER_SPAWN_FAILED'; });
      // Only close proves that the helper released its job handle and cwd.
      // Resolving on an error frame can race native cleanup and leave a live tree.
      helper.once('close', (code, signal) => end(terminal ? terminal.reason : 'CONTROLLER_EXIT_UNPROVEN', code, signal ?? null));
      helper.stdin.write(`${JSON.stringify({ executable_path: spec.executablePath, args: spec.args, cwd: spec.cwd,
        run_id: spec.runId, timeout_ms: spec.timeoutMs, expected_sha256: spec.expectedExecutableSha256,
        deadline_ms: spec.deadlineAt == null ? '' : String(Date.parse(spec.deadlineAt)) })}\n`);
      await ready;
      return Object.freeze({ proof, stdout, stderr, completion,
        async resume(prompt = '', { deadlineAt = null } = {}) {
          if (finished || failureReason || terminationIssued || resumeIssued || Buffer.byteLength(prompt, 'utf8') > 65536) throw fail('resume_invalid');
          if (deadlineAt !== null && !Number.isFinite(Date.parse(deadlineAt))) throw fail('resume_deadline_invalid');
          const deadline = Math.min(Date.now() + spec.timeoutMs,
            spec.deadlineAt == null ? Infinity : Date.parse(spec.deadlineAt),
            deadlineAt == null ? Infinity : Date.parse(deadlineAt));
          if (deadline <= Date.now()) throw fail('deadline_expired_before_resume');
          resumeIssued = true;
          helper.stdin.write(`RESUME ${deadline} ${Buffer.from(prompt, 'utf8').toString('base64')}\n`);
        },
        async terminate(reason = 'CANCELLED') {
          if (finished) return;
          if (terminationIssued) { await completion; return; }
          // Fence resume synchronously, before writing or waiting for native cleanup.
          terminationIssued = true;
          const safeReason = String(reason).replace(/[^A-Z_]/g, '').slice(0, 80) || 'CANCELLED';
          // Helper holds the only job handle. Its termination kills exactly this tree.
          if (!resumeIssued) {
            cancellation = Object.freeze({ id: randomUUID(), reason: safeReason });
            helper.stdin.end(`CANCEL_SUSPENDED ${cancellation.id} ${cancellation.reason}\n`);
          } else helper.stdin.end(`CANCEL ${safeReason}\n`);
          // Suspended cleanup has separate bounded process-exit/accounting waits.
          const deadline = setTimeout(() => stop('CONTROLLER_TERMINATION_TIMEOUT'), cancellation ? 11000 : 6000);
          await completion; clearTimeout(deadline);
        },
      });
    },
  });
}
