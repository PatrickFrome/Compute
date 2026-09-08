import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();

async function read(rel) { return fs.readFile(path.join(root, rel), 'utf8'); }
async function write(rel, text) { await fs.writeFile(path.join(root, rel), text, 'utf8'); }
function replaceOnce(text, from, to, name) {
  const first = text.indexOf(from);
  if (first < 0) throw new Error(`patch_anchor_missing:${name}`);
  if (text.indexOf(from, first + from.length) >= 0) throw new Error(`patch_anchor_ambiguous:${name}`);
  return text.slice(0, first) + to + text.slice(first + from.length);
}

async function patchNativeSupervisor() {
  const rel = 'apps/metaengine-browser/src/native-supervisor-client-base.mjs';
  let text = await read(rel);
  text = replaceOnce(text,
    "import { reconcileRestoredGeneratingChats } from './self-update-chat-reconcile.mjs';\n",
    "import { reconcileRestoredGeneratingChats } from './self-update-chat-reconcile.mjs';\nimport { loadNativeSupervisorControlState, persistNativeSupervisorControlState } from './native-supervisor-control-state.mjs';\n",
    'native-import-control-state');
  text = replaceOnce(text,
    "  #legacyFastlaneBusy = false;\n\n  constructor({\n",
    "  #legacyFastlaneBusy = false;\n  #controlStatePath = null;\n  #controlStateLoaded = false;\n  #controlStatePersistenceError = null;\n\n  constructor({\n",
    'native-control-fields');
  text = replaceOnce(text,
    "    commandFastlane = false,\n    commandFastlaneIntervalMs = 750,\n  }) {\n",
    "    commandFastlane = false,\n    commandFastlaneIntervalMs = 750,\n    controlStatePath = null,\n  }) {\n",
    'native-control-option');
  text = replaceOnce(text,
    "    this.#maintenanceIntervalMs = Math.max(1000, Math.min(60000, Number(maintenanceIntervalMs) || DEFAULT_MAINTENANCE_INTERVAL_MS));\n",
    "    this.#maintenanceIntervalMs = Math.max(1000, Math.min(60000, Number(maintenanceIntervalMs) || DEFAULT_MAINTENANCE_INTERVAL_MS));\n    this.#controlStatePath = controlStatePath ? String(controlStatePath) : null;\n",
    'native-control-path');
  text = replaceOnce(text,
    "      session_continuity: structuredClone(this.#continuityStatus),\n      control_fast_lane: {\n",
    "      session_continuity: structuredClone(this.#continuityStatus),\n      control_state: {\n        schema: 'metaengine.native-supervisor.control-state-runtime.v1',\n        path_configured: Boolean(this.#controlStatePath),\n        loaded: this.#controlStateLoaded,\n        persistence_error: this.#controlStatePersistenceError,\n        quiescent: this.#supervisorMode === 'OFF' && this.#armed === false,\n        authority_effect: false,\n      },\n      control_fast_lane: {\n",
    'native-control-snapshot');
  text = replaceOnce(text,
    "  async start() {\n    if (this.#running) { this.#schedule(); return this.snapshot(); }\n    this.#running = true;\n",
    "  async #restoreControlState() {\n    if (this.#controlStateLoaded) return this.snapshot();\n    this.#controlStateLoaded = true;\n    if (!this.#controlStatePath) return this.snapshot();\n    const restored = await loadNativeSupervisorControlState(this.#controlStatePath);\n    if (restored) {\n      this.#supervisorMode = restored.supervisor_mode;\n      this.#armed = restored.supervisor_mode === 'OFF' ? false : restored.armed === true;\n      if (restored.recovered_fail_closed === true) this.#controlStatePersistenceError = restored.recovery_reason || 'CONTROL_STATE_RECOVERED_FAIL_CLOSED';\n    }\n    return this.snapshot();\n  }\n\n  async #persistControlState() {\n    if (!this.#controlStatePath) return null;\n    try {\n      const saved = await persistNativeSupervisorControlState(this.#controlStatePath, { supervisor_mode: this.#supervisorMode, armed: this.#armed });\n      this.#controlStatePersistenceError = null;\n      return saved;\n    } catch (error) {\n      this.#controlStatePersistenceError = `control_state_persistence:${clipError(error)}`;\n      throw error;\n    }\n  }\n\n  async start() {\n    if (this.#running) { this.#schedule(); return this.snapshot(); }\n    await this.#restoreControlState();\n    this.#running = true;\n",
    'native-control-restore-before-run');
  text = replaceOnce(text,
    "  setControlState({ mode, armed } = {}) {\n    if (mode !== undefined) {\n      const next = String(mode).toUpperCase();\n      if (!['OFF','MONITOR','CONTROL'].includes(next)) throw new Error('native_supervisor_mode_invalid');\n      this.#supervisorMode = next;\n    }\n    if (armed !== undefined) this.#armed = armed === true;\n    return this.snapshot();\n  }\n",
    "  setControlState({ mode, armed } = {}) {\n    if (mode !== undefined) {\n      const next = String(mode).toUpperCase();\n      if (!['OFF','MONITOR','CONTROL'].includes(next)) throw new Error('native_supervisor_mode_invalid');\n      this.#supervisorMode = next;\n      if (next === 'OFF') this.#armed = false;\n    }\n    if (armed !== undefined && this.#supervisorMode !== 'OFF') this.#armed = armed === true;\n    void this.#persistControlState().catch(() => {});\n    return this.snapshot();\n  }\n",
    'native-set-control-state');
  text = replaceOnce(text,
    "  #kickMaintenance() {\n    const now = Date.now();\n",
    "  #kickMaintenance() {\n    if (this.#supervisorMode === 'OFF' || this.#armed !== true) return this.#maintenancePromise;\n    const now = Date.now();\n",
    'native-quiescent-maintenance');
  text = replaceOnce(text,
    "    if (action === 'ARM') { this.#armed = true; return { armed: true, supervisor_mode: this.#supervisorMode, authority_effect: true }; }\n    if (action === 'DISARM') { this.#armed = false; return { armed: false, supervisor_mode: this.#supervisorMode, authority_effect: true }; }\n    if (action === 'SET_SUPERVISOR_MODE') {\n      const next = String(command?.payload?.mode || '').toUpperCase();\n      if (!['OFF','MONITOR','CONTROL'].includes(next)) throw new Error('native_supervisor_mode_invalid');\n      this.#supervisorMode = next;\n      return { supervisor_mode: next, armed: this.#armed, authority_effect: true };\n    }\n",
    "    if (action === 'ARM') {\n      if (this.#supervisorMode === 'OFF') throw new Error('native_supervisor_off_requires_mode_change');\n      this.#armed = true;\n      await this.#persistControlState();\n      return { armed: true, supervisor_mode: this.#supervisorMode, authority_effect: true };\n    }\n    if (action === 'DISARM') {\n      this.#armed = false;\n      await this.#persistControlState();\n      return { armed: false, supervisor_mode: this.#supervisorMode, authority_effect: true };\n    }\n    if (action === 'SET_SUPERVISOR_MODE') {\n      const next = String(command?.payload?.mode || '').toUpperCase();\n      if (!['OFF','MONITOR','CONTROL'].includes(next)) throw new Error('native_supervisor_mode_invalid');\n      this.#supervisorMode = next;\n      if (next === 'OFF') this.#armed = false;\n      await this.#persistControlState();\n      return { supervisor_mode: next, armed: this.#armed, authority_effect: true };\n    }\n",
    'native-remote-control-persist');
  await write(rel, text);
}

