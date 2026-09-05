export const BROWSER_FABRIC_SECURITY_ADVISOR_POLICY_SCHEMA = 'metaengine.browser-fabric.security-advisor-policy.v1';

const TRANSPORT_PROMOTION_RPCS = new Set([
  'devos_transport_promotion_lease_v1',
  'devos_transport_promotion_release_v1',
]);

function normalizeName(value) {
  return String(value || '').trim();
}

function row(finding, disposition, priority, reason, extra = {}) {
  return Object.freeze({
    finding_name: normalizeName(finding?.name),
    entity: normalizeName(finding?.metadata?.name),
    schema: normalizeName(finding?.metadata?.schema),
    level: normalizeName(finding?.level).toUpperCase(),
    disposition,
    priority,
    reason,
    automatic_ddl_allowed: false,
    automatic_rls_policy_generation_allowed: false,
    production_change_window_required: disposition === 'REMEDIATE_ACL',
    direct_connection_proof_required: disposition === 'REMEDIATE_ACL',
    rollback_sql_required: disposition === 'REMEDIATE_ACL',
    threat_model_review_required: ['REVIEW_INTENDED_CALLER', 'REVIEW_TABLE_EXPOSURE'].includes(disposition),
    authority_effect: false,
    ...extra,
  });
}

/**
 * Converts Security Advisor notices into a bounded review/remediation queue.
 * A linter finding is evidence, never DDL authority. In particular,
 * RLS-enabled/no-policy is not synonymous with "add a permissive policy".
 */
export function classifyBrowserFabricSecurityAdvisorFindings(findings = []) {
  if (!Array.isArray(findings)) {
    return Object.freeze({ ok: false, reason: 'SECURITY_ADVISOR_FINDINGS_INVALID', authority_effect: false });
  }

  const classified = findings.map((finding) => {
    const lint = normalizeName(finding?.name);
    const entity = normalizeName(finding?.metadata?.name);
    const schema = normalizeName(finding?.metadata?.schema);

    if (['anon_security_definer_function_executable', 'authenticated_security_definer_function_executable'].includes(lint)
        && schema === 'public'
        && TRANSPORT_PROMOTION_RPCS.has(entity)) {
      return row(finding, 'REMEDIATE_ACL', 'P0', 'LEGACY_TRANSPORT_PROMOTION_SECURITY_DEFINER_EXPOSED', {
        intended_target_role: 'service_role',
        public_or_user_execution_forbidden: true,
        exact_function_identity_preflight_required: true,
      });
    }

    if (lint === 'authenticated_security_definer_function_executable') {
      return row(finding, 'REVIEW_INTENDED_CALLER', 'P1', 'SIGNED_IN_SECURITY_DEFINER_CALLER_INTENT_UNPROVEN');
    }

    if (lint === 'rls_enabled_no_policy') {
      return row(finding, 'REVIEW_TABLE_EXPOSURE', 'P2', 'RLS_NO_POLICY_IS_NOT_AUTOMATICALLY_A_DEFECT', {
        deny_by_default_may_be_intentional: true,
        intended_caller_required_before_policy: true,
        api_exposure_required_before_policy: true,
      });
    }

    if (lint === 'auth_leaked_password_protection') {
      return row(finding, 'ENABLE_AUTH_HARDENING', 'P1', 'LEAKED_PASSWORD_PROTECTION_DISABLED', {
        browser_effect_domain: false,
        separate_auth_configuration_change: true,
      });
    }

    return row(finding, 'REVIEW_UNCLASSIFIED', 'P2', 'SECURITY_ADVISOR_FINDING_REQUIRES_OWNER_REVIEW');
  });

  const p0 = classified.filter((finding) => finding.priority === 'P0');
  return Object.freeze({
    ok: true,
    schema: BROWSER_FABRIC_SECURITY_ADVISOR_POLICY_SCHEMA,
    findings: Object.freeze(classified),
    p0_count: p0.length,
    p0_entities: Object.freeze(
      [...new Set(p0.map((finding) => finding.entity))]
        .sort((left, right) => left.localeCompare(right)),
    ),
    automatic_ddl_allowed: false,
    automatic_rls_policy_generation_allowed: false,
    security_advisor_is_authority: false,
    authority_effect: false,
  });
}

export function browserFabricSecurityAdvisorPolicyContract() {
  return Object.freeze({
    schema: BROWSER_FABRIC_SECURITY_ADVISOR_POLICY_SCHEMA,
    advisor_is_evidence_not_authority: true,
    transport_promotion_public_security_definer_is_p0: true,
    rls_no_policy_auto_fix_allowed: false,
    intended_caller_review_required: true,
    direct_connection_proof_before_acl_commit: true,
    rollback_sql_before_acl_commit: true,
    leaked_password_protection_is_separate_auth_hardening: true,
    automatic_ddl_allowed: false,
    authority_effect: false,
  });
}
