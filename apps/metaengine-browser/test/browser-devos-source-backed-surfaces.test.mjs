import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';
import { attachDevOSSourceSurfaces } from '../src/metaengine-devos-source-surfaces.mjs';
import { composeDevOSSurfaceRegistry, finalizeDevOSSurfaceRegistry } from '../src/metaengine-devos-surface-registry.mjs';
import { projectDevOSDevelopmentSources } from '../src/metaengine-devos-development-sources.mjs';

const require = createRequire(import.meta.url);
const { createDevOSRepoReadModel } = require('../src/devos-repo-read-model.cjs');

function zeroAuthority() {
  return {
    projection_is_authority: false,
    scheduler_authority: false,
    execution_authority: false,
    command_leasing: false,
    automatic_effect_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  };
}

function baseDevOS() {
  return {
    schema: 'metaengine.devos.projection.v1',
    primary_object: 'SESSION',
    sessions: [{ session_id: 'session:ctx', surface_ids: [], tasks: [], ...zeroAuthority() }],
    surfaces: [],
    artifacts: [],
    selected: { session_id: 'session:ctx', surface_id: null },
    active_session: { session_id: 'session:ctx', surface_count: 0, ...zeroAuthority() },
    navigation: { memory: { source_state: 'NOT_EXPOSED', ...zeroAuthority() } },
    surface_registry: {
      types: ['BROWSER', 'CODE', 'TERMINAL', 'DIFF', 'TESTS', 'LOGS', 'ARTIFACT', 'TIMELINE', 'MEMORY', 'GRAPH', 'CANVAS', 'DATABASE'].map((type) => ({ type, authority_effect: false })),
      ...zeroAuthority(),
    },
    counts: { surfaces: 0 },
    ...zeroAuthority(),
  };
}

function sourceSnapshot() {
  return {
    schema: 'metaengine.devos.source-snapshot.v1',
    code_files: [{ relative_path: 'src/app.js', sha256: `sha256:${'a'.repeat(64)}`, bytes: 12, truncated: false, language: 'javascript', text: 'export {};' }],
    terminal_entries: [{ seq: 1, at: '2026-09-08T00:00:00Z', capability: 'REPO_HEAD_READ', state: 'SUCCESS', summary: 'head read' }],
    terminal_entry_count: 1,
    candidate_id: 'candidate_test', source_head: 'b'.repeat(40),
    diff_components: [{ path: 'src/app.js', change: 'MODIFY', digest: `sha256:${'c'.repeat(64)}` }],
    diff_component_count: 1,
    test_receipts: [{ capability: 'CANDIDATE_CAPSULE_VERIFY', state: 'VERIFIED', receipt_schema: 'receipt.v1', valid: true, ref: 'candidate_test' }],
    test_receipt_count: 1,
    log_entries: [{ seq: 1, at: '2026-09-08T00:00:00Z', level: 'INFO', source: 'DEVELOPMENT_PLANE', message: 'ready' }],
    log_entry_count: 1,
    bounded: true, source_backed: true, renderer_authority: false,
    ...zeroAuthority(),
  };
}

test('source-backed attachment exposes Code Terminal Diff Tests Logs only from validated source snapshot', () => {
  const out = attachDevOSSourceSurfaces(baseDevOS(), sourceSnapshot());
  assert.deepEqual(out.surfaces.map((row) => row.type).sort(), ['CODE', 'DIFF', 'LOGS', 'TERMINAL', 'TESTS']);
  assert.equal(out.source_surface_attachment.all_surfaces_source_backed, true);
  for (const row of out.surfaces) {
    assert.equal(row.source_backed, true);
    assert.equal(row.presentation_only, true);
    assert.equal(row.runtime_bound, false);
    assert.equal(row.execution_authority, false);
    assert.equal(row.scheduler_authority, false);
    assert.equal(row.authority_effect, false);
    assert.equal(row.session_id, 'session:ctx');
  }
  assert.equal(out.surfaces.find((row) => row.type === 'TERMINAL').terminal_mode, 'READ_ONLY_TRANSCRIPT');
  assert.equal(out.surfaces.find((row) => row.type === 'DIFF').textual_diff_claimed, false);
});

