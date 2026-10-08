// A subprocess-only Electron boundary fixture. Owner files, bootstrap, endpoint
// pinning, singleton guard and activation-ACK journal are production modules.
// Browser windows, Sentinel processes and the update watchdog are inert doubles.
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { registerHooks } from 'node:module';
import { fileURLToPath } from 'node:url';

const options = JSON.parse(process.env.METAENGINE_SINGLETON_TEST_OPTIONS);
delete process.env.METAENGINE_SINGLETON_TEST_OPTIONS;
const src = new URL('../../src/', import.meta.url);
const entry = new URL(options.entry, src);
const endpoint = new URL('native-supervisor-endpoints.mjs', src).href;
const bootstrap = new URL('local-state-provider-bootstrap.mjs', src).href;
const offlineVerifier = new URL('../../../infra/client-state-runtime/offline-runtime-bundle.mjs', src).href;
const events = [];
globalThis.__traceEntrypoint = (...event) => events.push(event);
const trace = globalThis.__traceEntrypoint;
const originalSetTimeout = globalThis.setTimeout;
if (options.installerAfterBoot || options.installerDuringStartup) {
  globalThis.setTimeout = (callback, delay, ...args) => {
    if (delay === 5000) {
      const state = JSON.parse(fs.readFileSync(options.managedHost.evidenceFile, 'utf8')).state;
      trace('forced-fallback-armed', state);
      const timer = originalSetTimeout(() => { trace('forced-fallback-fired'); callback(...args); }, 0);
      // Keep this accelerated regression timer observable after the inert host
      // exits; a real Electron process still owns its app event loop here.
      timer.unref = () => timer;
      return timer;
    }
    return originalSetTimeout(callback, delay, ...args);
  };
}
process.on('exit', () => {
  process.stdout.write('SINGLETON_TEST_TRACE=' + JSON.stringify({
    events,
    provider: process.env.METAENGINE_STATE_PROVIDER || null,
    boot_state: process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE || null,
    instance: process.env.METAENGINE_LOCAL_STATE_INSTANCE_ID || null,
  }) + '\n');
});
const originalFetch = globalThis.fetch;
globalThis.fetch = async (...args) => {
  trace('fetch', String(args[0]), process.env.METAENGINE_STATE_PROVIDER || null);
  const response = await originalFetch(...args);
  trace('fetch-returned', response.status);
  return response;
};
const originalLog = console.log;
console.log = (...args) => {
  try {
    const row = JSON.parse(args[0]);
    if (row.schema === 'metaengine.browser.final-runtime-entry.v1') trace('activation-hook', row.state);
  } catch {}
  originalLog(...args);
};

