import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929124500_client_v1_r83_distributed_reconciliation_v1.sql', import.meta.url),
  'utf8',
);

test('distributed reconciliation compares sealed DB evidence to GitHub and Edge observations', () => {
  for (const pattern of [
    /client_v1_r83_physical_evidence_readback_v1/,
    /GITHUB_PACKAGE_SMOKE/,
    /GITHUB_INSTALLED_ELECTRON/,
    /GITHUB_EDGE_PROBE/,
    /EDGE_STABLE/,
    /EDGE_CANARY/,
    /EDGE_STABLE_CANARY_DIGEST_DIVERGENCE/,
    /EDGE_ROLLBACK_RESTORE/,
    /observation_sha256/,
    /evidence_sha256/,
  ]) assert.match(sql, pattern);
});

test('reconciliation is observation-only and cannot create release or Browser authority', () => {
  for (const pattern of [
    /promotion_authority boolean not null default false check \(promotion_authority=false\)/,
    /scheduler_authority boolean not null default false check \(scheduler_authority=false\)/,
    /automatic_retry_allowed boolean not null default false check \(automatic_retry_allowed=false\)/,
    /'promotion_authority',false/,
    /'scheduler_authority',false/,
    /'browser_actuation_authority',false/,
    /'automatic_retry_allowed',false/,
    /'authority_effect',false/,
  ]) assert.match(sql, pattern);

  assert.doesNotMatch(sql, /issue_native_v1\s*\(/i);
  assert.doesNotMatch(sql, /lease_v[0-9]+\s*\(/i);
  assert.doesNotMatch(sql, /promote_current/i);
  assert.doesNotMatch(sql, /self_update_apply/i);
});

test('reconciliation receipts are append-only and direct table access is revoked', () => {
  assert.match(sql, /unique\(subject_sha,observation_sha256\)/);
  assert.match(sql, /on conflict\(subject_sha,observation_sha256\) do nothing/);
  assert.match(sql, /revoke all on table public\.client_v1_r83_reconciliation_receipt_h205f22[\s\S]*service_role/);
  assert.doesNotMatch(sql, /update\s+public\.client_v1_r83_reconciliation_receipt_h205f22/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.client_v1_r83_reconciliation_receipt_h205f22/i);
});
