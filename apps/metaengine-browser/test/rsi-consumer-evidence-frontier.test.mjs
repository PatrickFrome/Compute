import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyRsiConsumerEvidenceAppend, assessRsiConsumerKnowledgeReview} from '../src/rsi-consumer-evidence-frontier.mjs';

const digest = (n) => `sha256:${String(n).padStart(64, '0')}`;
const sha = 'a'.repeat(40);
const handoff = Object.freeze({
  handoff_digest: digest(1), source_sha: sha,
  consumer_route: 'VERIFIED_SKILL_CANDIDATE_REVALIDATION',
  consumer_model_family:'GPT', consumer_environment_family:'LOCAL',
  consumer_context_digest:digest(2), consumer_task_set_digest:digest(3),
  consumer_harness_digest:digest(4), consumer_retrieval_profile_digest:digest(5),
  consumer_evaluator_root_digest:digest(6), consumer_evaluator_generation_digest:digest(7),
  consumer_evaluator_generation_seq:7,
  consumer_evaluator_generation_history_anchor_digest:digest(8),
  consumer_evaluation_epoch_seq:9, consumer_evaluation_epoch_digest:digest(9),
  consumer_evaluation_contract_digest:digest(10), current_consumer_plane_digest:digest(11),
  current_verified_library_digest:digest(12),
});
const observed = Object.freeze(Object.fromEntries([
  'consumer_model_family','consumer_environment_family',
  'consumer_context_digest','consumer_task_set_digest','consumer_harness_digest',
  'consumer_retrieval_profile_digest','consumer_evaluator_root_digest',
  'consumer_evaluator_generation_digest','consumer_evaluator_generation_seq',
  'consumer_evaluator_generation_history_anchor_digest',
  'consumer_evaluation_epoch_seq','consumer_evaluation_epoch_digest',
  'consumer_evaluation_contract_digest','current_consumer_plane_digest',
  'current_verified_library_digest',
].map(k=>[k,handoff[k]])));
const row = (id,state,d=20)=>({consumer_identity:digest(100),handoff,
  receipt:{receipt_id:id,receipt_digest:digest(d),handoff_digest:handoff.handoff_digest,
  source_sha:sha,consumer_route:handoff.consumer_route,state}});
const positive=row('positive','CONSUMER_REVALIDATED_RECIPE');
const adverse=row('adverse','CONSUMER_NEGATIVE_TRANSFER',21);
const invalid=row('invalid','CONSUMER_REVALIDATION_INVALID',22);
const result=(rows,current=observed)=>assessRsiConsumerKnowledgeReview({rows,handoff,observed:current});

test('new verified receipt appends; identical replay idempotent',()=>{
  assert.equal(classifyRsiConsumerEvidenceAppend([],positive),'APPEND');
  assert.equal(classifyRsiConsumerEvidenceAppend([positive],positive),'IDEMPOTENT');
});
test('second positive cannot supersede original verdict',()=>{
  assert.throws(()=>classifyRsiConsumerEvidenceAppend([positive],row('positive2','CONSUMER_REVALIDATED_RECIPE',23)),/positive_replay_forbidden/);
});
test('post-handoff negative transfer and invalid evidence append',()=>{
  assert.equal(classifyRsiConsumerEvidenceAppend([positive],adverse),'APPEND_ADVERSE');
  assert.equal(classifyRsiConsumerEvidenceAppend([positive,adverse],invalid),'APPEND_ADVERSE');
});
test('no positive resurrection after adverse',()=>{
  assert.throws(()=>classifyRsiConsumerEvidenceAppend([positive,adverse],row('newpositive','CONSUMER_REVALIDATED_RECIPE',24)),/positive_replay_forbidden/);
});
test('same receipt id with altered digest is not idempotent',()=>{
  assert.throws(()=>classifyRsiConsumerEvidenceAppend([positive],row('positive','CONSUMER_REVALIDATED_RECIPE',30)),/receipt_id_conflict/);
});
test('different consumer identity or handoff refuses re-binding',()=>{
  assert.throws(()=>classifyRsiConsumerEvidenceAppend([positive],{...adverse,consumer_identity:digest(500)}),/identity_conflict/);
  assert.throws(()=>classifyRsiConsumerEvidenceAppend([positive],{...adverse,handoff:{...handoff,handoff_digest:digest(500)},receipt:{...adverse.receipt,handoff_digest:digest(500)}}),/identity_conflict/);
});
test('malformed or unbound unverified receipt is refused',()=>{
  assert.throws(()=>classifyRsiConsumerEvidenceAppend([positive],{...adverse,receipt:{...adverse.receipt,source_sha:'b'.repeat(40)}}),/verified_row_required/);
});
test('review is read-only even with exact positive evidence',()=>{
  assert.equal(result([positive]).state,'ELIGIBLE_FOR_FRESH_OWNER_REVIEW_ONLY');
  assert.equal(result([positive]).authority_effect,false);
  assert.equal(result([positive]).skill_activation_authority,false);
});
test('missing snapshot is not equivalent to unchanged snapshot',()=>{
  assert.equal(result([positive],undefined).state,'ELIGIBLE_FOR_FRESH_OWNER_REVIEW_ONLY');
  assert.equal(assessRsiConsumerKnowledgeReview({rows:[positive],handoff}).state,'HOLD_CURRENT_STATE_UNOBSERVED');
});
test('context, retrieval profile, library, epoch, and task drift all hold',()=>{
  for(const key of ['consumer_context_digest','consumer_retrieval_profile_digest','current_verified_library_digest','consumer_evaluation_epoch_seq','consumer_task_set_digest','current_consumer_plane_digest']){
    assert.equal(result([positive],{...observed,[key]:key==='consumer_evaluation_epoch_seq'?10:digest(900)}).state,'HOLD_CURRENT_STATE_DRIFT',key);
  }
});
test('later contradictory evidence vetoes prior approval',()=>{
  assert.equal(result([positive,adverse]).state,'HOLD_POST_HANDOFF_ADVERSE_EVIDENCE');
  assert.equal(result([positive,adverse,invalid]).eligible_for_owner_review,false);
});
test('corrupt or duplicate stored history never yields review eligibility',()=>{
  assert.equal(result([positive,positive]).state,'HOLD_DUPLICATE_ARCHIVE_ROW');
  assert.equal(result([positive,{...adverse,consumer_identity:digest(111)}]).state,'HOLD_INCONSISTENT_ARCHIVE');
});
test('unverified empty evidence returns HOLD',()=>{
  assert.equal(result([]).state,'HOLD_NO_VERIFIED_ARCHIVE_ROW');
});
