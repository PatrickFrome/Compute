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

function readback(command=COMMAND) {
  return {
    schema:'metaengine.rsi.result-receipt-readback.v1',
    command_id:command,
    found:true,
    terminal:true,
    status:'COMPLETED',
    receipt:{
      schema:'metaengine.native-supervisor.command-receipt.v2',
      command_id:command,
      action:'SCROLL',
      platform:'CHATGPT',
      result:null,
      effect_outcome:'CONFIRMED',
      lane:'MUTATION',
      effect_key:`effect-${command.slice(0,8)}`,
      execution_ms:10,
      recorded_at:'2026-09-18T17:06:00.000Z',
      authority_effect:false,
    },
    error:null,
    execution_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  };
}

function genericAttribution() {
  return {
    task_id:'browser.command.generic',
    task_signature_digest:d('1'),
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

function registration(command=COMMAND) {
  return {
    command_id:command,
    task_id:'task.rsi.credit.1',
    task_signature_digest:d('2'),
    environment_fingerprint:'env.metaengine.browser.v1',
    model_family:'GPT_5_6_SOL',
    producer:'DB_LEASE_SUPERVISOR',
    lease_evidence_digest:d('3'),
    candidate_id:cid('c'),
    candidate_sha:'c'.repeat(40),
    proposal_digest:d('4'),
    skill_digests:[d('5')],
    external_attribution:true,
    authored_by_candidate:false,
  };
}

function credit(overrides={}) {
  return {
    credit_id:'credit.runtime.turn.1',
    assignment_method:'HIERARCHICAL_EXTERNAL',
    step_credit:0.5,
    confidence:0.95,
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
    evidence_refs:['evidence:terminal-receipt','evidence:credit-assignment'],
    external_credit_assigner:true,
    authored_by_candidate:false,
    ...overrides,
  };
}

test('runtime turns a persisted trusted outcome into durable canonical experience and replays it after restart', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-credit-runtime-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try {
    const first=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await first.start();
    await first.registerBrowserCommandAttribution(registration());
    const episode=await first.ingestBrowserOutcome({
      readback:readback(),
      attribution:genericAttribution(),
    });
    assert.equal(episode.eligible_for_experience_graph,true);
    assert.equal(first.snapshot().trusted_credit.pending_learning_outcome_count,1);

    const admission=await first.recordTrustedCredit({
      outcome_episode_digest:episode.episode_digest,
      assignment:credit(),
    });
    assert.equal(admission.experience_case.outcome,'SUCCESS');
    assert.equal(first.snapshot().trusted_credit.pending_learning_outcome_count,0);
    assert.equal(first.snapshot().trusted_credit.credited_outcome_count,1);
    assert.equal(first.snapshot().trusted_credit.experience_graph_case_count,1);
    const graphDigest=first.snapshot().trusted_credit.experience_graph_snapshot_digest;
    assert.ok(graphDigest);

    await assert.rejects(
      first.recordTrustedCredit({
        outcome_episode_digest:episode.episode_digest,
        assignment:credit({credit_id:'credit.runtime.duplicate'}),
      }),
      /outcome_credit_already_recorded/,
    );

    const second=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await second.start();
    assert.equal(second.snapshot().trusted_credit.pending_learning_outcome_count,0);
    assert.equal(second.snapshot().trusted_credit.credited_outcome_count,1);
    assert.equal(second.snapshot().trusted_credit.experience_graph_case_count,1);
    assert.equal(second.snapshot().trusted_credit.experience_graph_snapshot_digest,graphDigest);
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('runtime refuses credit for an outcome that never became durable learning evidence', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-credit-missing-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try {
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    const generic=await runtime.ingestBrowserOutcome({
      readback:readback(),
      attribution:genericAttribution(),
    });
    assert.equal(generic.eligible_for_experience_graph,false);
    await assert.rejects(
      runtime.recordTrustedCredit({
        outcome_episode_digest:generic.episode_digest,
        assignment:credit(),
      }),
      /persisted_learning_outcome_required/,
    );
    assert.equal(runtime.snapshot().trusted_credit.experience_graph_case_count,0);
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});
