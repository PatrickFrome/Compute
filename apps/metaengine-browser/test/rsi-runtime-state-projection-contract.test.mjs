import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';

const main = await fs.readFile(new URL('../src/main.mjs', import.meta.url), 'utf8');
const runtime = await fs.readFile(new URL('../src/rsi-runtime-service.mjs', import.meta.url), 'utf8');
const edge = await fs.readFile(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');

test('Browser publishes bounded RSI plans through the existing native state writer', () => {
  assert.match(main, /rsi: rsiRuntime\?\.controlPlaneProjection\?\.\(\{ limit: 4 \}\) \|\| null/);
  assert.match(runtime, /schema: 'metaengine\.rsi\.runtime-control-projection\.v1'/);
  assert.match(runtime, /browser_can_enqueue_devos_tasks: false/);
  assert.match(edge, /if\('rsi'in s\)row\.rsi=boundedObject\(s\.rsi,65536\)/);
  assert.match(edge, /state=coalesce\(target\.state,'\{\}'::jsonb\)\|\|excluded\.state/);
});

test('RSI native-state projection remains observation-only and does not add scheduling authority', () => {
  assert.match(edge, /rsi_runtime_projection:true/);
  assert.match(edge, /rsi_runtime_projection_is_authority:false/);
  assert.doesNotMatch(edge, /rsi.*devos_fleet_enqueue_v1/i);
  assert.doesNotMatch(edge, /rsi.*devos_meta_dispatch_v1/i);
  assert.match(runtime, /existing_devos_scheduler_required: true/);
  assert.match(runtime, /direct_execution_enabled: false/);
  assert.match(runtime, /direct_promotion_enabled: false/);
  assert.match(runtime, /direct_self_update_enabled: false/);
});
