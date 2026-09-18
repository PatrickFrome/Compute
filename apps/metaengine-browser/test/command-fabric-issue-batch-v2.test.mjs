import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  CONTROL_ACTION_MANIFEST_REVISION,
  genericIssueV1ControlActions,
} from '../src/control-actions-manifest.mjs';

const sqlPath = path.resolve('supabase/command-fabric-issue-batch-v2.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');

function parseIssuerAllowlist(source) {
  const match = source.match(/if\s+v_action\s+not\s+in\s*\(([^]*?)\)\s+then/i);
  assert.ok(match, 'batch issuer action allowlist must be explicit');
  return [...match[1].matchAll(/'([A-Z][A-Z0-9_]*)'/g)].map((row) => row[1]);
}

test('batch issuer v2 is rollback-only source evidence and cannot auto-deploy', () => {
  assert.match(sql, /^-- METAENGINE Command Fabric v2 source contract\./);
  assert.match(sql, /\bbegin\s*;/i);
  assert.match(sql, /\brollback\s*;/i);
  assert.equal(sqlPath.includes(`${path.sep}supabase${path.sep}migrations${path.sep}`), false);
  assert.match(sql, /automatic_effect_retry_allowed',\s*false/i);
  assert.match(sql, /authority_effect',\s*false/i);
});

test('batch issuer v2 is cryptographically fenced to the canonical manifest revision', () => {
  const revision = sql.match(/v_expected_manifest_revision\s+constant\s+text\s*:=\s*'([^']+)'/i)?.[1] || null;
  assert.equal(revision, CONTROL_ACTION_MANIFEST_REVISION);
  assert.match(revision, /^sha256:[0-9a-f]{64}$/);
  assert.match(sql, /capability_revision_mismatch/);
});

test('batch issuer v2 exposes exactly the existing generic issuer surface, no hidden expansion', () => {
  const sqlActions = parseIssuerAllowlist(sql).sort();
  const manifestActions = genericIssueV1ControlActions().map((row) => row.action).sort();
  assert.equal(sqlActions.length, 32);
  assert.deepEqual(sqlActions, manifestActions);
  assert.equal(sqlActions.includes('RESOLVE_PROMPT'), false);
  assert.equal(sqlActions.includes('CONTROL_CAPABILITIES'), false);
  assert.equal(sqlActions.some((action) => action.startsWith('GATE_')), false);
});

test('batch issuer v2 delegates every row to existing typed issuer and owns no raw insert authority', () => {
  assert.match(sql, /h205f22_a2_browser_supervisor_issue_native_v1\s*\(/);
  assert.doesNotMatch(sql, /insert\s+into\s+public\.compute_fabric_a2_browser_supervisor_command_h205f22/i);
  assert.match(sql, /command_idempotency_key_required/);
  assert.match(sql, /command_idempotency_key_too_long/);
  assert.match(sql, /v_count\s*<\s*1\s+or\s+v_count\s*>\s*64/i);
});

test('batch issuer v2 remains service-role only', () => {
  assert.match(sql, /revoke all on function[^;]+from public;/i);
  assert.match(sql, /revoke all on function[^;]+from anon;/i);
  assert.match(sql, /revoke all on function[^;]+from authenticated;/i);
  assert.match(sql, /grant execute on function[^;]+to service_role;/i);
});
