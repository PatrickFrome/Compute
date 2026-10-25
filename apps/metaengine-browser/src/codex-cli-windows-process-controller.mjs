import { spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const fail = reason => new Error(`codex_cli_process_${reason}`);

export function resolveCodexCliJobHelper({ moduleUrl = import.meta.url, resourcesPath = process.resourcesPath } = {}) {
  const modulePath = fileURLToPath(moduleUrl);
  if (/\.asar(?:[\\/]|$)/i.test(modulePath)) {
    if (!path.isAbsolute(resourcesPath || '')) throw fail('packaged_resources_required');
    return path.join(resourcesPath, 'native-coding', 'codex-cli-job-runner.ps1');
  }
  return fileURLToPath(new URL('../scripts/codex-cli-job-runner.ps1', moduleUrl));
}

/** A private process controller, not an OS sandbox or a lease issuer. */
export function createCodexCliWindowsProcessController({ helperPath = resolveCodexCliJobHelper(),
  powershellPath = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  startupTimeoutMs = 30000 } = {}) {
  if (process.platform !== 'win32') throw fail('windows_required');
  if (!path.isAbsolute(helperPath) || !path.isAbsolute(powershellPath)) throw fail('absolute_paths_required');
  return Object.freeze({
    async spawn(spec) {
      if (!path.isAbsolute(spec.executablePath || '') || !path.isAbsolute(spec.cwd || '')
        || !Array.isArray(spec.args) || spec.args.some(v => typeof v !== 'string' || v.includes('\0'))
        || !/^[a-f0-9]{64}$/.test(spec.expectedExecutableSha256 || '')
        || !/^[a-f0-9-]{36}$/.test(spec.runId || '')
        || (spec.deadlineAt != null && !Number.isFinite(Date.parse(spec.deadlineAt)))
        || !Number.isSafeInteger(spec.timeoutMs) || spec.timeoutMs < 100 || spec.timeoutMs > 1800000) throw fail('spec_invalid');
      const helper = spawn(powershellPath, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helperPath], {
        cwd: spec.cwd, env: spec.env, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'],
      });
      const stdout = new PassThrough(); const stderr = new PassThrough();
      let proof = null, resumed = false, finished = false, pending = '', terminal = null, helperErrorBytes = 0, failureReason = null;
      let resolveReady, rejectReady, resolveCompletion;
      const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
      const completion = new Promise(resolve => { resolveCompletion = resolve; });
      const end = (reason, exitCode = null) => {
        if (finished) return; finished = true; clearTimeout(startupTimer);
        if (!proof) rejectReady(fail(reason || 'not_started'));
        stdout.end(); stderr.end();
        resolveCompletion((terminal && !failureReason && exitCode === 0 && !pending.trim()) ? terminal : { exit_code: exitCode, signal: null, reason: failureReason || reason,
          tree_cleanup_confirmed: false, process_tree_control: 'WINDOWS_JOB_OBJECT' });
      };
      const stop = reason => { failureReason ||= reason; helper.kill(); };
      const protocolFailure = () => stop('CONTROLLER_PROTOCOL_INVALID');
      const startupTimer = setTimeout(() => stop('CONTROLLER_STARTUP_TIMEOUT'), startupTimeoutMs);
      const frame = value => {
        if (failureReason) return;
        if (!value || typeof value !== 'object') return protocolFailure();
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
          if (!proof || resumed) return protocolFailure(); resumed = true;
        } else if (value.type === 'output') {
          if (!proof || !resumed || !['stdout', 'stderr'].includes(value.channel)
            || typeof value.data_b64 !== 'string' || value.data_b64.length > 8192
            || !/^[A-Za-z0-9+/]*={0,2}$/.test(value.data_b64)) return protocolFailure();
          (value.channel === 'stdout' ? stdout : stderr).write(Buffer.from(value.data_b64, 'base64'));
        } else if (value.type === 'exit') {
          if (!proof || !resumed || terminal || !Number.isSafeInteger(value.exit_code)) return protocolFailure();
          terminal = { exit_code: value.exit_code, signal: null, reason: value.reason || null,
            tree_cleanup_confirmed: value.tree_cleanup_confirmed === true, process_tree_control: 'WINDOWS_JOB_OBJECT' };
        } else if (value.type === 'error') { failureReason = 'NATIVE_JOB_FAILED'; }
        else protocolFailure();
      };
      helper.stdout.setEncoding('utf8');
      helper.stdout.on('data', chunk => {
        pending += chunk;
        let index;
        while ((index = pending.indexOf('\n')) >= 0 && !finished) {
          const line = pending.slice(0, index).trim(); pending = pending.slice(index + 1);
          try { if (line) frame(JSON.parse(line)); } catch { protocolFailure(); }
        }
        if (pending.length > 65536) protocolFailure();
      });
      // Compiler/host errors are never exported as task output; keep them bounded.
      helper.stderr.on('data', chunk => { helperErrorBytes += chunk.length; if (helperErrorBytes > 65536) protocolFailure(); });
      helper.stdin.on('error', () => { if (!finished) stop('CONTROLLER_INPUT_FAILED'); });
      helper.once('error', () => { failureReason ||= 'CONTROLLER_SPAWN_FAILED'; });
      // Only close proves that the helper released its job handle and cwd.
      // Resolving on an error frame can race native cleanup and leave a live tree.
      helper.once('close', code => end(terminal ? terminal.reason : 'CONTROLLER_EXIT_UNPROVEN', code));
      helper.stdin.write(`${JSON.stringify({ executable_path: spec.executablePath, args: spec.args, cwd: spec.cwd,
        run_id: spec.runId, timeout_ms: spec.timeoutMs, expected_sha256: spec.expectedExecutableSha256,
        deadline_ms: spec.deadlineAt == null ? '' : String(Date.parse(spec.deadlineAt)) })}\n`);
      await ready;
      let resumeIssued = false;
      return Object.freeze({ proof, stdout, stderr, completion,
        async resume(prompt = '', { deadlineAt = null } = {}) {
          if (finished || resumeIssued || Buffer.byteLength(prompt, 'utf8') > 65536) throw fail('resume_invalid');
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
          // Helper holds the only job handle. Its termination kills exactly this tree.
          helper.stdin.end(`CANCEL ${String(reason).replace(/[^A-Z_]/g, '').slice(0, 80)}\n`);
          const deadline = setTimeout(() => helper.kill(), 6000);
          await completion; clearTimeout(deadline);
        },
      });
    },
  });
}
