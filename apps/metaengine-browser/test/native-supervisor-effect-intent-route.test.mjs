import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const edgeSource = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../src/native-supervisor-client-core.mjs', import.meta.url), 'utf8');
const migrationSource = fs.readFileSync(new URL('../../../supabase/migrations/20260831124000_native_supervisor_effect_binding_v1.sql', import.meta.url), 'utf8');

test('leased semantic effects have an authenticated HTTP bridge to the durable binding seal', () => {
  assert.match(edgeSource, /BIND_EFFECT_RPC='h205f22_a2_browser_supervisor_bind_effect_v1'/);
  assert.match(edgeSource, /EFFECT_BINDING_SCHEMAS=new Set\(\['metaengine\.native-supervisor\.effect-binding\.v1','metaengine\.native-supervisor\.effect-binding\.v2'\]\)/);
  assert.match(edgeSource, /effect_intent_binding_schemas:\['v1','v2'\]/);
  assert.match(edgeSource, /\/effect-intent\$\/\)/);
  assert.match(edgeSource, /rpc\(BIND_EFFECT_RPC,\{p_workspace_id:WORKSPACE_ID,p_command_id:commandId,p_client_id:clientId\(req\),p_binding:binding,p_authority_effect:false\}\)/);
  assert.match(edgeSource, /result\.accepted!==true\|\|!result\.effect_binding/);
  assert.match(edgeSource, /return json\(200,\{\.\.\.result,authority_effect:false\}\)/);

  assert.match(clientSource, /\/v1\/commands\/\$\{encodeURIComponent\(command\.command_id\)\}\/effect-intent/);
  assert.match(clientSource, /payload: \{ binding \}/);
  assert.match(clientSource, /body\?\.accepted !== true \|\| !body\?\.effect_binding/);
  assert.match(clientSource, /binding: body\.effect_binding/);
  assert.match(clientSource, /const sealed = assertNativeEffectBindingMatches\(\{/);
  assert.match(clientSource, /clientId: identityState\.client_id/);
  assert.match(clientSource, /processIncarnationId: observed\.process_incarnation_id/);
  assert.match(clientSource, /tabId: observed\.tab_id/);
  assert.match(clientSource, /targetId: observed\.target_id/);

  assert.match(migrationSource, /h205f22_a2_browser_supervisor_bind_effect_v1\(/);
  assert.match(migrationSource, /p_workspace_id uuid/);
  assert.match(migrationSource, /p_client_id text/);
  assert.match(migrationSource, /effect_binding_sha256/);
  assert.match(migrationSource, /status <> 'LEASED'/);
  assert.match(migrationSource, /leased_by is distinct from p_client_id/);
});

test('effect intent route rejects unsealed or cross-command/client bindings before the RPC', () => {
  assert.match(edgeSource, /effect_binding_required/);
  assert.match(edgeSource, /effect_binding_schema_invalid/);
  assert.match(edgeSource, /effect_binding_command_mismatch/);
  assert.match(edgeSource, /effect_binding_client_mismatch/);
  assert.match(edgeSource, /effect_binding_rejected/);
});
