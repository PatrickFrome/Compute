import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { createDevosSupervisorRoutes } from '../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs';

const edgeSource = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/index.ts', import.meta.url), 'utf8');
const devosRouteSource = fs.readFileSync(new URL('../supabase/a2-browser-native-supervisor-v1/devos-routes.mjs', import.meta.url), 'utf8');
const clientSource = fs.readFileSync(new URL('../src/native-supervisor-client-core-base.mjs', import.meta.url), 'utf8');
const migrationSource = fs.readFileSync(new URL('../../../supabase/migrations/20260831124000_native_supervisor_effect_binding_v1.sql', import.meta.url), 'utf8');

test('leased semantic effects have an authenticated HTTP bridge to the durable binding seal', () => {
  assert.match(edgeSource, /BIND_EFFECT_RPC='h205f22_a2_browser_supervisor_bind_effect_v1'/);
  assert.match(edgeSource, /EFFECT_BINDING_SCHEMAS=new Set\(\['metaengine\.native-supervisor\.effect-binding\.v1','metaengine\.native-supervisor\.effect-binding\.v2'\]\)/);
  assert.match(edgeSource, /effect_intent_binding_schemas:\['v1','v2'\]/);
  assert.match(edgeSource, /\/effect-intent\$\/\)/);
  assert.match(edgeSource, /String\(binding\.command_id\|\|''\)\.toLowerCase\(\)!==String\(commandId\|\|''\)\.toLowerCase\(\)/);
  assert.match(edgeSource, /rpc\(BIND_EFFECT_RPC,\{p_workspace_id:WORKSPACE_ID,p_command_id:commandId,p_client_id:clientId\(req\),p_binding:binding,p_authority_effect:false\}\)/);
  assert.match(edgeSource, /result\.accepted!==true\|\|!result\.effect_binding/);
  assert.match(edgeSource, /return json\(200,\{\.\.\.result,authority_effect:false\}\)/);

  assert.match(clientSource, /\/v1\/commands\/\$\{encodeURIComponent\(command\.command_id\)\}\/effect-intent/);
  assert.match(clientSource, /binding: body\.effect_binding/);
  assert.match(clientSource, /assertNativeEffectBindingMatches\(\{/);
  assert.match(clientSource, /effect_binding: sealed/);
  assert.match(clientSource, /effect_binding_sha256: body\.effect_binding_sha256 \|\| null/);

  assert.match(migrationSource, /h205f22_a2_browser_supervisor_bind_effect_v1\(/);
  assert.match(migrationSource, /p_workspace_id uuid/);
  assert.match(migrationSource, /p_client_id text/);
  assert.match(migrationSource, /effect_binding_sha256/);
  assert.match(migrationSource, /status <> 'LEASED'/);
  assert.match(migrationSource, /leased_by is distinct from v_client/);
});

test('effect intent route rejects unsealed or cross-command/client bindings before the RPC', () => {
  assert.match(edgeSource, /effect_binding_required/);
  assert.match(edgeSource, /effect_binding_schema_invalid/);
  assert.match(edgeSource, /effect_binding_command_mismatch/);
  assert.match(edgeSource, /effect_binding_client_mismatch/);
  assert.match(edgeSource, /effect_binding_rejected/);
});

test('composed DevOS route preserves binding check then same commandId then RPC', async () => {
  const commandId = '11111111-2222-4333-8444-555555555555';
  const otherCommandId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
  const workspaceId = '99999999-8888-4777-8666-555555555555';
  const clientId = 'browser-client-exact';
  const calls = [];
  const route = createDevosSupervisorRoutes({
    workspaceId,
    rpc: async (name, args) => {
      calls.push({ name, args });
      return { accepted: true, effect_binding: args.p_binding, authority_effect: false };
    },
  });
  const request = (binding) => route({
    req: { method: 'POST' },
    path: `/v1/commands/${commandId}/effect-intent`,
    body: { binding },
    clientId,
  });

  const wrongCommand = await request({ command_id: otherCommandId, client_id: clientId });
  assert.equal(wrongCommand.status, 409);
  assert.equal((await wrongCommand.json()).error, 'effect_binding_command_mismatch');
  assert.equal(calls.length, 0, 'cross-command binding must fail before RPC');

  const wrongClient = await request({ command_id: commandId, client_id: 'other-client' });
  assert.equal(wrongClient.status, 409);
  assert.equal((await wrongClient.json()).error, 'effect_binding_client_mismatch');
  assert.equal(calls.length, 0, 'cross-client binding must fail before RPC');

  const valid = await request({ command_id: commandId, client_id: clientId });
  assert.equal(valid.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].name, 'h205f22_a2_browser_supervisor_bind_effect_v1');
  assert.equal(calls[0].args.p_command_id, commandId);
  assert.equal(calls[0].args.p_binding.command_id, commandId);
  assert.equal(calls[0].args.p_client_id, clientId);
  assert.match(devosRouteSource, /binding\.command_id[\s\S]*p_command_id:commandId/);
  assert.doesNotMatch(devosRouteSource, /commandId\s*\(\s*req\s*\)/);
});
