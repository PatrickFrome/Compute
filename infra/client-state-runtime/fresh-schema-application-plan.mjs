import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadFreshSchemaCandidatePlan } from './fresh-schema-plan.mjs';
import { RPC_ALLOWLIST, TABLE_ALLOWLIST, RPC_CATALOG_QUERY } from './db-api-core.mjs';

export const FRESH_SCHEMA_SELECTION_RESOURCE = new URL('./fresh-schema-statement-selection.json', import.meta.url);
export const FRESH_SCHEMA_PRIVATE_ACL_RESOURCE = new URL('./fresh-schema-private-acl-v1.sql', import.meta.url);
export const FRESH_SCHEMA_PREREQUISITES_RESOURCE = new URL('./fresh-schema-prerequisites-v1.sql', import.meta.url);
export const FRESH_SCHEMA_BASELINE_RESOURCES = Object.freeze([
  new URL('../../supabase/migrations/20260825213000_a2_chat_bridge_remote_runtime_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260827033500_a2_browser_operator_device_identity_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260827034100_a2_browser_operator_device_identity_hardening_v2.sql', import.meta.url),
  new URL('../../supabase/migrations/20260827043107_a2_browser_supervisor_control_plane_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260929010000_client_v1_fresh_project_bootstrap_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260929133000_client_v1_fresh_meta_orchestrator_substrate_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260827115000_a2_browser_supervisor_idempotent_issuance_v2.sql', import.meta.url),
  new URL('../../supabase/migrations/20260827120215_a2_browser_supervisor_remote_authority_v3.sql', import.meta.url),
  new URL('../../supabase/migrations/20260829192000_a2_browser_autonomous_download_update_actuator_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260831152000_a2_workspace_binding_registry_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260902090000_a2_workspace_binding_snapshot_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260906172000_browser_control_plane_fast_lane_release_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260902205500_supervisor_mesh_terminal_freshness_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260913163614_devos_environment_reset_generation_fence_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260913165258_devos_reset_supervisor_admission_fence_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260918150000_devos_transport_promotion_json_null_admission_fix_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260921000000_browser_emergency_lane_and_lease_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260929020000_client_v1_native_device_enrollment_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260929134500_client_v1_goal_submit_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260929203000_client_v1_plan_generation_watermark_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260929211500_client_v1_goal_progress_reconciliation_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260929224500_client_v1_agent_origin_result_proof_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20260930163000_client_v1_admin_connectivity_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20261001033000_browser_guardian_enrollment_ticket_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20261005080000_browser_computer_authority_plane_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20261005123000_browser_computer_visual_fence_target_binding_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20261006173000_browser_device_nonce_concurrency_v3.sql', import.meta.url),
  new URL('../../supabase/migrations/20261007061807_native_supervisor_readonly_issuer_parity_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20261007061415_cognitive_delta_live_acceptor_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20261007063940_cognitive_durable_latest_batch_v1.sql', import.meta.url),
  new URL('../../supabase/migrations/20261007064856_meta_task_claim_class_preservation_v1.sql', import.meta.url),
]);
const root = new URL('../../', import.meta.url);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => { throw new Error(code); };

