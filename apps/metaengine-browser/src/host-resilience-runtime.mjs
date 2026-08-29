export class HostResilienceRuntime {
  #electron; #onResume; #platform; #blockerId = null; #resumeHandler = null;
  #state = { state: 'UNINITIALIZED', open_at_login: false, executable_will_launch_at_login: false, prevent_app_suspension: false, last_resume_at: null, last_error: null };

  constructor({ electron = null, onResume = async () => {}, platform = process.platform } = {}) {
    this.#electron = electron;
    this.#onResume = onResume;
    this.#platform = platform;
  }

  snapshot() { return structuredClone({ schema: 'metaengine.host-resilience-runtime.v1', ...this.#state, authority_effect: false }); }

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
      if (this.#blockerId != null && electron.powerSaveBlocker?.isStarted?.(this.#blockerId)) electron.powerSaveBlocker.stop(this.#blockerId);
    } catch {}
    this.#blockerId = null;
    this.#resumeHandler = null;
    this.#state.prevent_app_suspension = false;
    this.#state.state = 'STOPPED';
    return this.snapshot();
  }
}