async function patchMain() {
  const rel = 'apps/metaengine-browser/src/main.mjs';
  let text = await read(rel);
  text = replaceOnce(text,
    "import { DevelopmentPlane } from './development-plane.mjs';\n",
    "import { DevelopmentPlane } from './development-plane.mjs';\nimport { loadNativeSupervisorControlState } from './native-supervisor-control-state.mjs';\n",
    'main-control-import');
  text = replaceOnce(text,
    "let startupFailurePresented = false;\n",
    "let startupFailurePresented = false;\nlet startupControlState = null;\n",
    'main-control-global');
  text = replaceOnce(text,
    "  return path.join(app.getPath('userData'), 'metaengine-fleet-state-v1.json');\n",
    "  return path.join(app.getPath('userData'), 'metaengine-fleet-state-v2.json');\n",
    'main-fleet-state-v2');
  text = replaceOnce(text,
    "function supervisorIdentityPath() {\n  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-device-v1.json');\n}\n",
    "function supervisorIdentityPath() {\n  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-device-v1.json');\n}\n\nfunction supervisorControlStatePath() {\n  return path.join(app.getPath('userData'), 'metaengine-native-supervisor-control-state-v1.json');\n}\n",
    'main-control-state-path');
  text = replaceOnce(text,
    "  registry.close(id);\n  await fleet?.onTabClosed(id, 'PHYSICAL_TAB_CLOSED_BY_SHELL');\n  if (!registry.selected()) await createTab('https://chatgpt.com/', { select: true, load: true });\n  invalidatePerception(id);\n",
    "  registry.close(id);\n  await fleet?.onTabClosed(id, 'PHYSICAL_TAB_CLOSED_BY_SHELL');\n  invalidatePerception(id);\n",
    'main-zero-tab-close');
  text = replaceOnce(text,
    "    policy: { profile: 'BALANCED', warm_agents: 2, desired_agents: 6 },\n",
    "    policy: { profile: 'BALANCED', warm_agents: 0, desired_agents: 0, spawn_burst_limit: 8 },\n",
    'main-zero-warm-fleet');
  text = replaceOnce(text,
    "function developmentPlaneRepoRoot() {\n  return app.isPackaged ? process.resourcesPath : path.resolve(APP_ROOT, '../..');\n}\n",
    "function developmentPlaneRepoRoot() {\n  return app.isPackaged ? path.join(process.resourcesPath, 'devos-source-snapshot') : path.resolve(APP_ROOT, '../..');\n}\n",
    'main-packaged-source-root');
  text = replaceOnce(text,
    "        env: { METAENGINE_REPO_ROOT: repoRoot },\n",
    "        env: {\n          METAENGINE_REPO_ROOT: repoRoot,\n          METAENGINE_SOURCE_PROVENANCE: path.join(repoRoot, '.metaengine-source-provenance.json'),\n          METAENGINE_GIT_REPOSITORY: 'PatrickFrome/Compute',\n        },\n",
    'main-packaged-source-env');
  text = replaceOnce(text,
    "      workerObservationBudget: 4,\n    });\n",
    "      workerObservationBudget: 4,\n      controlStatePath: supervisorControlStatePath(),\n    });\n",
    'main-control-state-wire');
  text = replaceOnce(text,
    "async function bootstrapDegradableSubsystems() {\n",
    "async function bootstrapDegradableSubsystems() {\n  const quiescentStartup = startupControlState?.supervisor_mode === 'OFF' && startupControlState?.armed === false;\n",
    'main-quiescent-bootstrap');
  text = replaceOnce(text,
    "  if (sessionReady) {\n    initialTab = await runDegradableStartupStep('INITIAL_TAB_CREATE', () => createTab('https://chatgpt.com/', { select: true, load: false }));\n",
    "  if (sessionReady && !quiescentStartup) {\n    initialTab = await runDegradableStartupStep('INITIAL_TAB_CREATE', () => createTab('https://chatgpt.com/', { select: true, load: false }));\n",
    'main-quiescent-initial-tab');
  text = replaceOnce(text,
    "async function startAfterReady() {\n  await registerShellProtocol();\n  await initDevOSSessionLayouts();\n",
    "async function startAfterReady() {\n  await registerShellProtocol();\n  startupControlState = await loadNativeSupervisorControlState(supervisorControlStatePath());\n  await initDevOSSessionLayouts();\n",
    'main-control-restore-ready');
  await write(rel, text);
}

