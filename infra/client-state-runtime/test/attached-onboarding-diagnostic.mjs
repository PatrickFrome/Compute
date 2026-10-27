const fallbackCode = 'attached_bundle_fixture_onboarding_failure_unattested';
const stages = new Set(['preflight', 'migration', 'role_provision', 'transaction_admission',
  'api_reconnect', 'publish_config', 'cleanup']);

// CLI receipts are untrusted process output. Keep the existing bounded code
// and admit only fixed metadata; never print the receipt or raw diagnostics.
export function formatAttachedOnboardingDiagnostic(setupFailureCode, receipt) {
  const code = typeof setupFailureCode === 'string' && /^attached_onboarding_[a-z0-9_]{1,160}$/.test(setupFailureCode)
    ? setupFailureCode : fallbackCode;
  const stage = code !== fallbackCode && stages.has(receipt?.stage) ? receipt.stage : 'unknown';
  const category = stage === 'migration' && receipt?.category === 'cognitive_rpc_public_execution_requires_review'
    ? 'cognitive_rpc_public_execution_requires_review' : 'unclassified';
  return `${code}; stage=${stage}; category=${category}`;
}
