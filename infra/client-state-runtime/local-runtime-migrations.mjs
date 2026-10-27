import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

// Reviewed offline SQL resource required when a freshly generated PG17 schema
// lacks the local vault compatibility functions. sourceClosure hashes this
// literal URL and the physical installer retains its exact file digest.
export const LOCAL_VAULT_COMPAT_SQL_RESOURCE = new URL('./local-vault-compat.sql', import.meta.url);

export const LOCAL_RUNTIME_MIGRATIONS = Object.freeze([
  { path: '20260901034000_meta_orchestrator_controller_lease_v1.sql', signature: 'public.meta_orchestrator_controller_lease_v1(uuid,text,text,integer)', source_url: new URL('../../supabase/migrations/20260901034000_meta_orchestrator_controller_lease_v1.sql', import.meta.url),
    relations: Object.freeze(['destruktion_meta.meta_orchestrator_controller_lease_h205f22']) },
  { path: '20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql', signature: 'public.meta_orchestrator_frontier_admit_v2(uuid,text,bigint,text[],text,bigint)', source_url: new URL('../../supabase/migrations/20260901034500_meta_orchestrator_frontier_leader_fence_v2.sql', import.meta.url) },
  { path: '20260902183500_devos_live_ambiguity_reconciliation_v3.sql', signature: 'public.devos_fleet_reconcile_ambiguous_v2(uuid,text,uuid,text,bigint,text,text,bigint,jsonb)', source_url: new URL('../../supabase/migrations/20260902183500_devos_live_ambiguity_reconciliation_v3.sql', import.meta.url) },
  // Native admission replaces this trigger, so an old dump must first have
  // the reviewed browser gate. Never replay v2 over an existing v3/unknown body.
  { path: '20260902190500_devos_dispatch_admission_runtime_v2.sql',
    signature: 'destruktion_meta.devos_fleet_claim_transport_admission_h205f22()',
    source_url: new URL('../../supabase/migrations/20260902190500_devos_dispatch_admission_runtime_v2.sql', import.meta.url),
    upgrade_source_url: new URL('../../supabase/migrations/20260903052200_devos_dispatch_admission_signed_native_v3.sql', import.meta.url),
    prerequisite: 'SIGNED_BROWSER_DISPATCH_V3',
    signatures: Object.freeze(['destruktion_meta.devos_normalize_native_supervisor_state_h205f22(jsonb)',
      'destruktion_meta.devos_fleet_claim_transport_admission_h205f22()']),
    triggers: Object.freeze([{ relation: 'destruktion_meta.devos_fleet_claim_h205f22',
      name: 'devos_fleet_claim_transport_admission_trg', signature: 'destruktion_meta.devos_fleet_claim_transport_admission_h205f22()' }]) },
  { path: 'cognitive-acceptor-direct-api-v1.sql',
    signature: 'public.h205f22_a2_browser_cognitive_accept_v1(uuid,text,text,uuid,bigint,bigint,jsonb,boolean)',
    source_url: new URL('./cognitive-acceptor-direct-api-v1.sql', import.meta.url), reviewed_security_definer: true },
  { path: '20261009194157_managed_project_admission_v1.sql', signature: 'public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)', source_url: new URL('../../supabase/migrations/20261009194157_managed_project_admission_v1.sql', import.meta.url),
    signatures: Object.freeze([
      'public.h205f22_a2_managed_project_repository_provision_v1(uuid,uuid,text,bigint,text,text,text)',
      'public.h205f22_a2_managed_project_admission_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint)',
      'public.h205f22_a2_managed_project_binding_effect_v1(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint,text,text,text,boolean,boolean,text)',
      'destruktion_meta.a2_managed_project_admission_read_h205f22(uuid,uuid,text,bigint,bigint,uuid,bigint,uuid,text,bigint,boolean)',
    ]), relations: Object.freeze(['public.compute_fabric_a2_managed_project_repository_h205f22']) },
  { path: '20261010100000_project_continuity_history_v1.sql', signature: 'public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint)', source_url: new URL('../../supabase/migrations/20261010100000_project_continuity_history_v1.sql', import.meta.url),
    signatures: Object.freeze([
      'public.h205f22_project_register_v1(uuid,uuid,uuid,text,bigint)',
      'public.h205f22_project_snapshot_v1(uuid,uuid,uuid,bigint,integer,uuid,text,bigint)',
      'public.h205f22_project_history_v1(uuid,uuid,bigint,bigint,integer,uuid,bigint,text,uuid,text,bigint)',
      'public.h205f22_project_spawn_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint)',
      'public.h205f22_project_activity_v1(uuid,uuid,uuid,bigint,bigint,uuid,text,bigint,text,text,jsonb,bigint,uuid,text,bigint)',
      'public.h205f22_project_policy_v1(uuid,uuid,bigint,integer,bigint,bigint,uuid,text,bigint)',
      'public.h205f22_project_reconcile_v1(uuid,uuid,uuid,text,bigint)',
      'destruktion_meta.project_device_grant_h205f22(uuid,text,bigint)',
      'destruktion_meta.project_authorize_h205f22(uuid,uuid,uuid,text,bigint)',
      'destruktion_meta.project_task_projection_h205f22(uuid,uuid)',
      'destruktion_meta.project_result_bound_h205f22(uuid,text)',
      'destruktion_meta.project_completion_ready_h205f22(uuid)',
      'destruktion_meta.project_task_completion_guard_h205f22()',
      'destruktion_meta.project_append_h205f22(uuid,text,uuid,bigint,text,bigint,text,text,jsonb,text,bigint,boolean,text)',
      'destruktion_meta.project_parent_h205f22(uuid,uuid,uuid,bigint,bigint,uuid,text,bigint)',
      'destruktion_meta.project_task_state_history_h205f22()',
      'destruktion_meta.project_fleet_event_history_h205f22()',
    ]), relations: Object.freeze(['destruktion_meta.project_run_h205f22', 'destruktion_meta.project_task_h205f22', 'destruktion_meta.project_event_h205f22', 'destruktion_meta.project_child_proposal_h205f22']),
    triggers: Object.freeze([
      { relation: 'destruktion_meta.devos_fleet_task_h205f22', name: 'project_task_completion_guard_h205f22', signature: 'destruktion_meta.project_task_completion_guard_h205f22()' },
      { relation: 'destruktion_meta.devos_fleet_task_h205f22', name: 'project_task_state_history_h205f22', signature: 'destruktion_meta.project_task_state_history_h205f22()' },
      { relation: 'destruktion_meta.devos_fleet_event_h205f22', name: 'project_fleet_event_history_h205f22', signature: 'destruktion_meta.project_fleet_event_history_h205f22()' },
    ]) },
  // Marker is absent on v1 installations: apply replacement only in a new migration.
  { path: '20261012130000_project_verifier_reference_transport_v1.sql', signature: 'destruktion_meta.project_verifier_reference_transport_h205f22()',
    source_url: new URL('../../supabase/migrations/20261012130000_project_verifier_reference_transport_v1.sql', import.meta.url) },
  { path: '20261015123000_project_unbounded_defaults_v1.sql', signature: 'destruktion_meta.project_unbounded_defaults_h205f22()',
    source_url: new URL('../../supabase/migrations/20261015123000_project_unbounded_defaults_v1.sql', import.meta.url) },
  {path:'20261022070000_native_coding_execution_ledger_v1.sql',
    signature:'destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text)',
    signatures:Object.freeze(['destruktion_meta.native_coding_reserve_v1(uuid,uuid,bigint,text,text,bigint,uuid,text,text)',
      'destruktion_meta.native_coding_advance_v1(uuid,bigint,uuid,text,text,text,text,text,text,text)',
      'destruktion_meta.native_coding_read_v1(uuid,uuid,bigint)']),
    source_url:new URL('../../supabase/migrations/20261022070000_native_coding_execution_ledger_v1.sql',import.meta.url),
    relations:Object.freeze(['destruktion_meta.native_coding_execution_h205f22'])},
  {path:'20261023082533_native_coding_operator_qa_admission_v1.sql',
    signature:'public.native_coding_admission_context_v1(uuid,text,uuid)',
    signatures:Object.freeze(['public.native_coding_admission_context_v1(uuid,text,uuid)',
      'public.native_coding_execution_context_v1(uuid,text,uuid,bigint)',
      'destruktion_meta.native_coding_claim_admission_v1()',
      'destruktion_meta.native_coding_task_transition_guard_v1()']),
    source_url:new URL('../../supabase/migrations/20261023082533_native_coding_operator_qa_admission_v1.sql',import.meta.url),
    relations:Object.freeze(['destruktion_meta.native_coding_operator_permit_h205f22',
      'destruktion_meta.native_coding_provider_registration_h205f22','destruktion_meta.native_coding_job_registration_h205f22']),
    triggers:Object.freeze([{relation:'destruktion_meta.devos_fleet_claim_h205f22',name:'native_coding_claim_admission_trg',signature:'destruktion_meta.native_coding_claim_admission_v1()'},
      {relation:'destruktion_meta.devos_fleet_task_h205f22',name:'native_coding_task_transition_guard_trg',signature:'destruktion_meta.native_coding_task_transition_guard_v1()'}])},
  // Native independent acceptance remains inside the existing project cycle.
  {path:'20261025070000_native_coding_project_continuation_v1.sql',
    signature:'destruktion_meta.native_coding_reserve_worktree_v1(uuid,bigint)',
    signatures:Object.freeze(['destruktion_meta.native_coding_reserve_worktree_v1(uuid,bigint)',
      'destruktion_meta.native_coding_execution_worktree_fence_v1()',
      'destruktion_meta.native_coding_project_result_bound_v1(uuid)',
      'destruktion_meta.native_coding_checkpoint_candidate_v1(uuid)',
      'destruktion_meta.native_coding_project_reconcile_writer_v1(uuid,text)',
      'destruktion_meta.native_coding_project_completion_ready_v1(uuid)',
      'destruktion_meta.native_coding_finalize_checkpoint_v1(uuid)']),
    source_url:new URL('../../supabase/migrations/20261025070000_native_coding_project_continuation_v1.sql',import.meta.url),
    relations:Object.freeze(['destruktion_meta.native_coding_worktree_fence_h205f22','destruktion_meta.native_coding_checkpoint_h205f22']),
    triggers:Object.freeze([{relation:'destruktion_meta.native_coding_execution_h205f22',
      name:'native_coding_execution_worktree_fence_trg',signature:'destruktion_meta.native_coding_execution_worktree_fence_v1()'}])},
  {path:'20261025080000_native_coding_worktree_lease_admission_v1.sql',
    signature:'destruktion_meta.native_coding_worktree_admissible_v1(uuid,uuid)',
    source_url:new URL('../../supabase/migrations/20261025080000_native_coding_worktree_lease_admission_v1.sql',import.meta.url)},
  {path:'20261025090000_native_coding_agent_project_tools_v1.sql',
    signature:'destruktion_meta.native_coding_agent_context_v1(uuid)',
    signatures:Object.freeze(['destruktion_meta.native_coding_agent_context_v1(uuid)',
      'destruktion_meta.native_coding_agent_overview_v1(uuid,bigint,integer)',
      'destruktion_meta.native_coding_agent_history_v1(uuid,bigint,bigint,integer)',
      'destruktion_meta.native_coding_agent_message_v1(uuid,uuid,text,text)',
      'destruktion_meta.native_coding_agent_child_permit_v1(uuid,text)',
      'destruktion_meta.native_coding_agent_spawn_v1(uuid,uuid,jsonb)',
      'destruktion_meta.native_coding_agent_intent_read_v1(uuid,uuid)',
      'destruktion_meta.native_coding_agent_intent_begin_v1(jsonb,uuid,uuid,text,jsonb)',
      'destruktion_meta.native_coding_agent_intent_immutable_v1()',
      'destruktion_meta.native_coding_agent_alias_immutable_v1()']),
    source_url:new URL('../../supabase/migrations/20261025090000_native_coding_agent_project_tools_v1.sql',import.meta.url),
    relations:Object.freeze(['destruktion_meta.native_coding_agent_intent_h205f22','destruktion_meta.native_coding_agent_intent_alias_h205f22']),
    triggers:Object.freeze([{relation:'destruktion_meta.native_coding_agent_intent_h205f22',name:'native_coding_agent_intent_immutable_trg',signature:'destruktion_meta.native_coding_agent_intent_immutable_v1()'},
      {relation:'destruktion_meta.native_coding_agent_intent_alias_h205f22',name:'native_coding_agent_alias_immutable_trg',signature:'destruktion_meta.native_coding_agent_alias_immutable_v1()'}])},
  {path:'20261025100000_native_coding_checkpoint_commit_rotation_v1.sql',
    signature:'destruktion_meta.native_coding_finish_checkpoint_v1(uuid,jsonb,text,text)',
    signatures:Object.freeze(['destruktion_meta.native_coding_finish_checkpoint_v1(uuid,jsonb,text,text)',
      'destruktion_meta.native_coding_commit_gate_v1(uuid)',
      'destruktion_meta.native_coding_read_commit_v1(uuid)',
      'destruktion_meta.native_coding_project_reconcile_commit_v1(uuid,text)',
      'destruktion_meta.native_coding_commit_candidate_v1(uuid)',
      'destruktion_meta.native_coding_commit_immutable_v1()']),
    source_url:new URL('../../supabase/migrations/20261025100000_native_coding_checkpoint_commit_rotation_v1.sql',import.meta.url),
    relations:Object.freeze(['destruktion_meta.native_coding_commit_h205f22']),
    triggers:Object.freeze([{relation:'destruktion_meta.native_coding_commit_h205f22',name:'native_coding_commit_immutable_trg',signature:'destruktion_meta.native_coding_commit_immutable_v1()'}])},
  {path:'20261025110000_native_coding_initial_goal_seed_v1.sql',
    signature:'destruktion_meta.native_coding_seed_goal_v1(uuid,uuid,text,jsonb,text,text)',
    signatures:Object.freeze(['destruktion_meta.native_coding_seed_goal_v1(uuid,uuid,text,jsonb,text,text)',
      'destruktion_meta.native_coding_seed_profile_v1(uuid,boolean)',
      'destruktion_meta.native_coding_seed_read_v1(uuid,uuid)',
      'destruktion_meta.native_coding_seed_list_v1(uuid,bigint,integer)',
      'destruktion_meta.native_coding_seed_uuid_v1(text)',
      'destruktion_meta.native_coding_seed_browser_correlation_guard_v1()',
      'destruktion_meta.native_coding_seed_immutable_v1()']),
    source_url:new URL('../../supabase/migrations/20261025110000_native_coding_initial_goal_seed_v1.sql',import.meta.url),
    relations:Object.freeze(['destruktion_meta.native_coding_seed_profile_h205f22','destruktion_meta.native_coding_seed_h205f22']),
    triggers:Object.freeze([{relation:'destruktion_meta.native_coding_seed_profile_h205f22',name:'native_coding_seed_profile_immutable_trg',signature:'destruktion_meta.native_coding_seed_immutable_v1()'},
      {relation:'destruktion_meta.native_coding_seed_h205f22',name:'native_coding_seed_immutable_trg',signature:'destruktion_meta.native_coding_seed_immutable_v1()'},
      {relation:'destruktion_meta.client_v1_goal_request_h205f22',name:'native_coding_seed_browser_correlation_guard_trg',signature:'destruktion_meta.native_coding_seed_browser_correlation_guard_v1()'}])},
  {path:'20261025120000_native_coding_service_heartbeat_admission_v1.sql',
    signature:'destruktion_meta.native_coding_service_heartbeat_v1(uuid,text,bigint,uuid,integer,jsonb,text,jsonb)',
    signatures:Object.freeze(['destruktion_meta.native_coding_service_heartbeat_v1(uuid,text,bigint,uuid,integer,jsonb,text,jsonb)',
      'destruktion_meta.native_coding_service_heartbeat_read_v1(uuid,text,bigint,uuid,text)',
      'destruktion_meta.native_coding_service_admissible_v1(uuid)']),
    source_url:new URL('../../supabase/migrations/20261025120000_native_coding_service_heartbeat_admission_v1.sql',import.meta.url),
    relations:Object.freeze(['destruktion_meta.native_coding_service_heartbeat_h205f22'])},
  {path:'native-agent-count-unbounded-v2.sql',
    signature:'destruktion_meta.native_agent_count_unbounded_v2()',
    source_url:new URL('./native-agent-count-unbounded-v2.sql',import.meta.url),
    reviewed_agent_count_upgrade:true},
  {path:'native-coding-running-agent-scope-v1.sql',
    signature:'destruktion_meta.native_coding_running_critic_admissible_v1(uuid,uuid)',
    signatures:Object.freeze(['destruktion_meta.native_coding_running_critic_admissible_v1(uuid,uuid)',
      'destruktion_meta.native_coding_agent_context_v1(uuid)']),
    source_url:new URL('./native-coding-running-agent-scope-v1.sql',import.meta.url),
    reviewed_running_agent_scope_upgrade:true},
  // P3 opt-in fleet DAG: qualified only for self-owned local PostgreSQL;
  // the existing devos lease inserts into the same canonical claim table.
  { path: 'fleet-coordination-claim-guard-v1.sql', signature: 'destruktion_meta.fleet_coordination_claim_gate_v1()',
    source_url: new URL('./fleet-coordination-claim-guard-v1.sql', import.meta.url),
    triggers: Object.freeze([{ relation: 'destruktion_meta.devos_fleet_claim_h205f22',
      name: 'zz_fleet_coordination_claim_gate_v1', signature: 'destruktion_meta.fleet_coordination_claim_gate_v1()' }]) },
  { path: '20261026020000_browser_parent_suspension_v1.sql',
    signature: 'public.h205f22_project_suspend_browser_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint)',
    signatures: Object.freeze([
      'public.h205f22_project_suspend_browser_v1(uuid,uuid,uuid,bigint,bigint,uuid,jsonb,uuid,text,bigint)',
      'public.h205f22_project_suspension_read_v1(uuid,uuid,uuid,text,bigint)',
      'public.h205f22_project_suspension_list_v1(uuid,uuid,text,bigint,bigint,integer)',
      'public.h205f22_project_resume_browser_v1(uuid,uuid,jsonb,uuid,text,bigint)',
      'public.h205f22_project_release_browser_child_v1(uuid,uuid,bigint,text,text,text,bigint,uuid,text,bigint)',
      'destruktion_meta.browser_parent_suspension_projection_v1(uuid)',
      'destruktion_meta.browser_parent_reservation_v1(uuid,text)',
      'destruktion_meta.browser_parent_reserved_claim_v1()',
      'destruktion_meta.browser_child_retirement_immutable_v1()',
    ]),
    source_url: new URL('../../supabase/migrations/20261026020000_browser_parent_suspension_v1.sql', import.meta.url),
    relations: Object.freeze(['destruktion_meta.browser_parent_suspension_h205f22', 'destruktion_meta.browser_child_retirement_h205f22']),
    triggers: Object.freeze([
      { relation: 'destruktion_meta.devos_fleet_claim_h205f22', name: 'browser_parent_reserved_claim_trg', signature: 'destruktion_meta.browser_parent_reserved_claim_v1()' },
      { relation: 'destruktion_meta.browser_child_retirement_h205f22', name: 'browser_child_retirement_immutable_trg', signature: 'destruktion_meta.browser_child_retirement_immutable_v1()' },
    ]),
  },
]);

