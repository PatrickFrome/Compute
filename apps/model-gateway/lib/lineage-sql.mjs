import { buildChallengeLineageArgs, buildCommitteeLineageArgs } from './lineage-envelope.mjs';

function sqlLiteral(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value !== 'string') throw new Error('lineage_sql_literal_must_be_string_or_null');
  if (value.includes('\u0000')) throw new Error('lineage_sql_literal_nul_forbidden');
  return `'${value.replaceAll("'", "''")}'`;
}

function expectedCte(args) {
  return `expected as (\n  select\n    ${sqlLiteral(args.p_relation)}::text as relation,\n    ${sqlLiteral(args.p_subject_kind)}::text as subject_kind,\n    ${sqlLiteral(args.p_subject_id)}::text as subject_id,\n    ${sqlLiteral(args.p_subject_sha256)}::text as subject_sha256,\n    ${sqlLiteral(args.p_object_kind)}::text as object_kind,\n    ${sqlLiteral(args.p_object_id)}::text as object_id,\n    ${sqlLiteral(args.p_object_sha256)}::text as object_sha256,\n    ${sqlLiteral(args.p_trace_id)}::text as trace_id\n)`;
}

export function buildLineageReadbackSql(args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('lineage_sql_args_required');
  const required = [
    'p_relation', 'p_subject_kind', 'p_subject_id', 'p_subject_sha256',
    'p_object_kind', 'p_object_id', 'p_object_sha256'
  ];
  for (const key of required) {
    if (typeof args[key] !== 'string' || !args[key]) throw new Error(`lineage_sql_${key}_required`);
  }

  return `-- METAENGINE F1 model-gateway lineage readback verifier. READ ONLY.\nwith\n${expectedCte(args)},\nrow_readback as (\n  select l.*\n  from destruktion_meta.compute_fabric_artifact_lineage_h205f22 l\n  cross join expected e\n  where l.relation = e.relation\n    and l.subject_kind = e.subject_kind\n    and l.subject_id = e.subject_id\n    and l.subject_sha256 is not distinct from e.subject_sha256\n    and l.object_kind = e.object_kind\n    and l.object_id = e.object_id\n    and l.object_sha256 is not distinct from e.object_sha256\n    and l.trace_id is not distinct from e.trace_id\n  order by l.created_at desc\n  limit 2\n),\nverified as (\n  select\n    r.*,\n    encode(extensions.digest(convert_to(jsonb_build_object(\n      'relation',r.relation,\n      'subject_kind',r.subject_kind,\n      'subject_id',r.subject_id,\n      'subject_sha256',r.subject_sha256,\n      'object_kind',r.object_kind,\n      'object_id',r.object_id,\n      'object_sha256',r.object_sha256,\n      'trace_id',r.trace_id,\n      'metadata',r.metadata,\n      'canonical',false,\n      'authority_effect',false\n    )::text,'UTF8'),'sha256'),'hex') as recomputed_receipt_sha256\n  from row_readback r\n)\nselect jsonb_build_object(\n  'schema','metaengine.model-gateway.lineage-db-readback-verification.v1',\n  'row_count',(select count(*) from verified),\n  'exactly_one_row',(select count(*) from verified)=1,\n  'edge_id',(select edge_id from verified limit 1),\n  'object_kind',(select object_kind from verified limit 1),\n  'object_id',(select object_id from verified limit 1),\n  'object_sha256',(select object_sha256 from verified limit 1),\n  'stored_receipt_sha256',(select receipt_sha256 from verified limit 1),\n  'recomputed_receipt_sha256',(select recomputed_receipt_sha256 from verified limit 1),\n  'database_receipt_hash_valid',coalesce((select receipt_sha256 = recomputed_receipt_sha256 from verified limit 1),false),\n  'canonical_false',coalesce((select canonical is false from verified limit 1),false),\n  'authority_effect_false',coalesce((select authority_effect is false from verified limit 1),false),\n  'metadata_schema_valid',coalesce((select metadata->>'schema' = 'metaengine.model-gateway.lineage-envelope.v1' from verified limit 1),false),\n  'metadata_storage_contract_valid',coalesce((select metadata->>'storage_contract' = 'destruktion_meta.compute_fabric_record_lineage_h205f22' from verified limit 1),false),\n  'metadata_persistence_mode_valid',coalesce((select metadata->>'persistence_mode' = 'APPEND_ONLY_LINEAGE_EVIDENCE' from verified limit 1),false),\n  'verification_passed',\n    (select count(*) from verified)=1\n    and coalesce((select receipt_sha256 = recomputed_receipt_sha256 from verified limit 1),false)\n    and coalesce((select canonical is false and authority_effect is false from verified limit 1),false)\n    and coalesce((select metadata->>'schema' = 'metaengine.model-gateway.lineage-envelope.v1' from verified limit 1),false)\n    and coalesce((select metadata->>'storage_contract' = 'destruktion_meta.compute_fabric_record_lineage_h205f22' from verified limit 1),false)\n    and coalesce((select metadata->>'persistence_mode' = 'APPEND_ONLY_LINEAGE_EVIDENCE' from verified limit 1),false),\n  'canonical',false,\n  'authority_effect',false\n) as verification;`;
}

export function buildCommitteeLineageReadbackSql(input) {
  return buildLineageReadbackSql(buildCommitteeLineageArgs(input));
}

export function buildChallengeLineageReadbackSql(input) {
  return buildLineageReadbackSql(buildChallengeLineageArgs(input));
}
