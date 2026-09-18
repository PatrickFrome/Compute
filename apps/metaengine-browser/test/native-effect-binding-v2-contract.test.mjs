import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const core = fs.readFileSync(new URL('../src/native-supervisor-client-core-base.mjs', import.meta.url), 'utf8');
const binding = fs.readFileSync(new URL('../src/native-effect-binding.mjs', import.meta.url), 'utf8');
const browserControl = fs.readFileSync(new URL('../src/native-browser-control.mjs', import.meta.url), 'utf8');
const edge = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');
const migration = fs.readFileSync(new URL('../../../supabase/migrations/20260906005500_native_supervisor_effect_binding_v2_runtime_fence.sql', import.meta.url), 'utf8');

test('capture observation id is carried through core into the v2 binding', () => {
  assert.match(browserControl, /runtime_observation_id: runtimeObservation\?\.observation_id \|\| null/);
  assert.match(core, /runtime_observation_id: frame\.runtime_observation_id \|\| null/);
  assert.match(core, /runtimeObservationId: observed\?\.runtime_observation_id \|\| null/);
  assert.match(binding, /NATIVE_EFFECT_BINDING_SCHEMA_V2 = 'metaengine\.native-supervisor\.effect-binding\.v2'/);
  assert.match(binding, /runtime_observation_id: runtime\.observation_id/);
  assert.match(binding, /runtimeObservationId: schema === NATIVE_EFFECT_BINDING_SCHEMA_V2 \? binding\.runtime_observation_id : null/);
});

test('v2 binding is fenced again immediately before browser mutation', () => {
  assert.match(browserControl, /return withDebugger\(webContents, async \(dbg\) => \{/);
  assert.match(browserControl, /assertNativeEffectRuntimeBindingCurrent\(\{/);
  assert.match(browserControl, /document_url_sha256: sha256\(clip\(webContents\.getURL\?\.\(\) \|\| '', 1200\)\)/);
  assert.match(browserControl, /attachment_generation: runtime\.attachment_generation/);
  assert.match(browserControl, /document_generation: runtime\.document_generation/);
  assert.match(browserControl, /binding_generation: runtime\.binding_generation/);
});

test('edge and sql accept v1 plus v2 while the database lease remains authority', () => {
  assert.match(edge, /EFFECT_BINDING_SCHEMAS=new Set\(\['metaengine\.native-supervisor\.effect-binding\.v1','metaengine\.native-supervisor\.effect-binding\.v2'\]\)/);
  assert.match(edge, /effect_intent_binding_schemas:\['v1','v2'\]/);
  assert.match(edge, /p_authority_effect:false/);

  assert.match(migration, /v_schema not in \('metaengine\.native-supervisor\.effect-binding\.v1','metaengine\.native-supervisor\.effect-binding\.v2'\)/);
  assert.match(migration, /runtime_observation_id.*\^obs_\[0-9a-f\]\{32\}\$/s);
  assert.match(migration, /binding_generation.*\^\[1-9\]\[0-9\]\{0,15\}\$/s);
  assert.match(migration, /v_row\.status <> 'LEASED'/);
  assert.match(migration, /v_row\.leased_by is distinct from v_client/);
  assert.match(migration, /v_row\.expires_at <= clock_timestamp\(\)/);
  assert.match(migration, /effect_binding_conflict/);
});
