import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiBrowserOutcomeEpisode,
  verifyRsiBrowserOutcomeEpisode,
  rsiBrowserOutcomeIngestTrustRootSnapshot,
} from '../src/rsi-browser-outcome-ingest.mjs';

const SOURCE='a'.repeat(40);
const COMMAND='11111111-1111-4111-8111-111111111111';
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function readback(overrides={}){
  const receipt={
    schema:'metaengine.native-supervisor.command-receipt.v2',
    command_id:COMMAND,
    action:'SCROLL',
    platform:'CHATGPT',
    result:{moved:true,secret_like_user_value:'never-persist-this'},
    effect_outcome:'CONFIRMED',
    lane:'MUTATION',
    effect_key:'effect-1',
    execution_ms:12.34567,
    recorded_at:'2026-09-18T16:30:00.000Z',
    authority_effect:false,
    ...(overrides.receipt||{}),
  };
  return {
    schema:'metaengine.rsi.result-receipt-readback.v1',
    command_id:COMMAND,
    found:true,
    terminal:true,
    status:'COMPLETED',
    receipt,
    error:null,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
    ...Object.fromEntries(Object.entries(overrides).filter(([k])=>k!=='receipt')),
  };
}

function attribution(overrides={}){
  return {
    task_id:'task.browser.scroll.1',
    task_signature_digest:d('1'),
    environment_fingerprint:'env.browser.chatgpt.v1',
    model_family:'GPT_5_6_SOL',
    candidate_id:cid('b'),
    candidate_sha:'b'.repeat(40),
    proposal_digest:d('2'),
    skill_digests:[d('3')],
    external_attribution:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('terminal same-client receipt becomes bounded evidence without persisting raw result or error',()=>{
  const rb=readback();
  const attr=attribution();
  const episode=createRsiBrowserOutcomeEpisode({source_sha:SOURCE,readback:rb,attribution:attr});
  verifyRsiBrowserOutcomeEpisode(episode,{source_sha:SOURCE,readback:rb,attribution:attr});
  assert.equal(episode.outcome_state,'VERIFIED_CONFIRMED_EFFECT');
  assert.equal(episode.eligible_for_experience_graph,true);
  assert.equal(episode.eligible_for_skill_evidence,true);
  assert.equal(episode.execution_ms,12.346);
  assert.equal(episode.raw_result_stored,false);
  assert.equal(episode.raw_error_stored,false);
  assert.equal(episode.authority_effect,false);
  const serialized=JSON.stringify(episode);
  assert.doesNotMatch(serialized,/never-persist-this/);
  assert.doesNotMatch(serialized,/"result":/);
});

test('ambiguous physical outcome is quarantined and cannot enter learning',()=>{
  const rb=readback({status:'FAILED',error:'renderer_lost',receipt:{effect_outcome:'AMBIGUOUS',result:null}});
  const episode=createRsiBrowserOutcomeEpisode({source_sha:SOURCE,readback:rb,attribution:attribution()});
  assert.equal(episode.outcome_state,'QUARANTINED_AMBIGUOUS');
  assert.equal(episode.quarantined,true);
  assert.equal(episode.eligible_for_experience_graph,false);
  assert.equal(episode.eligible_for_skill_evidence,false);
  assert.equal(episode.ambiguous_outcome_learning_allowed,false);
  assert.equal(episode.physical_effect_replay_allowed,false);
  assert.ok(episode.error_digest);
  assert.doesNotMatch(JSON.stringify(episode),/renderer_lost/);
});

test('failed outcome is learnable only when no-effect boundary is independently explicit',()=>{
  const rb=readback({status:'FAILED',error:'precondition_failed',receipt:{effect_outcome:'PRE_EFFECT_FAILURE',result:null}});
  const episode=createRsiBrowserOutcomeEpisode({source_sha:SOURCE,readback:rb,attribution:attribution({skill_digests:[]})});
  assert.equal(episode.outcome_state,'VERIFIED_FAILED_NO_EFFECT');
  assert.equal(episode.eligible_for_experience_graph,true);
  assert.equal(episode.eligible_for_skill_evidence,false);
});

test('nonterminal, expired, missing, or authority-bearing readback is never admitted',()=>{
  assert.throws(()=>createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,readback:readback({terminal:false,status:'EXPIRED'}),attribution:attribution(),
  }),/terminal_readback_required/);
  assert.throws(()=>createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,readback:readback({found:false,terminal:false,status:'NOT_FOUND',receipt:null}),attribution:attribution(),
  }),/terminal_readback_required/);
  assert.throws(()=>createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,readback:readback({authority_effect:true}),attribution:attribution(),
  }),/readback_authority_effect_invalid/);
  assert.throws(()=>createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,readback:readback({receipt:{authority_effect:true}}),attribution:attribution(),
  }),/receipt_authority_invalid/);
});

test('candidate attribution is all-or-nothing and external only',()=>{
  assert.throws(()=>createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,readback:readback(),attribution:attribution({proposal_digest:null}),
  }),/candidate_attribution_incomplete/);
  assert.throws(()=>createRsiBrowserOutcomeEpisode({
    source_sha:SOURCE,readback:readback(),attribution:attribution({external_attribution:false,authored_by_candidate:true}),
  }),/external_attribution_required/);
  const noCandidate=attribution({candidate_id:null,candidate_sha:null,proposal_digest:null,skill_digests:[]});
  const episode=createRsiBrowserOutcomeEpisode({source_sha:SOURCE,readback:readback(),attribution:noCandidate});
  assert.equal(episode.eligible_for_experience_graph,false);
  assert.equal(episode.candidate_id,null);
});

test('episode is deterministic for exact evidence and trust root keeps zero authority',()=>{
  const rb=readback();
  const attr=attribution();
  const left=createRsiBrowserOutcomeEpisode({source_sha:SOURCE,readback:rb,attribution:attr});
  const right=createRsiBrowserOutcomeEpisode({source_sha:SOURCE,readback:rb,attribution:attr});
  assert.equal(left.episode_digest,right.episode_digest);
  assert.equal(left.receipt_digest,right.receipt_digest);

  const root=rsiBrowserOutcomeIngestTrustRootSnapshot();
  assert.equal(root.terminal_receipt_readback_required,true);
  assert.equal(root.same_client_readback_required,true);
  assert.equal(root.ambiguous_outcome_learning_allowed,false);
  assert.equal(root.physical_effect_replay_allowed,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.outcome_ingest_root_digest,/^sha256:[0-9a-f]{64}$/);
});
