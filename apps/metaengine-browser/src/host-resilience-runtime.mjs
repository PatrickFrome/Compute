import { BrowserSentinelHeartbeat } from './browser-sentinel-heartbeat.mjs';

export class HostResilienceRuntime {
  #electron; #onResume; #platform; #blockerId = null; #resumeHandler = null;
  #sentinel = null; #sentinelOverride; #beforeQuitHandler = null; #getUpdateState;
  #state = { state: 'UNINITIALIZED', open_at_login: false, executable_will_launch_at_login: false, prevent_app_suspension: false, last_resume_at: null, last_error: null };

  constructor({ electron = null, onResume = async () => {}, platform = process.platform, browserSentinel = undefined, getUpdateState = () => null } = {}) {
    this.#electron = electron;
    this.#onResume = onResume;
    this.#platform = platform;
    this.#sentinelOverride = browserSentinel;
    this.#getUpdateState = typeof getUpdateState === 'function' ? getUpdateState : () => null;
  }

  snapshot() {
    return structuredClone({
      schema: 'metaengine.host-resilience-runtime.v1',
      ...this.#state,
      browser_sentinel: this.#sentinel?.snapshot?.() || null,
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
      if (process.env.METAENGINE_ALLOW_SUSPEND !== '1' && powerSaveBlocker) {
        this.#blockerId = powerSaveBlocker.start('prevent-app-suspension');
        this.#state.prevent_app_suspension = powerSaveBlocker.isStarted(this.#blockerId) === true;
      }
      if (powerMonitor?.on) {
        this.#resumeHandler = () => {
          this.#state.last_resume_at = new Date().toISOString();
          Promise.resolve(this.#onResume()).catch((e) => { this.#state.last_error = String(e?.message || e).slice(0, 240); });
        };
        powerMonitor.on('resume', this.#resumeHandler);
      }

      // Tests inject an Electron facade. Production resolves Electron internally and gets the real packaged paths.
      const sentinelEligible = this.#platform === 'win32'
        && this.#sentinelOverride !== false
        && (this.#sentinelOverride != null || this.#electron == null);
      if (sentinelEligible) {
        this.#sentinel = this.#sentinelOverride || new BrowserSentinelHeartbeat({
          packaged: app.isPackaged === true,
          getUpdateState: this.#getUpdateState,
        });
        const sentinelState = await this.#sentinel.start();
        if (sentinelState.state === 'ERROR') this.#state.last_error = `browser_sentinel:${String(sentinelState.last_error || 'start_failed').slice(0, 200)}`;
        if (typeof app?.on === 'function') {
          this.#beforeQuitHandler = () => {
            const updateState = String(this.#getUpdateState() || '').toUpperCase();
            this.#sentinel?.stopSync?.({ intent: updateState === 'RESTARTING' ? 'UPDATE_RESTART' : 'USER_EXIT' });
          };
          app.on('before-quit', this.#beforeQuitHandler);
        }
      }
      this.#state.state = 'ACTIVE';
    } catch (e) {
      this.#state.state = 'ERROR';
      this.#state.last_error = String(e?.message || e).slice(0, 240);
    }
    return this.snapshot();
  }

  async stop() {
    try {
      const electron = this.#electron || await import('electron');
      if (this.#resumeHandler && electron.powerMonitor?.removeListener) electron.powerMonitor.removeListener('resume', this.#resumeHandler);
      if (this.#beforeQuitHandler && electron.app?.removeListener) electron.app.removeListener('before-quit', this.#beforeQuitHandler);
      if (this.#blockerId != null && electron.powerSaveBlocker?.isStarted?.(this.#blockerId)) electron.powerSaveBlocker.stop(this.#blockerId);
    } catch {}
    await this.#sentinel?.stop?.({ intent: 'USER_EXIT' }).catch?.(() => {});
    this.#blockerId = null;
    this.#resumeHandler = null;
    this.#beforeQuitHandler = null;
    this.#state.prevent_app_suspension = false;
    this.#state.state = 'STOPPED';
    return this.snapshot();
  }
}
