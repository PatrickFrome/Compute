import fs from 'node:fs/promises';

const root = process.cwd();
const files = {
  worker: `${root}/apps/metaengine-browser/src/development-plane-worker.cjs`,
  plane: `${root}/apps/metaengine-browser/src/development-plane.mjs`,
  main: `${root}/apps/metaengine-browser/src/main.mjs`,
  projection: `${root}/apps/metaengine-browser/src/workspace-workbench-projection.mjs`,
  ui: `${root}/apps/metaengine-browser/ui/app.js`,
  activationTest: `${root}/apps/metaengine-browser/test/browser-devos-presentation-activation-wire.test.mjs`,
  selectedTest: `${root}/apps/metaengine-browser/test/browser-devos-selected-session-surfaces.test.mjs`,
  wiringTest: `${root}/apps/metaengine-browser/test/shell-workspace-projection-wiring.test.mjs`,
};

function replaceOne(source, before, after, label) {
  const count = source.split(before).length - 1;
  if (count !== 1) throw new Error(`${label}_anchor_count:${count}`);
  return source.replace(before, after);
}

let worker = await fs.readFile(files.worker, 'utf8');
worker = replaceOne(worker,
  "const { verifyEnvelope: verifyAdvisoryEvidenceEnvelope } = require('./advisory-evidence-verifier.cjs');",
  "const { verifyEnvelope: verifyAdvisoryEvidenceEnvelope } = require('./advisory-evidence-verifier.cjs');\nconst { createDevOSRepoReadModel } = require('./devos-repo-read-model.cjs');",
  'worker_import');
worker = replaceOne(worker,
  "  'REPO_HEAD_READ',\n  'CANDIDATE_CAPSULE_CREATE',",
  "  'REPO_HEAD_READ',\n  'DEVOS_REPO_READ_MODEL',\n  'CANDIDATE_CAPSULE_CREATE',",
  'worker_capability');
worker = replaceOne(worker,
  "    advisory_evidence_promotion_authority: false,\n    direct_promote_current: false,",
  "    advisory_evidence_promotion_authority: false,\n    devos_repo_read_model: true,\n    devos_repo_arbitrary_path_read: false,\n    direct_promote_current: false,",
  'worker_capability_metadata');
worker = replaceOne(worker,
  "  if (capability === 'REPO_HEAD_READ') return readRepoHead();\n  if (capability === 'CANDIDATE_CAPSULE_CREATE')",
  "  if (capability === 'REPO_HEAD_READ') return readRepoHead();\n  if (capability === 'DEVOS_REPO_READ_MODEL') return createDevOSRepoReadModel({ repoRoot, source: await requireCurrentSource() });\n  if (capability === 'CANDIDATE_CAPSULE_CREATE')",
  'worker_execute');
await fs.writeFile(files.worker, worker);

let plane = await fs.readFile(files.plane, 'utf8');
plane = replaceOne(plane,
  "  'REPO_HEAD_READ',\n  'CANDIDATE_CAPSULE_CREATE',",
  "  'REPO_HEAD_READ',\n  'DEVOS_REPO_READ_MODEL',\n  'CANDIDATE_CAPSULE_CREATE',",
  'plane_capability');
plane = replaceOne(plane,
  "  #stopRequested = true;\n",
  "  #stopRequested = true;\n  #transcript = [];\n  #transcriptTotal = 0;\n  #lastResults = new Map();\n",
  'plane_state');
plane = replaceOne(plane,
  "      advisory_evidence_promotion_authority: false,\n      direct_promote_current: false,",
  "      advisory_evidence_promotion_authority: false,\n      devos_repo_read_model: clone(this.#lastResults.get('DEVOS_REPO_READ_MODEL') || null),\n      transcript: Object.freeze(this.#transcript.map((row) => Object.freeze({ ...row }))),\n      transcript_total_count: this.#transcriptTotal,\n      last_results: Object.freeze(Object.fromEntries([...this.#lastResults.entries()].map(([key, value]) => [key, clone(value)]))),\n      direct_promote_current: false,",
  'plane_snapshot_sources');