async function patchDevelopmentPlaneWorker() {
  const rel = 'apps/metaengine-browser/src/development-plane-worker.cjs';
  let text = await read(rel);
  text = replaceOnce(text,
    "const repositoryRemote = String(process.env.METAENGINE_GIT_REMOTE || 'origin');\n",
    "const repositoryRemote = String(process.env.METAENGINE_GIT_REMOTE || 'origin');\nconst sourceProvenancePath = path.resolve(process.env.METAENGINE_SOURCE_PROVENANCE || path.join(repoRoot, '.metaengine-source-provenance.json'));\n",
    'devplane-provenance-path');
  text = replaceOnce(text,
    "    if (error?.code === 'ENOENT') return { repository_present: false, repository: repositoryName, head: null, ref: null };\n",
    "    if (error?.code === 'ENOENT') {\n      try {\n        const provenance = JSON.parse(await fs.readFile(sourceProvenancePath, 'utf8'));\n        const repository = String(provenance?.repository || repositoryName);\n        const head = String(provenance?.head || '').toLowerCase();\n        const ref = provenance?.ref == null ? null : String(provenance.ref);\n        if (provenance?.schema !== 'metaengine.devos.packaged-source-snapshot.v1' || !/^[A-Za-z0-9_.-]+\\/[A-Za-z0-9_.-]+$/.test(repository) || !/^[0-9a-f]{40}$/.test(head)) throw new Error('repo_packaged_provenance_invalid');\n        return { repository_present: true, repository, head, ref, packaged_source_snapshot: true };\n      } catch (provenanceError) {\n        if (provenanceError?.code !== 'ENOENT') throw provenanceError;\n        return { repository_present: false, repository: repositoryName, head: null, ref: null };\n      }\n    }\n",
    'devplane-provenance-fallback');
  await write(rel, text);
}

