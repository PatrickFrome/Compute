/**
 * ME2 ui-host — bring up Mission Control (Next standalone in me2-ui-dist).
 * Spawn modes (pure decision in me2-constants.resolveUiSpawnMode):
 *   ME2_UI_BIN → explicit; bun present → bun server.js; else the Electron binary
 * itself runs server.js with ELECTRON_RUN_AS_NODE=1 (operator machines need no
 * bun — the R77 lesson made honest-fallback mandatory).
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { UI, UI_HOST, resolveUiSpawnMode } from '../shared/me2-constants.mjs';
import { probeUi, pollUntil } from './probes.mjs';

export function probeBun(spawnSyncImpl) {
  try {
    const r = spawnSyncImpl('bun', ['--version'], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
    return r.status === 0;
  } catch {
    return false;
  }
}

export class UiHost {
  constructor({ uiDistDir, electronExecPath = null, log = () => {}, spawnImpl = spawn, spawnSyncImpl = null, env = process.env } = {}) {
    this.uiDistDir = uiDistDir;
    this.electronExecPath = electronExecPath;
    this.log = log;
    this.spawnImpl = spawnImpl;
    this.spawnSyncImpl = spawnSyncImpl;
    this.env = env;
    this.child = null;
    this.status = 'idle'; // idle|starting|live|degraded
  }

  contractFilesPresent() {
    return ['server.js', 'package.json', join('.next', 'BUILD_ID'), 'me2-ui-manifest.json']
      .map((rel) => join(this.uiDistDir, rel))
      .every((p) => existsSync(p));
  }

  buildSpawnPlan() {
    const bunAvailable = this.spawnSyncImpl ? probeBun(this.spawnSyncImpl) : Boolean(this.env.ME2_UI_BIN || false);
    return resolveUiSpawnMode({ bunAvailable, explicitBin: this.env.ME2_UI_BIN || null, dev: this.env.ME2_UI_DEV === '1' });
  }

  spawnChild() {
    if (!this.uiDistDir || !existsSync(join(this.uiDistDir, 'server.js'))) {
      this.status = 'degraded';
      return { ok: false, reason: 'ui_dist_missing' };
    }
    if (!this.contractFilesPresent()) {
      this.status = 'degraded';
      return { ok: false, reason: 'ui_dist_contract_incomplete' };
    }
    const plan = this.buildSpawnPlan();
    let bin;
    let args;
    const env = { ...this.env, NODE_ENV: 'production', PORT: String(UI.PORT) };
    if (plan.mode === 'bun-dev') {
      bin = this.env.ME2_UI_BIN || 'bun';
      args = plan.args;
      env.NODE_ENV = 'development';
    } else if (plan.mode === 'explicit') {
      bin = this.env.ME2_UI_BIN;
      args = plan.args;
    } else if (plan.mode === 'bun') {
      bin = 'bun';
      args = plan.args;
    } else {
      if (!this.electronExecPath) {
        this.status = 'degraded';
        return { ok: false, reason: 'electron_node_fallback_unavailable' };
      }
      bin = this.electronExecPath;
      args = plan.args;
      env.ELECTRON_RUN_AS_NODE = '1';
    }
    this.child = this.spawnImpl(bin, args, {
      cwd: this.uiDistDir,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    this.child.on('exit', (code) => {
      this.log({ plane: 'ui-host', event: 'child_exit', code, mode: plan.mode });
      this.child = null;
      if (this.status === 'live') this.status = 'degraded';
    });
    this.status = 'starting';
    this.log({ plane: 'ui-host', event: 'spawn', mode: plan.mode, pid: this.child.pid });
    return { ok: true, mode: plan.mode, pid: this.child.pid };
  }

  /** Spawn (if needed) and wait for :3000 health. Honest degraded on timeout. */
  async bringUp() {
    if (!(await probeUi(UI.PORT, { timeoutMs: 1500 })).ok) {
      const spawnResult = this.spawnChild();
      if (!spawnResult.ok) return { ok: false, ...spawnResult, status: this.status };
    } else {
      this.status = 'live';
      return { ok: true, mode: 'adopted', status: this.status };
    }
    const health = await pollUntil(() => probeUi(UI.PORT, { timeoutMs: 2500 }), {
      tries: Math.ceil(UI_HOST.START_TIMEOUT_MS / UI_HOST.PROBE_INTERVAL_MS),
      intervalMs: UI_HOST.PROBE_INTERVAL_MS,
    });
    if (!health.ok) {
      this.status = 'degraded';
      this.log({ plane: 'ui-host', event: 'degraded', reason: 'no_health_on_port' });
      return { ok: false, reason: 'no_health_on_port', status: this.status };
    }
    this.status = 'live';
    return { ok: true, status: this.status };
  }

  snapshot() {
    return { status: this.status, pid: this.child?.pid ?? null };
  }
}
