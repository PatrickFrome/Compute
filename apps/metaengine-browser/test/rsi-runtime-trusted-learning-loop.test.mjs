
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const SOURCE='a'.repeat(40);
const COMMAND='11111111-1111-4111-8111-111111111111';
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function registration(command=COMMAND){
  return {
    command_id:command,
    task_id:'task.release.aligned.learning.1',
    task_signature_digest:d('1'),
    environment_fingerprint:'env.metaengine.browser.v1',
    model_family:'GPT_5_6_SOL',
    producer:'DB_LEASE_SUPERVISOR',
    lease_evidence_digest:d('2'),
    candidate_id:cid('c'),
    candidate_sha:'c'.repeat(40),
    proposal_digest:d('3'),
    skill_digests:[d('4')],
    external_attribution:true,
    authored_by_candidate:false,
  };
}

function genericAttribution(){
  return {
    task_id:'browser.command.generic',
    task_signature_digest:d('5'),
    environment_fingerprint:'env.metaengine.browser.v1',
    model_family:'NATIVE_SUPERVISOR',
    candidate_id:null,
    candidate_sha:null,
    proposal_digest:null,
    skill_digests:[],
    external_attribution:true,
    authored_by_candidate:false,
  };
}

function readback({command=COMMAND,status='COMPLETED',effect_outcome='CONFIRMED',error=null}={}){
  return {
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
      effect_outcome,
      lane:'MUTATION',
      effect_key:'effect-'+command.slice(0,8),
      execution_ms:11,
      recorded_at:'2026-09-18T17:52:00.000Z',
      authority_effect:false,
    },
    error,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}

function creditAssignment(){
  return {
    credit_id:'credit.release.aligned.learning.1',
    assignment_method:'HIERARCHICAL_EXTERNAL',
    step_credit:0.6,
    confidence:0.97,
    attempt_index:1,
    challenge_family:'BROWSER_RUNTIME',
    hidden_manifest_digest:d('6'),
    execution_signature_digest:d('7'),
    failure_codes:[],
    mechanism_tags:['SEMANTIC_ACTION'],
    lesson_digests:[d('8')],
    attribution_digests:[],
    transfer_receipt_digests:[],
    evidence_digest:d('9'),
    evidence_refs:['evidence:terminal-receipt','evidence:external-credit'],
    external_credit_assigner:true,
    authored_by_candidate:false,
  };
}

test('release-aligned runtime closes trusted command outcome into durable contextual experience',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-trusted-learning-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const first=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await first.start();

    await assert.rejects(
      first.ingestBrowserOutcome({
        readback:readback(),
        attribution:{...genericAttribution(),candidate_id:cid('c'),candidate_sha:'c'.repeat(40),proposal_digest:d('3')},
      }),
      /candidate_attribution_requires_trusted_registry/,
    );

    await first.registerBrowserCommandAttribution(registration());
    const episode=await first.ingestBrowserOutcome({
      readback:readback(),
      attribution:genericAttribution(),
    });
    assert.equal(episode.eligible_for_experience_graph,true);
    assert.equal(episode.candidate_id,cid('c'));
    assert.equal(first.snapshot().command_attribution_registry.active_count,0);
    assert.equal(first.snapshot().trusted_credit.pending_learning_outcome_count,1);

    const admission=await first.recordTrustedCredit({
      outcome_episode_digest:episode.episode_digest,
      assignment:creditAssignment(),
    });
    assert.equal(admission.append_only_graph_admission,true);
    assert.equal(admission.candidate_can_write_graph,false);
    assert.equal(first.snapshot().trusted_credit.pending_learning_outcome_count,0);
    assert.equal(first.snapshot().trusted_credit.credited_outcome_count,1);
    assert.equal(first.snapshot().trusted_credit.experience_graph_case_count,1);

    const graphDigest=first.snapshot().trusted_credit.experience_graph_snapshot_digest;
    const second=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await second.start();
    assert.equal(second.snapshot().trusted_credit.credited_outcome_count,1);
    assert.equal(second.snapshot().trusted_credit.experience_graph_case_count,1);
    assert.equal(second.snapshot().trusted_credit.experience_graph_snapshot_digest,graphDigest);
    assert.equal(second.snapshot().execution_authority,false);
    assert.equal(second.snapshot().scheduler_authority,false);
    assert.equal(second.snapshot().promotion_authority,false);
    assert.equal(second.snapshot().self_update_authority,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('ambiguous physical outcome is consumed but cannot enter trusted learning or credit',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-ambiguous-learning-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try{
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    await runtime.registerBrowserCommandAttribution(registration());
    const episode=await runtime.ingestBrowserOutcome({
      readback:readback({status:'FAILED',effect_outcome:'AMBIGUOUS',error:'renderer_lost'}),
      attribution:genericAttribution(),
    });
    assert.equal(episode.quarantined,true);
    assert.equal(episode.eligible_for_experience_graph,false);
    assert.equal(episode.ambiguous_outcome_learning_allowed,false);
    assert.equal(episode.physical_effect_replay_allowed,false);
    assert.equal(runtime.snapshot().command_attribution_registry.active_count,0);
    assert.equal(runtime.snapshot().trusted_credit.pending_learning_outcome_count,0);
    await assert.rejects(
      runtime.recordTrustedCredit({
        outcome_episode_digest:episode.episode_digest,
        assignment:creditAssignment(),
      }),
      /persisted_learning_outcome_required/,
    );
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