async function patchBeforePack() {
  const rel = 'apps/metaengine-browser/scripts/electron-builder-before-pack.cjs';
  let text = await read(rel);
  text = replaceOnce(text,
    "const path = require('node:path');\n",
    "const path = require('node:path');\nconst { buildDevOSSourceSnapshot } = require('./devos-source-snapshot-builder.cjs');\n",
    'beforepack-source-builder-import');
  text = replaceOnce(text,
    "  const appRoot = path.resolve(__dirname, '..');\n",
    "  const appRoot = path.resolve(__dirname, '..');\n  const repoRoot = path.resolve(appRoot, '../..');\n  await buildDevOSSourceSnapshot({\n    repoRoot,\n    outputDir: path.join(appRoot, 'devos-source-snapshot'),\n    repository: process.env.GITHUB_REPOSITORY || 'PatrickFrome/Compute',\n    head: process.env.GITHUB_SHA || null,\n    ref: process.env.GITHUB_REF || null,\n  });\n",
    'beforepack-build-source-snapshot');
  await write(rel, text);
}

async function patchBuilderConfig() {
  const rel = 'apps/metaengine-browser/electron-builder.test.json';
  const json = JSON.parse(await read(rel));
  const resources = Array.isArray(json.extraResources) ? json.extraResources : [];
  if (!resources.some((row) => row?.to === 'devos-source-snapshot')) {
    resources.push({ from: 'devos-source-snapshot', to: 'devos-source-snapshot', filter: ['**/*'] });
  }
  json.extraResources = resources;
  await write(rel, `${JSON.stringify(json, null, 2)}\n`);
}

async function patchPackage() {
  const rel = 'apps/metaengine-browser/package.json';
  const json = JSON.parse(await read(rel));
  const requiredChecks = [
    'node --check src/native-supervisor-control-state.mjs',
    'node --check scripts/devos-source-snapshot-builder.cjs',
  ];
  for (const check of requiredChecks) {
    if (!json.scripts.check.includes(check)) json.scripts.check += ` && ${check}`;
  }
  await write(rel, `${JSON.stringify(json, null, 2)}\n`);
}

await patchNativeSupervisor();
await patchMain();
await patchDevelopmentPlaneWorker();
await patchBeforePack();
await patchBuilderConfig();
await patchPackage();
console.log(JSON.stringify({ schema: 'metaengine.devos.convergence-runtime-patch.v1', ok: true }));
