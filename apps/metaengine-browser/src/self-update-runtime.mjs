import { HostResilienceRuntime } from './host-resilience-runtime.mjs';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function clipError(error) { return String(error?.message || error || 'unknown_error').slice(0, 300); }

function verifiedMetadata(info) {
  const version = String(info?.version || '').trim();
  if (!VERSION_RE.test(version)) throw new Error('update_metadata_version_invalid');
  const files = Array.isArray(info?.files) ? info.files : [];
  if (files.length === 0) throw new Error('update_metadata_files_missing');
  const normalized = files.map((file) => {
    const url = String(file?.url || '').trim();
    const sha512 = String(file?.sha512 || '').trim();
    if (!url || !sha512 || sha512.length < 40) throw new Error('update_metadata_file_digest_invalid');
    return { url: url.slice(0, 500), sha512: sha512.slice(0, 200), size: Number(file?.size || 0) };
  });
  const stagingPercentage = info?.stagingPercentage == null ? null : Number(info.stagingPercentage);
  if (stagingPercentage != null && (!Number.isFinite(stagingPercentage) || stagingPercentage < 0 || stagingPercentage > 100)) {
    throw new Error('update_metadata_staging_invalid');
  }
  return {
    version,
    files: normalized,
    staging_percentage: stagingPercentage,
    release_date: info?.releaseDate ? String(info.releaseDate).slice(0, 80) : null,
  };
}

export class SelfUpdateRuntime {
  #updater = null; #injectedUpdater; #packagedOverride; #host = null; #hostOverride;
  #state = {
    state: 'UNINITIALIZED', available_version: null, downloaded_version: null,
    metadata_verified: false, candidate_file_count: 0, staging_percentage: null,
    last_check_at: null, last_error: null,
  };
  #lastCheck = 0; #intervalMs; #canRestart;

  constructor({ intervalMs = 10 * 60 * 1000, canRestart = async () => false, updater = null, packaged = null, hostResilience = undefined } = {}) {
    this.#intervalMs = Math.max(60 * 1000, Number(intervalMs) || 10 * 60 * 1000);
    this.#canRestart = canRestart;
    this.#injectedUpdater = updater;
    this.#packagedOverride = packaged;
    this.#hostOverride = hostResilience;
  }

  snapshot() {
    return structuredClone({ schema: 'metaengine.self-update-runtime.v2', ...this.#state, host_resilience: this.#host?.snapshot?.() || null, authority_effect: false });
  }

  async #approveAndDownload(info) {
    try {
      const metadata = verifiedMetadata(info);
      this.#state.available_version = metadata.version;
      this.#state.metadata_verified = true;
      this.#state.candidate_file_count = metadata.files.length;
      this.#state.staging_percentage = metadata.staging_percentage;
      this.#state.last_error = null;
      this.#state.state = 'APPROVED_DOWNLOAD';
      if (typeof this.#updater?.downloadUpdate !== 'function') throw new Error('electron_updater_download_unavailable');
      await this.#updater.downloadUpdate();
      if (this.#state.state === 'APPROVED_DOWNLOAD') this.#state.state = 'DOWNLOADING';
    } catch (error) {
      this.#state.state = 'REJECTED_METADATA';
      this.#state.metadata_verified = false;
      this.#state.last_error = clipError(error);
    }
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
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      if ('disableWebInstaller' in updater) updater.disableWebInstaller = true;
      updater.on('checking-for-update', () => { this.#state.state = 'CHECKING'; });
      updater.on('update-available', (info) => { void this.#approveAndDownload(info); });
      updater.on('update-not-available', () => {
        this.#state.state = 'CURRENT';
        this.#state.available_version = null;
        this.#state.downloaded_version = null;
        this.#state.metadata_verified = false;
        this.#state.candidate_file_count = 0;
      });
      updater.on('download-progress', (p) => { this.#state.state = 'DOWNLOADING'; this.#state.download_percent = Number(p?.percent || 0); });
      updater.on('update-downloaded', (info) => {
        const downloaded = String(info?.version || '');
        if (!this.#state.metadata_verified || !this.#state.available_version || downloaded !== this.#state.available_version) {
          this.#state.state = 'ERROR';
          this.#state.last_error = 'downloaded_version_binding_mismatch';
          return;
        }
        this.#state.state = 'READY_RESTART';
        this.#state.downloaded_version = downloaded;
        this.#state.download_percent = 100;
      });
      updater.on('error', (e) => { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); });
      this.#updater = updater;
      this.#state.state = 'IDLE';
    } catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); }
    return this.snapshot();
  }

  async cycle({ force = false } = {}) {
    if (!this.#updater) return this.snapshot();
    const now = Date.now();
    const latchedFailure = ['ERROR','REJECTED_METADATA'].includes(this.#state.state);
    const busy = ['APPROVED_DOWNLOAD','DOWNLOADING','READY_RESTART','RESTARTING'].includes(this.#state.state);
    if (!busy && (!latchedFailure || force) && (force || now - this.#lastCheck >= this.#intervalMs)) {
      this.#lastCheck = now;
      this.#state.last_check_at = new Date(now).toISOString();
      try {
        if (force && latchedFailure) {
          this.#state.last_error = null;
          this.#state.metadata_verified = false;
          this.#state.available_version = null;
          this.#state.downloaded_version = null;
          this.#state.candidate_file_count = 0;
        }
        await this.#updater.checkForUpdates();
      } catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); }
    }
    if (this.#state.state === 'READY_RESTART' && await this.#canRestart()) {
      this.#state.state = 'RESTARTING';
      try {
        await this.#host?.prepareExpectedRestart?.('SELF_UPDATE');
        this.#updater.quitAndInstall(false, true);
      } catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); }
    }
    return this.snapshot();
  }
}
