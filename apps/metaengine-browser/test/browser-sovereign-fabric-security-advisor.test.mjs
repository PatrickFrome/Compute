import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyBrowserFabricSecurityAdvisorFindings,
  browserFabricSecurityAdvisorPolicyContract,
} from '../src/browser-fabric-security-advisor-policy.mjs';

const finding = (name, entity, schema = 'public', level = 'WARN') => ({
  name,
  level,
  metadata: { name: entity, schema },
});

test('legacy transport-promotion SECURITY DEFINER exposure is P0 ACL remediation evidence only', () => {
  const out = classifyBrowserFabricSecurityAdvisorFindings([
    finding('anon_security_definer_function_executable', 'devos_transport_promotion_lease_v1'),
    finding('authenticated_security_definer_function_executable', 'devos_transport_promotion_release_v1'),
  ]);
  assert.equal(out.ok, true);
  assert.equal(out.p0_count, 2);
  for (const row of out.findings) {
    assert.equal(row.disposition, 'REMEDIATE_ACL');
    assert.equal(row.priority, 'P0');
    assert.equal(row.intended_target_role, 'service_role');
    assert.equal(row.automatic_ddl_allowed, false);
    assert.equal(row.direct_connection_proof_required, true);
    assert.equal(row.rollback_sql_required, true);
  }
});

test('RLS enabled with no policy never auto-generates an allow policy', () => {
  const out = classifyBrowserFabricSecurityAdvisorFindings([
    finding('rls_enabled_no_policy', 'event_ledger', 'destruktion_meta', 'INFO'),
  ]);
  const row = out.findings[0];
  assert.equal(row.disposition, 'REVIEW_TABLE_EXPOSURE');
  assert.equal(row.deny_by_default_may_be_intentional, true);
  assert.equal(row.intended_caller_required_before_policy, true);
  assert.equal(row.automatic_rls_policy_generation_allowed, false);
});

test('other signed-in SECURITY DEFINER functions require intended-caller review instead of blind revoke', () => {
  const out = classifyBrowserFabricSecurityAdvisorFindings([
    finding('authenticated_security_definer_function_executable', 'coordination_read_barrier_h205f22'),
  ]);
  const row = out.findings[0];
  assert.equal(row.disposition, 'REVIEW_INTENDED_CALLER');
  assert.equal(row.priority, 'P1');
  assert.equal(row.threat_model_review_required, true);
  assert.equal(row.automatic_ddl_allowed, false);
});

test('leaked-password advisor is separate Auth hardening, not Browser effect authority', () => {
  const out = classifyBrowserFabricSecurityAdvisorFindings([
    { name: 'auth_leaked_password_protection', level: 'WARN', metadata: { type: 'auth', entity: 'Auth' } },
  ]);
  const row = out.findings[0];
  assert.equal(row.disposition, 'ENABLE_AUTH_HARDENING');
  assert.equal(row.browser_effect_domain, false);
  assert.equal(row.separate_auth_configuration_change, true);
  assert.equal(row.automatic_ddl_allowed, false);
});

test('advisor policy remains evidence-only', () => {
  const contract = browserFabricSecurityAdvisorPolicyContract();
  assert.equal(contract.advisor_is_evidence_not_authority, true);
  assert.equal(contract.rls_no_policy_auto_fix_allowed, false);
  assert.equal(contract.automatic_ddl_allowed, false);
  assert.equal(contract.authority_effect, false);
});
