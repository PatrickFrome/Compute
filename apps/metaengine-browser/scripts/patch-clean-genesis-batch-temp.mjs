import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = process.cwd();
const read = (p) => fs.readFile(path.join(ROOT, p), 'utf8');
const write = (p, value) => fs.writeFile(path.join(ROOT, p), value);

function replaceOnce(text, from, to, label) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`patch_anchor_missing:${label}`);
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`patch_anchor_ambiguous:${label}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

async function patchPackage() {
  const file = 'apps/metaengine-browser/package.json';
  const pkg = JSON.parse(await read(file));
  pkg.version = '0.7.0-dev.1';
  if (!pkg.scripts.check.includes('node --check src/runtime-genesis.mjs')) {
    pkg.scripts.check += ' && node --check src/runtime-genesis.mjs';
  }
  await write(file, `${JSON.stringify(pkg, null, 2)}\n`);
}

async function patchMain() {
  const file = 'apps/metaengine-browser/src/main.mjs';
  let text = await read(file);
  text = replaceOnce(
    text,
    "import { loadNativeSupervisorControlState } from './native-supervisor-control-state.mjs';",
    "import { loadNativeSupervisorControlState } from './native-supervisor-control-state.mjs';\nimport { ensureRuntimeGenesis } from './runtime-genesis.mjs';",
    'main_runtime_genesis_import',
  );
  text = replaceOnce(
    text,
    'let startupControlState = null;\nconst degradedStartupSubsystems = new Map();',
    'let startupControlState = null;\nlet runtimeGenesisState = null;\nconst degradedStartupSubsystems = new Map();',
    'main_runtime_genesis_state',
  );
  text = replaceOnce(
    text,
    "      browser_runtime_ready: browserRuntimeReady,\n      startup_degraded_subsystems: startupDegradedSnapshot(),",
    "      browser_runtime_ready: browserRuntimeReady,\n      runtime_genesis: runtimeGenesisState ? structuredClone(runtimeGenesisState) : null,\n      startup_degraded_subsystems: startupDegradedSnapshot(),",
    'main_runtime_genesis_snapshot',
  );
  text = replaceOnce(
    text,
    "      intervalMs: 2000,\n      commandFastlane: true,\n      commandFastlaneIntervalMs: 750,",
    "      intervalMs: 2000,\n      commandBatchSize: 64,\n      commandReadConcurrency: 32,\n      commandMutationConcurrency: 16,\n      commandBatchWaitMs: 15000,\n      legacySingleLeaseFallback: false,\n      commandFastlane: false,",
    'main_batch_required_options',
  );
  text = replaceOnce(
    text,
    "async function startAfterReady() {\n  await registerShellProtocol();\n  startupControlState = await loadNativeSupervisorControlState(supervisorControlStatePath());",
    "async function startAfterReady() {\n  await registerShellProtocol();\n  runtimeGenesisState = await ensureRuntimeGenesis({ userDataPath: app.getPath('userData') });\n  startupControlState = await loadNativeSupervisorControlState(supervisorControlStatePath());",
    'main_clean_genesis_start',
  );
  await write(file, text);
}

async function patchClient() {
  const file = 'apps/metaengine-browser/src/native-supervisor-client-base.mjs';
  let text = await read(file);
  text = replaceOnce(
    text,
    '  #controlStatePersistenceError = null;\n',
    '  #controlStatePersistenceError = null;\n  #legacySingleLeaseFallback = true;\n',
    'client_legacy_field',
  );
  text = replaceOnce(
    text,
    '    commandBatchWaitMs = DEFAULT_BATCH_WAIT_MS,\n    maintenanceIntervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,\n    commandFastlane = false,',
    '    commandBatchWaitMs = DEFAULT_BATCH_WAIT_MS,\n    maintenanceIntervalMs = DEFAULT_MAINTENANCE_INTERVAL_MS,\n    legacySingleLeaseFallback = true,\n    commandFastlane = false,',
    'client_legacy_option',
  );
  text = replaceOnce(
    text,
    '    this.#controlStatePath = controlStatePath ? String(controlStatePath) : null;\n    this.#commandLane = new NativeSupervisorCommandLaneScheduler({',
    '    this.#controlStatePath = controlStatePath ? String(controlStatePath) : null;\n    this.#legacySingleLeaseFallback = legacySingleLeaseFallback !== false;\n    this.#commandLane = new NativeSupervisorCommandLaneScheduler({',
    'client_legacy_option_store',
  );
  text = replaceOnce(
    text,
    '    this.#commandFastlane = commandFastlane === true\n      ? new NativeSupervisorCommandFastlane({',
    '    this.#commandFastlane = commandFastlane === true && this.#legacySingleLeaseFallback\n      ? new NativeSupervisorCommandFastlane({',
    'client_fastlane_gate',
  );
  text = replaceOnce(
    text,
    "        transport: this.#batchTransport,\n        wait_batch_ms: this.#batchWaitMs,",
    "        transport: this.#batchTransport,\n        batch_transport_required: this.#legacySingleLeaseFallback === false,\n        legacy_single_lease_fallback_enabled: this.#legacySingleLeaseFallback,\n        wait_batch_ms: this.#batchWaitMs,",
    'client_snapshot_batch_required',
  );
  text = replaceOnce(
    text,
    "  async #pickupAndRunLegacyFastlaneCommand() {\n    if (this.#batchTransport === 'SUPPORTED' || this.#legacyFastlaneBusy || this.#cyclePromise) return null;",
    "  async #pickupAndRunLegacyFastlaneCommand() {\n    if (!this.#legacySingleLeaseFallback || this.#batchTransport === 'SUPPORTED' || this.#legacyFastlaneBusy || this.#cyclePromise) return null;",
    'client_fastlane_no_fallback',
  );
  text = replaceOnce(
    text,
    "      if ([404, 405, 501].includes(response.status)) {\n        this.#batchTransport = 'UNAVAILABLE';\n        this.#commandFastlane?.start();\n      } else {",
    "      if ([404, 405, 501].includes(response.status)) {\n        if (this.#legacySingleLeaseFallback) {\n          this.#batchTransport = 'UNAVAILABLE';\n          this.#commandFastlane?.start();\n        } else {\n          this.#batchTransport = 'REQUIRED_UNAVAILABLE';\n          this.#commandFastlane?.stop();\n          this.#lastBatchCount = 0;\n          throw new Error(`native_supervisor_batch_transport_required:http_${response.status}`);\n        }\n      } else {",
    'client_batch_required_unsupported',
  );
  text = replaceOnce(
    text,
    "    const command = await this.#nextCommand();\n    this.#lastBatchCount = command ? 1 : 0;",
    "    if (!this.#legacySingleLeaseFallback) {\n      this.#batchTransport = 'REQUIRED_UNAVAILABLE';\n      this.#lastBatchCount = 0;\n      throw new Error('native_supervisor_batch_transport_required');\n    }\n    const command = await this.#nextCommand();\n    this.#lastBatchCount = command ? 1 : 0;",
    'client_no_silent_single_fallback',
  );
  await write(file, text);
}

async function patchBoundedDeadlineReliability() {
  for (const [file, label] of [
    ['apps/metaengine-browser/src/native-supervisor-client-core.mjs', 'supervisor_bounded_deadline_ref'],
    ['apps/metaengine-browser/src/bounded-network-fetch.mjs', 'optional_network_deadline_ref'],
  ]) {
    let text = await read(file);
    text = replaceOnce(
      text,
      '    timer.unref?.();\n    try {',
      '    // This timer is the liveness boundary for a hanging transport promise. Keep it referenced\n    // until the request settles so the bounded operation cannot disappear with the event loop.\n    try {',
      label,
    );
    await write(file, text);
  }
}

async function patchBatchContracts() {
  {
    const file = 'apps/metaengine-browser/test/native-supervisor-command-fastlane.test.mjs';
    let text = await read(file);
    text = replaceOnce(
      text,
      "test('base client preserves the 750ms fastlane only as a fallback and suppresses it after batch support', async () => {",
      "test('base client keeps the legacy fastlane only behind explicit fallback and suppresses it after batch support', async () => {",
      'fastlane_test_name',
    );
    text = replaceOnce(
      text,
      '  assert.match(source, /commandFastlane === true\\s*\\?\\s*new NativeSupervisorCommandFastlane/);',
      '  assert.match(source, /commandFastlane === true && this\\.#legacySingleLeaseFallback\\s*\\?\\s*new NativeSupervisorCommandFastlane/);',
      'fastlane_fallback_gate_contract',
    );
    text = replaceOnce(
      text,
      "test('shell opts the native supervisor into the command fastlane with a bounded cadence', async () => {\n  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');\n  assert.match(main, /commandFastlane:\\s*true/);\n  assert.match(main, /commandFastlaneIntervalMs:\\s*750/);\n});",
      "test('clean genesis shell requires held batch transport and disables the single-command fastlane', async () => {\n  const main = await readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');\n  assert.match(main, /commandBatchSize:\\s*64/);\n  assert.match(main, /commandReadConcurrency:\\s*32/);\n  assert.match(main, /commandMutationConcurrency:\\s*16/);\n  assert.match(main, /legacySingleLeaseFallback:\\s*false/);\n  assert.match(main, /commandFastlane:\\s*false/);\n  assert.doesNotMatch(main, /commandFastlaneIntervalMs:\\s*750/);\n});",
      'shell_batch_required_contract',
    );
    await write(file, text);
  }
  {
    const file = 'apps/metaengine-browser/test/native-supervisor-fast-lane-contract.test.mjs';
    let text = await read(file);
    text = replaceOnce(
      text,
      "test('base command lane precedes heavy maintenance, preserves 750ms fallback, and hands off to held batch transport', () => {",
      "test('base command lane precedes heavy maintenance, gates legacy fallback explicitly, and hands off to held batch transport', () => {",
      'fast_lane_contract_name',
    );
    text = replaceOnce(
      text,
      '  assert.match(source, /commandFastlane === true\\s*\\?\\s*new NativeSupervisorCommandFastlane/);',
      '  assert.match(source, /commandFastlane === true && this\\.#legacySingleLeaseFallback\\s*\\?\\s*new NativeSupervisorCommandFastlane/);',
      'fast_lane_fallback_gate_contract',
    );
    await write(file, text);
  }
}

await patchPackage();
await patchMain();
await patchClient();
await patchBoundedDeadlineReliability();
await patchBatchContracts();