test('source-backed attachment never invents surfaces when source snapshot is absent or invalid', () => {
  const base = baseDevOS();
  assert.equal(attachDevOSSourceSurfaces(base, null), base);
  assert.equal(attachDevOSSourceSurfaces(base, { ...sourceSnapshot(), source_backed: false }), base);
});

test('common surface instance registry validates exact Session membership and rejects duplicates fail-closed', () => {
  const composed = composeDevOSSurfaceRegistry(baseDevOS(), { source_snapshot: sourceSnapshot() });
  assert.equal(composed.surface_instance_registry.valid, true);
  assert.equal(composed.surface_instance_registry.instance_count, composed.surfaces.length);
  assert.equal(composed.surface_instance_registry.source_backed_count, 5);
  assert.equal(composed.surface_registry.instances_validated, true);
  const bad = structuredClone(composed);
  bad.surfaces.push({ ...bad.surfaces[0] });
  const invalid = finalizeDevOSSurfaceRegistry(bad);
  assert.equal(invalid.surface_instance_registry.valid, false);
  assert.equal(invalid.surface_instance_registry.reason, 'SURFACE_INSTANCE_INVALID');
});

test('development source projection maps only retained trusted read results and transcript into bounded source snapshot', () => {
  const candidate = { schema: 'metaengine.development-plane.candidate-capsule.v1', candidate_id: 'candidate_x', source: { head: 'd'.repeat(40) }, components: [{ path: 'a.js', change: 'MODIFY', digest: `sha256:${'e'.repeat(64)}` }] };
  const plane = {
    schema: 'metaengine.development-plane.snapshot.v1', authority_effect: false, browser_actuation_authority: false, page_command_authority: false, state: 'READY',
    devos_repo_read_model: { schema: 'metaengine.development-plane.repo-read-model.v1', authority_effect: false, repository: 'PatrickFrome/Compute', head: 'd'.repeat(40), ref: 'refs/heads/work/test', code_files: [{ relative_path: 'a.js', sha256: `sha256:${'f'.repeat(64)}`, bytes: 4, truncated: false, language: 'javascript', text: 'x=1;' }] },
    transcript: [{ seq: 1, at: 'now', capability: 'DEVOS_REPO_READ_MODEL', state: 'SUCCESS', summary: '1 source file' }], transcript_total_count: 1,
    last_results: { CANDIDATE_CAPSULE_CREATE: candidate, CANDIDATE_CAPSULE_VERIFY: { schema: 'verify.v1', ok: true, candidate_id: 'candidate_x' } },
  };
  const out = projectDevOSDevelopmentSources({ development_plane: plane, startup_logs: [] });
  assert.equal(out.schema, 'metaengine.devos.source-snapshot.v1');
  assert.equal(out.code_files.length, 1);
  assert.equal(out.terminal_entries.length, 1);
  assert.equal(out.diff_components.length, 1);
  assert.equal(out.test_receipts.length, 1);
  assert.equal(out.log_entries.length, 1);
  assert.equal(out.renderer_authority, false);
  assert.equal(out.direct_process_authority, false);
});

test('repo read model is root-confined, fixed-path, digest bound and bounded', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'metaengine-devos-source-'));
  try {
    await fs.mkdir(path.join(root, 'apps/metaengine-browser/src'), { recursive: true });
    await fs.mkdir(path.join(root, 'apps/metaengine-browser/ui'), { recursive: true });
    await fs.writeFile(path.join(root, 'apps/metaengine-browser/src/main.mjs'), 'export const main = true;\n');
    await fs.writeFile(path.join(root, 'apps/metaengine-browser/ui/app.js'), 'window.devos = true;\n');
    const out = await createDevOSRepoReadModel({ repoRoot: root, source: { repository: 'PatrickFrome/Compute', head: '1'.repeat(40), ref: 'refs/heads/work/test' } });
    assert.equal(out.schema, 'metaengine.development-plane.repo-read-model.v1');
    assert.equal(out.code_files.length, 2);
    assert.equal(out.renderer_path_selection_allowed, false);
    assert.equal(out.arbitrary_path_read_allowed, false);
    assert.equal(out.process_spawn_used, false);
    assert.match(out.code_files[0].sha256, /^sha256:[0-9a-f]{64}$/);
    assert.equal(out.execution_authority, false);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
