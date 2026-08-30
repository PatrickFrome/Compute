import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');
const policyPath = path.join(repoRoot, 'coordination/convergence/DEVELOPMENT_GATE_POLICY_V1.json');
const migrationPath = path.join(repoRoot, 'supabase/migrations/20260830130000_h205f22_development_gate_policy_v1.sql');

function policy() { return JSON.parse(fs.readFileSync(policyPath, 'utf8')); }
function migration() { return fs.readFileSync(migrationPath, 'utf8'); }

test('GATE_DISABLE_ALL_DEV makes only noncritical development gates advisory', () => {
  const row = policy();
  assert.equal(row.schema, 'metaengine.development-gate-policy.v1');
  assert.equal(row.mode, 'GATE_DISABLE_ALL_DEV');
  assert.equal(row.scope, 'DEVELOPMENT_ONLY');
  assert.equal(row.noncritical_gate_mode, 'ADVISORY');
  assert.equal(row.noncritical_failure_blocks_development, false);
  assert.equal(row.parallel_development_allowed, true);
  assert.equal(row.authority_effect, false);
});

test('hard safety and authority fences cannot be disabled by development gate mode', () => {
  const row = policy();
  assert.equal(row.hard_safety_mode, 'ENFORCED');
  for (const required of [
    'TYPED_COMMAND_ONLY',
    'ONE_RESOURCE_ONE_ACTUATION_LEASE',
    'NO_BLIND_RETRY_AFTER_AMBIGUOUS_EFFECT',
    'EXACT_TARGET_PROCESS_TAB_INCARNATION_BINDING',
    'SECRET_BOUNDARIES',
    'PAGE_MODEL_WEBMCP_ZERO_AUTHORITY',
    'NO_ARBITRARY_EVAL',
    'DURABLE_PRE_EFFECT_RECORD',
    'LIVE_REVALIDATION_BEFORE_ACTUATION',
    'MAIN_PRODUCTION_IRREVERSIBLE_EFFECT_AUTHORIZATION',
  ]) assert.ok(row.hard_gate_classes.includes(required), `missing hard gate ${required}`);
  assert.equal(row.main_or_production_promotion_unchanged, true);
});

test('Supabase contract pins hard_safety_mode ENFORCED and zero authority effect', () => {
  const sql = migration();
  assert.match(sql, /hard_safety_mode\s+text\s+not\s+null/i);
  assert.match(sql, /hard_safety_mode\s*=\s*'ENFORCED'/i);
  assert.match(sql, /hard_safety_mode\s*=\s*'ENFORCED'\)/i);
  assert.match(sql, /authority_effect\s+boolean\s+not\s+null\s+default\s+false/i);
  assert.match(sql, /development_gate_policy_authority_effect_ck\s+check\s*\(authority_effect\s*=\s*false\)/i);
  assert.doesNotMatch(sql, /GATE_DISABLE_ALL'[^_]/);
});
