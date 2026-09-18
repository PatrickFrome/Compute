import assert from 'node:assert/strict';
import test from 'node:test';

import { BROWSER_BRAIN_WORKING_MEMORY_SCHEMA } from '../src/browser-brain-working-memory.mjs';
import { RsiShadowObserver } from '../src/rsi-shadow-observer.mjs';
import { RsiRuntimeImprovementFrontier } from '../src/rsi-runtime-improvement-frontier.mjs';
import { createRsiExperienceContextPlan } from '../src/rsi-experience-context-planner.mjs';
import {
  createRsiCandidateSynthesisRequest,
  verifyRsiCandidateSynthesisRequest,
  createRsiCandidateMutationProposal,
  verifyRsiCandidateMutationProposal,
  prepareRsiContextAwareCandidateBuild,
  verifyRsiContextAwareCandidateBuild,
  rsiContextAwareCandidateTrustRootSnapshot,
} from '../src/rsi-context-aware-candidate-synthesis.mjs';

const SOURCE='a'.repeat(40);
const TARGET='apps/metaengine-browser/src/browser-brain-working-memory.mjs';
const d=(c)=>`sha256:${c.repeat(64)}`;

function brain() {
  return {
    schema:BROWSER_BRAIN_WORKING_MEMORY_SCHEMA,
    global:{process_revision:2,cognitive_sequence:3,dropped_events:0},
    cells:[{
      tab_id:'tab_00000000-0000-4000-8000-000000000123',
      status:'READY',
      binding:null,
      last_event:null,
      last_command:{status:'AMBIGUOUS',effect_outcome:'AMBIGUOUS'},
      last_semantic_sequence:null,
      last_observed_at:'2026-09-18T17:20:00.000Z',
      attention_reason:null,
      execution_authority:false,
      authority_effect:false,
    }],
    raw_dom_stored:false,
    raw_network_stored:false,
    page_text_stored:false,
    input_values_stored:false,
    command_payload_stored:false,
    execution_authority:false,
    command_leasing:false,
    automatic_effect_retry_allowed:false,
    authority_effect:false,
  };
}

function fixture() {
  const observer=new RsiShadowObserver({source_sha:SOURCE,clock:()=>Date.parse('2026-09-18T17:20:00Z')});
  const observation=observer.observeBrainSnapshot(brain());
  const frontier=new RsiRuntimeImprovementFrontier();
  const [entry]=frontier.prepare(observation);
  assert.ok(entry);
  const context=createRsiExperienceContextPlan({frontier_entry:entry});
  const request=createRsiCandidateSynthesisRequest({
    context_plan:context,
    frontier_entry:entry,
    generation:1,
    strategy:'CONTEXT_GUIDED_DIVERSE_PROPOSAL',
  });
  const proposal=createRsiCandidateMutationProposal({
    synthesis_request:request,
    proposal:{
      proposal_id:'proposal:ambiguous-command:1',
      mutations:[{path:TARGET,change:'MODIFY'}],
      proposal_evidence_digest:d('1'),
      producer_receipt_digest:d('2'),
      proposer_class:'EXTERNAL_DEVOS_PLANNER',
      external_proposer_verified:true,
      authored_by_candidate:false,
    },
  });
  const sourceSnapshot={
    schema:'metaengine.devos.packaged-source-snapshot.v1',
    repository:'PatrickFrome/Compute',
    head:SOURCE,
    ref:SOURCE,
    bounded:true,
    arbitrary_path_copy:false,
    process_spawn_used:false,
    authority_effect:false,
    source_files:[TARGET],
    source_file_count:1,
  };
  return {entry,context,request,proposal,sourceSnapshot};
}

test('context-aware request contains bounded verified memory references but no raw patch or source authority',()=>{
  const {request}=fixture();
  verifyRsiCandidateSynthesisRequest(request);
  assert.equal(request.source_sha,SOURCE);
  assert.equal(request.experience_mode,'NO_VERIFIED_EXPERIENCE');
  assert.equal(request.selected_experience_count,0);
  assert.equal(request.raw_patch_requested,false);
  assert.equal(request.raw_source_persisted_in_request,false);
  assert.equal(request.hidden_evaluation_manifest_exposed,false);
  assert.equal(request.model_or_page_output_is_authority,false);
  assert.equal(request.existing_devos_scheduler_required,true);
  assert.equal(request.request_is_execution_authority,false);
});