const REQUIRED_COLUMNS = {
  devos_fleet_task_h205f22: ['task_id', 'workspace_id', 'point_id', 'role', 'base_sha', 'lease_generation', 'lease_agent_id', 'lease_tab_id', 'lease_target_id', 'lease_agent_generation_epoch', 'lease_expires_at', 'state', 'authority_effect', 'result_summary', 'result_sha256', 'error_code', 'finished_at', 'updated_at'],
  devos_fleet_claim_h205f22: ['claim_id', 'workspace_id', 'task_id', 'agent_id', 'lease_generation', 'base_sha', 'tab_id', 'target_id', 'agent_generation_epoch', 'state', 'expires_at', 'updated_at', 'authority_effect'],
};

async function loadSources() {
  return Promise.all(LOCAL_RUNTIME_MIGRATIONS.map(async (migration) => {
    const source = await readFile(migration.source_url, 'utf8');
    const upgradeSource = migration.upgrade_source_url ? await readFile(migration.upgrade_source_url, 'utf8') : null;
    return { ...migration, source, sha256: createHash('sha256').update(source).digest('hex'),
      ...(upgradeSource === null ? {} : { upgradeSource, upgradeSha256: createHash('sha256').update(upgradeSource).digest('hex') }) };
  }));
}

function sourcePlan(sources) {
  const migrations = sources.map(migration => ({ source: migration.path, source_sha256: migration.sha256,
    signature: migration.signature, signatures: [...(migration.signatures || [migration.signature])],
    relations: [...(migration.relations || [])], triggers: [...(migration.triggers || [])],
    ...(migration.upgradeSource ? { upgrade_source: '20260903052200_devos_dispatch_admission_signed_native_v3.sql', upgrade_source_sha256: migration.upgradeSha256 } : {}) }));
  return { schema: 'compute.local-runtime-migration-plan.v1',
    source_manifest_sha256: createHash('sha256').update(JSON.stringify(migrations)).digest('hex'), migrations };
}