const planeHelpers = [
  '  #appendTranscript(capability, state, summary = null) {',
  '    this.#transcriptTotal += 1;',
  "    this.#transcript.push(Object.freeze({ seq: this.#transcriptTotal, at: new Date(this.#clock()).toISOString(), capability: String(capability || 'UNKNOWN'), state: String(state || 'UNKNOWN'), summary: summary == null ? null : String(summary).slice(0, 800), authority_effect: false }));",
  '    if (this.#transcript.length > 64) this.#transcript.splice(0, this.#transcript.length - 64);',
  '  }',
  '',
  '  #retainResult(capability, result) {',
  '    let retained = null;',
  "    if (capability === 'DEVOS_REPO_READ_MODEL' || capability === 'CANDIDATE_CAPSULE_VERIFY' || capability === 'VERIFICATION_SANDBOX_PLAN_VERIFY' || capability === 'ADVISORY_EVIDENCE_VERIFY') retained = clone(result);",
  "    if (capability === 'CANDIDATE_CAPSULE_CREATE' && result && typeof result === 'object') retained = { schema: result.schema, candidate_id: result.candidate_id, source: clone(result.source), components: clone(result.components), verification_plan: clone(result.verification_plan), authority_effect: false };",
  '    if (retained) this.#lastResults.set(capability, retained);',
  "    const summary = capability === 'DEVOS_REPO_READ_MODEL' ? `${Number(result?.code_file_count || 0)} source files` : (result?.candidate_id || result?.evidence_id || result?.schema || 'success');",
  "    this.#appendTranscript(capability, 'SUCCESS', summary);",
  '  }',
  '',
  '  #clearRestartTimer() {',
].join('\n');
plane = replaceOne(plane, '  #clearRestartTimer() {', planeHelpers, 'plane_helpers');
plane = replaceOne(plane,
  "    const requestId = `req_${String(this.#uuid()).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;\n    return new Promise((resolve, reject) => {",
  "    const requestId = `req_${String(this.#uuid()).replace(/[^a-z0-9-]/gi, '').toLowerCase()}`;\n    this.#appendTranscript(cap, 'REQUESTED');\n    return new Promise((resolve, reject) => {",
  'plane_request_transcript');
plane = replaceOne(plane,
  "      this.#pending.set(requestId, {\n        resolve: (value) => { clearTimeout(timer); resolve(clone(value)); },\n        reject: (error) => { clearTimeout(timer); reject(error); },\n      });",
  "      this.#pending.set(requestId, {\n        capability: cap,\n        resolve: (value) => { clearTimeout(timer); resolve(clone(value)); },\n        reject: (error) => { clearTimeout(timer); reject(error); },\n      });",
  'plane_pending_capability');
plane = replaceOne(plane,
  "    if (message.ok === true) pending.resolve(message.result);\n    else pending.reject(new Error(`development_plane_remote_error:${String(message.error || 'UNKNOWN')}`));",
  "    if (message.ok === true) {\n      this.#retainResult(pending.capability, message.result);\n      pending.resolve(message.result);\n    } else {\n      this.#appendTranscript(pending.capability, 'ERROR', String(message.error || 'UNKNOWN'));\n      pending.reject(new Error(`development_plane_remote_error:${String(message.error || 'UNKNOWN')}`));\n    }",
  'plane_response_retain');
await fs.writeFile(files.plane, plane);

let projection = await fs.readFile(files.projection, 'utf8');
projection = replaceOne(projection,
  "import { attachDevOSNativeSurfaces } from './metaengine-devos-native-surfaces.mjs';",
  "import { composeDevOSSurfaceRegistry } from './metaengine-devos-surface-registry.mjs';",
  'projection_registry_import');
projection = replaceOne(projection,
  "  const devosNative=attachDevOSNativeSurfaces(devosBase);\n  const devosAttention=attachDevOSSystemAttention(devosNative,{...snapshot,workspaces:base});",
  "  const devosSurfaces=composeDevOSSurfaceRegistry(devosBase,{source_snapshot:snapshot?.devos_sources??null});\n  const devosAttention=attachDevOSSystemAttention(devosSurfaces,{...snapshot,workspaces:base});",
  'projection_registry_compose');
await fs.writeFile(files.projection, projection);

