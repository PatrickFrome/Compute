import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const sql = await readFile(
  new URL('../../../supabase/migrations/20260929123000_client_v1_r83_physical_evidence_seal_v1.sql', import.meta.url),
  'utf8',
);

test('Client V1 R83 physical evidence seal is append-only and authority-free', () => {
  assert.match(sql, /client_v1_r83_physical_evidence_seal_h205f22/);
  assert.match(sql, /subject_sha text not null unique/);
  assert.match(sql, /promotion_authority boolean not null default false check \(promotion_authority = false\)/);
  assert.match(sql, /automatic_retry_allowed boolean not null default false check \(automatic_retry_allowed = false\)/);
  assert.match(sql, /revoke all on table public\.client_v1_r83_physical_evidence_seal_h205f22[\s\S]*service_role/);
  assert.doesNotMatch(sql, /update\s+public\.client_v1_r83_physical_evidence_seal_h205f22/i);
  assert.doesNotMatch(sql, /delete\s+from\s+public\.client_v1_r83_physical_evidence_seal_h205f22/i);
  // Fail-closed validators intentionally use boolean true as the COALESCE default
  // for missing evidence fields. Fence actual authority grants instead of
  // banning that defensive token lexically.
  assert.doesNotMatch(sql, /promotion_authority\s*=\s*true/i);
  assert.doesNotMatch(sql, /['"]promotion_authority['"]\s*,\s*true/i);
  assert.doesNotMatch(sql, /scheduler_authority\s*=\s*true/i);
  assert.doesNotMatch(sql, /['"]scheduler_authority['"]\s*,\s*true/i);
  assert.doesNotMatch(sql, /browser_actuation_authority\s*=\s*true/i);
  assert.doesNotMatch(sql, /['"]browser_actuation_authority['"]\s*,\s*true/i);
});

test('evidence verifier re-reads exact installed Browser durable facts', () => {
  for (const pattern of [
    /compute_fabric_a2_browser_device_enrollment_request_h205f22/,
    /v_enrollment\.status is distinct from 'CLAIMED'/,
    /metadata->>'qualification_kind' is distinct from 'INSTALLED_ELECTRON'/,
    /metadata->>'qualification_run_id'/,
    /compute_fabric_a2_browser_device_h205f22/,
    /v_device\.active is not true/,
    /v_device\.revoked_at is not null/,
    /compute_fabric_a2_browser_supervisor_command_h205f22/,
    /v_command\.issued_by is distinct from 'CLIENT_V1_INSTALLED_ELECTRON_QUALIFIER'/,
    /v_command\.action is distinct from 'POLL'/,
    /v_command\.status is distinct from 'COMPLETED'/,
    /v_command\.command_lane is distinct from 'READ_ONLY'/,
    /v_command\.leased_by is distinct from v_client_id/,
    /receipt->'result'->'snapshot'->'rsi'->>'source_sha'/,
  ]) assert.match(sql, pattern);
});

test('external GitHub and Edge evidence is bound but not treated as DB-verifiable promotion authority', () => {
  for (const pattern of [
    /external_readback_bound',true/,
    /external_readback_requires_reconciliation',true/,
    /a2-browser-native-supervisor-v1/,
    /a2-browser-native-supervisor-v14-canary/,
    /restore_source_pin/,
    /health_probe_evidence_invalid/,
    /evidence_sha256/,
  ]) assert.match(sql, pattern);
  assert.match(sql, /Evidence existence is never promotion authority/);
});
