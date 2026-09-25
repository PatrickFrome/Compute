/**
 * ME2 daemon-host — adopt-or-spawn the ME2 OS daemon (bun mini-service).
 * Contract: GET :3041/health for liveness, /state for the me2-daemon-contract.v1
 * handshake. Adopt first (a daemon may already run from the sandbox start.sh);
 * spawn only when adopt fails; honest DEGRADED after restart caps — never storms.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DAEMON, DAEMON_HOST, CONTRACT } from '../shared/me2-constants.mjs';
import { parseHandshake } from '../shared/me2-constants.mjs';
import { probeDaemon, probeJson, pollUntil } from './probes.mjs';

export class DaemonHost {
  constructor({ daemonDir, log = () => {}, spawnImpl = spawn, env = process.env } = {}) {
    this.daemonDir = daemonDir;
    this.log = log;
    this.spawnImpl = spawnImpl;
    this.env = env;
    this.child = null;
    this.restarts = 0;
    this.status = 'idle'; // idle|adopted|spawned|degraded
  }

  /** Adopt a running daemon; returns handshake or null. */
  async adopt() {
    const health = await probeDaemon(DAEMON.REST_PORT, { timeoutMs: DAEMON_HOST.ADOPT_PROBE_TIMEOUT_MS });
    if (!health.ok) return null;
    const state = await probeJson(`http://127.0.0.1:${DAEMON.REST_PORT}${CONTRACT.HANDSHAKE_PATH}`);
    const handshake = parseHandshake(state.json ?? state.text ?? '');
    this.status = 'adopted';
    this.log({ plane: 'daemon-host', event: 'adopted', handshake: handshake.ok, contract: handshake.ok ? CONTRACT.SCHEMA : handshake.reason });
    return { health, handshake };
  }

  /** Spawn `bun index.ts` in daemonDir and wait for health. */
  async spawnDaemon() {
    if (!this.daemonDir || !existsSync(join(this.daemonDir, 'index.ts'))) {
      this.status = 'degraded';
      this.log({ plane: 'daemon-host', event: 'spawn_refused', reason: 'daemon_dir_invalid' });
      return { ok: false, reason: 'daemon_dir_invalid' };
    }
    this.child = this.spawnImpl('bun', ['index.ts'], {
      cwd: this.daemonDir,
      env: this.env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.on('exit', (code) => {
      this.log({ plane: 'daemon-host', event: 'child_exit', code, restarts: this.restarts });
      this.child = null;
    });
    const health = await pollUntil(() => probeDaemon(DAEMON.REST_PORT, { timeoutMs: DAEMON_HOST.HEALTH_TIMEOUT_MS }), {
      tries: 20,
      intervalMs: 500,
    });
    if (!health.ok) {
      this.status = 'degraded';
      return { ok: false, reason: 'spawn_no_health' };
    }
    this.status = 'spawned';
    this.log({ plane: 'daemon-host', event: 'spawned' });
    return { ok: true, health };
  }

  /**
   * Full bring-up: adopt → (spawn on failure, with capped restarts) → handshake.
   * Honest result: {ok, mode, handshake} — degraded is a RESULT, not an exception.
   * opts.backoffMs: injectable for fast tests (production default from constants).
   */
  async bringUp({ backoffMs = DAEMON_HOST.RESTART_BACKOFF_MS } = {}) {
    const adopted = await this.adopt();
    if (adopted) return { ok: true, mode: 'adopted', ...adopted };
    for (let attempt = 0; attempt <= DAEMON_HOST.MAX_RESTARTS; attempt += 1) {
      const spawned = await this.spawnDaemon();
      if (spawned.ok) {
        const state = await probeJson(`http://127.0.0.1:${DAEMON.REST_PORT}${CONTRACT.HANDSHAKE_PATH}`);
        return { ok: true, mode: 'spawned', handshake: parseHandshake(state.json ?? '') };
      }
      this.restarts += 1;
      if (this.restarts > DAEMON_HOST.MAX_RESTARTS) break;
      await new Promise((r) => setTimeout(r, backoffMs));
    }
    this.status = 'degraded';
    this.log({ plane: 'daemon-host', event: 'degraded', restarts: this.restarts });
    return { ok: false, mode: 'degraded', restarts: this.restarts };
  }

  snapshot() {
    return { status: this.status, restarts: this.restarts, pid: this.child?.pid ?? null };
  }
}