let main = await fs.readFile(files.main, 'utf8');
main = replaceOne(main,
  "import { projectWorkspaceWorkbench } from './workspace-workbench-projection.mjs';",
  "import { projectWorkspaceWorkbench } from './workspace-workbench-projection.mjs';\nimport { projectDevOSDevelopmentSources } from './metaengine-devos-development-sources.mjs';",
  'main_sources_import');
main = replaceOne(main,
  "    presentation_focus: devosPresentationFocus.snapshot(),\n    session_layouts: devosSessionLayouts.snapshot(),",
  "    presentation_focus: devosPresentationFocus.snapshot(),\n    session_layouts: devosSessionLayouts.snapshot(),\n    devos_sources: projectDevOSDevelopmentSources({ development_plane: developmentPlane?.snapshot() || null, startup_logs: startupDegradedSnapshot() }),",
  'main_intent_sources');
main = replaceOne(main,
  "    presentation_focus: presentationFocus,\n    session_layouts: devosSessionLayouts.snapshot(),",
  "    presentation_focus: presentationFocus,\n    session_layouts: devosSessionLayouts.snapshot(),\n    devos_sources: projectDevOSDevelopmentSources({ development_plane: developmentPlaneSnapshot, startup_logs: startupDegradedSnapshot() }),",
  'main_shell_sources');
main = replaceOne(main,
  "  if (developmentPlane.snapshot().state !== 'READY') await developmentPlane.start();\n  return developmentPlane.snapshot();",
  "  if (developmentPlane.snapshot().state !== 'READY') await developmentPlane.start();\n  if (!developmentPlane.snapshot().devos_repo_read_model) {\n    try { await developmentPlane.request('DEVOS_REPO_READ_MODEL'); recordStartupSubsystemReady('DEVOS_REPO_READ_MODEL'); }\n    catch (error) { recordStartupSubsystemDegraded('DEVOS_REPO_READ_MODEL', error); }\n  }\n  return developmentPlane.snapshot();",
  'main_source_read_init');
await fs.writeFile(files.main, main);

let ui = await fs.readFile(files.ui, 'utf8');
ui = replaceOne(ui,
  "      procedural_playbook_count: Math.max(0, Number(row.procedural_playbook_count || 0)),\n      authority_effect: false,",
  "      procedural_playbook_count: Math.max(0, Number(row.procedural_playbook_count || 0)),\n      source_backed: row.source_backed === true,\n      source: row.source ? String(row.source) : null,\n      source_ref: row.source_ref ? String(row.source_ref) : null,\n      source_sha256: row.source_sha256 ? String(row.source_sha256) : null,\n      code_text: typeof row.code_text === 'string' ? row.code_text.slice(0, 24576) : '',\n      terminal_entries: Array.isArray(row.terminal_entries) ? row.terminal_entries.slice(-48) : [],\n      diff_components: Array.isArray(row.diff_components) ? row.diff_components.slice(0, 64) : [],\n      test_receipts: Array.isArray(row.test_receipts) ? row.test_receipts.slice(-32) : [],\n      log_entries: Array.isArray(row.log_entries) ? row.log_entries.slice(-64) : [],\n      authority_effect: false,",
  'ui_source_payload');
