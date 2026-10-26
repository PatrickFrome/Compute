// No provider, filesystem or network dependency may enter this pre-ready rail.
// Private per-app state prevents duplicate scheme registration across the entry
// loader, main-entry and main after a consent dialog awaited app.whenReady().
const states = new WeakMap();

export function ensureElectronPreReady({ app, protocol } = {}) {
  if (!app || typeof app.isReady !== 'function' || typeof app.enableSandbox !== 'function'
    || typeof protocol?.registerSchemesAsPrivileged !== 'function') {
    throw new Error('electron_pre_ready_dependencies_invalid');
  }
  const state = states.get(app);
  if (state === 'READY') return;
  if (state) throw new Error('electron_pre_ready_initialization_incomplete');
  if (app.isReady()) throw new Error('electron_pre_ready_initialization_missed');
  states.set(app, 'INITIALIZING');
  try {
    app.enableSandbox();
    protocol.registerSchemesAsPrivileged([{ scheme: 'metaengine', privileges: {
      standard: true, secure: true, supportFetchAPI: true, corsEnabled: false,
    } }]);
    states.set(app, 'READY');
  } catch {
    states.set(app, 'FAILED');
    throw new Error('electron_pre_ready_initialization_failed');
  }
}
