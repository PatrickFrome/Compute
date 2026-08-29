import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLineageReadbackSql } from '../lib/lineage-sql.mjs';

function args(overrides = {}) {
  return {
    p_relation: 'RESULT_OF',
    p_subject_kind: 'MODEL_GATEWAY_TASK',
    p_subject_id: 'readback-task',
    p_subject_sha256: 'a'.repeat(64),
    p_object_kind: 'MODEL_GATEWAY_CHALLENGE_RECEIPT',
    p_object_id: 'challenge:readback-task',
    p_object_sha256: 'b'.repeat(64),
    p_trace_id: null,
    ...overrides
  };
}

test('lineage SQL verifier is a single read-only SELECT pipeline against the forced-RLS lineage table', () => {
  const sql = buildLineageReadbackSql(args());
  assert.match(sql, /^-- METAENGINE F1 model-gateway lineage readback verifier\. READ ONLY\.\nwith\n/);
  assert.match(sql, /from destruktion_meta\.compute_fabric_artifact_lineage_h205f22 l/);
  assert.match(sql, /select jsonb_build_object\(/);
  assert.doesNotMatch(sql, /\b(insert|update|delete|merge|truncate|alter|drop|create|grant|revoke|call|do)\s+/i);
  assert.doesNotMatch(sql, /\bfor\s+(update|share)\b/i);
});

test('lineage SQL verifier reproduces the exact database receipt digest field set', () => {
  const sql = buildLineageReadbackSql(args());
  for (const fragment of [
    "'relation',r.relation",
    "'subject_kind',r.subject_kind",
    "'subject_id',r.subject_id",
    "'subject_sha256',r.subject_sha256",
    "'object_kind',r.object_kind",
    "'object_id',r.object_id",
    "'object_sha256',r.object_sha256",
    "'trace_id',r.trace_id",
    "'metadata',r.metadata",
    "'canonical',false",
    "'authority_effect',false",
    "convert_to(jsonb_build_object(",
    ")::text,'UTF8'),'sha256'),'hex') as recomputed_receipt_sha256"
  ]) {
    assert.ok(sql.includes(fragment), `missing digest fragment: ${fragment}`);
  }
  assert.match(sql, /receipt_sha256 = recomputed_receipt_sha256/);
  assert.match(sql, /'database_receipt_hash_valid'/);
});

test('lineage SQL verifier fails closed on absent or duplicate matching rows', () => {
  const sql = buildLineageReadbackSql(args());
  assert.match(sql, /limit 2/);
  assert.match(sql, /'row_count',\(select count\(\*\) from verified\)/);
  assert.match(sql, /'exactly_one_row',\(select count\(\*\) from verified\)=1/);
  assert.match(sql, /'verification_passed',[\s\S]*\(select count\(\*\) from verified\)=1/);
});

test('lineage SQL verifier binds every expected subject/object field and trace id with null-safe equality', () => {
  const sql = buildLineageReadbackSql(args({ p_trace_id: 'c'.repeat(32) }));
  for (const predicate of [
    'l.relation = e.relation',
    'l.subject_kind = e.subject_kind',
    'l.subject_id = e.subject_id',
    'l.subject_sha256 is not distinct from e.subject_sha256',
    'l.object_kind = e.object_kind',
    'l.object_id = e.object_id',
    'l.object_sha256 is not distinct from e.object_sha256',
    'l.trace_id is not distinct from e.trace_id'
  ]) assert.ok(sql.includes(predicate), `missing readback predicate: ${predicate}`);
  assert.ok(sql.includes(`'${'c'.repeat(32)}'::text as trace_id`));
});

test('SQL literal escaping keeps quote-bearing task ids inside one literal', () => {
  const malicious = "task'; select pg_sleep(9); --";
  const sql = buildLineageReadbackSql(args({ p_subject_id: malicious }));
  assert.ok(sql.includes("'task''; select pg_sleep(9); --'::text as subject_id"));
  assert.equal((sql.match(/pg_sleep\(9\)/g) || []).length, 1);
  assert.throws(() => buildLineageReadbackSql(args({ p_subject_id: 'bad\u0000id' })), /nul_forbidden/);
});

test('readback result also reasserts metadata storage semantics and non-authority policy', () => {
  const sql = buildLineageReadbackSql(args());
  assert.match(sql, /metadata->>'schema' = 'metaengine\.model-gateway\.lineage-envelope\.v1'/);
  assert.match(sql, /metadata->>'storage_contract' = 'destruktion_meta\.compute_fabric_record_lineage_h205f22'/);
  assert.match(sql, /metadata->>'persistence_mode' = 'APPEND_ONLY_LINEAGE_EVIDENCE'/);
  assert.match(sql, /canonical is false and authority_effect is false/);
  assert.match(sql, /'canonical',false/);
  assert.match(sql, /'authority_effect',false/);
});
