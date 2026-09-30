export const requestId = '11111111-1111-4111-8111-111111111111';
export const receipt = Object.freeze({
  request_id: requestId,
  workspace_id: '2de9f84b-7c0a-4091-911c-894ff1d6eaf4',
  roadmap_id: 'metaengine-client-v1',
  plan_generation: 4,
  alignment_epoch: 3,
  baseline_sha: 'b'.repeat(40),
  plan_sha256: 'c'.repeat(64),
  point_ids: ['obj.ship-useful-work.v1'],
  task_id: '98903ffd-dc3f-4a3e-ab09-55931c5100a9',
  task_spec_sha256: 'd'.repeat(64),
});

export function wireProof() {
  return {
    ...receipt,
    point_id: receipt.point_ids[0],
    schema: 'metaengine.client-v1.goal-execution-proof.v1',
    found: true,
    task_state: 'RESULT_READY',
    terminal: false,
    lease_generation: 2,
    survives_plan_retirement: true,
    agent_origin_proof: {
      proven: true,
      contract: 'ZAI_AGENT_SURFACE_CAUSAL_V1',
      conversation_url_sha256: 'a'.repeat(64),
      agent_surface_sha256: 'e'.repeat(64),
      prompt_sha256: 'f'.repeat(64),
      effect_state: 'PROVEN_GENERATING',
      lease_generation: 2,
      proven_at: '2026-09-30T00:00:00Z',
      agent_identity_returned: false,
      tab_identity_returned: false,
      target_identity_returned: false,
      authority_effect: false,
    },
    result_proof: {
      available: true,
      result_summary_sha256: '1'.repeat(64),
      result_sha256: '1'.repeat(64),
      claim_valid: true,
      claim_schema: 'metaengine.agent-result-claim.v1',
      claim_sha256: '2'.repeat(64),
      claim_disposition: 'READY',
      conversation_url_sha256: 'a'.repeat(64),
      origin_bound: true,
      accepted: true,
      result_summary_returned: false,
      model_output_returned: false,
      page_content_returned: false,
      authority_effect: false,
    },
    user_goal_to_agent_readback: true,
    user_goal_to_result_readback: true,
    task_payload_returned: false,
    result_summary_returned: false,
    page_content_returned: false,
    model_output_returned: false,
    scheduler_identity_returned: false,
    automatic_retry_allowed: false,
    scheduler_authority: false,
    browser_authority: false,
    release_authority: false,
    authority_effect: false,
  };
}

export function wireProgress() {
  const proof = wireProof();
  return {
    ...proof,
    schema: 'metaengine.client-v1.goal-progress.v1',
    result_checkpoint_id: null,
    result_summary_sha256: proof.result_proof.result_summary_sha256,
    result_sha256: proof.result_proof.result_sha256,
    error_code: null,
  };
}
