import { HostResilienceRuntime } from './host-resilience-runtime.mjs';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SAFE_ARTIFACT_RE = /^[0-9A-Za-z._-]+$/;
export const DEFAULT_TRUSTED_UPDATE_CHANNEL = 'dev';
export const DEFAULT_TRUSTED_ARTIFACT_PREFIX = 'METAENGINE-Browser-Test-Setup-';

function clipError(error) { return String(error?.message || error || 'unknown_error').slice(0, 300); }

export function validateCiTestFeedUrl(value, { testMode = false, githubActions = false } = {}) {
  if (value == null || String(value).trim() === '') return null;
  if (testMode !== true || githubActions !== true) throw new Error('self_update_test_feed_not_allowed');
  const url = new URL(String(value).trim());
  if (url.protocol !== 'http:') throw new Error('self_update_test_feed_protocol_invalid');
  if (!['127.0.0.1','localhost','[::1]'].includes(url.hostname.toLowerCase())) throw new Error('self_update_test_feed_not_loopback');
  if (url.username || url.password || url.search || url.hash) throw new Error('self_update_test_feed_url_components_invalid');
  if (!url.pathname.endsWith('/')) throw new Error('self_update_test_feed_path_invalid');
  return url.href;
}

function verifiedMetadata(info, { trustedArtifactPrefix = DEFAULT_TRUSTED_ARTIFACT_PREFIX } = {}) {
  const version = String(info?.version || '').trim();
  if (!VERSION_RE.test(version)) throw new Error('update_metadata_version_invalid');
  const files = Array.isArray(info?.files) ? info.files : [];
  if (files.length === 0) throw new Error('update_metadata_files_missing');
  let installerCount = 0;
  const normalized = files.map((file) => {
    const url = String(file?.url || '').trim();
    const sha512 = String(file?.sha512 || '').trim();
    if (!url || !sha512 || sha512.length < 80) throw new Error('update_metadata_file_digest_invalid');
    if (!SAFE_ARTIFACT_RE.test(url) || url.includes('..') || url.includes('/') || url.includes('\\')) throw new Error('update_metadata_artifact_path_invalid');
    if (url.startsWith(trustedArtifactPrefix) && url.endsWith('.exe') && url.includes(`-${version}-`)) installerCount += 1;
    else throw new Error('update_metadata_artifact_binding_invalid');
    return { url: url.slice(0, 500), sha512: sha512.slice(0, 200), size: Number(file?.size || 0) };
  });
  if (installerCount !== 1) throw new Error('update_metadata_installer_count_invalid');
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
  #trustedChannel; #trustedArtifactPrefix; #ciTestFeedUrl; #beforeInstall;
  #state = {
    state: 'UNINITIALIZED', available_version: null, downloaded_version: null,
    metadata_verified: false, candidate_file_count: 0, staging_percentage: null,
    last_check_at: null, last_error: null, trusted_channel: null,
    download_percent: null, restart_gate_safe: false, restart_gate_since: null,
    restart_grace_ms: null, install_attempted_version: null, publisher_verified: false,
    ci_test_feed_active: false, pre_install_receipt_persisted: false,
  };
  #lastCheck = 0; #intervalMs; #canRestart; #clock; #restartGraceMs; #restartSafeSince = null;

  constructor({
    intervalMs = 10 * 60 * 1000,
    restartGraceMs = 12_000,
    canRestart = async () => false,
    updater = null,
    packaged = null,
    hostResilience = undefined,
    trustedChannel = DEFAULT_TRUSTED_UPDATE_CHANNEL,
    trustedArtifactPrefix = DEFAULT_TRUSTED_ARTIFACT_PREFIX,
    ciTestFeedUrl = process.env.METAENGINE_SELF_UPDATE_TEST_FEED_URL || null,
    ciTestMode = process.env.METAENGINE_SELF_UPDATE_TEST_MODE === '1',
    githubActions = process.env.GITHUB_ACTIONS === 'true',
    beforeInstall = async () => {},
    clock = () => Date.now(),
  } = {}) {
    this.#intervalMs = Math.max(60 * 1000, Number(intervalMs) || 10 * 60 * 1000);
    this.#restartGraceMs = Math.max(3000, Number(restartGraceMs) || 12_000);
    this.#canRestart = canRestart;
    this.#injectedUpdater = updater;
    this.#packagedOverride = packaged;
    this.#hostOverride = hostResilience;
    this.#trustedChannel = String(trustedChannel || DEFAULT_TRUSTED_UPDATE_CHANNEL).trim();
    this.#trustedArtifactPrefix = String(trustedArtifactPrefix || DEFAULT_TRUSTED_ARTIFACT_PREFIX).trim();
    this.#clock = clock;
    if (typeof beforeInstall !== 'function') throw new Error('self_update_before_install_invalid');
    this.#beforeInstall = beforeInstall;
    if (!/^[0-9A-Za-z._-]+$/.test(this.#trustedChannel)) throw new Error('trusted_update_channel_invalid');
    if (!SAFE_ARTIFACT_RE.test(this.#trustedArtifactPrefix)) throw new Error('trusted_update_artifact_prefix_invalid');
    this.#ciTestFeedUrl = validateCiTestFeedUrl(ciTestFeedUrl, { testMode: ciTestMode, githubActions });
    this.#state.trusted_channel = this.#trustedChannel;
    this.#state.restart_grace_ms = this.#restartGraceMs;
  }

  snapshot() {
    return structuredClone({ schema: 'metaengine.self-update-runtime.v6', ...this.#state, host_resilience: this.#host?.snapshot?.() || null, authority_effect: false });
  }

  #resetRestartGate() {
    this.#restartSafeSince = null;
    this.#state.restart_gate_safe = false;
    this.#state.restart_gate_since = null;
  }

  async #approveAndDownload(info) {
    try {
      const metadata = verifiedMetadata(info, { trustedArtifactPrefix: this.#trustedArtifactPrefix });
      this.#state.available_version = metadata.version;
      this.#state.metadata_verified = true;
      this.#state.candidate_file_count = metadata.files.length;
      this.#state.staging_percentage = metadata.staging_percentage;
      this.#state.last_error = null;
      this.#state.state = 'APPROVED_DOWNLOAD';
      this.#state.install_attempted_version = null;
      this.#state.pre_install_receipt_persisted = false;
      this.#resetRestartGate();
      if (typeof this.#updater?.downloadUpdate !== 'function') throw new Error('electron_updater_download_unavailable');
      await this.#updater.downloadUpdate();
      if (this.#state.state === 'APPROVED_DOWNLOAD') this.#state.state = 'DOWNLOADING';
    } catch (error) {
      this.#state.state = 'REJECTED_METADATA';
      this.#state.metadata_verified = false;
      this.#state.last_error = clipError(error);
      this.#resetRestartGate();
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
      updater.channel = this.#trustedChannel;
      updater.allowDowngrade = false;
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      if ('disableWebInstaller' in updater) updater.disableWebInstaller = true;
      if ('allowUnverifiedLinuxPackages' in updater) updater.allowUnverifiedLinuxPackages = false;
      if (this.#ciTestFeedUrl) {
        if (typeof updater.setFeedURL !== 'function') throw new Error('electron_updater_set_feed_url_unavailable');
        updater.setFeedURL({ provider: 'generic', url: this.#ciTestFeedUrl, channel: this.#trustedChannel });
        this.#state.ci_test_feed_active = true;
      }
      updater.on('checking-for-update', () => { this.#state.state = 'CHECKING'; });
      updater.on('update-available', (info) => { void this.#approveAndDownload(info); });
      updater.on('update-not-available', () => {
        this.#state.state = 'CURRENT';
        this.#state.available_version = null;
        this.#state.downloaded_version = null;
        this.#state.metadata_verified = false;
        this.#state.candidate_file_count = 0;
        this.#state.download_percent = null;
        this.#state.install_attempted_version = null;
        this.#state.pre_install_receipt_persisted = false;
        this.#resetRestartGate();
      });
      updater.on('download-progress', (p) => { this.#state.state = 'DOWNLOADING'; this.#state.download_percent = Number(p?.percent || 0); });
      updater.on('update-downloaded', (info) => {
        const downloaded = String(info?.version || '');
        if (!this.#state.metadata_verified || !this.#state.available_version || downloaded !== this.#state.available_version) {
          this.#state.state = 'ERROR';
          this.#state.last_error = 'downloaded_version_binding_mismatch';
          this.#resetRestartGate();
          return;
        }
        this.#state.state = 'READY_RESTART';
        this.#state.downloaded_version = downloaded;
        this.#state.download_percent = 100;
        this.#state.pre_install_receipt_persisted = false;
        this.#resetRestartGate();
      });
      updater.on('error', (e) => { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); this.#resetRestartGate(); });
      this.#updater = updater;
      this.#state.state = 'IDLE';
    } catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); this.#resetRestartGate(); }
    return this.snapshot();
  }

  async #cycleRestartGate() {
    if (!['READY_RESTART','RESTART_GRACE'].includes(this.#state.state)) return;
    const safe = await this.#canRestart();
    const now = this.#clock();
    if (!safe) {
      this.#resetRestartGate();
      this.#state.state = 'READY_RESTART';
      return;
    }
    if (this.#restartSafeSince == null) {
      this.#restartSafeSince = now;
      this.#state.restart_gate_safe = true;
      this.#state.restart_gate_since = new Date(now).toISOString();
      this.#state.state = 'RESTART_GRACE';
      return;
    }
    this.#state.restart_gate_safe = true;
    if (now - this.#restartSafeSince < this.#restartGraceMs) {
      this.#state.state = 'RESTART_GRACE';
      return;
    }
    if (!this.#state.downloaded_version || this.#state.install_attempted_version === this.#state.downloaded_version) return;
    this.#state.install_attempted_version = this.#state.downloaded_version;
    this.#state.state = 'RESTARTING';
    try {
      const receipt = {
        schema: 'metaengine.self-update.pre-install-receipt.v1',
        version: this.#state.downloaded_version,
        available_version: this.#state.available_version,
        metadata_verified: this.#state.metadata_verified === true,
        restart_gate_safe: this.#state.restart_gate_safe === true,
        restart_gate_since: this.#state.restart_gate_since,
        recorded_at: new Date(now).toISOString(),
        authority_effect: false,
      };
      await this.#beforeInstall(structuredClone(receipt));
      this.#state.pre_install_receipt_persisted = true;
      await this.#host?.prepareExpectedRestart?.('SELF_UPDATE');
      this.#updater.quitAndInstall(false, true);
    } catch (e) {
      this.#state.state = 'ERROR';
      this.#state.pre_install_receipt_persisted = false;
      this.#state.last_error = clipError(e);
      this.#resetRestartGate();
    }
  }

  async cycle({ force = false } = {}) {
    if (!this.#updater) return this.snapshot();
    const now = this.#clock();
    const latchedFailure = ['ERROR','REJECTED_METADATA'].includes(this.#state.state);
    const busy = ['APPROVED_DOWNLOAD','DOWNLOADING','READY_RESTART','RESTART_GRACE','RESTARTING'].includes(this.#state.state);
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
          this.#state.download_percent = null;
          this.#state.install_attempted_version = null;
          this.#state.pre_install_receipt_persisted = false;
          this.#resetRestartGate();
        }
        await this.#updater.checkForUpdates();
      } catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); this.#resetRestartGate(); }
    }
    await this.#cycleRestartGate();
    return this.snapshot();
  }
}
