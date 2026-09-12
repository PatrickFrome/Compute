import { HostResilienceRuntime } from './host-resilience-runtime.mjs';
import { resolveTrustedMetaengineDevRelease } from './trusted-dev-release-resolver.mjs';

const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;
const SAFE_ARTIFACT_RE = /^[0-9A-Za-z._-]+$/;
const COMMAND_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECOVERABLE_SELF_UPDATE_HOLDS = new Set(['AMBIGUOUS_INSTALL', 'SUCCESSOR_RECEIPT_AMBIGUOUS']);
export const DEFAULT_TRUSTED_UPDATE_CHANNEL = 'dev';
export const DEFAULT_TRUSTED_ARTIFACT_PREFIX = 'METAENGINE-Browser-Test-Setup-';

function clipError(error) { return String(error?.message || error || 'unknown_error').slice(0, 300); }

export function classifySelfUpdateDisableEnvironment(env = process.env) {
  const disableRequested = String(env?.METAENGINE_DISABLE_SELF_UPDATE || '') === '1';
  const holdReason = String(env?.METAENGINE_SELF_UPDATE_HOLD_REASON || '').trim().toUpperCase() || null;
  const recoverableHold = disableRequested && RECOVERABLE_SELF_UPDATE_HOLDS.has(holdReason);
  return Object.freeze({
    globally_disabled: disableRequested && !recoverableHold,
    install_effect_quarantined: recoverableHold,
    hold_reason: holdReason,
    control_plane_enabled: !disableRequested || recoverableHold,
    automatic_effect_retry_allowed: false,
    authority_effect: false,
  });
}

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
  #trustedChannel; #trustedArtifactPrefix; #ciTestFeedUrl; #beforeInstall; #beforeInstallerLaunch;
  #releaseResolver; #releaseFetch; #currentVersion; #resolvedRelease = null;
  #state = {
    state: 'UNINITIALIZED', available_version: null, downloaded_version: null,
    metadata_verified: false, candidate_file_count: 0, staging_percentage: null,
    last_check_at: null, last_error: null, trusted_channel: null,
    download_percent: null, restart_gate_safe: false, restart_gate_since: null,
    restart_grace_ms: null, install_attempted_version: null, publisher_verified: false,
    ci_test_feed_active: false, pre_install_receipt_persisted: false,
    installer_handoff_prepared: false, automatic_install: true,
    current_version: null, release_resolution: 'UNRESOLVED', resolved_tag: null,
    resolved_git_sha: null, resolved_feed_url: null,
    install_effect_quarantined: false, self_update_hold_reason: null,
    control_plane_enabled: true,
    developer_emergency_requested: false, developer_emergency_command_id: null,
    developer_emergency_requested_at: null, developer_emergency_state: 'NONE',
    developer_emergency_policy_bypass: false,
  };
  #lastCheck = 0; #intervalMs; #canRestart; #canEmergencyRestart; #clock; #restartGraceMs; #restartSafeSince = null;
  #emergencyRequested = false; #emergencyCommandId = null;

  constructor({
    intervalMs = 10 * 60 * 1000,
    restartGraceMs = 12_000,
    canRestart = async () => false,
    canEmergencyRestart = async () => false,
    updater = null,
    packaged = null,
    hostResilience = undefined,
    trustedChannel = DEFAULT_TRUSTED_UPDATE_CHANNEL,
    trustedArtifactPrefix = DEFAULT_TRUSTED_ARTIFACT_PREFIX,
    ciTestFeedUrl = process.env.METAENGINE_SELF_UPDATE_TEST_FEED_URL || null,
    ciTestMode = process.env.METAENGINE_SELF_UPDATE_TEST_MODE === '1',
    githubActions = process.env.GITHUB_ACTIONS === 'true',
    beforeInstall = async () => {},
    beforeInstallerLaunch = async () => {},
    clock = () => Date.now(),
    currentVersion = null,
    releaseResolver = resolveTrustedMetaengineDevRelease,
    fetchImpl = globalThis.fetch,
  } = {}) {
    this.#intervalMs = Math.max(1000, Number(intervalMs) || 10 * 60 * 1000);
    this.#restartGraceMs = Math.max(1000, Number(restartGraceMs) || 12_000);
    if (typeof canRestart !== 'function') throw new Error('self_update_restart_gate_invalid');
    if (typeof canEmergencyRestart !== 'function') throw new Error('self_update_emergency_restart_gate_invalid');
    this.#canRestart = canRestart;
    this.#canEmergencyRestart = canEmergencyRestart;
    this.#injectedUpdater = updater;
    this.#packagedOverride = packaged;
    this.#hostOverride = hostResilience;
    this.#trustedChannel = String(trustedChannel || DEFAULT_TRUSTED_UPDATE_CHANNEL).trim();
    this.#trustedArtifactPrefix = String(trustedArtifactPrefix || DEFAULT_TRUSTED_ARTIFACT_PREFIX).trim();
    this.#clock = clock;
    this.#currentVersion = currentVersion == null ? null : String(currentVersion).trim();
    if (typeof beforeInstall !== 'function') throw new Error('self_update_before_install_invalid');
    if (typeof beforeInstallerLaunch !== 'function') throw new Error('self_update_before_installer_launch_invalid');
    if (typeof releaseResolver !== 'function') throw new Error('self_update_release_resolver_invalid');
    if (typeof fetchImpl !== 'function') throw new Error('self_update_release_fetch_invalid');
    this.#beforeInstall = beforeInstall;
    this.#beforeInstallerLaunch = beforeInstallerLaunch;
    this.#releaseResolver = releaseResolver;
    this.#releaseFetch = fetchImpl;
    if (!/^[0-9A-Za-z._-]+$/.test(this.#trustedChannel)) throw new Error('trusted_update_channel_invalid');
    if (!SAFE_ARTIFACT_RE.test(this.#trustedArtifactPrefix)) throw new Error('trusted_update_artifact_prefix_invalid');
    this.#ciTestFeedUrl = validateCiTestFeedUrl(ciTestFeedUrl, { testMode: ciTestMode, githubActions });
    this.#state.trusted_channel = this.#trustedChannel;
    this.#state.restart_grace_ms = this.#restartGraceMs;
  }

  snapshot() {
    return structuredClone({ schema: 'metaengine.self-update-runtime.v8', ...this.#state, host_resilience: this.#host?.snapshot?.() || null, authority_effect: false });
  }

  #resetRestartGate() {
    this.#restartSafeSince = null;
    this.#state.restart_gate_safe = false;
    this.#state.restart_gate_since = null;
  }

  #resetInstallHandoff() {
    this.#state.pre_install_receipt_persisted = false;
    this.#state.installer_handoff_prepared = false;
  }

  #clearEmergencyRequest(state = 'NONE') {
    this.#emergencyRequested = false;
    this.#emergencyCommandId = null;
    this.#state.developer_emergency_requested = false;
    this.#state.developer_emergency_command_id = null;
    this.#state.developer_emergency_state = state;
    this.#state.developer_emergency_policy_bypass = false;
  }

  #clearResolvedRelease() {
    this.#resolvedRelease = null;
    this.#state.publisher_verified = false;
    this.#state.release_resolution = 'UNRESOLVED';
    this.#state.resolved_tag = null;
    this.#state.resolved_git_sha = null;
    this.#state.resolved_feed_url = null;
  }

  async #prepareTrustedReleaseFeed() {
    if (this.#ciTestFeedUrl) return true;
    if (!this.#currentVersion) throw new Error('self_update_current_version_unavailable');
    const resolved = await this.#releaseResolver({ currentVersion: this.#currentVersion, fetchImpl: this.#releaseFetch });
    if (!resolved) {
      this.#clearResolvedRelease();
      this.#state.state = 'CURRENT';
      this.#state.last_error = null;
      return false;
    }
    if (resolved.schema !== 'metaengine.trusted-dev-release.v1' || resolved.authority_effect !== false) throw new Error('self_update_release_resolution_invalid');
    if (typeof this.#updater?.setFeedURL !== 'function') throw new Error('electron_updater_set_feed_url_unavailable');
    this.#resolvedRelease = structuredClone(resolved);
    this.#state.publisher_verified = true;
    this.#state.release_resolution = 'VERIFIED';
    this.#state.resolved_tag = resolved.tag;
    this.#state.resolved_git_sha = resolved.git_sha;
    this.#state.resolved_feed_url = resolved.feed_url;
    this.#state.last_error = null;
    this.#updater.setFeedURL({ provider: 'generic', url: resolved.feed_url, channel: this.#trustedChannel });
    return true;
  }

  async #approveAndDownload(info) {
    try {
      const metadata = verifiedMetadata(info, { trustedArtifactPrefix: this.#trustedArtifactPrefix });
      if (!this.#ciTestFeedUrl) {
        const expected = this.#resolvedRelease;
        if (!expected || this.#state.publisher_verified !== true) throw new Error('update_publisher_resolution_missing');
        if (metadata.version !== expected.version || metadata.files.length !== 1) throw new Error('update_publisher_version_binding_mismatch');
        const [file] = metadata.files;
        if (file.url !== expected.installer_name || file.sha512 !== expected.installer_sha512) throw new Error('update_publisher_installer_binding_mismatch');
      }
      this.#state.available_version = metadata.version;
      this.#state.metadata_verified = true;
      this.#state.candidate_file_count = metadata.files.length;
      this.#state.staging_percentage = metadata.staging_percentage;
      this.#state.last_error = null;
      this.#state.state = 'APPROVED_DOWNLOAD';
      this.#state.install_attempted_version = null;
      this.#resetInstallHandoff();
      this.#resetRestartGate();
      if (typeof this.#updater?.downloadUpdate !== 'function') throw new Error('electron_updater_download_unavailable');
      await this.#updater.downloadUpdate();
      if (this.#state.state === 'APPROVED_DOWNLOAD') this.#state.state = 'DOWNLOADING';
    } catch (error) {
      this.#state.state = 'REJECTED_METADATA';
      this.#state.metadata_verified = false;
      this.#state.last_error = clipError(error);
      this.#resetRestartGate();
      if (this.#emergencyRequested) this.#clearEmergencyRequest('FAILED_METADATA');
    }
  }

  async start() {
    try {
      let packaged = this.#packagedOverride;
      let electronApp = null;
      if (packaged == null || (!this.#injectedUpdater && !this.#currentVersion)) {
        const electron = await import('electron');
        electronApp = electron.app;
        if (packaged == null) packaged = electronApp.isPackaged;
      }
      if (!this.#injectedUpdater && !this.#currentVersion) this.#currentVersion = String(electronApp?.getVersion?.() || '').trim();
      this.#state.current_version = this.#currentVersion;
      if (packaged && this.#hostOverride !== false) {
        this.#host = this.#hostOverride || new HostResilienceRuntime();
        await this.#host.start();
      }
      const disableEnvironment = classifySelfUpdateDisableEnvironment(process.env);
      this.#state.install_effect_quarantined = disableEnvironment.install_effect_quarantined;
      this.#state.self_update_hold_reason = disableEnvironment.hold_reason;
      this.#state.control_plane_enabled = disableEnvironment.control_plane_enabled;
      if (!packaged || disableEnvironment.globally_disabled) { this.#state.state = 'DISABLED'; return this.snapshot(); }
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
        this.#resetInstallHandoff();
        this.#resetRestartGate();
        if (this.#emergencyRequested) this.#clearEmergencyRequest('NO_UPDATE');
      });
      updater.on('download-progress', (p) => { this.#state.state = 'DOWNLOADING'; this.#state.download_percent = Number(p?.percent || 0); });
      updater.on('update-downloaded', (info) => {
        const downloaded = String(info?.version || '');
        if (!this.#state.metadata_verified || !this.#state.available_version || downloaded !== this.#state.available_version) {
          this.#state.state = 'ERROR';
          this.#state.last_error = 'downloaded_version_binding_mismatch';
          this.#resetRestartGate();
          if (this.#emergencyRequested) this.#clearEmergencyRequest('FAILED_DOWNLOAD_BINDING');
          return;
        }
        this.#state.state = 'READY_RESTART';
        this.#state.downloaded_version = downloaded;
        this.#state.download_percent = 100;
        this.#resetInstallHandoff();
        this.#resetRestartGate();
        if (this.#emergencyRequested) void this.#cycleEmergencyRestartGate();
      });
      updater.on('error', (e) => {
        this.#state.state = 'ERROR';
        this.#state.last_error = clipError(e);
        this.#resetRestartGate();
        if (this.#emergencyRequested) this.#clearEmergencyRequest('FAILED_UPDATER');
      });
      this.#updater = updater;
      this.#state.state = 'IDLE';
    } catch (e) { this.#state.state = 'ERROR'; this.#state.last_error = clipError(e); this.#resetRestartGate(); }
    return this.snapshot();
  }

  async checkNow() {
    if (!this.#updater) return this.snapshot();
    return this.cycle({ force: true });
  }

  async requestDeveloperEmergencyUpdate({ commandId } = {}) {
    const normalizedCommandId = String(commandId || '').trim().toLowerCase();
    if (!COMMAND_ID_RE.test(normalizedCommandId)) throw new Error('self_update_emergency_command_id_invalid');
    if (!this.#updater) throw new Error('self_update_emergency_updater_unavailable');
    if (this.#state.state === 'RESTARTING') return this.snapshot();
    this.#emergencyRequested = true;
    this.#emergencyCommandId = normalizedCommandId;
    this.#state.developer_emergency_requested = true;
    this.#state.developer_emergency_command_id = normalizedCommandId;
    this.#state.developer_emergency_requested_at = new Date(this.#clock()).toISOString();
    this.#state.developer_emergency_state = 'REQUESTED';
    this.#state.developer_emergency_policy_bypass = true;
    if (['READY_RESTART','RESTART_GRACE'].includes(this.#state.state)) {
      await this.#cycleEmergencyRestartGate();
      return this.snapshot();
    }
    await this.cycle({ force: true });
    return this.snapshot();
  }

  async applyWhenSafe() {
    if (!this.#updater) return this.snapshot();
    if (this.#state.state === 'RESTARTING') return this.snapshot();
    if (!['READY_RESTART','RESTART_GRACE'].includes(this.#state.state)) throw new Error('self_update_apply_not_ready');
    await this.#cycleRestartGate();
    return this.snapshot();
  }

  async #launchInstaller(now, { developerEmergency = false } = {}) {
    if (!this.#state.downloaded_version || this.#state.install_attempted_version === this.#state.downloaded_version) return;
    this.#state.install_attempted_version = this.#state.downloaded_version;
    this.#state.state = 'RESTARTING';
    if (developerEmergency) this.#state.developer_emergency_state = 'INSTALL_EFFECT_FENCING';
    try {
      const receipt = {
        schema: 'metaengine.self-update.pre-install-receipt.v1',
        version: this.#state.downloaded_version,
        available_version: this.#state.available_version,
        metadata_verified: this.#state.metadata_verified === true,
        publisher_verified: this.#state.publisher_verified === true,
        resolved_tag: this.#state.resolved_tag,
        resolved_git_sha: this.#state.resolved_git_sha,
        restart_gate_safe: this.#state.restart_gate_safe === true,
        restart_gate_since: this.#state.restart_gate_since,
        recorded_at: new Date(now).toISOString(),
        authority_effect: false,
      };
      await this.#beforeInstall(structuredClone(receipt));
      this.#state.pre_install_receipt_persisted = true;
      await this.#host?.prepareExpectedRestart?.('SELF_UPDATE');
      await this.#host?.prepareInstallerHandoff?.('SELF_UPDATE');
      this.#state.installer_handoff_prepared = true;
      await this.#beforeInstallerLaunch(structuredClone(receipt));
      if (developerEmergency) this.#state.developer_emergency_state = 'INSTALLER_DISPATCHED';
      this.#updater.quitAndInstall(true, true);
    } catch (e) {
      this.#state.state = 'ERROR';
      this.#state.installer_handoff_prepared = false;
      this.#state.last_error = clipError(e);
      this.#resetRestartGate();
      if (developerEmergency) this.#clearEmergencyRequest('EFFECT_BLOCKED_OR_FAILED');
    }
  }

  async #cycleEmergencyRestartGate() {
    if (!this.#emergencyRequested || !['READY_RESTART','RESTART_GRACE'].includes(this.#state.state)) return;
    const safe = await this.#canEmergencyRestart();
    if (!safe) {
      this.#resetRestartGate();
      this.#state.state = 'READY_RESTART';
      this.#state.developer_emergency_state = 'WAITING_MINIMAL_RESTART_SAFETY';
      return;
    }
    const now = this.#clock();
    this.#state.restart_gate_safe = true;
    this.#state.restart_gate_since = new Date(now).toISOString();
    this.#state.developer_emergency_state = 'ADMITTED';
    await this.#launchInstaller(now, { developerEmergency: true });
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
    await this.#launchInstaller(now);
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
          this.#resetInstallHandoff();
          this.#resetRestartGate();
        }
        const shouldCheck = await this.#prepareTrustedReleaseFeed();
        if (shouldCheck) await this.#updater.checkForUpdates();
        else if (this.#emergencyRequested) this.#clearEmergencyRequest('NO_UPDATE');
      } catch (e) {
        this.#state.state = 'DISCOVERY_ERROR';
        this.#state.last_error = clipError(e);
        this.#state.metadata_verified = false;
        this.#resetRestartGate();
        if (this.#emergencyRequested) this.#clearEmergencyRequest('FAILED_DISCOVERY');
      }
    }
    if (this.#emergencyRequested) await this.#cycleEmergencyRestartGate();
    else await this.#cycleRestartGate();
    return this.snapshot();
  }
}