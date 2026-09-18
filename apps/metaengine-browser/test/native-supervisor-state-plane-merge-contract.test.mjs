import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

// ---------------------------------------------------------------------------
// P1-2 — /v1/state multi-writer plane-merge contract
//
// Three writers persist state through the Edge (bootstrap heartbeat, 5s
// supervisor heartbeat, realtime observation push). The historical
// full-JSON replacement (state=excluded.state) let any writer that omitted a
// plane erase the plane written by another writer — live-observed as
// supervisor_mesh flapping between the mesh table (fresh) and the signed
// state (null). The repair establishes per-plane ownership:
//   present key (including explicit null) overwrites, absent key preserves.
// ---------------------------------------------------------------------------

const read = (rel) => fs.readFile(new URL(rel, import.meta.url), 'utf8');

test('edge upsert merges state per plane instead of full replacement', async () => {
  const edge = await read('../supabase/a2-browser-native-supervisor-v1/index.ts');
  assert.match(edge, /coalesce\(target\.state,'\{\}'::jsonb\)\|\|excluded\.state/,
    'the persisted state must shallow-merge per top-level plane');
  assert.doesNotMatch(edge, /state=excluded\.state\b/,
    'full-JSON replacement must be gone');
  assert.match(edge, /insert into public\.\$\{STATE_TABLE\} as target\(/,
    'the conflict target must be aliased so the merge can reference the stored row');
});

test('edge boundedState preserves the absent-vs-null distinction for every plane', async () => {
  const edge = await read('../supabase/a2-browser-native-supervisor-v1/index.ts');
  const planeKeys = [
    'tabs', 'development_plane', 'compute', 'fleet', 'perception',
    'supervisor_lifecycle', 'supervisor_mesh', 'self_update',
    'host_resilience', 'realtime_process_plane', 'control_latency',
  ];
  for (const key of planeKeys) {
    assert.match(
      edge,
      new RegExp(`if\\('${key}'in s\\)row\\.${key}=`),
      `plane ${key} must be emitted only when the writer included it`,
    );
  }
  // Identity/scalar fields stay mandatory for every writer.
  for (const key of ['shell_version', 'supervisor_mode', 'armed', 'operator_mode', 'heartbeat_at', 'last_error', 'started_at']) {
    assert.match(edge, new RegExp(`${key}:`), `scalar field ${key} remains always-emitted`);
  }
});

test('heartbeat state getter always carries the mesh plane', async () => {
  const coreBase = await read('../src/native-supervisor-client-core-base.mjs');
  assert.match(
    coreBase,
    /supervisor_mesh:\s*supervisorMesh,/s,
    'getStateWithMeshProjection must include supervisor_mesh unconditionally (null when absent)',
  );
  assert.doesNotMatch(
    coreBase,
    /\.\.\.\(supervisorMesh \? \{ supervisor_mesh: supervisorMesh \} : \{\}\)/,
    'conditional mesh spread would silently omit the plane and freeze a stale server-side value',
  );
});

test('realtime state push always carries the mesh plane', async () => {
  const publicClient = await read('../src/native-supervisor-client.mjs');
  assert.match(
    publicClient,
    /supervisor_mesh:\s*supervisorMesh,/s,
    'the realtime push must include supervisor_mesh unconditionally (null when absent)',
  );
  assert.doesNotMatch(
    publicClient,
    /\.\.\.\(supervisorMesh \? \{ supervisor_mesh: supervisorMesh \} : \{\}\)/,
    'conditional mesh spread would let a stopped mesh linger server-side under plane-merge semantics',
  );
});

test('plane merge semantics: present null clears, absent key preserves', () => {
  // Reference semantics of the SQL used by the Edge (jsonb shallow concat).
  // Simulated with plain objects to keep the contract executable in CI
  // without a Postgres instance.
  const storedPlanes = {
    supervisor_mesh: { running: true },
    fleet: { agents: [1, 2, 3] },
    self_update: { state: 'CURRENT' },
  };
  const incoming = {
    schema: 'metaengine.native-browser-supervisor.state.v1',
    shell_version: '0.7.0-dev.test',
    supervisor_mode: 'CONTROL',
    armed: true,
    operator_mode: 'CONTROL',
    supervisor_mesh: null, // writer says: mesh not running
    // fleet omitted: writer does not own the fleet plane this beat
    self_update: { state: 'ERROR', last_error: 'x' },
    heartbeat_at: new Date().toISOString(),
  };
  const merged = { ...storedPlanes, ...incoming };
  assert.equal(merged.supervisor_mesh, null, 'explicit null clears the plane');
  assert.deepEqual(merged.fleet, { agents: [1, 2, 3] }, 'absent key preserves the plane');
  assert.equal(merged.self_update.state, 'ERROR', 'present plane overwrites wholesale');
  assert.equal(merged.shell_version, '0.7.0-dev.test');
});
