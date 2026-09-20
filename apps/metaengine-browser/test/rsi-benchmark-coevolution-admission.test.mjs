import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import {
  createRsiBenchmarkProvenancePolicy,
  createRsiBenchmarkTaskProvenance,
  assessRsiBenchmarkContamination,
  createRsiBenchmarkEvidenceAdmission,
} from '../src/rsi-benchmark-provenance-guard.mjs';
import {
  RsiBenchmarkCoevolutionLedger,
  createRsiBenchmarkCoevolutionProposal,
  verifyRsiBenchmarkCoevolutionProposal,
  createRsiBenchmarkCoevolutionAdmission,
  verifyRsiBenchmarkCoevolutionAdmission,
  rsiBenchmarkCoevolutionTrustRootSnapshot,
} from '../src/rsi-benchmark-coevolution-admission.mjs';

const SOURCE='a'.repeat(40);
const d=(label)=>`sha256:${crypto.createHash('sha256').update(String(label),'utf8').digest('hex')}`;
function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
const structuralDigest=(v)=>`sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;

function provenanceFixture(label='g1'){
  const policy=createRsiBenchmarkProvenancePolicy({
    policy_id:`coevolution.provenance.${label}`,
    min_resistant_tasks:8,
    min_source_families:2,
    max_public_static_fraction:0,
    external_policy_owner:true,
    authored_by_candidate:false,
  });
  const tasks=[];
  const assessments=[];
  for(let i=0;i<8;i++){
    const task=createRsiBenchmarkTaskProvenance({
      policy,
      task_id:`coevolution.task.${label}.${i+1}`,
      benchmark_id:`coevolution.benchmark.${label}`,
      benchmark_version:`generation-${label}`,
      task_prompt_digest:d(`prompt-${label}-${i}`),
      hidden_test_digest:d(`hidden-${label}-${i}`),
      source_kind:'FRESH_PRIVATE_COMMIT',
      source_family:i<4?'family.alpha':'family.beta',
      source_repository_digest:d(`source-repo-${label}-${i}`),
      candidate_repository_digest:d('candidate-repo'),
      source_commit_sha:(i%2===0?'b':'c').repeat(40),
      source_published_at:'2026-09-18T00:00:00.000Z',
      candidate_frozen_at:'2026-09-17T00:00:00.000Z',
      task_materialized_at:'2026-09-18T01:00:00.000Z',
      searchability:'NOT_SEARCHABLE',
      reference_solution_visible:false,
      hidden_tests_visible:false,
      evaluator_harness_visible:false,
      evaluator_harness_mutated_by_candidate:false,
      task_authored_by_candidate:false,
      task_selected_by_candidate:false,
      source_repository_selected_by_candidate:false,
      ingested_into_trusted_memory:false,
      ingested_into_skill_library:false,
      external_provenance_verifier:true,
      authored_by_candidate:false,
      evidence_refs:[`coevolution:provenance:${label}:${i+1}`],
    });
    tasks.push(task);
    assessments.push(assessRsiBenchmarkContamination({policy,task}));
  }
  const admission=createRsiBenchmarkEvidenceAdmission({policy,assessments,tasks});
  assert.equal(admission.eligible_for_full_holdout_evidence,true);
  return {policy,tasks,assessments,admission};
}

function generationFixture(label='g1',{
  parentGeneration=0,
  parentBenchmarkDigest=d('benchmark-parent-0'),
  proposedGeneration=1,
  proposedBenchmarkDigest=d(`benchmark-${label}`),
  trustedRuntimeDigest=d('trusted-runtime'),
  activeVerifierRootDigest=d('active-verifier'),
  anchorSetDigest=d('stable-anchor-set'),
  heldoutAnchorDigest=d('stable-heldout-anchor'),
  masteryCertified=true,
  anchorRecalibrationPass=true,
  taskQualityPass=true,
  semanticConstructionPass=true,
  noOpAblationPass=true,
  environmentFidelityPass=true,
  agenticUsabilityPass=true,
  freshnessProbePass=true,
  brokenTaskCount=0,
}={}){
  const p=provenanceFixture(label);
  const taskDigestSet=p.tasks.map(t=>t.task_provenance_digest);
  const proposal=createRsiBenchmarkCoevolutionProposal({
    proposal_id:`coevolution.proposal.${label}`,
    source_sha:SOURCE,
    benchmark_family_id:'metaengine.browser.agentic.benchmark',
    parent_generation:parentGeneration,
    parent_benchmark_digest:parentBenchmarkDigest,
    parent_generation_receipt_digest:d(`parent-receipt-${parentGeneration}`),
    proposed_generation:proposedGeneration,
    proposed_benchmark_digest:proposedBenchmarkDigest,
    task_digest_set:taskDigestSet,
    trusted_runtime_digest:trustedRuntimeDigest,
    active_verifier_root_digest:activeVerifierRootDigest,
    anchor_set_digest:anchorSetDigest,
    heldout_anchor_digest:heldoutAnchorDigest,
    mastery_policy_digest:d('mastery-policy-fixed'),
    mastery_certificate_digest:d(`mastery-certificate-${label}`),
    mastery_certified:masteryCertified,
    anchor_recalibration_receipt_digest:d(`anchor-recalibration-${label}`),
    anchor_recalibration_pass:anchorRecalibrationPass,
    task_quality_audit_digest:d(`task-quality-${label}`),
    semantic_construction_audit_digest:d(`semantic-audit-${label}`),
    no_op_ablation_digest:d(`noop-ablation-${label}`),
    environment_fidelity_audit_digest:d(`environment-fidelity-${label}`),
    agentic_usability_audit_digest:d(`agentic-usability-${label}`),
    freshness_probe_digest:d(`freshness-${label}`),
    broken_task_count:brokenTaskCount,
    task_quality_pass:taskQualityPass,
    semantic_construction_pass:semanticConstructionPass,
    no_op_ablation_pass:noOpAblationPass,
    environment_fidelity_pass:environmentFidelityPass,
    agentic_usability_pass:agenticUsabilityPass,
    freshness_probe_pass:freshnessProbePass,
    benchmark_provenance_policy:p.policy,
    benchmark_provenance_admission:p.admission,
    benchmark_provenance_assessments:p.assessments,
    benchmark_provenance_tasks:p.tasks,
    external_benchmark_curator:true,
    authored_by_candidate:false,
  });
  const admission=createRsiBenchmarkCoevolutionAdmission({
    admission_id:`coevolution.admission.${label}`,
    proposal,
    benchmark_provenance_policy:p.policy,
    benchmark_provenance_admission:p.admission,
    benchmark_provenance_assessments:p.assessments,
    benchmark_provenance_tasks:p.tasks,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  return {...p,provenanceAdmission:p.admission,proposal,admission};
}

test('mastery-throttled generation is only eligible for shadow benchmark trial',()=>{
  const fx=generationFixture();
  const proposal=verifyRsiBenchmarkCoevolutionProposal(fx.proposal,{
    benchmark_provenance_policy:fx.policy,
    benchmark_provenance_admission:fx.provenanceAdmission,
    benchmark_provenance_assessments:fx.assessments,
    benchmark_provenance_tasks:fx.tasks,
  });
  assert.equal(proposal.clean_generation_evidence,true);
  assert.equal(proposal.proposed_generation,proposal.parent_generation+1);
  assert.equal(proposal.current_benchmark_remains_active,true);
  assert.equal(proposal.proposed_benchmark_shadow_only,true);
  assert.equal(proposal.raw_task_content_present,false);
  assert.equal(proposal.benchmark_activation_authority,false);
  assert.equal(proposal.verifier_replacement_authority,false);

  const admission=verifyRsiBenchmarkCoevolutionAdmission(fx.admission,{
    proposal:fx.proposal,
    benchmark_provenance_policy:fx.policy,
    benchmark_provenance_admission:fx.provenanceAdmission,
    benchmark_provenance_assessments:fx.assessments,
    benchmark_provenance_tasks:fx.tasks,
  });
  assert.equal(admission.state,'ELIGIBLE_FOR_SHADOW_BENCHMARK_TRIAL');
  assert.equal(admission.eligible_for_shadow_benchmark_trial,true);
  assert.equal(admission.admission_can_activate_benchmark,false);
  assert.equal(admission.active_verifier_remains_unchanged,true);
  assert.equal(admission.authority_effect,false);
});

test('mastery anchor or validation failure cannot become eligible',()=>{
  for(const [label,overrides,blocker] of [
    ['mastery',{masteryCertified:false},'MASTERY_NOT_CERTIFIED'],
    ['anchor',{anchorRecalibrationPass:false},'ANCHOR_RECALIBRATION_FAILED'],
    ['quality',{taskQualityPass:false},'TASK_QUALITY_AUDIT_FAILED'],
    ['semantic',{semanticConstructionPass:false},'SEMANTIC_CONSTRUCTION_AUDIT_FAILED'],
    ['noop',{noOpAblationPass:false},'NO_OP_ABLATION_FAILED'],
    ['environment',{environmentFidelityPass:false},'ENVIRONMENT_FIDELITY_AUDIT_FAILED'],
    ['agentic',{agenticUsabilityPass:false},'AGENTIC_USABILITY_AUDIT_FAILED'],
    ['freshness',{freshnessProbePass:false},'FRESHNESS_PROBE_FAILED'],
  ]){
    const fx=generationFixture(label,overrides);
    assert.equal(fx.proposal.clean_generation_evidence,false,label);
    assert.ok(fx.proposal.blockers.includes(blocker),blocker);
    assert.equal(fx.admission.state,'BENCHMARK_GENERATION_REJECTED');
    assert.equal(fx.admission.eligible_for_shadow_benchmark_trial,false);
  }
});

test('generation must advance exactly by one and benchmark identity must change',()=>{
  assert.throws(()=>generationFixture('skip',{proposedGeneration:2}),/generation_must_advance_by_one/);
  const same=d('same-benchmark');
  assert.throws(()=>generationFixture('same',{parentBenchmarkDigest:same,proposedBenchmarkDigest:same}),/benchmark_digest_must_change/);
});

test('broken task evidence fails before benchmark generation admission',()=>{
  assert.throws(()=>generationFixture('broken',{brokenTaskCount:1}),/broken_task_present/);
});

test('candidate cannot author benchmark generation or admission',()=>{
  const p=provenanceFixture('candidate');
  assert.throws(()=>createRsiBenchmarkCoevolutionProposal({
    proposal_id:'coevolution.proposal.candidate',
    source_sha:SOURCE,
    benchmark_family_id:'metaengine.browser.agentic.benchmark',
    parent_generation:0,
    parent_benchmark_digest:d('parent'),
    parent_generation_receipt_digest:d('parent-receipt'),
    proposed_generation:1,
    proposed_benchmark_digest:d('candidate-proposed'),
    task_digest_set:p.tasks.map(t=>t.task_provenance_digest),
    trusted_runtime_digest:d('trusted-runtime'),
    active_verifier_root_digest:d('active-verifier'),
    anchor_set_digest:d('anchor'),
    heldout_anchor_digest:d('heldout'),
    mastery_policy_digest:d('mastery-policy'),
    mastery_certificate_digest:d('mastery-certificate'),
    mastery_certified:true,
    anchor_recalibration_receipt_digest:d('recalibration'),
    anchor_recalibration_pass:true,
    task_quality_audit_digest:d('quality'),
    semantic_construction_audit_digest:d('semantic'),
    no_op_ablation_digest:d('noop'),
    environment_fidelity_audit_digest:d('environment'),
    agentic_usability_audit_digest:d('agentic'),
    freshness_probe_digest:d('freshness'),
    broken_task_count:0,
    task_quality_pass:true,
    semantic_construction_pass:true,
    no_op_ablation_pass:true,
    environment_fidelity_pass:true,
    agentic_usability_pass:true,
    freshness_probe_pass:true,
    benchmark_provenance_policy:p.policy,
    benchmark_provenance_admission:p.admission,
    benchmark_provenance_assessments:p.assessments,
    benchmark_provenance_tasks:p.tasks,
    external_benchmark_curator:false,
    authored_by_candidate:true,
  }),/external_curator_required/);
});

test('append-only coevolution ledger preserves exact lineage and stable grounding across restart',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-benchmark-coevolution-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await ledger.init();

  const g1=generationFixture('g1');
  assert.equal((await ledger.add(g1.admission)).state,'ELIGIBLE_FOR_SHADOW_BENCHMARK_TRIAL');

  const g2=generationFixture('g2',{
    parentGeneration:1,
    parentBenchmarkDigest:g1.admission.proposed_benchmark_digest,
    proposedGeneration:2,
    proposedBenchmarkDigest:d('benchmark-g2'),
  });
  assert.equal((await ledger.add(g2.admission)).state,'ELIGIBLE_FOR_SHADOW_BENCHMARK_TRIAL');

  const snap=ledger.snapshot();
  assert.equal(snap.row_count,2);
  assert.equal(snap.current_shadow_generation,2);
  assert.equal(snap.current_shadow_benchmark_digest,g2.admission.proposed_benchmark_digest);
  assert.equal(snap.active_benchmark_digest,null);
  assert.equal(snap.ledger_can_activate_benchmark,false);

  const restored=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await restored.init();
  assert.equal(restored.snapshot().row_count,2);
  assert.equal((await restored.add(g2.admission)).state,'IDEMPOTENT');
});

test('ledger rejects lineage discontinuity and grounding drift',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-benchmark-coevolution-drift-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiBenchmarkCoevolutionLedger({statePath:path.join(dir,'ledger.json'),source_sha:SOURCE});
  await ledger.init();
  const g1=generationFixture('drift-g1');
  await ledger.add(g1.admission);

  const wrongParent=generationFixture('wrong-parent',{
    parentGeneration:1,
    parentBenchmarkDigest:d('not-parent'),
    proposedGeneration:2,
  });
  await assert.rejects(()=>ledger.add(wrongParent.admission),/lineage_discontinuity/);

  const drift=generationFixture('runtime-drift',{
    parentGeneration:1,
    parentBenchmarkDigest:g1.admission.proposed_benchmark_digest,
    proposedGeneration:2,
    trustedRuntimeDigest:d('different-runtime'),
  });
  await assert.rejects(()=>ledger.add(drift.admission),/grounding_drift/);
});

test('failed durable write cannot create phantom benchmark-generation evidence',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-benchmark-coevolution-fail-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const statePath=path.join(dir,'ledger.json');
  const ledger=new RsiBenchmarkCoevolutionLedger({statePath,source_sha:SOURCE});
  await ledger.init();
  const g1=generationFixture('persist-fail');

  await fs.mkdir(statePath);
  await assert.rejects(()=>ledger.add(g1.admission));
  assert.equal(ledger.snapshot().row_count,0);
  assert.equal(ledger.snapshot().current_shadow_generation,null);
  assert.deepEqual(ledger.admissions(),[]);
});

test('self-rehashed admission cannot weaken activation policy',async(t)=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'rsi-benchmark-coevolution-policy-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const ledger=new RsiBenchmarkCoevolutionLedger({statePath:path.join(dir,'ledger.json'),source_sha:SOURCE});
  await ledger.init();
  const g1=generationFixture('policy');
  const badCore={...g1.admission,admission_can_activate_benchmark:true};
  delete badCore.admission_digest;
  const bad={...badCore,admission_digest:structuralDigest(badCore)};
  await assert.rejects(()=>ledger.add(bad),/ledger_admission_policy_invalid/);
  assert.equal(ledger.snapshot().row_count,0);
});

test('benchmark coevolution trust root reuses provenance guard and remains zero-authority',()=>{
  const root=rsiBenchmarkCoevolutionTrustRootSnapshot();
  assert.equal(root.existing_benchmark_provenance_guard_reused,true);
  assert.equal(root.mastery_certificate_required,true);
  assert.equal(root.exact_generation_increment_required,true);
  assert.equal(root.stable_trusted_runtime_required,true);
  assert.equal(root.stable_active_verifier_required,true);
  assert.equal(root.stable_anchor_set_required,true);
  assert.equal(root.anchor_recalibration_required,true);
  assert.equal(root.task_quality_audit_required,true);
  assert.equal(root.semantic_construction_audit_required,true);
  assert.equal(root.no_op_ablation_required,true);
  assert.equal(root.environment_fidelity_audit_required,true);
  assert.equal(root.agentic_usability_audit_required,true);
  assert.equal(root.raw_task_content_persisted,false);
  assert.equal(root.current_benchmark_remains_active,true);
  assert.equal(root.proposed_benchmark_shadow_only,true);
  assert.equal(root.benchmark_activation_authorized,false);
  assert.equal(root.verifier_replacement_authorized,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.benchmark_coevolution_root_digest,/^sha256:[0-9a-f]{64}$/);
});