// This hashes disk sources only. A source pin is not an attestation of existing SQL bodies.
export async function loadLocalRuntimeMigrationPlan() { return sourcePlan(await loadSources()); }

async function inspectMigrationObjects(tx, migration) {
  const rows = await tx.unsafe(`SELECT 'function' AS kind, value AS identity,
      pg_catalog.to_regprocedure(value) IS NOT NULL AS installed,
      pg_catalog.to_regprocedure(value) IS NOT NULL AS occupied
    FROM pg_catalog.jsonb_array_elements_text($1::text::jsonb)
    UNION ALL SELECT 'relation', value, EXISTS (SELECT 1 FROM pg_catalog.pg_class c
      WHERE c.oid=pg_catalog.to_regclass(value) AND c.relkind IN ('r','p') AND c.relrowsecurity),
      pg_catalog.to_regclass(value) IS NOT NULL
    FROM pg_catalog.jsonb_array_elements_text($2::text::jsonb)
    UNION ALL SELECT 'trigger', value->>'relation' || ':' || (value->>'name'), EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass(value->>'relation')
      AND t.tgname=value->>'name' AND t.tgfoid=pg_catalog.to_regprocedure(value->>'signature')
      AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')), EXISTS (
      SELECT 1 FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass(value->>'relation')
      AND t.tgname=value->>'name')
    FROM pg_catalog.jsonb_array_elements($3::text::jsonb)`,
  [JSON.stringify(migration.signatures || [migration.signature]), JSON.stringify(migration.relations || []), JSON.stringify(migration.triggers || [])]);
  const expected = (migration.signatures || [migration.signature]).length + (migration.relations || []).length + (migration.triggers || []).length;
  if (rows.length !== expected) throw new Error('local_runtime_migration_catalog_invalid:' + migration.path);
  return { complete: rows.every(row => row.installed), present: rows.some(row => row.occupied ?? row.installed),
    missing: rows.filter(row => !row.installed).map(row => row.kind + ':' + row.identity) };
}

