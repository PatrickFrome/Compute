// Test fixtures only. This runs reviewed fixture code on the host and provides
// NO untrusted-code security boundary. Never import into production composition.
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { verificationDigest } from '../../src/development-verification-sqlite-journal.mjs';

export function trustedFixtureExecutor({ workingRoot, markerPath = null, crashAfterBuild = false, failTeardown = false } = {}) {
  const sessionPath = key => path.join(workingRoot, key);
  return {
    executor_id: 'TEST_TRUSTED_HOST_FIXTURE',
    configuration_digest: verificationDigest({ version: 1, kind: 'REVIEWED_FIXTURE_ONLY' }),
    async createSession({ session_key, snapshot_dir }) {
      await fs.mkdir(sessionPath(session_key));
      await fs.cp(snapshot_dir, sessionPath(session_key), { recursive: true });
      return { session_id: session_key };
    },
    async runStep({ session_key, step, output_limit_bytes }) {
      const cwd = path.join(sessionPath(session_key), step.cwd);
      const result = await new Promise(resolve => {
        execFile(step.executable, step.args, { cwd, windowsHide: true, shell: false, timeout: step.timeout_ms,
          maxBuffer: output_limit_bytes, env: { PATH: process.env.PATH, SystemRoot: process.env.SystemRoot, TEST_ONLY: 'true' } },
        (error, stdout, stderr) => resolve({ exit_code: error ? Number.isInteger(error.code) ? error.code : null : 0,
          timed_out: Boolean(error?.killed && error?.code !== 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'),
          output_limit_exceeded: error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', stdout, stderr }));
      });
      if (markerPath) await fs.appendFile(markerPath, `${step.id}\n`);
      if (crashAfterBuild && step.id === 'BUILD') process.exit(73);
      return result;
    },
    async stop({ session_key }) {
      if (failTeardown) return { stopped: false, persistent_state_deleted: false };
      await fs.rm(sessionPath(session_key), { recursive: true, force: true });
      return { stopped: true, persistent_state_deleted: true };
    },
    async recover({ session_key }) {
      if (failTeardown) return { stopped: false, persistent_state_deleted: false };
      await fs.rm(sessionPath(session_key), { recursive: true, force: true });
      return { stopped: true, persistent_state_deleted: true };
    },
  };
}
