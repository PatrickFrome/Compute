import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSentinelHost } from './browser-sentinel.mjs';
import { BrowserParentProgressLease } from './browser-parent-progress-lease.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT_PROGRESS_HEARTBEAT_MS = 5_000;
const LOGIN_START_RECHECK_MS = 30_000;

export class HostResilienceRuntime {
  #electron; #onResume; #platform; #blockerId = null; #resumeHandler = null; #sentinel = null; #progressLease = null; #progressTimer = null; #resilienceTickPromise = null; #app = null; #stopRequested = true; #lastLoginCheckMs = 0;
  #state = {
    state: 'UNINITIALIZED', open_at_login: false, executable_will_launch_at_login: false,
    login_start_required: false, login_start_verified: false, login_start_attempts: 0,
    login_start_recheck_ms: LOGIN_START_RECHECK_MS, last_login_start_check_at: null,
    prevent_app_suspension: false, sentinel: null, sentinel_worker_healthy: false,
    sentinel_worker_recovery: null,
    parent_progress: null, parent_progress_heartbeat_ms: PARENT_PROGRESS_HEARTBEAT_MS,
    last_resume_at: null, last_error: null,
  };

  constructor({ electron = null, onResume = async () => {}, platform = process.platform } = {}) {
    this.#electron = electron;
    this.#onResume = onResume;
    this.#platform = platform;
  }

  snapshot() {
    const sentinel = this.#sentinel?.snapshot?.() || this.#state.sentinel;
    const parentProgress = this.#progressLease?.snapshot?.() || this.#state.parent_progress;
    return structuredClone({
      schema: 'metaengine.host-resilience-runtime.v6',
      ...this.#state,
      sentinel,
      parent_progress: parentProgress,
      sentinel_worker_healthy: sentinel?.worker_ready === true,
      login_start_retry_pending: this.#state.login_start_required === true && this.#state.login_start_verified !== true && this.#stopRequested !== true,
      useful_progress_required: true,
      pid_liveness_alone_sufficient: false,
      terminal_requires_external_stop: true,
      external_stop_requested: this.#stopRequested,
      sentinel_recovery_requires_exact_old_pid_absence: true,
      sentinel_recovery_uses_existing_progress_tick: true,
      login_start_recovery_uses_existing_progress_tick: true,
      watchdog_scheduler_authority: false,
      watchdog_task_leasing: false,
      authority_effect: false,
    });
  }

  async #verifyLoginStart({ force = false } = {}) {
    const required = this.#platform === 'win32' && process.env.METAENGINE_DISABLE_LOGIN_START !== '1';
    this.#state.login_start_required = required;
    if (!required) {
      this.#state.login_start_verified = false;
      return true;
    }
    const now = Date.now();
    if (!force && this.#state.login_start_verified === true && now - this.#lastLoginCheckMs < LOGIN_START_RECHECK_MS) return true;
    if (!force && this.#state.login_start_verified !== true && now - this.#lastLoginCheckMs < Math.min(PARENT_PROGRESS_HEARTBEAT_MS, LOGIN_START_RECHECK_MS)) return false;
    this.#lastLoginCheckMs = now;
    this.#state.last_login_start_check_at = new Date(now).toISOString();
    this.#state.login_start_attempts += 1;
    const app = this.#app;
    if (!app || typeof app.setLoginItemSettings !== 'function' || typeof app.getLoginItemSettings !== 'function') {
      this.#state.login_start_verified = false;
      this.#state.last_error = 'login_start:API_UNAVAILABLE';
      this.#state.state = 'DEGRADED_LOGIN_START';
      return false;
    }
    try {
      app.setLoginItemSettings({ openAtLogin: true, enabled: true });
      const settings = app.getLoginItemSettings();
      this.#state.open_at_login = settings?.openAtLogin === true;
      this.#state.executable_will_launch_at_login = settings?.executableWillLaunchAtLogin === true;
      this.#state.login_start_verified = this.#state.open_at_login && this.#state.executable_will_launch_at_login;
      if (this.#state.login_start_verified) {
        if (String(this.#state.last_error || '').startsWith('login_start:')) this.#state.last_error = null;
        if (this.#state.state === 'DEGRADED_LOGIN_START') this.#state.state = 'ACTIVE';
        return true;
      }
      this.#state.last_error = 'login_start:NOT_VERIFIED';
      this.#state.state = 'DEGRADED_LOGIN_START';
      return false;
    } catch (error) {
      this.#state.login_start_verified = false;
      this.#state.last_error = `login_start:${String(error?.message || error).slice(0, 180)}`;
      this.#state.state = 'DEGRADED_LOGIN_START';
      return false;
    }
  }

  async #resilienceTick({ kind = 'EVENT_LOOP_HEARTBEAT', detail = null, forceLoginCheck = false } = {}) {
    if (this.#resilienceTickPromise) return this.#resilienceTickPromise;
    this.#resilienceTickPromise = (async () => {
      if (this.#stopRequested) return this.snapshot();
      await this.#verifyLoginStart({ force: forceLoginCheck });

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
          } else if (['STALE_WORKER_PID_ALIVE','WORKER_PID_MISSING_AMBIGUOUS','SPAWN_AMBIGUOUS','CANDIDATE_ALIVE_HEARTBEAT_AMBIGUOUS'].includes(String(recovery?.state || ''))) {
            this.#state.last_error = `sentinel_worker:${String(recovery.state).slice(0, 180)}`;
          }
        } catch (error) {
          this.#state.sentinel_worker_healthy = false;
          this.#state.last_error = `sentinel_worker:${String(error?.message || error).slice(0, 200)}`;
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
      if (this.#platform === 'win32' && process.env.METAENGINE_DISABLE_CRASH_SENTINEL !== '1' && typeof app.getPath === 'function') {
        const statePath = path.join(app.getPath('userData'), 'metaengine-browser-sentinel-v1.json');
        this.#sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(__dirname, 'browser-sentinel-worker.cjs'), executable: process.execPath });
        await this.#sentinel.start({ app });
        await this.#sentinel.waitUntilHealthy(5_000);
        this.#progressLease = new BrowserParentProgressLease({ statePath, getBinding: () => this.#sentinel?.snapshot?.() || null });
        await this.#progressLease.mark({ kind: 'HOST_RESILIENCE_STARTED' });
        this.#state.parent_progress = this.#progressLease.snapshot();
        this.#state.sentinel_worker_healthy = true;
      }
      this.#startResiliencePump();
      if (process.env.METAENGINE_ALLOW_SUSPEND !== '1' && powerSaveBlocker) {
        this.#blockerId = powerSaveBlocker.start('prevent-app-suspension');
        this.#state.prevent_app_suspension = powerSaveBlocker.isStarted(this.#blockerId) === true;
      }
      if (powerMonitor?.on) {
        this.#resumeHandler = () => {
          this.#state.last_resume_at = new Date().toISOString();
          Promise.resolve(this.#onResume())
            .then(() => this.#resilienceTick({ kind: 'POWER_RESUME', forceLoginCheck: true }))
            .catch((e) => { this.#state.last_error = String(e?.message || e).slice(0, 240); });
        };
        powerMonitor.on('resume', this.#resumeHandler);
      }
      if (this.#state.login_start_required && !this.#state.login_start_verified) this.#state.state = 'DEGRADED_LOGIN_START';
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
    if (this.#sentinel) await this.#sentinel.prepareExpectedRestart(reason);
    return this.snapshot();
  }

  async prepareInstallerHandoff(reason = 'SELF_UPDATE') {
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
    this.#state.prevent_app_suspension = false;
    this.#state.sentinel_worker_healthy = false;
    this.#state.state = 'STOPPED';
    return this.snapshot();
  }
}
