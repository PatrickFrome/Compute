import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const bindingMigration = fs.readFileSync(new URL('../../../supabase/migrations/20260906164000_native_supervisor_effect_binding_v2_transport_compat.sql', import.meta.url), 'utf8');
const completionMigration = fs.readFileSync(new URL('../../../supabase/migrations/20260906164500_supervisor_complete_requires_effect_binding.sql', import.meta.url), 'utf8');
const client = fs.readFileSync(new URL('../src/native-supervisor-client-core-base.mjs', import.meta.url), 'utf8');

test('final v2 binding migration preserves legacy transport while retaining exact DB lease and immutable replay gates', () => {
  assert.match(bindingMigration, /v_binding jsonb := p_binding/);
  assert.match(bindingMigration, /jsonb_typeof\(v_binding\) = 'string'/);
  assert.match(bindingMigration, /v_schema not in \('metaengine\.native-supervisor\.effect-binding\.v1','metaengine\.native-supervisor\.effect-binding\.v2'\)/);
  assert.match(bindingMigration, /runtime_observation_id.*\^obs_\[0-9a-f\]\{32\}\$/s);
  assert.match(bindingMigration, /v_row\.status <> 'LEASED'/);
  assert.match(bindingMigration, /v_row\.leased_by is distinct from v_client/);
  assert.match(bindingMigration, /v_row\.expires_at <= clock_timestamp\(\)/);
  assert.match(bindingMigration, /v_row\.payload->>'tab_id'.*v_binding->>'tab_id'/s);
  assert.match(bindingMigration, /native_effect_binding_conflict/);
  assert.match(bindingMigration, /where workspace_id=p_workspace_id and command_id=p_command_id/);
  assert.match(bindingMigration, /revoke all on function.*from public, anon, authenticated/is);
  assert.match(bindingMigration, /grant execute on function.*to service_role/is);
});

test('successful semantic completion requires sealed binding while failure reporting remains possible', () => {
  assert.match(completionMigration, /v_bound_effect_actions constant text\[\].*STOP_GENERATION.*SCROLL.*SEMANTIC_FOCUS.*SEMANTIC_TYPE.*TYPED_CLICK/s);
  assert.match(completionMigration, /if coalesce\(p_ok,false\) and v_row\.action = any\(v_bound_effect_actions\)/);
  assert.match(completionMigration, /v_row\.effect_binding is null/);
  assert.match(completionMigration, /supervisor_effect_binding_required/);
  assert.match(completionMigration, /v_row\.effect_binding->>'command_id' is distinct from v_row\.command_id::text/);
  assert.match(completionMigration, /v_row\.effect_binding->>'client_id' is distinct from v_client/);
  assert.match(completionMigration, /status='LEASED'/);
  assert.match(completionMigration, /leased_by=v_client/);
  assert.match(completionMigration, /expires_at>clock_timestamp\(\)/);
  assert.match(completionMigration, /p_authority_effect is distinct from false/);
});

test('native client seals and reads back effect intent before dispatching DB-leased semantic mutation', () => {
  assert.match(client, /nativeActionRequiresEffectBinding\(command\?\.action\)/);
  assert.match(client, /CAPTURE/);
  assert.match(client, /buildNativeEffectBinding\(\{/);
  assert.match(client, /\/effect-intent/);
  assert.match(client, /assertNativeEffectBindingMatches\(\{/);
  assert.match(client, /effect_binding: sealed/);
});
