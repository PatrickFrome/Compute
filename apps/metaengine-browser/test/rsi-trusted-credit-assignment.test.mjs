import assert from 'node:assert/strict';
import test from 'node:test';

import { createRsiBrowserOutcomeEpisode } from '../src/rsi-browser-outcome-ingest.mjs';
import {
  createRsiTrustedCreditReceipt,
  createRsiExperienceGraphAdmission,
  applyRsiExperienceGraphAdmission,
  rsiTrustedCreditTrustRootSnapshot,
} from '../src/rsi-trusted-credit-assignment.mjs';

const SOURCE='a'.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function outcome({
  command='11111111-1111-4111-8111-111111111111',
  status='COMPLETED',
  effect='CONFIRMED',
  task='task.credit.1',
}={}) {
  const readback={
    schema:'metaengine.rsi.result-receipt-readback.v1',
    command_id:command,
    found:true,
    terminal:true,
    status,
    receipt:{
      schema:'metaengine.native-supervisor.command-receipt.v2',
      command_id:command,
      action:'SCROLL',
      platform:'CHATGPT',
      result:null,
      effect_outcome:effect,
      lane:'MUTATION',
      effect_key:`effect-${command.slice(0,8)}`,
      execution_ms:10,
      recorded_at:'2026-09-18T17:05:00.000Z',
      authority_effect:false,
    },
    error:status==='FAILED'?'precondition_failed':null,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
  const attribution={
    task_id:task,
    task_signature_digest:d('1'),
    environment_fingerprint:'env.metaengine.browser.v1',
    model_family:'GPT_5_6_SOL',
    candidate_id:cid('c'),
    candidate_sha:'c'.repeat(40),
    proposal_digest:d('2'),
    skill_digests:[d('3')],
    external_attribution:true,
    authored_by_candidate:false,
  };
  return createRsiBrowserOutcomeEpisode({source_sha:SOURCE,readback,attribution});
}

function assignment(overrides={}) {
  return {
    credit_id:'credit.turn.1',
    assignment_method:'TURN_VALUE_DELTA',
    step_credit:0.25,
    confidence:0.9,
    attempt_index:1,
    challenge_family:'BROWSER_RUNTIME',
    hidden_manifest_digest:d('4'),
    execution_signature_digest:d('5'),
    failure_codes:[],
    mechanism_tags:['SEMANTIC_ACTION'],
    lesson_digests:[d('6')],
    attribution_digests:[d('7')],
    transfer_receipt_digests:[],
    evidence_digest:d('8'),
    evidence_refs:['evidence:terminal-receipt','evidence:turn-credit'],
    external_credit_assigner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('trusted turn credit becomes a canonical append-only experience graph admission',()=>{
  const episode=outcome();
  const receipt=createRsiTrustedCreditReceipt({outcome_episode:episode,assignment:assignment()});
  assert.equal(receipt.step_credit,0.25);
  assert.equal(receipt.terminal_task_reward_is_step_credit,false);
  assert.equal(receipt.credit_is_contextual_not_global_truth,true);
  assert.equal(receipt.promotion_authority,false);

  const admission=createRsiExperienceGraphAdmission({outcome_episode:episode,credit_receipt:receipt});
  assert.equal(admission.experience_case.outcome,'SUCCESS');
  assert.equal(admission.experience_case.candidate_id,cid('c'));
  assert.ok(admission.experience_case.attribution_digests.includes(receipt.credit_receipt_digest));
  assert.equal(admission.candidate_can_write_graph,false);
  assert.equal(admission.raw_trajectory_stored,false);

  const graph=applyRsiExperienceGraphAdmission({admission});
  assert.equal(graph.case_count,1);
  assert.equal(graph.task_anchor_count,1);
  assert.equal(graph.append_only,true);
  assert.equal(graph.authority_effect,false);
});

test('a useful partial action inside a failed command may receive positive contextual credit without changing failure truth',()=>{
  const episode=outcome({
    command:'22222222-2222-4222-8222-222222222222',
    status:'FAILED',
    effect:'PRE_EFFECT_FAILURE',
  });
  const receipt=createRsiTrustedCreditReceipt({
    outcome_episode:episode,
    assignment:assignment({
      credit_id:'credit.turn.failed.partial',
      step_credit:0.4,
      attempt_index:2,
      failure_codes:['PRECONDITION_FAILED'],
    }),
  });
  const admission=createRsiExperienceGraphAdmission({outcome_episode:episode,credit_receipt:receipt});
  assert.equal(receipt.step_credit,0.4);
  assert.equal(receipt.overall_outcome,'FAILURE');
  assert.equal(admission.experience_case.outcome,'FAILURE');
  assert.deepEqual(admission.experience_case.failure_codes,['PRECONDITION_FAILED']);
});

test('graph materialization reuses an exact task anchor and appends distinct cases',()=>{
  const firstEpisode=outcome();
  const firstCredit=createRsiTrustedCreditReceipt({outcome_episode:firstEpisode,assignment:assignment()});
  const firstAdmission=createRsiExperienceGraphAdmission({outcome_episode:firstEpisode,credit_receipt:firstCredit});
  const firstGraph=applyRsiExperienceGraphAdmission({admission:firstAdmission});

  const secondEpisode=outcome({command:'33333333-3333-4333-8333-333333333333'});
  const secondCredit=createRsiTrustedCreditReceipt({
    outcome_episode:secondEpisode,
    assignment:assignment({credit_id:'credit.turn.2',attempt_index:2,step_credit:0.6}),
  });
  const secondAdmission=createRsiExperienceGraphAdmission({outcome_episode:secondEpisode,credit_receipt:secondCredit});
  const secondGraph=applyRsiExperienceGraphAdmission({previous_snapshot:firstGraph,admission:secondAdmission});
  assert.equal(secondGraph.epoch,2);
  assert.equal(secondGraph.task_anchor_count,1);
  assert.equal(secondGraph.case_count,2);
  assert.equal(secondGraph.predecessor_snapshot_digest,firstGraph.snapshot_digest);
});

test('credit rejects missing external evidence and invalid outcome eligibility',()=>{
  const episode=outcome();
  assert.throws(()=>createRsiTrustedCreditReceipt({
    outcome_episode:episode,
    assignment:assignment({external_credit_assigner:false,authored_by_candidate:true}),
  }),/external_assigner_required/);
  assert.throws(()=>createRsiTrustedCreditReceipt({
    outcome_episode:{...episode,eligible_for_experience_graph:false},
    assignment:assignment(),
  }),/outcome_episode_not_learning_eligible/);
});

test('trusted credit root remains advisory and zero-authority',()=>{
  const root=rsiTrustedCreditTrustRootSnapshot();
  assert.equal(root.persisted_terminal_outcome_required,true);
  assert.equal(root.candidate_command_attribution_required,true);
  assert.equal(root.terminal_task_reward_is_step_credit,false);
  assert.equal(root.candidate_can_write_graph,false);
  assert.equal(root.second_scheduler,false);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
});
