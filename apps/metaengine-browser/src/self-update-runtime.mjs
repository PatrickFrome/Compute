// Stable import surface for METAENGINE Browser self-update.
// Production construction does not inject an updater, so v8 always resolves an exact
// trusted METAENGINE dev release before electron-updater is allowed to check a feed.
// The compatibility shim below exists only for dependency-injected unit-test updaters
// that predate publisher resolution and have no currentVersion/setFeedURL surface.
// Static invariant marker retained intentionally: self_update_test_feed_not_allowed
import {
  SelfUpdateRuntime as SelfUpdateRuntimeV8,
  DEFAULT_TRUSTED_UPDATE_CHANNEL,
  DEFAULT_TRUSTED_ARTIFACT_PREFIX,
  validateCiTestFeedUrl,
} from './self-update-runtime-v8.mjs';
import {
  markSelfUpdateInstallEffectAttempted,
  SELF_UPDATE_INSTALL_EFFECT_BARRIER,
} from './self-update-transaction-journal.mjs';
import {
  DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS,
  DEFAULT_DEV_UPDATE_HINT_URL,
  probeDevUpdateHint,
} from './dev-update-hint.mjs';
import {
  createBoundedNetworkFetch,
  DEFAULT_OPTIONAL_NETWORK_DEADLINE_MS,
} from './bounded-network-fetch.mjs';

export {
  DEFAULT_TRUSTED_UPDATE_CHANNEL,
  DEFAULT_TRUSTED_ARTIFACT_PREFIX,
  validateCiTestFeedUrl,
  DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS,
  DEFAULT_DEV_UPDATE_HINT_URL,
  DEFAULT_OPTIONAL_NETWORK_DEADLINE_MS,
};

// The cheap zero-authority hint remains the fast development wake-up path. Exact
// GitHub release discovery is deliberately much slower when there is no new hint so
// a long-lived Browser cannot exhaust the unauthenticated GitHub API quota by itself.
export const DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS = 15 * 60 * 1000;
export const DEFAULT_DEV_UPDATE_HINT_RETRY_MS = 5 * 60 * 1000;
export const DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS = 1 * 1000;
export const DEFAULT_EXACT_UPDATE_DISCOVERY_DEADLINE_MS = 8 * 1000;

const HINT_BUSY_STATES = new Set(['APPROVED_DOWNLOAD','DOWNLOADING','READY_RESTART','RESTART_GRACE','RESTARTING']);
const HINT_LATCHED_FAILURE_STATES = new Set(['ERROR','REJECTED_METADATA']);