const canonicalSqlText = value => String(value).replace(/\r\n/g, '\n');
function reviewedBody(source, name) {
  const start = source.indexOf('create or replace function destruktion_meta.' + name + '(');
  const bodyStart = source.indexOf('as $$', start), end = source.indexOf('$$;', bodyStart + 5);
  if (start < 0 || bodyStart < 0 || end < 0) throw new Error('local_runtime_dispatch_source_invalid');
  return canonicalSqlText(source.slice(bodyStart + 5, end));
}

async function attestDispatchBodies(tx, migration) {
  const functions = await tx.unsafe(`SELECT p.oid::text AS oid, p.proname AS name, p.prosrc AS body,
    l.lanname AS language, p.prosecdef AS definer, p.provolatile AS volatility, p.proconfig AS config,
    pg_catalog.format_type(p.prorettype, NULL) AS result
    FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_language l ON l.oid=p.prolang
    WHERE p.oid IN (pg_catalog.to_regprocedure($1::text), pg_catalog.to_regprocedure($2::text))`, migration.signatures);
  const normalizer = functions.find(row => row.name === 'devos_normalize_native_supervisor_state_h205f22');
  const gate = functions.find(row => row.name === 'devos_fleet_claim_transport_admission_h205f22');
  if (functions.length !== 2 || !normalizer || !gate || normalizer.language !== 'plpgsql' || gate.language !== 'plpgsql'
    || normalizer.definer !== false || gate.definer !== true || normalizer.volatility !== 'i' || gate.volatility !== 'v'
    || normalizer.result !== 'jsonb' || gate.result !== 'trigger'
    || JSON.stringify(normalizer.config) !== JSON.stringify(['search_path=pg_catalog'])
    || JSON.stringify(gate.config) !== JSON.stringify(['search_path=pg_catalog, public, destruktion_meta'])
    || canonicalSqlText(normalizer.body) !== reviewedBody(migration.source, normalizer.name)) {
    throw new Error('local_runtime_dispatch_existing_body_requires_review');
  }
  const gateBody = canonicalSqlText(gate.body);
  const version = gateBody === reviewedBody(migration.upgradeSource, gate.name) ? 3
    : gateBody === reviewedBody(migration.source, gate.name) ? 2 : null;
  if (version === null) throw new Error('local_runtime_dispatch_existing_body_requires_review');
  const [trigger] = await tx.unsafe(`SELECT pg_catalog.pg_get_triggerdef(t.oid, false) AS definition
    FROM pg_catalog.pg_trigger t WHERE t.tgrelid=pg_catalog.to_regclass('destruktion_meta.devos_fleet_claim_h205f22')
    AND t.tgname='devos_fleet_claim_transport_admission_trg' AND NOT t.tgisinternal AND t.tgenabled IN ('O','A')`);
  const compact = text => String(text).replace(/[\s()"]/g, '').toLowerCase();
  const prefix = 'CREATE TRIGGER devos_fleet_claim_transport_admission_trg BEFORE INSERT ON destruktion_meta.devos_fleet_claim_h205f22 FOR EACH ROW ';
  const suffix = 'EXECUTE FUNCTION destruktion_meta.devos_fleet_claim_transport_admission_h205f22()';
  // The native migration narrows this exact gate to browser targets; all other
  // predicates/timing/function bindings require review instead of silent repair.
  const definitions = [prefix + suffix, prefix + "WHEN (((new.target_id IS NULL) OR (new.target_id !~~ 'codex-cli:%'::text))) " + suffix];
  if (!definitions.some(value => compact(value) === compact(trigger?.definition))) throw new Error('local_runtime_dispatch_existing_trigger_requires_review');
  return version;
}

async function ensureDispatchPrerequisite(tx, migration, before) {
  if (before.present && !before.complete) throw new Error('local_runtime_migration_partial_install:' + migration.path + ':' + before.missing.join(','));
  let version = before.complete ? await attestDispatchBodies(tx, migration) : null;
  if (version === null) await tx.unsafe(migration.source);
  if (version !== 3) await tx.unsafe(migration.upgradeSource);
  if (!(await inspectMigrationObjects(tx, migration)).complete || await attestDispatchBodies(tx, migration) !== 3) {
    throw new Error('local_runtime_dispatch_prerequisite_readback_failed');
  }
  return { source: migration.path, source_sha256: migration.sha256, signature: migration.signature, signatures: migration.signatures,
    upgrade_source: '20260903052200_devos_dispatch_admission_signed_native_v3.sql', upgrade_source_sha256: migration.upgradeSha256,
    status: version === 3 ? 'ALREADY_PRESENT_NOT_MODIFIED' : version === 2 ? 'UPGRADED_REVIEWED_V2_TO_V3' : 'APPLIED_LOCAL_ONLY',
    existing_bodies_attested: true, browser_dispatch_version: 3 };
}

export async function applyLocalRuntimeMigrations({ sql, expectedMigrationSourcesSha256 } = {}) {
  if (typeof sql?.begin !== 'function') throw new Error('local_runtime_migration_connection_required');
  const sources = await loadSources();
  const plan = sourcePlan(sources);
  if (expectedMigrationSourcesSha256 !== undefined && (!/^[a-f0-9]{64}$/.test(expectedMigrationSourcesSha256)
    || expectedMigrationSourcesSha256 !== plan.source_manifest_sha256)) throw new Error('local_runtime_migration_source_pin_mismatch');
  return sql.begin(async (tx) => {
    await tx.unsafe("SET LOCAL lock_timeout = '3s'");
    await tx.unsafe("SET LOCAL statement_timeout = '30s'");
    // Serialize installers in this database, including the no-objects-yet case.
    await tx.unsafe("SELECT pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(current_database() || ':compute.local-runtime-migrations.v1', 0))");
    const columns = await tx.unsafe(`SELECT c.table_name, c.column_name, c.udt_name
      FROM information_schema.columns c WHERE c.table_schema = 'destruktion_meta'
      AND c.table_name IN ('devos_fleet_task_h205f22','devos_fleet_claim_h205f22')`);
    for (const [table, names] of Object.entries(REQUIRED_COLUMNS)) {
      const absent = names.filter((name) => !columns.some((column) => column.table_name === table && column.column_name === name));
      if (absent.length) throw new Error('local_runtime_dependency_columns_missing:' + table + ':' + absent.join(','));
    }
    if (!columns.some((column) => column.table_name === 'devos_fleet_claim_h205f22' && column.column_name === 'claim_id' && column.udt_name === 'int8')) throw new Error('local_runtime_bigint_claim_schema_required');
    const [dependencies] = await tx.unsafe(`SELECT
      pg_catalog.to_regprocedure('public.meta_orchestrator_frontier_admit_v1(uuid,text,bigint,text[])') IS NOT NULL AS frontier,
      pg_catalog.to_regprocedure('destruktion_meta.devos_emit_event_h205f22(uuid,text,uuid,text,text,text,bigint,text,jsonb,text)') IS NOT NULL AS event,
      pg_catalog.to_regclass('public.compute_fabric_a2_browser_supervisor_state_h205f22') IS NOT NULL AS supervisor`);
    if (!dependencies.frontier || !dependencies.event || !dependencies.supervisor) throw new Error('local_runtime_dependency_functions_missing');
    const receipts = [];
    for (const migration of sources) {
      const before = await inspectMigrationObjects(tx, migration);
      if (migration.prerequisite === 'SIGNED_BROWSER_DISPATCH_V3') {
        receipts.push(await ensureDispatchPrerequisite(tx, migration, before));
        continue;
      }
      if (migration.reviewed_security_definer) {
        const inspect = async () => (await tx.unsafe(`SELECT p.prosecdef AS definer FROM pg_catalog.pg_proc p
          WHERE p.oid=pg_catalog.to_regprocedure($1::text)`, [migration.signature]))[0]?.definer === true;
        const wasDefiner = await inspect();
        // The SQL always validates the exact body/metadata/owner/ACL, including
        // repeat application. Only its guarded ALTER may change invoker mode.
        await tx.unsafe(migration.source);
        if (!await inspect()) throw new Error('local_runtime_reviewed_definer_readback_failed:' + migration.path);
        receipts.push({ source: migration.path, source_sha256: migration.sha256, signature: migration.signature,
          signatures: [migration.signature], status: wasDefiner ? 'ALREADY_PRESENT_NOT_MODIFIED' : 'APPLIED_LOCAL_ONLY',
          existing_bodies_attested: true, cognitive_acceptor_direct_api: true, table_grants_modified: false });
        continue;
      }
      if (migration.reviewed_agent_count_upgrade) {
        // The source verifies exact old/current bodies and the full permit
        // constraint on every application. A marker alone is not admission.
        await tx.unsafe(migration.source);
        if (!(await inspectMigrationObjects(tx,migration)).complete)
          throw Error('local_runtime_agent_count_upgrade_readback_failed');
        receipts.push({source:migration.path,source_sha256:migration.sha256,
          signature:migration.signature,signatures:[migration.signature],
          status:before.complete?'ALREADY_PRESENT_NOT_MODIFIED':'APPLIED_LOCAL_ONLY',
          existing_bodies_attested:true,agent_count_limit:null});
        continue;
      }
      if (migration.reviewed_running_agent_scope_upgrade) {
        // Exact predecessor/current bodies are guarded by this additive source;
        // always attest repeat installs rather than trusting a presence marker.
        await tx.unsafe(migration.source);
        if (!(await inspectMigrationObjects(tx,migration)).complete)
          throw Error('local_runtime_running_agent_scope_readback_failed');
        receipts.push({source:migration.path,source_sha256:migration.sha256,
          signature:migration.signature,signatures:migration.signatures,
          status:before.complete?'ALREADY_PRESENT_NOT_MODIFIED':'APPLIED_LOCAL_ONLY',
          existing_bodies_attested:true,running_agent_scope_separate_from_admission:true});
        continue;
      }
      if (before.complete) {
        receipts.push({ source: migration.path, source_sha256: migration.sha256, signature: migration.signature,
          signatures: migration.signatures || [migration.signature], status: 'ALREADY_PRESENT_NOT_MODIFIED', existing_bodies_attested: false });
        continue;
      }
      // These migrations create tables/triggers and cannot repair a partially installed owner schema safely.
      if (before.present) throw new Error('local_runtime_migration_partial_install:' + migration.path + ':' + before.missing.join(','));
      await tx.unsafe(migration.source);
      const after = await inspectMigrationObjects(tx, migration);
      if (!after.complete) throw new Error('local_runtime_migration_readback_failed:' + migration.path);
      receipts.push({ source: migration.path, source_sha256: migration.sha256, signature: migration.signature,
        signatures: migration.signatures || [migration.signature], status: 'APPLIED_LOCAL_ONLY', existing_bodies_attested: false });
    }
    return { schema: 'compute.local-runtime-migrations.v1', source_manifest_sha256: plan.source_manifest_sha256,
      migrations: receipts, local_only: true, original_dump_modified: false, existing_bodies_attested: false };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const url = process.env.LOCAL_STATE_ADMIN_DATABASE_URL;
  if (!url || !['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname)) throw new Error('local_state_loopback_database_required');
  let sql;
  try {
    const { default: postgres } = await import('postgres');
    sql = postgres(url, { max: 1, prepare: false });
    console.log(JSON.stringify(await applyLocalRuntimeMigrations({ sql })));
  }
  catch (error) { console.error(JSON.stringify({ event: 'local_runtime_migration_failed', code: error.code === 'ERR_MODULE_NOT_FOUND' ? 'dependency_unavailable' : error.code || error.message })); process.exitCode = 1; }
  finally { if (sql) await sql.end({ timeout: 5 }); }
}
