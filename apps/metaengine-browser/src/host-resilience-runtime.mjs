import { spawn } from 'node:child_process';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSentinelHost } from './browser-sentinel.mjs';
import { BrowserParentProgressLease } from './browser-parent-progress-lease.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT_PROGRESS_HEARTBEAT_MS = 5_000;
const LOGIN_START_RECHECK_MS = 30_000;

// In the packaged app, __dirname points INSIDE app.asar. ELECTRON_RUN_AS_NODE runs
// the Electron binary as vanilla Node, which cannot load modules from an asar
// archive: the sentinel worker spawned from the asar path dies at require time
// (observed on the live Windows host as ~1 worker recovery generation every few
// seconds, each ending in CANDIDATE_CONFIRMED_ABSENT, blocking self-update restart
// with host_resilience_sentinel_not_ready_for_expected_restart). The worker closure
// is unpacked by electron-builder (asarUnpack in electron-builder.test.json); this
// resolver maps the asar path onto app.asar.unpacked and falls back to the original
// path (dev mode / unpacked layout missing) without inventing any new authority.
export function resolveSentinelWorkerScript(candidatePath, existsSyncImpl = ((p) => fsSync.existsSync(p))) {
  const candidate = String(candidatePath || '');
  for (const sep of [path.sep, '/']) {
    const marker = `${sep}app.asar${sep}`;
    if (candidate.includes(marker)) {
      const unpacked = candidate.split(marker).join(`${sep}app.asar.unpacked${sep}`);
      if (existsSyncImpl(unpacked)) return unpacked;
    }
  }
  return candidate;
}