ui = replaceOne(ui,
  "  } else if (surface.type === 'MEMORY') {\n    bodyNode.append(kvRow('Episodes', surface.episode_count, 'neutral'));\n    bodyNode.append(kvRow('Semantic facts', surface.semantic_fact_count, 'neutral'));\n    bodyNode.append(kvRow('Playbooks', surface.procedural_playbook_count, 'neutral'));\n  } else {",
  "  } else if (surface.type === 'MEMORY') {\n    bodyNode.append(kvRow('Episodes', surface.episode_count, 'neutral'));\n    bodyNode.append(kvRow('Semantic facts', surface.semantic_fact_count, 'neutral'));\n    bodyNode.append(kvRow('Playbooks', surface.procedural_playbook_count, 'neutral'));\n  } else if (surface.type === 'CODE') {\n    bodyNode.append(kvRow('Source', surface.source_ref || surface.source || 'repository', 'good'));\n    const pre = el('pre', 'surfaceCode'); pre.textContent = surface.code_text || 'Source content unavailable'; bodyNode.append(pre);\n  } else if (surface.type === 'TERMINAL') {\n    const pre = el('pre', 'surfaceCode'); pre.textContent = (surface.terminal_entries || []).map((row) => '[' + text(row.state, 'STATE') + '] ' + text(row.capability, 'CAPABILITY') + (row.summary ? ' · ' + row.summary : '')).join('\\n') || 'No Development Plane transcript'; bodyNode.append(pre);\n  } else if (surface.type === 'DIFF') {\n    for (const row of surface.diff_components || []) bodyNode.append(kvRow(text(row.change, 'CHANGE'), row.path || 'unknown', 'neutral'));\n  } else if (surface.type === 'TESTS') {\n    for (const row of surface.test_receipts || []) bodyNode.append(kvRow(text(row.capability, 'VERIFY'), row.valid ? 'PASS' : text(row.state, 'AVAILABLE'), row.valid ? 'good' : 'warn'));\n  } else if (surface.type === 'LOGS') {\n    const pre = el('pre', 'surfaceCode'); pre.textContent = (surface.log_entries || []).map((row) => '[' + text(row.level, 'INFO') + '] ' + text(row.source, 'DEVOS') + ' · ' + text(row.message, '')).join('\\n') || 'No runtime log entries'; bodyNode.append(pre);\n  } else {",
  'ui_source_renderers');
await fs.writeFile(files.ui, ui);

let activationTest = await fs.readFile(files.activationTest, 'utf8');
activationTest = replaceOne(activationTest,
  "  assert.equal((block.match(/attachSelected\\(\\)/g) || []).length, 1);",
  "  assert.equal((block.match(/attachSelected\\(\\{ force_single_selected: true \\}\\)/g) || []).length, 1);",
  'activation_force_single');
await fs.writeFile(files.activationTest, activationTest);

let selectedTest = await fs.readFile(files.selectedTest, 'utf8');
selectedTest = replaceOne(selectedTest, "  assert.equal(view.selected_session_surface_count, 1);", "  assert.equal(view.selected_session_surface_count, 2);", 'selected_count');
selectedTest = replaceOne(selectedTest, "  assert.equal(view.selected_session_surfaces.length, 1);", "  assert.equal(view.selected_session_surfaces.length, 2);", 'selected_length');
selectedTest = replaceOne(selectedTest, "  assert.equal(view.selected_session_surface_count, 301);", "  assert.equal(view.selected_session_surface_count, 302);", 'selected_bounded_count');
await fs.writeFile(files.selectedTest, selectedTest);

let wiringTest = await fs.readFile(files.wiringTest, 'utf8');
wiringTest = replaceOne(wiringTest,
  "  assert.match(shell, /const workspaces = projectWorkspaceWorkbench\\(\\{\\s*tabs,\\s*fleet: fleetSnapshot,\\s*owner_safety_gates: ownerSafetyGatesSnapshot,\\s*development_plane: developmentPlaneSnapshot,\\s*supervisor,\\s*compute,\\s*presentation_focus: presentationFocus,\\s*\\}\\)/s);",
  "  assert.match(shell, /session_layouts: devosSessionLayouts\\.snapshot\\(\\)/);\n  assert.match(shell, /devos_sources: projectDevOSDevelopmentSources\\(/);",
  'wiring_shell_projection');
wiringTest = replaceOne(wiringTest,
  "  assert.match(source, /attachDevOSSystemAttention\\(devosBase,\\{\\.\\.\\.snapshot,workspaces:base\\}\\)/);",
  "  assert.match(source, /composeDevOSSurfaceRegistry\\(devosBase,\\{source_snapshot:snapshot\\?\\.devos_sources\\?\\?null\\}\\)/);\n  assert.match(source, /attachDevOSSystemAttention\\(devosSurfaces,\\{\\.\\.\\.snapshot,workspaces:base\\}\\)/);\n  assert.match(source, /attachDevOSSessionLayout\\(devosAttention,snapshot\\?\\.session_layouts\\?\\?null\\)/);",
  'wiring_registry_projection');
await fs.writeFile(files.wiringTest, wiringTest);

console.log(JSON.stringify({ schema: 'metaengine.devos.source-finalize-patch.v1', ok: true, authority_effect: false }));
