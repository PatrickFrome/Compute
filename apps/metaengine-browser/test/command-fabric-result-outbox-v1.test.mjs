import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const sqlPath = path.resolve('supabase/command-fabric-result-outbox-v1.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

test('result outbox is rollback-only and cannot deploy by file placement', () => {
  assert.match(sql, /Intentionally rollback-only/i);
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /\brollback\s*;/i);
  assert.equal(sqlPath.includes(`${path.sep}supabase${path.sep}migrations${path.sep}`), false);
});

test('outbox is a monotonic terminal index rather than a second command authority table', () => {
  assert.match(sql, /outbox_seq bigint generated always as identity primary key/i);
  assert.match(sql, /unique \(workspace_id, command_id\)/i);
  assert.match(sql, /status text not null check \(status in \('COMPLETED','FAILED','EXPIRED','CANCELLED'\)\)/i);
  assert.match(sql, /authority_effect boolean not null default false check \(authority_effect = false\)/i);
  assert.doesNotMatch(sql, /\bpayload\s+jsonb/i);
  assert.doesNotMatch(sql, /\bissued_by\b/i);
});

test('capture binds terminal result to sha256 and byte count without copying full receipt', () => {
  assert.match(sql, /extensions\.digest\([\s\S]*'sha256'/i);
  assert.match(sql, /receipt_sha256/i);
  assert.match(sql, /receipt_bytes/i);
  assert.match(sql, /on conflict \(workspace_id, command_id\) do nothing/i);
  const tableSection = sql.slice(sql.indexOf('create table'), sql.indexOf('alter table'));
  assert.doesNotMatch(tableSection, /\breceipt\s+jsonb/i);
});

test('result delta is exact-client cursor fenced and bounded', () => {
  assert.match(sql, /o\.result_client_id = v_client/i);
  assert.match(sql, /o\.outbox_seq > v_after/i);
  assert.match(sql, /least\(16, coalesce\(p_limit, 16\)\)/i);
  assert.match(sql, /p\.receipt_bytes <= 4096/i);
  assert.match(sql, /hard_response_limit_bytes',\s*16384/i);
  assert.match(sql, /octet_length\(v_payload::text\) > 16384/i);
  assert.match(sql, /supervisor_result_delta_budget_exceeded/i);
});

test('inline receipt is digest-verified and can be stripped without moving cursor', () => {
  assert.match(sql, /octet_length\(coalesce\(c\.receipt, '\{\}'::jsonb\)::text\) = p\.receipt_bytes/i);
  assert.match(sql, /extensions\.digest\([\s\S]*= p\.receipt_sha256/i);
  assert.match(sql, /receipt_inline_omitted_for_budget/i);
  assert.match(sql, /'next_seq', v_next/i);
  assert.match(sql, /'has_more', v_has_more/i);
});

test('result delta cannot grant transport or retry authority and stays service-role only', () => {
  assert.match(sql, /'transport_delivery_is_authority',\s*false/i);
  assert.match(sql, /'automatic_effect_retry_allowed',\s*false/i);
  assert.match(sql, /'authority_effect',\s*false/i);
  assert.match(sql, /revoke all on function public\.h205f22_a2_browser_supervisor_result_delta_v1\([^;]+from public;/i);
  assert.match(sql, /from anon;/i);
  assert.match(sql, /from authenticated;/i);
  assert.match(sql, /grant execute on function public\.h205f22_a2_browser_supervisor_result_delta_v1\([^;]+to service_role;/i);
});
