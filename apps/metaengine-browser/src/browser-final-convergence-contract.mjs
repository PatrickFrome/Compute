export const BROWSER_FINAL_CONVERGENCE_CONTRACT_SCHEMA = 'metaengine.browser-final-convergence.v1';

export const BROWSER_FINAL_CONVERGENCE_REQUIRED_PROOFS = Object.freeze([
  'COMMAND_FABRIC_V2',
  'FAST_CONTROL_STATELESS',
  'WORKTREE_AWARE_READ_MODEL',
  'HOST_AGENT_REPLAY_FENCE_V2',
  'HOST_AGENT_ONE_SHOT_SESSION_KEYS',
  'LEASED_BROWSER_PLAN_V1',
  'VERIFIED_EXECUTION_FABRIC_V1',
  'SENTINEL_SUCCESSOR_FENCE',
  'EXACT_SHA_PHYSICAL_RELEASE_GATE',
]);

function plainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export function evaluateBrowserFinalConvergence(proofs = {}) {
  if (!plainObject(proofs)) throw new Error('browser_final_convergence_proofs_invalid');

  const unknown = Object.keys(proofs).filter((key) => !BROWSER_FINAL_CONVERGENCE_REQUIRED_PROOFS.includes(key));
  if (unknown.length) throw new Error(`browser_final_convergence_proof_unknown:${unknown[0]}`);

  const missing = [];
  for (const proof of BROWSER_FINAL_CONVERGENCE_REQUIRED_PROOFS) {
    if (proofs[proof] !== true) missing.push(proof);
  }

  return Object.freeze({
    schema: BROWSER_FINAL_CONVERGENCE_CONTRACT_SCHEMA,
    state: missing.length === 0 ? 'SOURCE_READY' : 'BLOCKED',
    required_proofs: [...BROWSER_FINAL_CONVERGENCE_REQUIRED_PROOFS],
    missing_proofs: Object.freeze(missing),
    source_ready: missing.length === 0,
    exact_release_sha_still_required: true,
    physical_release_qualification_still_required: true,
    automatic_effect_retry_allowed: false,
    production_promotion_authorized: false,
    authority_effect: false,
  });
}