test('external typed mutation proposal remains non-authoritative and cannot carry generic CREATE',()=>{
  const {request,proposal}=fixture();
  verifyRsiCandidateMutationProposal(proposal,request);
  assert.deepEqual(proposal.mutations,[{path:TARGET,change:'MODIFY'}]);
  assert.equal(proposal.raw_patch_present,false);
  assert.equal(proposal.code_content_present,false);
  assert.equal(proposal.proposal_is_build_authority,false);
  assert.equal(proposal.execution_authority,false);

  assert.throws(()=>createRsiCandidateMutationProposal({
    synthesis_request:request,
    proposal:{
      proposal_id:'proposal:create:1',
      mutations:[{path:'apps/metaengine-browser/src/new-helper.mjs',change:'CREATE'}],
      proposal_evidence_digest:d('1'),
      producer_receipt_digest:d('2'),
      proposer_class:'EXTERNAL_DEVOS_PLANNER',
      external_proposer_verified:true,
      authored_by_candidate:false,
    },
  }),/generic_create_requires_separate_absence_proof/);
});

test('context-aware build delegates all path and workspace authority to existing isolated candidate builder',()=>{
  const {entry,request,proposal,sourceSnapshot}=fixture();
  const build=prepareRsiContextAwareCandidateBuild({
    synthesis_request:request,
    frontier_entry:entry,
    source_snapshot:sourceSnapshot,
    mutation_proposal:proposal,
    sequence:1,
    requested_backend:'VERCEL_SANDBOX',
  });
  verifyRsiContextAwareCandidateBuild(build,{synthesis_request:request,mutation_proposal:proposal});
  assert.deepEqual(build.exact_mutation_set,[{path:TARGET,change:'MODIFY'}]);
  assert.equal(build.generic_build_plan.source.parent_sha,SOURCE);
  assert.equal(build.generic_build_plan.workspace_contract.authority,'EXISTING_DEVOS_ONLY');
  assert.equal(build.devos_lease_required_before_materialization,true);
  assert.equal(build.candidate_materialized,false);
  assert.equal(build.execution_authority,false);
  assert.equal(build.promotion_authority,false);
});

test('proposal cannot mutate immutable RSI roots even with valid external-proposer metadata',()=>{
  const {entry,request,sourceSnapshot}=fixture();
  const immutable='apps/metaengine-browser/src/rsi-runtime-service.mjs';
  const proposal=createRsiCandidateMutationProposal({
    synthesis_request:request,
    proposal:{
      proposal_id:'proposal:immutable:1',
      mutations:[{path:immutable,change:'MODIFY'}],
      proposal_evidence_digest:d('3'),
      producer_receipt_digest:d('4'),
      proposer_class:'EXTERNAL_DEVOS_PLANNER',
      external_proposer_verified:true,
      authored_by_candidate:false,
    },
  });
  const snapshot={...sourceSnapshot,source_files:[immutable],source_file_count:1};
  assert.throws(()=>prepareRsiContextAwareCandidateBuild({
    synthesis_request:request,
    frontier_entry:entry,
    source_snapshot:snapshot,
    mutation_proposal:proposal,
  }),/immutable_path_forbidden/);
});

test('proposal target must be present in trusted bounded source snapshot before generic modification',()=>{
  const {entry,request,proposal,sourceSnapshot}=fixture();
  const snapshot={...sourceSnapshot,source_files:['apps/metaengine-browser/src/main.mjs'],source_file_count:1};
  assert.throws(()=>prepareRsiContextAwareCandidateBuild({
    synthesis_request:request,
    frontier_entry:entry,
    source_snapshot:snapshot,
    mutation_proposal:proposal,
  }),/mutation_target_not_in_source_snapshot/);
});

test('candidate synthesis trust root is only a planning boundary',()=>{
  const root=rsiContextAwareCandidateTrustRootSnapshot();
  assert.equal(root.verified_experience_context_required,true);
  assert.equal(root.precommitted_hypothesis_required,true);
  assert.equal(root.external_proposer_receipt_required,true);
  assert.equal(root.raw_model_patch_is_authority,false);
  assert.equal(root.existing_isolated_candidate_builder_required,true);
  assert.equal(root.devos_lease_required_before_materialization,true);
  assert.equal(root.candidate_materialized_by_this_module,false);
  assert.equal(root.no_second_scheduler,true);
  assert.equal(root.execution_authority,false);
  assert.equal(root.promotion_authority,false);
  assert.equal(root.self_update_authority,false);
});
