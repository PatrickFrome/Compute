import { HostResilienceRuntime } from './host-resilience-runtime.mjs';

export class SelfUpdateRuntime {
  #updater = null; #injectedUpdater; #packagedOverride; #host = null; #hostOverride;
  #state = { state: 'UNINITIALIZED', available_version: null, downloaded_version: null, last_check_at: null, last_error: null };
  #lastCheck = 0; #intervalMs; #canRestart;

  constructor({ intervalMs = 10 * 60 * 1000, canRestart = async () => false, updater = null, packaged = null, hostResilience = undefined } = {}) {
    this.#intervalMs = Math.max(60 * 1000, Number(intervalMs) || 10 * 60 * 1000);
    this.#canRestart = canRestart;
    this.#injectedUpdater = updater;
    this.#packagedOverride = packaged;
    this.#hostOverride = hostResilience;
  }

  snapshot() {
    return structuredClone({ schema: 'metaengine.self-update-runtime.v1', ...this.#state, host_resilience: this.#host?.snapshot?.() || null, authority_effect: false });
  }

  async start() {
    try {
      let packaged = this.#packagedOverride;
      if (packaged == null) {
        const { app } = await import('electron');
        packaged = app.isPackaged;
      }
      if (packaged && this.#hostOverride !== false) {
        this.#host = this.#hostOverride || new HostResilienceRuntime();
        await this.#host.start();
      }
      if (!packaged || process.env.METAENGINE_DISABLE_SELF_UPDATE === '1') { this.#state.state = 'DISABLED'; return this.snapshot(); }
      let updater = this.#injectedUpdater;
      if (!updater) {
        const mod = await import('electron-updater');
        updater = mod.autoUpdater || mod.default?.autoUpdater;
      }
      if (!updater) throw new Error('electron_updater_unavailable');
      updater.allowPrerelease = true;
      updater.allowDowngrade = false;
      updater.autoDownload = true;
      updater.autoInstallOnAppQuit = false;
      if ('disableWebInstaller' in updater) updater.disableWebInstaller = true;
      updater.on('checking-for-update', () => { this.#state.state = 'CHECKING'; });
      updater.on('update-available', (info) => { this.#state.state = 'DOWNLOADING'; this.#state.available_version = String(info?.version || ''); });
      updater.on('update-not-available', () => { this.#state.state = 'CURRENT'; });
      updater.on('download-progress', (p) => { this.#state.state = 'DOWNLOADING'; this.#state.download_percent = Number(p?.percent || 0); });
      updater.on('update-downloaded', (info) => { this.#state.state = 'READY_RESTART'; this.#state.downloaded_version = String(info?.version || ''); this.#state.download_percent = 100; });
      updater.on('error', (e) => { this.#state.state = 'ERROR'; this.#state.last_error = String(e?.message || e).slice(0, 300); });
      this.#updater = updater;
      this.#state.state = 'IDLE';
    } catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = String(e?.message || e).slice(0, 300); }
    return this.snapshot();
  }

  async cycle({ force = false } = {}) {
    if (!this.#updater) return this.snapshot();
    const now = Date.now();
    if (!['DOWNLOADING','READY_RESTART','RESTARTING'].includes(this.#state.state) && (force || now - this.#lastCheck >= this.#intervalMs)) {
      this.#lastCheck = now; this.#state.last_check_at = new Date(now).toISOString();
      try { await this.#updater.checkForUpdates(); }
      catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = String(e?.message || e).slice(0, 300); }
    }
    if (this.#state.state === 'READY_RESTART' && await this.#canRestart()) {
      this.#state.state = 'RESTARTING';
      try { this.#updater.quitAndInstall(false, true); }
      catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = String(e?.message || e).slice(0, 300); }
    }
    return this.snapshot();
  }
}
