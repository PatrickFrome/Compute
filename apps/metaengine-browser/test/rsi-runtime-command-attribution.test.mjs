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

function readback(overrides={}) {
  return {
    schema:'metaengine.rsi.result-receipt-readback.v1',
    command_id:COMMAND,
    found:true,
    terminal:true,
    status:'COMPLETED',
    receipt:{
      schema:'metaengine.native-supervisor.command-receipt.v2',
      command_id:COMMAND,
      action:'SCROLL',
      platform:'CHATGPT',
      result:{moved:true},
      effect_outcome:'CONFIRMED',
      lane:'MUTATION',
      effect_key:'effect-1',
      execution_ms:12.5,
      recorded_at:'2026-09-18T17:00:00.000Z',
      authority_effect:false,
      ...(overrides.receipt||{}),
    },
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

function genericAttribution(overrides={}) {
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
    ...overrides,
  };
}

function trustedRegistration(overrides={}) {
  return {
    command_id:COMMAND,
    task_id:'task.rsi.candidate.1',
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
    ...overrides,
  };
}

test('candidate credit is admitted only through durable trusted command correlation', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-command-attribution-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try {
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();

    await assert.rejects(
      runtime.ingestBrowserOutcome({
        readback:readback(),
        attribution:genericAttribution({
          candidate_id:cid('c'),
          candidate_sha:'c'.repeat(40),
          proposal_digest:d('4'),
          skill_digests:[d('5')],
        }),
      }),
      /candidate_attribution_requires_trusted_registry/,
    );

    const registered=await runtime.registerBrowserCommandAttribution(trustedRegistration());
    assert.equal(registered.candidate_id,cid('c'));
    assert.equal(runtime.snapshot().command_attribution_registry.active_count,1);

    const episode=await runtime.ingestBrowserOutcome({
      readback:readback(),
      attribution:genericAttribution(),
    });
    assert.equal(episode.candidate_id,cid('c'));
    assert.equal(episode.candidate_sha,'c'.repeat(40));
    assert.equal(episode.proposal_digest,d('4'));
    assert.deepEqual(episode.skill_digests,[d('5')]);
    assert.equal(episode.eligible_for_experience_graph,true);
    assert.equal(episode.eligible_for_skill_evidence,true);
    assert.equal(runtime.snapshot().command_attribution_registry.active_count,0);
    assert.equal(runtime.snapshot().command_attribution_registry.consumed_count,1);

    const restarted=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await restarted.start();
    assert.equal(restarted.snapshot().command_attribution_registry.active_count,0);
    assert.equal(restarted.snapshot().command_attribution_registry.registered_count,1);
    assert.equal(restarted.snapshot().command_attribution_registry.consumed_count,1);
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('uncorrelated generic Browser outcomes remain observational and cannot become candidate learning cases', async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-generic-outcome-'));
  const ledgerPath=path.join(root,'rsi.jsonl');
  try {
    const runtime=new RsiRuntimeService({source_sha:SOURCE,ledgerPath});
    await runtime.start();
    const episode=await runtime.ingestBrowserOutcome({
      readback:readback(),
      attribution:genericAttribution(),
    });
    assert.equal(episode.candidate_id,null);
    assert.equal(episode.eligible_for_experience_graph,false);
    assert.equal(episode.eligible_for_skill_evidence,false);
    assert.equal(runtime.snapshot().browser_outcome_ingest.learning_eligible_count,0);
    assert.equal(runtime.snapshot().command_attribution_registry.active_count,0);
  } finally {
    await fs.rm(root,{recursive:true,force:true});
  }
});
