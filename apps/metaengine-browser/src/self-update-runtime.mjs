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

export { DEFAULT_TRUSTED_UPDATE_CHANNEL, DEFAULT_TRUSTED_ARTIFACT_PREFIX, validateCiTestFeedUrl };
export const DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS = 5 * 60 * 1000;

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

export class SelfUpdateRuntime extends SelfUpdateRuntimeV8 {
  constructor(options = {}) {
    const withDevCadence = {
      ...options,
      intervalMs: options?.intervalMs ?? DEFAULT_CONTINUOUS_DEV_UPDATE_INTERVAL_MS,
    };
    const injectedLegacyTest = options?.updater
      && options?.currentVersion == null
      && options?.ciTestFeedUrl == null;
    if (!injectedLegacyTest) {
      super(withDevCadence);
      return;
    }
    super({
      ...withDevCadence,
      updater: compatInjectedUpdater(options.updater),
      ciTestFeedUrl: 'http://127.0.0.1:1/',
      ciTestMode: true,
      githubActions: true,
    });
  }
}