// Pure source loader. Does not acquire a connection or execute SQL. The owning
// fresh-provider factory alone may apply this plan inside its checked transaction.
// Exclusions are reviewed exact byte spans, NEVER regex rewriting of SQL bodies.
export async function loadFreshSchemaApplicationPlan() {
  const candidate = await loadFreshSchemaCandidatePlan();
  const selectionBytes = await readFile(FRESH_SCHEMA_SELECTION_RESOURCE);
  const selection = JSON.parse(selectionBytes);
  if (selection.schema !== 'compute.fresh-schema-statement-selection.v1'
    || selection.sources.length !== candidate.baseline.length) fail('fresh_selection_shape_invalid');
  const paths = [...new Set(selection.sources.map(row => new URL(row.path,root).href))];
  if (JSON.stringify(paths) !== JSON.stringify(FRESH_SCHEMA_BASELINE_RESOURCES.map(url=>url.href))) fail('fresh_selection_packaged_resources_mismatch');
  const statements = [];
  for (let i = 0; i < selection.sources.length; i++) {
    const entry = selection.sources[i], pinned = candidate.baseline[i];
    if (entry.path !== pinned.path || entry.sha256 !== pinned.sha256 || entry.step !== pinned.step)
      fail('fresh_selection_candidate_mismatch');
    const source = await readFile(new URL(entry.path, root));
    if (sha(source) !== entry.sha256) fail('fresh_selection_source_changed');
    let start = 0;
    for (const exclusion of entry.exclude) {
      if (!Number.isSafeInteger(exclusion.start) || !Number.isSafeInteger(exclusion.end)
        || exclusion.start < start || exclusion.end <= exclusion.start || exclusion.end > source.length
        || sha(source.subarray(exclusion.start, exclusion.end)) !== exclusion.sha256
        || typeof exclusion.reason !== 'string' || !exclusion.reason) fail('fresh_selection_span_invalid');
      if (exclusion.start > start) statements.push({ source: entry.path, start, end: exclusion.start,
        sql: source.subarray(start, exclusion.start).toString('utf8') });
      start = exclusion.end;
    }
    if (start < source.length) statements.push({ source: entry.path, start, end: source.length,
      sql: source.subarray(start).toString('utf8') });
  }
  const exact = statements.map(row => ({source:row.source,start:row.start,end:row.end,sha256:sha(row.sql)}));
  const acl = await readFile(FRESH_SCHEMA_PRIVATE_ACL_RESOURCE);
  const prerequisites = await readFile(FRESH_SCHEMA_PREREQUISITES_RESOURCE);
  return Object.freeze({ schema:'compute.fresh-schema-application-plan.v1',
    selection_sha256:sha(selectionBytes), source_manifest_sha256:sha(JSON.stringify({exact,prerequisites:sha(prerequisites),acl:sha(acl),upgrades:candidate.upgrade_sources_sha256})),
    upgrade_sources_sha256:candidate.upgrade_sources_sha256, statements,
    prerequisite_sql:prerequisites.toString('utf8'), prerequisite_sha256:sha(prerequisites),
    post_upgrade_acl_sql:acl.toString('utf8'), post_upgrade_acl_sha256:sha(acl),
    rpc_signatures:candidate.rpc_signatures, excluded_functions:selection.excluded_functions,
    transaction_required:true, empty_application_schema_required:true,
    private_owner_required:'state_owner', runtime_ready:false,
    owner_approval_procedure:selection.owner_approval_procedure,
    automatic_population_required:true });
}

// Read-only postcondition check. Called BEFORE the owner's transaction commits.
export async function verifyFreshSchemaCatalogue({ sql, plan } = {}) {
  if (!plan || plan.schema !== 'compute.fresh-schema-application-plan.v1') fail('fresh_plan_required');
  if (!Array.isArray(plan.rpc_signatures) || plan.rpc_signatures.length!==RPC_ALLOWLIST.length) fail('fresh_plan_rpc_signatures_invalid');
  const catalog = await sql.unsafe(RPC_CATALOG_QUERY,[JSON.stringify(RPC_ALLOWLIST)]);
  if (catalog.length !== RPC_ALLOWLIST.length) fail('fresh_rpc_catalog_count_mismatch');
  for (const signature of plan.rpc_signatures) {
    const name = signature.slice(7,signature.indexOf('('));
    const matches = catalog.filter(row=>row.name===name);
    const [row] = await sql.unsafe('select to_regprocedure($1)::oid::text as oid',[signature]);
    if (matches.length!==1 || String(matches[0].oid)!==row.oid) fail('fresh_rpc_signature_mismatch');
  }
  for (const signature of plan.excluded_functions) {
    const [row] = await sql.unsafe('select to_regprocedure($1) is not null as present',[signature]);
    if(row.present)fail('fresh_legacy_entrypoint_present');
  }
  let columnCount = 0;
  for(const [table,policy] of Object.entries(TABLE_ALLOWLIST)) {
    const columns=await sql.unsafe("select column_name from information_schema.columns where table_schema='public' and table_name=$1",[table]);
    for(const column of new Set(Object.values(policy).flat())) {
      if(!columns.some(row=>row.column_name===column))fail('fresh_rest_column_missing');
      columnCount++;
    }
  }
  const publicExecutors=await sql.unsafe(`select n.nspname,p.proname from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid=p.pronamespace
    cross join lateral pg_catalog.aclexplode(coalesce(p.proacl,pg_catalog.acldefault('f',p.proowner))) a
    where n.nspname in ('public','destruktion_meta') and a.grantee=0 and a.privilege_type='EXECUTE'`);
  if(publicExecutors.length)fail('fresh_public_function_execute_remaining');
  const [state]=await sql.unsafe("select public.devos_environment_state_v1('11111111-1111-4111-8111-111111111111'::uuid) as value");
  if(state.value.refill_enabled!==false || state.value.supervisor_admission_enabled!==false)fail('fresh_environment_default_unfenced');
  return {schema:'compute.fresh-schema-catalogue.v1',exact_rpc_signatures:plan.rpc_signatures.length,
    rest_tables:Object.keys(TABLE_ALLOWLIST).length,rest_columns:columnCount,
    excluded_legacy_entrypoints_absent:true,public_function_execute:false,default_environment_fenced:true,runtime_ready:false,automatic_population_required:true};
}