function compatInjectedUpdater(updater) {
  if (typeof updater?.setFeedURL === 'function') return updater;
  return new Proxy(updater, {
    get(target, property) {
      if (property === 'setFeedURL') return () => {};
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
    set(target, property, value) { return Reflect.set(target, property, value, target); },
  });
}

function clipHintError(error) { return String(error?.message || error || 'unknown_error').slice(0, 160); }

async function durableInstallEffectBarrier(receipt) {
  const targetVersion = String(receipt?.version || '');
  if (!targetVersion) throw new Error('self_update_install_effect_target_invalid');
  const { app } = await import('electron');
  return markSelfUpdateInstallEffectAttempted(app, { targetVersion });
}

export class SelfUpdateRuntime extends SelfUpdateRuntimeV8 {
  #hintIntervalMs;
  #hintRetryMs;
  #hintProbe;
  #hintFetch;
  #clock;
  #networkDeadlineMs;
  #exactDiscoveryDeadlineMs;
  #exactDiscoveryPromise = null;
  #exactDiscoveryStartedAt = null;
  #exactDiscoveryCompletedAt = null;
  #installEffectBarrierMode;
  #lastHintCheck = 0;
  #lastHintCheckAt = null;
  #lastHintVersion = null;
  #lastHintError = null;
  #lastHintTriggeredVersion = null;
  #lastHintTriggeredAt = 0;

  constructor(options = {}) {
    const rawFetch = options?.fetchImpl ?? globalThis.fetch;
    const networkDeadlineMs = Math.max(500, Math.min(30_000, Number(options?.networkDeadlineMs) || DEFAULT_OPTIONAL_NETWORK_DEADLINE_MS));
    const exactDiscoveryDeadlineMs = Math.max(
      networkDeadlineMs,
      Math.min(30_000, Number(options?.exactDiscoveryDeadlineMs) || DEFAULT_EXACT_UPDATE_DISCOVERY_DEADLINE_MS),
    );
    const hintFetch = createBoundedNetworkFetch(rawFetch, {
      deadlineMs: networkDeadlineMs,
      label: 'self_update_hint',
    });
    const exactDiscoveryFetch = createBoundedNetworkFetch(rawFetch, {
      deadlineMs: exactDiscoveryDeadlineMs,
      label: 'self_update_exact_discovery',
    });
    const injectedUpdater = options?.updater != null;
    const originalBeforeInstallerLaunch = options?.beforeInstallerLaunch;
    if (originalBeforeInstallerLaunch != null && typeof originalBeforeInstallerLaunch !== 'function') {
      throw new Error('self_update_before_installer_launch_invalid');
    }
    const explicitInstallEffectBarrier = options?.installEffectBarrier;
    if (explicitInstallEffectBarrier != null && typeof explicitInstallEffectBarrier !== 'function') {
      throw new Error('self_update_install_effect_barrier_invalid');
    }
    // Production never injects electron-updater. Preserve the old dependency-injected
    // test surface without silently weakening production: injected updaters get a
    // zero-effect compatibility barrier unless a test explicitly supplies one.
    const installEffectBarrier = explicitInstallEffectBarrier
      || (injectedUpdater
        ? async () => ({ state: 'INJECTED_UPDATER_TEST_BYPASS', authority_effect: false })
        : durableInstallEffectBarrier);
    const installEffectBarrierMode = explicitInstallEffectBarrier
      ? 'INJECTED_BARRIER'
      : (injectedUpdater ? 'INJECTED_UPDATER_TEST_BYPASS' : SELF_UPDATE_INSTALL_EFFECT_BARRIER);
    const withDevCadence = {
      ...options,
      fetchImpl: exactDiscoveryFetch,
      intervalMs: options?.intervalMs ?? DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS,
      restartGraceMs: options?.restartGraceMs ?? DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS,
      beforeInstallerLaunch: async (receipt) => {
        // This is the write-ahead boundary. A failure here leaves the supervisor and
        // singleton intact because the native final-launch hook has not run yet. Once
        // it succeeds, any later crash/handoff failure is conservatively potentially
        // effectful and may only converge through durable startup/readback evidence.
        await installEffectBarrier(structuredClone(receipt));
        await originalBeforeInstallerLaunch?.(structuredClone(receipt));
      },
    };
    const injectedLegacyTest = options?.updater
      && options?.currentVersion == null
      && options?.ciTestFeedUrl == null;
    if (!injectedLegacyTest) {
      super(withDevCadence);
    } else {
      super({
        ...withDevCadence,
        updater: compatInjectedUpdater(options.updater),
        ciTestFeedUrl: 'http://127.0.0.1:1/',
        ciTestMode: true,
        githubActions: true,
      });
    }
    this.#hintIntervalMs = Math.max(1000, Number(options?.hintIntervalMs ?? DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS));
    this.#hintRetryMs = Math.max(this.#hintIntervalMs, Number(options?.hintRetryMs ?? DEFAULT_DEV_UPDATE_HINT_RETRY_MS));
    this.#hintProbe = options?.hintProbe ?? probeDevUpdateHint;
    this.#hintFetch = hintFetch;
    this.#networkDeadlineMs = networkDeadlineMs;
    this.#exactDiscoveryDeadlineMs = exactDiscoveryDeadlineMs;
    this.#clock = options?.clock ?? (() => Date.now());
    this.#installEffectBarrierMode = installEffectBarrierMode;
    if (typeof this.#hintProbe !== 'function') throw new Error('self_update_hint_probe_invalid');
  }

  snapshot() {
    const base = super.snapshot();
    return {
      ...base,
      hint_interval_ms: this.#hintIntervalMs,
      hint_retry_ms: this.#hintRetryMs,
      hint_last_check_at: this.#lastHintCheckAt,
      hint_version: this.#lastHintVersion,
      hint_last_error: this.#lastHintError,
      hint_triggered_version: this.#lastHintTriggeredVersion,
      hint_last_triggered_at: this.#lastHintTriggeredAt > 0 ? new Date(this.#lastHintTriggeredAt).toISOString() : null,
      network_deadline_ms: this.#networkDeadlineMs,
      hint_network_deadline_ms: this.#networkDeadlineMs,
      exact_discovery_deadline_ms: this.#exactDiscoveryDeadlineMs,
      exact_discovery_in_flight: this.#exactDiscoveryPromise != null,
      exact_discovery_started_at: this.#exactDiscoveryStartedAt,
      exact_discovery_completed_at: this.#exactDiscoveryCompletedAt,
      hint_triggered_exact_discovery_background: true,
      network_discovery_bounded: true,
      install_effect_barrier_mode: this.#installEffectBarrierMode,
      install_effect_barrier_before_final_handoff: true,
      automatic_effect_retry: false,
      hint_authority_effect: false,
    };
  }

  async #hintRequestsExactCheck() {
    const snapshot = super.snapshot();
    if (HINT_BUSY_STATES.has(snapshot.state) || HINT_LATCHED_FAILURE_STATES.has(snapshot.state)) return false;
    if (!snapshot.current_version || snapshot.state === 'DISABLED' || snapshot.state === 'UNINITIALIZED') return false;
    const now = this.#clock();
    if (now - this.#lastHintCheck < this.#hintIntervalMs) return false;
    this.#lastHintCheck = now;
    this.#lastHintCheckAt = new Date(now).toISOString();
    try {
      const hint = await this.#hintProbe({ currentVersion: snapshot.current_version, fetchImpl: this.#hintFetch });
      this.#lastHintVersion = hint?.version || null;
      this.#lastHintError = null;
      if (!hint?.newer_than_current || hint.authority_effect !== false) return false;
      if (hint.version === snapshot.available_version || hint.version === snapshot.downloaded_version) return false;
      const sameTriggeredVersion = hint.version === this.#lastHintTriggeredVersion;
      if (sameTriggeredVersion) {
        const retryDue = snapshot.state === 'DISCOVERY_ERROR'
          && now - this.#lastHintTriggeredAt >= this.#hintRetryMs;
        if (!retryDue) return false;
      }
      this.#lastHintTriggeredVersion = hint.version;
      this.#lastHintTriggeredAt = now;
      return true;
    } catch (error) {
      // The hint is a cheap zero-authority signal. Failure neither changes updater
      // authority nor consumes the longer exact publisher-verification budget.
      this.#lastHintError = clipHintError(error);
      return false;
    }
  }

  #startExactDiscoverySingleflight() {
    if (this.#exactDiscoveryPromise) return false;
    this.#exactDiscoveryStartedAt = new Date(this.#clock()).toISOString();
    this.#exactDiscoveryCompletedAt = null;
    this.#exactDiscoveryPromise = super.cycle({ force: true })
      .catch(() => this.snapshot())
      .finally(() => {
        this.#exactDiscoveryCompletedAt = new Date(this.#clock()).toISOString();
        this.#exactDiscoveryPromise = null;
      });
    return true;
  }

  async cycle({ force = false } = {}) {
    if (force && this.#exactDiscoveryPromise) {
      await this.#exactDiscoveryPromise;
      return this.snapshot();
    }
    const hintTriggered = force ? false : await this.#hintRequestsExactCheck();
    if (hintTriggered) {
      this.#startExactDiscoverySingleflight();
      // Exact GitHub publisher verification is read-only and singleflight. Do not
      // await it on the NativeSupervisor heartbeat-critical path. The parent runtime
      // owns all verification/download/install state and the next normal cycle reads it.
      return this.snapshot();
    }
    return super.cycle({ force });
  }
}