export class HostResilienceRuntime {
  #electron; #onResume; #platform; #spawn; #sentinelFactory;
  #blockerId = null; #resumeHandler = null; #sentinel = null; #progressLease = null; #progressTimer = null; #resilienceTickPromise = null;
  #app = null; #stopRequested = true; #lastLoginCheckMs = 0; #sentinelStatePath = null; #sentinelBootstrapRetrySafe = false; #sentinelBootstrapAttempts = 0;
  #state = {
    state: 'UNINITIALIZED', open_at_login: false, executable_will_launch_at_login: false,
    login_start_required: false, login_start_verified: false, login_start_policy_hold: false,
    login_start_attempts: 0, login_start_repair_attempts: 0,
    login_start_recheck_ms: LOGIN_START_RECHECK_MS, last_login_start_check_at: null,
    prevent_app_suspension: false, sentinel: null, sentinel_worker_healthy: false,
    sentinel_worker_recovery: null, sentinel_bootstrap: null,
    parent_progress: null, parent_progress_heartbeat_ms: PARENT_PROGRESS_HEARTBEAT_MS,
    last_resume_at: null, last_error: null,
  };

  constructor({ electron = null, onResume = async () => {}, platform = process.platform, spawnImpl = spawn, sentinelFactory = null } = {}) {
    if (typeof spawnImpl !== 'function') throw new Error('host_resilience_spawn_invalid');
    if (sentinelFactory != null && typeof sentinelFactory !== 'function') throw new Error('host_resilience_sentinel_factory_invalid');
    this.#electron = electron;
    this.#onResume = onResume;
    this.#platform = platform;
    this.#spawn = spawnImpl;
    this.#sentinelFactory = sentinelFactory || ((options) => new BrowserSentinelHost(options));
  }

  snapshot() {
    const sentinel = this.#sentinel?.snapshot?.() || this.#state.sentinel;
    const parentProgress = this.#progressLease?.snapshot?.() || this.#state.parent_progress;
    return structuredClone({
      schema: 'metaengine.host-resilience-runtime.v7',
      ...this.#state,
      sentinel,
      parent_progress: parentProgress,
      sentinel_worker_healthy: sentinel?.worker_ready === true,
      sentinel_bootstrap_retry_pending: this.#sentinelBootstrapRetrySafe === true && this.#stopRequested !== true,
      login_start_retry_pending: this.#state.login_start_required === true && this.#state.open_at_login !== true && this.#stopRequested !== true,
      useful_progress_required: true,
      pid_liveness_alone_sufficient: false,
      terminal_requires_external_stop: true,
      external_stop_requested: this.#stopRequested,
      sentinel_recovery_requires_exact_old_pid_absence: true,
      sentinel_bootstrap_retry_requires_proven_no_spawn_effect: true,
      sentinel_recovery_uses_existing_progress_tick: true,
      sentinel_bootstrap_recovery_uses_existing_progress_tick: true,
      login_start_recovery_uses_existing_progress_tick: true,
      login_start_repair_requires_fresh_absence_readback: true,
      login_start_policy_hold_is_advisory: true,
      login_start_policy_hold_grants_repair_authority: false,
      watchdog_scheduler_authority: false,
      watchdog_task_leasing: false,
      authority_effect: false,
    });
  }

  #sentinelRequired() {
    return this.#platform === 'win32'
      && process.env.METAENGINE_DISABLE_CRASH_SENTINEL !== '1'
      && typeof this.#app?.getPath === 'function';
  }

  async #verifyLoginStart({ force = false } = {}) {
    const required = this.#platform === 'win32' && process.env.METAENGINE_DISABLE_LOGIN_START !== '1';
    this.#state.login_start_required = required;
    if (!required) {
      this.#state.login_start_verified = false;
      this.#state.login_start_policy_hold = false;
      return true;
    }
    const now = Date.now();
    if (!force && this.#state.login_start_verified === true && now - this.#lastLoginCheckMs < LOGIN_START_RECHECK_MS) return true;
    if (!force && this.#state.login_start_verified !== true && now - this.#lastLoginCheckMs < Math.min(PARENT_PROGRESS_HEARTBEAT_MS, LOGIN_START_RECHECK_MS)) return false;
    this.#lastLoginCheckMs = now;
    this.#state.last_login_start_check_at = new Date(now).toISOString();
    this.#state.login_start_attempts += 1;
    const app = this.#app;
    if (!app || typeof app.getLoginItemSettings !== 'function') {
      this.#state.login_start_verified = false;
      this.#state.login_start_policy_hold = false;
      this.#state.last_error = 'login_start:API_UNAVAILABLE';
      this.#state.state = 'DEGRADED_LOGIN_START';
      return false;
    }
    try {
      const observed = app.getLoginItemSettings();
      this.#state.open_at_login = observed?.openAtLogin === true;
      this.#state.executable_will_launch_at_login = observed?.executableWillLaunchAtLogin === true;
      this.#state.login_start_policy_hold = this.#state.open_at_login && observed?.executableWillLaunchAtLogin === false;
      this.#state.login_start_verified = this.#state.open_at_login;

      if (this.#state.login_start_verified) {
        if (String(this.#state.last_error || '').startsWith('login_start:')) this.#state.last_error = null;
        if (this.#state.state === 'DEGRADED_LOGIN_START') this.#state.state = 'ACTIVE';
        return true;
      }

      // Repair authority exists only after a fresh readback proves registration absent.
      // Startup Approval is an OS-owned policy layer: when openAtLogin is already true,
      // executableWillLaunchAtLogin=false is advisory and must never trigger a rewrite.
      if (typeof app.setLoginItemSettings !== 'function') {
        this.#state.last_error = 'login_start:API_UNAVAILABLE';
        this.#state.state = 'DEGRADED_LOGIN_START';
        return false;
      }
      this.#state.login_start_repair_attempts += 1;
      app.setLoginItemSettings({ openAtLogin: true, enabled: true });

      const repaired = app.getLoginItemSettings();
      this.#state.open_at_login = repaired?.openAtLogin === true;
      this.#state.executable_will_launch_at_login = repaired?.executableWillLaunchAtLogin === true;
      this.#state.login_start_policy_hold = this.#state.open_at_login && repaired?.executableWillLaunchAtLogin === false;
      this.#state.login_start_verified = this.#state.open_at_login;
      if (this.#state.login_start_verified) {
        if (String(this.#state.last_error || '').startsWith('login_start:')) this.#state.last_error = null;
        if (this.#state.state === 'DEGRADED_LOGIN_START') this.#state.state = 'ACTIVE';
        return true;
      }
      this.#state.login_start_policy_hold = false;
      this.#state.last_error = 'login_start:REGISTRATION_ABSENT_AFTER_REPAIR';
      this.#state.state = 'DEGRADED_LOGIN_START';
      return false;
    } catch (error) {
      // A failed or ambiguous readback never grants write authority. The next recovery
      // pass always starts with a fresh getLoginItemSettings() observation before any
      // further repair attempt.
      this.#state.login_start_verified = false;
      this.#state.login_start_policy_hold = false;
      this.#state.last_error = `login_start:${String(error?.message || error).slice(0, 180)}`;
      this.#state.state = 'DEGRADED_LOGIN_START';
      return false;
    }
  }

  async #bootstrapSentinel() {
    if (!this.#sentinelRequired() || this.#stopRequested) return true;
    if (this.#sentinel?.snapshot?.()?.worker_ready === true) {
      this.#sentinelBootstrapRetrySafe = false;
      return true;
    }
    if (this.#sentinel && this.#sentinelBootstrapRetrySafe !== true) return false;

    const app = this.#app;
    this.#sentinelStatePath ||= path.join(app.getPath('userData'), 'metaengine-browser-sentinel-v1.json');
    let spawnInvoked = false;
    let spawnReturned = false;
    const trackedSpawn = (...args) => {
      spawnInvoked = true;
      const child = this.#spawn(...args);
      spawnReturned = true;
      return child;
    };
    const candidate = this.#sentinelFactory({
      statePath: this.#sentinelStatePath,
      workerScript: resolveSentinelWorkerScript(path.join(__dirname, 'browser-sentinel-worker.cjs')),
      executable: process.execPath,
      spawnImpl: trackedSpawn,
    });
    this.#sentinelBootstrapAttempts += 1;
    const attempt = this.#sentinelBootstrapAttempts;
    this.#state.sentinel_bootstrap = {
      state: 'STARTING', attempt, spawn_invoked: false, spawn_returned: false,
      automatic_retry_allowed: false, started_at: new Date().toISOString(), authority_effect: false,
    };

    try {
      await candidate.start({ app });
      this.#sentinel = candidate;
      const healthy = await candidate.waitUntilHealthy(5_000);
      this.#progressLease = new BrowserParentProgressLease({ statePath: this.#sentinelStatePath, getBinding: () => this.#sentinel?.snapshot?.() || null });
      await this.#progressLease.mark({ kind: 'HOST_RESILIENCE_STARTED' });
      this.#state.parent_progress = this.#progressLease.snapshot();
      this.#state.sentinel_worker_healthy = true;
      this.#sentinelBootstrapRetrySafe = false;
      this.#state.sentinel_bootstrap = {
        state: 'HEALTHY', attempt, spawn_invoked: spawnInvoked, spawn_returned: spawnReturned,
        worker_pid: healthy?.worker_pid || null, automatic_retry_allowed: false,
        completed_at: new Date().toISOString(), authority_effect: false,
      };
      if (String(this.#state.last_error || '').startsWith('sentinel_bootstrap:')) this.#state.last_error = null;
      return true;
    } catch (error) {
      // No replay permission is inferred from time. A new sentinel may be spawned only
      // when the tracked spawn call never returned a child handle: either execution
      // failed before spawn was invoked, or spawn itself synchronously proved failure.
      const retrySafe = spawnReturned !== true;
      this.#sentinel = retrySafe ? null : candidate;
      this.#sentinelBootstrapRetrySafe = retrySafe;
      this.#state.sentinel_worker_healthy = false;
      this.#state.sentinel_bootstrap = {
        state: retrySafe ? 'PROVEN_NO_SPAWN_EFFECT' : 'AMBIGUOUS_AFTER_SPAWN_RETURN',
        attempt,
        spawn_invoked: spawnInvoked,
        spawn_returned: spawnReturned,
        error: String(error?.message || error).slice(0, 240),
        automatic_retry_allowed: retrySafe,
        failed_at: new Date().toISOString(),
        authority_effect: false,
      };
      this.#state.last_error = `sentinel_bootstrap:${String(error?.message || error).slice(0, 200)}`;
      if (this.#state.state === 'ACTIVE') this.#state.state = 'DEGRADED_SENTINEL';
      return false;
    }
  }

  async #resilienceTick({ kind = 'EVENT_LOOP_HEARTBEAT', detail = null, forceLoginCheck = false } = {}) {
    if (this.#resilienceTickPromise) return this.#resilienceTickPromise;
    this.#resilienceTickPromise = (async () => {
      if (this.#stopRequested) return this.snapshot();
      await this.#verifyLoginStart({ force: forceLoginCheck });

      if (!this.#sentinel && this.#sentinelBootstrapRetrySafe) await this.#bootstrapSentinel();

      // Keep the parent-progress lease fresh independently of worker recovery. A dead
      // sentinel must never make the healthy parent look wedged while we repair it.
      if (this.#progressLease) {
        await this.#progressLease.mark({ kind, detail });
        this.#state.parent_progress = this.#progressLease.snapshot();
      }

      if (this.#sentinel?.recoverWorkerIfProvenAbsent) {
        try {
          const recovery = await this.#sentinel.recoverWorkerIfProvenAbsent();
          this.#state.sentinel_worker_recovery = recovery ? structuredClone(recovery) : null;
          this.#state.sentinel_worker_healthy = this.#sentinel.snapshot()?.worker_ready === true;
          if (recovery?.state === 'RECOVERED' || recovery?.state === 'HEALTHY') {
            if (String(this.#state.last_error || '').startsWith('sentinel_worker:')) this.#state.last_error = null;
            if (this.#state.state === 'DEGRADED_SENTINEL') this.#state.state = 'ACTIVE';
          } else if (['STALE_WORKER_PID_ALIVE','WORKER_PID_MISSING_AMBIGUOUS','SPAWN_AMBIGUOUS','CANDIDATE_ALIVE_HEARTBEAT_AMBIGUOUS'].includes(String(recovery?.state || ''))) {
            this.#state.last_error = `sentinel_worker:${String(recovery.state).slice(0, 180)}`;
            if (this.#state.state === 'ACTIVE') this.#state.state = 'DEGRADED_SENTINEL';
          }
        } catch (error) {
          this.#state.sentinel_worker_healthy = false;
          this.#state.last_error = `sentinel_worker:${String(error?.message || error).slice(0, 200)}`;
          if (this.#state.state === 'ACTIVE') this.#state.state = 'DEGRADED_SENTINEL';
        }
      }
      return this.snapshot();
    })().finally(() => { this.#resilienceTickPromise = null; });
    return this.#resilienceTickPromise;
  }

  #startResiliencePump() {
    if (this.#progressTimer || this.#stopRequested) return;
    this.#progressTimer = setInterval(() => {
      void this.#resilienceTick({ kind: 'EVENT_LOOP_HEARTBEAT' }).catch((error) => {
        this.#state.last_error = `resilience_tick:${String(error?.message || error).slice(0, 200)}`;
      });
    }, PARENT_PROGRESS_HEARTBEAT_MS);
    this.#progressTimer.unref?.();
  }

  async start() {
    this.#stopRequested = false;
    try {
      const electron = this.#electron || await import('electron');
      const { app, powerSaveBlocker, powerMonitor } = electron;
      this.#app = app || null;
      if (!app?.isPackaged) { this.#state.state = 'DISABLED_UNPACKAGED'; return this.snapshot(); }
      this.#state.state = 'ACTIVE';
      await this.#verifyLoginStart({ force: true });
      await this.#bootstrapSentinel();
      this.#startResiliencePump();
      if (process.env.METAENGINE_ALLOW_SUSPEND !== '1' && powerSaveBlocker) {
        this.#blockerId = powerSaveBlocker.start('prevent-app-suspension');
        this.#state.prevent_app_suspension = powerSaveBlocker.isStarted(this.#blockerId) === true;
      }
      if (powerMonitor?.on && !this.#resumeHandler) {
        this.#resumeHandler = () => {
          this.#state.last_resume_at = new Date().toISOString();
          Promise.resolve(this.#onResume())
            .then(() => this.#resilienceTick({ kind: 'POWER_RESUME', forceLoginCheck: true }))
            .catch((e) => { this.#state.last_error = String(e?.message || e).slice(0, 240); });
        };
        powerMonitor.on('resume', this.#resumeHandler);
      }
      if (this.#state.login_start_required && !this.#state.login_start_verified) this.#state.state = 'DEGRADED_LOGIN_START';
      else if (this.#sentinelRequired() && this.#sentinel?.snapshot?.()?.worker_ready !== true) this.#state.state = 'DEGRADED_SENTINEL';
    } catch (e) {
      this.#state.state = 'ERROR';
      this.#state.sentinel_worker_healthy = false;
      this.#state.last_error = String(e?.message || e).slice(0, 240);
      this.#startResiliencePump();
    }
    return this.snapshot();
  }

  async markProgress({ kind = 'CONTROL_PLANE_CYCLE', detail = null } = {}) {
    try {
      return await this.#resilienceTick({ kind, detail });
    } catch (e) {
      this.#state.last_error = `parent_progress:${String(e?.message || e).slice(0, 200)}`;
      throw e;
    }
  }

  async prepareExpectedRestart(reason = 'SELF_UPDATE') {
    if (this.#sentinelRequired() && this.#sentinel?.snapshot?.()?.worker_ready !== true) throw new Error('host_resilience_sentinel_not_ready_for_expected_restart');
    if (this.#sentinel) await this.#sentinel.prepareExpectedRestart(reason);
    return this.snapshot();
  }

  async prepareInstallerHandoff(reason = 'SELF_UPDATE') {
    if (this.#sentinelRequired() && this.#sentinel?.snapshot?.()?.worker_ready !== true) throw new Error('host_resilience_sentinel_not_ready_for_installer_handoff');
    if (this.#sentinel) await this.#sentinel.prepareInstallerHandoff(reason);
    return this.snapshot();
  }

  async stop() {
    this.#stopRequested = true;
    try {
      const electron = this.#electron || await import('electron');
      if (this.#resumeHandler && electron.powerMonitor?.removeListener) electron.powerMonitor.removeListener('resume', this.#resumeHandler);
      if (this.#blockerId != null && electron.powerSaveBlocker?.isStarted?.(this.#blockerId)) electron.powerSaveBlocker.stop(this.#blockerId);
      if (this.#progressTimer) clearInterval(this.#progressTimer);
      await this.#sentinel?.stop?.();
    } catch {}
    this.#blockerId = null;
    this.#resumeHandler = null;
    this.#progressTimer = null;
    this.#progressLease = null;
    this.#resilienceTickPromise = null;
    this.#app = null;
    this.#sentinel = null;
    this.#sentinelStatePath = null;
    this.#sentinelBootstrapRetrySafe = false;
    this.#state.prevent_app_suspension = false;
    this.#state.sentinel_worker_healthy = false;
    this.#state.state = 'STOPPED';
    return this.snapshot();
  }
}
