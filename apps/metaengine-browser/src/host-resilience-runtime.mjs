import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSentinelHost } from './browser-sentinel.mjs';
import { BrowserParentProgressLease } from './browser-parent-progress-lease.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT_PROGRESS_HEARTBEAT_MS = 5_000;

export class HostResilienceRuntime {
  #electron; #onResume; #platform; #blockerId = null; #resumeHandler = null; #sentinel = null; #progressLease = null; #progressTimer = null; #resilienceTickPromise = null;
  #state = {
    state: 'UNINITIALIZED', open_at_login: false, executable_will_launch_at_login: false,
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
      schema: 'metaengine.host-resilience-runtime.v5',
      ...this.#state,
      sentinel,
      parent_progress: parentProgress,
      sentinel_worker_healthy: sentinel?.worker_ready === true,
      useful_progress_required: true,
      pid_liveness_alone_sufficient: false,
      sentinel_recovery_requires_exact_old_pid_absence: true,
      sentinel_recovery_uses_existing_progress_tick: true,
      watchdog_scheduler_authority: false,
      watchdog_task_leasing: false,
      authority_effect: false,
    });
  }

  async #resilienceTick({ kind = 'EVENT_LOOP_HEARTBEAT', detail = null } = {}) {
    if (this.#resilienceTickPromise) return this.#resilienceTickPromise;
    this.#resilienceTickPromise = (async () => {
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

  async start() {
    try {
      const electron = this.#electron || await import('electron');
      const { app, powerSaveBlocker, powerMonitor } = electron;
      if (!app?.isPackaged) { this.#state.state = 'DISABLED_UNPACKAGED'; return this.snapshot(); }
      if (this.#platform === 'win32' && process.env.METAENGINE_DISABLE_LOGIN_START !== '1') {
        app.setLoginItemSettings({ openAtLogin: true, enabled: true });
        const settings = app.getLoginItemSettings();
        this.#state.open_at_login = settings?.openAtLogin === true;
        this.#state.executable_will_launch_at_login = settings?.executableWillLaunchAtLogin === true;
      }
      if (this.#platform === 'win32' && process.env.METAENGINE_DISABLE_CRASH_SENTINEL !== '1' && typeof app.getPath === 'function') {
        const statePath = path.join(app.getPath('userData'), 'metaengine-browser-sentinel-v1.json');
        this.#sentinel = new BrowserSentinelHost({ statePath, workerScript: path.join(__dirname, 'browser-sentinel-worker.cjs'), executable: process.execPath });
        await this.#sentinel.start({ app });
        await this.#sentinel.waitUntilHealthy(5_000);
        this.#progressLease = new BrowserParentProgressLease({ statePath, getBinding: () => this.#sentinel?.snapshot?.() || null });
        await this.#progressLease.mark({ kind: 'HOST_RESILIENCE_STARTED' });
        this.#state.parent_progress = this.#progressLease.snapshot();
        this.#progressTimer = setInterval(() => {
          void this.#resilienceTick({ kind: 'EVENT_LOOP_HEARTBEAT' }).catch((error) => {
            this.#state.last_error = `resilience_tick:${String(error?.message || error).slice(0, 200)}`;
          });
        }, PARENT_PROGRESS_HEARTBEAT_MS);
        this.#progressTimer.unref?.();
        this.#state.sentinel_worker_healthy = true;
      }
      if (process.env.METAENGINE_ALLOW_SUSPEND !== '1' && powerSaveBlocker) {
        this.#blockerId = powerSaveBlocker.start('prevent-app-suspension');
        this.#state.prevent_app_suspension = powerSaveBlocker.isStarted(this.#blockerId) === true;
      }
      if (powerMonitor?.on) {
        this.#resumeHandler = () => {
          this.#state.last_resume_at = new Date().toISOString();
          Promise.resolve(this.#onResume())
            .then(() => this.#resilienceTick({ kind: 'POWER_RESUME' }))
            .catch((e) => { this.#state.last_error = String(e?.message || e).slice(0, 240); });
        };
        powerMonitor.on('resume', this.#resumeHandler);
      }
      this.#state.state = 'ACTIVE';
    } catch (e) {
      this.#state.state = 'ERROR';
      this.#state.sentinel_worker_healthy = false;
      this.#state.last_error = String(e?.message || e).slice(0, 240);
    }
    return this.snapshot();
  }

  async markProgress({ kind = 'CONTROL_PLANE_CYCLE', detail = null } = {}) {
    if (!this.#progressLease) return this.snapshot();
    try {
      await this.#progressLease.mark({ kind, detail });
      this.#state.parent_progress = this.#progressLease.snapshot();
    } catch (e) {
      this.#state.last_error = `parent_progress:${String(e?.message || e).slice(0, 200)}`;
      throw e;
    }
    return this.snapshot();
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
    this.#state.prevent_app_suspension = false;
    this.#state.sentinel_worker_healthy = false;
    this.#state.state = 'STOPPED';
    return this.snapshot();
  }
}