let ready = false;
let ownsLock = false;
const app = new EventEmitter();
const realOn = app.on.bind(app);
const realOnce = app.once.bind(app);
app.on = (event, listener) => { trace('on', event); return realOn(event, listener); };
app.once = (event, listener) => { trace('once', event); return realOnce(event, listener); };
app.getPath = () => options.userData;
app.getVersion = () => '0.7.0-dev.singleton-fixture';
app.setAppUserModelId = () => {};
app.hasSingleInstanceLock = () => ownsLock;
app.releaseSingleInstanceLock = () => { trace('release-lock'); ownsLock = false; };
app.isReady = () => ready;
app.exit = code => { trace('exit', code); process.exit(code); };
app.quit = () => {
  trace('quit-requested');
  let prevented = false;
  app.emit('will-quit', { preventDefault: () => { prevented = true; trace('quit-prevented'); } });
  if (!prevented && !options.holdQuit) app.exit(0);
};
app.relaunch = () => { throw new Error('fixture_relaunch_forbidden'); };
app.requestSingleInstanceLock = data => {
  trace('lock', options.primary, process.env.METAENGINE_STATE_PROVIDER || null);
  ownsLock = options.primary === true;
  if (!ownsLock && !options.flags.includes('--metaengine-installer-shutdown')) {
    // Simulate an existing primary's durable visible-window ACK for the exact
    // launch nonce. The secondary reads the real production journal/ledger.
    const bootId = 'singleton-fixture-existing-primary';
    fs.writeFileSync(path.join(options.userData, 'metaengine-browser-startup-journal-v1.json'), JSON.stringify({
      schema: 'metaengine.browser.startup-journal.v1', version: 1,
      current_boot_id: bootId, last_sequence: 1, events: [], authority_effect: false,
      activation_acks: [{
        boot_id: bootId, launch_id: data.launch_id, sequence: 1, version: app.getVersion(),
        pid: process.pid, at: new Date().toISOString(), authority_effect: false,
      }],
    }));
  }
  return ownsLock;
};
globalThis.__singletonTestElectron = {
  app,
  BaseWindow: { getAllWindows: () => [{
    isDestroyed: () => false, isVisible: () => true, isFocused: () => true,
    isMinimized: () => false, show() {}, focus() {},
  }] },
  dialog: { showErrorBox: title => trace('dialog', title), showMessageBox: async () => ({ response: 0 }) },
};
const dataModule = source => 'data:text/javascript;base64,' + Buffer.from(source).toString('base64');
const electronModule = dataModule([
  'export const app = globalThis.__singletonTestElectron.app;',
  'export const BaseWindow = globalThis.__singletonTestElectron.BaseWindow;',
  'export const dialog = globalThis.__singletonTestElectron.dialog;',
].join('\n'));
const runtimeModule = dataModule([
  'import { app } from "electron";',
  'import { NATIVE_SUPERVISOR_BASE, NATIVE_SUPERVISOR_STATE_PROVIDER, setNativeSupervisorBase } from ' + JSON.stringify(endpoint) + ';',
  'globalThis.__traceEntrypoint("runtime-import", process.env.METAENGINE_LOCAL_PROVIDER_BOOT_STATE || null, NATIVE_SUPERVISOR_STATE_PROVIDER, NATIVE_SUPERVISOR_BASE, app.isReady());',
  'if (NATIVE_SUPERVISOR_STATE_PROVIDER === "LOCAL_POSTGRES") {',
  '  let rejected = false; try { setNativeSupervisorBase("https://example.com/cloud"); } catch { rejected = true; }',
  '  if (!rejected) throw new Error("fixture_cloud_swap_not_rejected");',
  '}',
  'globalThis.__traceEntrypoint("runtime-barrier", !!globalThis.__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__);',
  'globalThis.__METAENGINE_BROWSER_BOOTSTRAP_BARRIER__?.then(() => globalThis.__traceEntrypoint("barrier-released"));',
  'app.on("activate", () => globalThis.__traceEntrypoint("runtime-activate"));',
].join('\n'));
const hostModule = dataModule([
  'import { NATIVE_SUPERVISOR_STATE_PROVIDER, NATIVE_SUPERVISOR_BASE } from ' + JSON.stringify(endpoint) + ';',
  'import { persistentLocalProviderBootstrap as boot } from ' + JSON.stringify(bootstrap) + ';',
  'globalThis.__traceEntrypoint("host-import", boot.state, NATIVE_SUPERVISOR_STATE_PROVIDER, NATIVE_SUPERVISOR_BASE);',
  'export class HostResilienceRuntime {',
  '  constructor() { globalThis.__traceEntrypoint("host-created"); }',
  '  async start() { globalThis.__traceEntrypoint("host-start", globalThis.__singletonTestElectron.app.isReady()); return { state: "FIXTURE_READY" }; }',
  '  async stop() { globalThis.__traceEntrypoint("resilience-stopped"); }',
  '}',
].join('\n'));
const mocks = new Map([
  [new URL('main.mjs', src).href, runtimeModule],
  [new URL('host-resilience-runtime.mjs', src).href, hostModule],
  [new URL('self-update-continuity-watchdog.mjs', src).href, dataModule(
    'export function startSelfUpdateContinuityWatchdog() { globalThis.__traceEntrypoint("watchdog-installed"); }' +
    'export async function reconcileStaleSelfUpdateSessionContinuity() { return null; }',
  )],
  [new URL('self-update-smoke.mjs', src).href, dataModule(
    'export async function runSelfUpdateSmoke({ app }) { globalThis.__traceEntrypoint("self-update-smoke"); app.exit(0); }',
  )],
]);
if (options.managedHost) {
  globalThis.__singletonTestRuntimePaths = options.managedHost;
  mocks.set(offlineVerifier, dataModule([
    'export async function verifyOfflineRuntimeBundle(options) {',
    '  const fixture = globalThis.__singletonTestRuntimePaths;',
    '  globalThis.__traceEntrypoint("managed-bundle-verified", options.bundleDirectory, options.expectedBundleDigest);',
    '  if (options.bundleDirectory !== fixture.sourceRoot || options.expectedBundleDigest !== fixture.digest) throw new Error("fixture_bundle_pin_invalid");',
    options.installerDuringStartup
      ? '  setTimeout(() => { globalThis.__traceEntrypoint("installer-signal-during-startup"); globalThis.__singletonTestElectron.app.emit("second-instance", null, ["browser.exe", "--metaengine-installer-shutdown"]); }, 0);'
      : '',
    '  return { paths: { nodeExecutable: fixture.nodeExecutable, sourceRoot: fixture.sourceRoot, hostEntry: fixture.hostEntry } };',
    '}',
  ].join('\n')));
}
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === 'electron') return { url: electronModule, shortCircuit: true };
    const resolved = nextResolve(specifier, context);
    if (resolved.url.startsWith(src.href)) trace('module', path.basename(fileURLToPath(resolved.url)));
    const mock = mocks.get(resolved.url);
    return mock ? { url: mock, shortCircuit: true } : resolved;
  },
});
process.argv = [process.execPath, fileURLToPath(entry), ...options.flags];
try {
  await import(entry.href);
  trace('entry-complete');
  if (options.emitReady) {
    trace('ready-emitted');
    ready = true;
    app.emit('ready');
    app.emit('ready'); // A one-shot primary continuation must survive duplicate delivery.
  }
} catch (error) {
  trace('entry-failed', String(error?.message || error));
  process.exitCode = 1;
}
// End the fixture itself. No test waits for or starts a real Electron process,
// Sentinel, UI timer, updater, network retry or singleton re-notify.
const awaitingProbeExit = options.emitReady && options.flags.some(flag => [
  '--metaengine-version-probe', '--metaengine-profile-probe',
  '--metaengine-client-goal-journal-probe', '--metaengine-self-update-smoke',
].includes(flag));
if (options.installerAfterBoot || options.installerDuringStartup) {
  if (options.installerAfterBoot) originalSetTimeout(() => {
    trace('installer-signal-after-boot');
    app.emit('second-instance', null, ['browser.exe', '--metaengine-installer-shutdown']);
  }, 50);
  originalSetTimeout(() => process.exit(99), 5000).unref();
} else {
  setTimeout(() => options.quitAfterBoot ? app.quit()
    : process.exit(awaitingProbeExit ? 99 : process.exitCode || 0), awaitingProbeExit ? 5000 : 200);
}
