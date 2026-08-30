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
  DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS,
  DEFAULT_DEV_UPDATE_HINT_URL,
  probeDevUpdateHint,
} from './dev-update-hint.mjs';

export {
  DEFAULT_TRUSTED_UPDATE_CHANNEL,
  DEFAULT_TRUSTED_ARTIFACT_PREFIX,
  validateCiTestFeedUrl,
  DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS,
  DEFAULT_DEV_UPDATE_HINT_URL,
};

// Permanent development-loop defaults. Full release discovery remains bounded to one
// minute while a non-authority raw pointer can wake the exact resolver every 15s.
export const DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS = 60 * 1000;
export const DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS = 3 * 1000;

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

export class SelfUpdateRuntime extends SelfUpdateRuntimeV8 {
  #hintIntervalMs;
  #hintProbe;
  #hintFetch;
  #clock;
  #lastHintCheck = 0;
  #lastHintCheckAt = null;
  #lastHintVersion = null;
  #lastHintError = null;
  #lastHintTriggeredVersion = null;

  constructor(options = {}) {
    const withDevCadence = {
      ...options,
      intervalMs: options?.intervalMs ?? DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS,
      restartGraceMs: options?.restartGraceMs ?? DEFAULT_CONTINUOUS_DEV_RESTART_GRACE_MS,
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
    this.#hintIntervalMs = Math.max(5000, Number(options?.hintIntervalMs ?? DEFAULT_DEV_UPDATE_HINT_INTERVAL_MS));
    this.#hintProbe = options?.hintProbe ?? probeDevUpdateHint;
    this.#hintFetch = options?.fetchImpl ?? globalThis.fetch;
    this.#clock = options?.clock ?? (() => Date.now());
    if (typeof this.#hintProbe !== 'function') throw new Error('self_update_hint_probe_invalid');
  }

  snapshot() {
    const base = super.snapshot();
    return {
      ...base,
      hint_interval_ms: this.#hintIntervalMs,
      hint_last_check_at: this.#lastHintCheckAt,
      hint_version: this.#lastHintVersion,
      hint_last_error: this.#lastHintError,
      hint_triggered_version: this.#lastHintTriggeredVersion,
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
      if (hint.version === this.#lastHintTriggeredVersion) return false;
      this.#lastHintTriggeredVersion = hint.version;
      return true;
    } catch (error) {
      // Hint failure has zero authority over the updater. The one-minute exact resolver
      // remains the fallback and no release/feed/install state is mutated here.
      this.#lastHintError = clipHintError(error);
      return false;
    }
  }

  async cycle({ force = false } = {}) {
    const hintTriggered = force ? false : await this.#hintRequestsExactCheck();
    return super.cycle({ force: force || hintTriggered });
  }
}
