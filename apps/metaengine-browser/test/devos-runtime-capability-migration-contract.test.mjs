import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const here = path.dirname(fileURLToPath(import.meta.url));
const migrationPath = path.resolve(here, '../../../supabase/migrations/20260903112000_devos_runtime_capability_contract_v1.sql');
const sql = fs.readFileSync(migrationPath, 'utf8');

function must(pattern, label) {
  assert.match(sql, pattern, label);
}

test('migration publishes the exact non-authoritative protocol-generation-2 capability envelope', () => {
  must(/create or replace function public\.devos_runtime_capabilities_v1\(\)/i, 'capability RPC required');
  must(/'schema',\s*'metaengine\.native-browser-supervisor\.capabilities\.v1'/i, 'exact schema required');
  must(/'protocol_generation',\s*2/i, 'protocol generation 2 required');
  for (const feature of [
    'signed_device_auth_v1',
    'typed_commands_only_v1',
    'devos_cycle_v1',
    'devos_ambiguity_reconcile_v2',
    'devos_transport_promotion_v1',
    'devos_scheduler_capacity_v1',
    'meta_orchestrator_superstep_v1',
    'meta_orchestrator_controller_lease_v1',
    'meta_atomic_frontier_v2',
    'post_lock_transport_revalidation_v1',
  ]) must(new RegExp(`'${feature}',\\s*true`, 'i'), `${feature} required`);
  must(/jsonb_build_array\('PRE_EFFECT_ABORTED',\s*'EFFECT_PROVEN'\)/i, 'bounded ambiguity recovery classes required');
  must(/'second_scheduler_loop',\s*false/i, 'second scheduler must be forbidden');
  must(/'automatic_retry_allowed',\s*false/i, 'retry authority must remain false');
  must(/'arbitrary_eval',\s*false/i, 'arbitrary eval must remain false');
  must(/'page_model_text_authority',\s*false/i, 'page/model text authority must remain false');
  must(/'authority_effect',\s*false/i, 'authority effect must remain false');
});

test('capability and debt RPCs are service-role only', () => {
  must(/revoke all on function public\.devos_runtime_capabilities_v1\(\) from public, anon, authenticated;/i, 'capability public grants revoked');
  must(/grant execute on function public\.devos_runtime_capabilities_v1\(\) to service_role;/i, 'capability service role grant required');
  must(/revoke all on function public\.devos_recovery_debt_snapshot_v1\(uuid\) from public, anon, authenticated;/i, 'debt public grants revoked');
  must(/grant execute on function public\.devos_recovery_debt_snapshot_v1\(uuid\) to service_role;/i, 'debt service role grant required');
  assert.doesNotMatch(sql, /grant\s+(?:all|execute).*\b(?:anon|authenticated|public)\b/i, 'no public/anon/authenticated execute grant');
});

test('recovery debt classifies effect proof only from exact durable transport evidence', () => {
  must(/e\.event_type\s*=\s*'TASK_TRANSPORT_PROVEN'/i, 'transport proof event required');
  must(/e\.task_id\s*=\s*a\.task_id/i, 'task identity required');
  must(/e\.lease_generation\s*=\s*a\.lease_generation/i, 'lease generation fence required');
  must(/prompt_sha256[^\n]*\^\[0-9a-f\]\{64\}\$/i, 'prompt digest proof required');
  must(/conversation_url_sha256[^\n]*\^\[0-9a-f\]\{64\}\$/i, 'conversation digest proof required');
  must(/effect_state[^\n]*PROVEN_GENERATING[^\n]*PROVEN_NEW_CONVERSATION[^\n]*PROVEN_CONVERSATION/i, 'explicit proven effect states required');
  must(/count\(\*\) filter \(where effect_proven\)::bigint as effect_proven_count/i, 'effect-proven partition required');
  must(/count\(\*\) filter \(where not effect_proven\)::bigint as effect_unknown_count/i, 'effect-unknown partition required');
});

test('recovery debt never returns task content or replay authority', () => {
  for (const [key, value] of [
    ['task_content_returned', 'false'],
    ['physical_effect_replayed', 'false'],
    ['automatic_retry_allowed', 'false'],
    ['scheduler_authority', 'false'],
    ['browser_authority', 'false'],
    ['release_authority', 'false'],
    ['authority_effect', 'false'],
  ]) must(new RegExp(`'${key}',\\s*${value}`, 'i'), `${key} must remain ${value}`);
  assert.doesNotMatch(sql, /'automatic_retry_allowed',\s*true/i);
  assert.doesNotMatch(sql, /'physical_effect_replayed',\s*true/i);
});
