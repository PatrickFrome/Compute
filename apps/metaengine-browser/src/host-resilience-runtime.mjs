import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserSentinelHost } from './browser-sentinel.mjs';
import { BrowserParentProgressLease } from './browser-parent-progress-lease.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PARENT_PROGRESS_HEARTBEAT_MS = 5_000;

export class HostResilienceRuntime {
  #electron; #onResume; #platform; #blockerId = null; #resumeHandler = null; #sentinel = null; #progressLease = null; #progressTimer = null;
  #state = {
    state: 'UNINITIALIZED', open_at_login: false, executable_will_launch_at_login: false,
    prevent_app_suspension: false, sentinel: null, sentinel_worker_healthy: false,
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
      schema: 'metaengine.host-resilience-runtime.v4',
      ...this.#state,
      sentinel,
      parent_progress: parentProgress,
      sentinel_worker_healthy: sentinel?.worker_ready === true,
      useful_progress_required: true,
      pid_liveness_alone_sufficient: false,
      watchdog_scheduler_authority: false,
      watchdog_task_leasing: false,
      authority_effect: false,
    });
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
        this.#state.sentinel = this.#sentinel.snapshot();
        this.#progressTimer = setInterval(() => {
          void this.markProgress({ kind: 'EVENT_LOOP_HEARTBEAT' }).catch(() => {});
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
            .then(() => this.markProgress({ kind: 'POWER_RESUME' }))
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

    // Parent progress must remain independent from watchdog recovery. After the
    // durable progress write, opportunistically repair a missing worker. The host
    // method itself requires positive old-PID absence before any replacement spawn
    // and permanently blocks automatic retry after an ambiguous spawn/readback.
    if (this.#sentinel?.snapshot?.()?.worker_ready !== true) {
      try {
        const recovered = await this.#sentinel.reconcileWorker({ timeoutMs: 5_000 });
        this.#state.sentinel = recovered;
        this.#state.sentinel_worker_healthy = recovered?.worker_ready === true;
        if (recovered?.worker_recovery?.error) {
          this.#state.last_error = `sentinel_worker_recovery:${String(recovered.worker_recovery.error).slice(0, 200)}`;
        } else if (this.#state.last_error?.startsWith('sentinel_worker_recovery:')) {
          this.#state.last_error = null;
        }
      } catch (e) {
        this.#state.last_error = `sentinel_worker_recovery:${String(e?.message || e).slice(0, 200)}`;
      }
    } else {
      this.#state.sentinel = this.#sentinel.snapshot();
      this.#state.sentinel_worker_healthy = true;
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
    this.#state.prevent_app_suspension = false;
    this.#state.sentinel_worker_healthy = false;
    this.#state.state = 'STOPPED';
    return this.snapshot();
  }
}
