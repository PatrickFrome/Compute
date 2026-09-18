import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  RsiVerifierEvolutionShadowLedger,
  createRsiVerifierEvolutionCandidate,
  createRsiVerifierEvolutionExternalReceipt,
  createRsiVerifierEvolutionShadowAdmission,
  rsiVerifierEvolutionShadowTrustRootSnapshot,
  verifyRsiVerifierEvolutionShadowAdmission,
} from '../src/rsi-verifier-evolution-shadow-admission.mjs';

const SOURCE='a'.repeat(40);
const dg=(v)=>`sha256:${crypto.createHash('sha256').update(JSON.stringify(v),'utf8').digest('hex')}`;

function candidate(){
  return createRsiVerifierEvolutionCandidate({
    source_sha:SOURCE,
    candidate_id:'verifier.shadow.candidate.1',
    predecessor_verifier_root_digest:dg({root:'predecessor'}),
    candidate_verifier_root_digest:dg({root:'candidate'}),
    constitution_digest:dg({constitution:'rsi'}),
    candidate_package_digest:dg({pkg:'candidate'}),
    training_evidence_digest:dg({training:'archive'}),
    self_authored_eval_digest:dg({self:'advisory'}),
    external_candidate_builder:true,
    authored_by_candidate:false,
  });
}

function receipt(role,c,{verdict='PASS',patch={}}={}){
  const evaluatorRoot=role==='PREDECESSOR'
    ? c.predecessor_verifier_root_digest
    : dg({root:'secondary'});
  const defaults={
    receipt_id:`verifier.shadow.receipt.${role.toLowerCase()}`,
    candidate:c,
    evaluator_role:role,
    evaluator_root_digest:evaluatorRoot,
    hidden_suite_root_digest:dg({suite:'hidden-root'}),
    hidden_acceptance_digest:dg({suite:'acceptance'}),
    sabotage_suite_digest:dg({suite:'sabotage'}),
    transfer_holdout_digest:dg({suite:'transfer'}),
    trajectory_integrity_digest:dg({suite:'trajectory'}),
    legibility_holdout_digest:dg({suite:'legibility'}),
    challenge_archive_digest:dg({archive:'adversarial-counterexamples'}),
    acceptance_pass:true,
    sabotage_pass:true,
    transfer_pass:true,
    trajectory_integrity_pass:true,
    legibility_pass:true,
    monitorability_nonregression_pass:true,
    constitution_match:true,
    identity_match:true,
    discovered_exploit_count:0,
    sabotage_signal_count:0,
    ambiguous_case_count:0,
    verdict,
    evidence_refs:[`verifier:shadow:${role.toLowerCase()}:1`],
    external_evaluator:true,
    authored_by_candidate:false,
  };
  return createRsiVerifierEvolutionExternalReceipt({...defaults,...patch});
}

test('dual independent external verifiers can admit only verifier-shadow status',()=>{
  const c=candidate();
  const p=receipt('PREDECESSOR',c);
  const s=receipt('SECONDARY',c);
  const admission=createRsiVerifierEvolutionShadowAdmission({
    admission_id:'verifier.shadow.admission.1',
    candidate:c,
    predecessor_receipt:p,
    secondary_receipt:s,
    external_admission_owner:true,
    authored_by_candidate:false,
  });
  verifyRsiVerifierEvolutionShadowAdmission(admission,{
    candidate:c,predecessor_receipt:p,secondary_receipt:s,
  });
  assert.equal(admission.state,'QUALIFIED_FOR_VERIFIER_SHADOW_ONLY');
  assert.equal(admission.qualified_for_verifier_shadow_only,true);
  assert.equal(admission.active_verifier_remains_predecessor,true);
  assert.equal(admission.candidate_verifier_shadow_only,true);
  assert.equal(admission.verifier_replacement_authorized,false);
  assert.equal(admission.verifier_activation_authorized,false);
  assert.equal(admission.promotion_authority,false);
  assert.equal(admission.self_update_authority,false);
  assert.equal(admission.authority_effect,false);
});

test('candidate cannot self-verify or reuse predecessor as secondary verifier',()=>{
  const c=candidate();
  assert.throws(()=>createRsiVerifierEvolutionExternalReceipt({
    receipt_id:'verifier.shadow.receipt.self',
    candidate:c,
    evaluator_role:'SECONDARY',
    evaluator_root_digest:c.candidate_verifier_root_digest,
    hidden_suite_root_digest:dg({suite:'hidden-root'}),
    hidden_acceptance_digest:dg({suite:'acceptance'}),
    sabotage_suite_digest:dg({suite:'sabotage'}),
    transfer_holdout_digest:dg({suite:'transfer'}),
    trajectory_integrity_digest:dg({suite:'trajectory'}),
    legibility_holdout_digest:dg({suite:'legibility'}),
    challenge_archive_digest:dg({archive:'adversarial-counterexamples'}),
    acceptance_pass:true,sabotage_pass:true,transfer_pass:true,trajectory_integrity_pass:true,
    legibility_pass:true,monitorability_nonregression_pass:true,constitution_match:true,identity_match:true,
    verdict:'PASS',evidence_refs:['verifier:self'],external_evaluator:true,authored_by_candidate:false,
  }),/candidate_cannot_self_verify/);

  const p=receipt('PREDECESSOR',c);
  const s=receipt('SECONDARY',c,{patch:{
    evaluator_root_digest:c.predecessor_verifier_root_digest,
    receipt_id:'verifier.shadow.receipt.secondary.alias',
  }});
  assert.throws(()=>createRsiVerifierEvolutionShadowAdmission({
    admission_id:'verifier.shadow.admission.alias',
    candidate:c,predecessor_receipt:p,secondary_receipt:s,
    external_admission_owner:true,authored_by_candidate:false,
  }),/secondary_root_not_independent/);
});

test('hidden-suite disagreement and constitution drift fail closed',()=>{
  const c=candidate();
  const p=receipt('PREDECESSOR',c);
  const s=receipt('SECONDARY',c,{patch:{
    hidden_suite_root_digest:dg({suite:'other-hidden-root'}),
  }});
  assert.throws(()=>createRsiVerifierEvolutionShadowAdmission({
    admission_id:'verifier.shadow.admission.hidden-drift',
    candidate:c,predecessor_receipt:p,secondary_receipt:s,
    external_admission_owner:true,authored_by_candidate:false,
  }),/hidden_suite_root_digest_mismatch/);

  const s2Base=receipt('SECONDARY',c);
  const s2Core={...s2Base,constitution_digest:dg({constitution:'mutated'})};
  delete s2Core.receipt_digest;
  const s2={...s2Core,receipt_digest:dg(s2Core)};
  assert.throws(()=>createRsiVerifierEvolutionShadowAdmission({
    admission_id:'verifier.shadow.admission.constitution-drift',
    candidate:c,predecessor_receipt:p,secondary_receipt:s2,
    external_admission_owner:true,authored_by_candidate:false,
  }),/receipt_digest_mismatch/);
});

test('sabotage exploit ambiguity monitorability or transfer failures cannot be called PASS',()=>{
  const c=candidate();
  const cases=[
    ['sabotage',{sabotage_pass:false,sabotage_signal_count:1}],
    ['exploit',{discovered_exploit_count:1}],
    ['ambiguity',{ambiguous_case_count:1}],
    ['monitorability',{monitorability_nonregression_pass:false}],
    ['transfer',{transfer_pass:false}],
    ['legibility',{legibility_pass:false}],
    ['trajectory',{trajectory_integrity_pass:false}],
  ];
  for(const [label,patch] of cases){
    assert.throws(()=>receipt('SECONDARY',c,{patch:{...patch,receipt_id:`verifier.shadow.receipt.${label}`}}),/verdict_evidence_mismatch/,label);
  }
});

test('both external verifiers may reject while preserving zero authority',()=>{
  const c=candidate();
  const failPatch={
    acceptance_pass:false,
    verdict:'FAIL',
  };
  const p=receipt('PREDECESSOR',c,{verdict:'FAIL',patch:{...failPatch,receipt_id:'verifier.shadow.receipt.p.fail'}});
  const s=receipt('SECONDARY',c,{verdict:'FAIL',patch:{...failPatch,receipt_id:'verifier.shadow.receipt.s.fail'}});
  const admission=createRsiVerifierEvolutionShadowAdmission({
    admission_id:'verifier.shadow.admission.reject',
    candidate:c,predecessor_receipt:p,secondary_receipt:s,
    external_admission_owner:true,authored_by_candidate:false,
  });
  assert.equal(admission.state,'VERIFIER_EVOLUTION_REJECTED');
  assert.equal(admission.qualified_for_verifier_shadow_only,false);
  assert.equal(admission.active_verifier_remains_predecessor,true);
  assert.equal(admission.verifier_replacement_authorized,false);
  assert.equal(admission.authority_effect,false);
});

test('durable ledger re-verifies policy and preserves negative evidence across restart',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-verifier-shadow-'));
  try{
    const statePath=path.join(root,'ledger.json');
    const c=candidate();
    const p=receipt('PREDECESSOR',c);
    const s=receipt('SECONDARY',c);
    const admission=createRsiVerifierEvolutionShadowAdmission({
      admission_id:'verifier.shadow.admission.persist',
      candidate:c,predecessor_receipt:p,secondary_receipt:s,
      external_admission_owner:true,authored_by_candidate:false,
    });
    const ledger=new RsiVerifierEvolutionShadowLedger({statePath,source_sha:SOURCE});
    await ledger.init();
    assert.equal((await ledger.add({candidate:c,predecessor_receipt:p,secondary_receipt:s,admission})).state,'QUALIFIED_FOR_VERIFIER_SHADOW_ONLY');
    assert.equal((await ledger.add({candidate:c,predecessor_receipt:p,secondary_receipt:s,admission})).state,'IDEMPOTENT');
    assert.equal(ledger.snapshot().qualified_count,1);
    assert.equal(ledger.snapshot().ledger_can_replace_verifier,false);
    assert.equal(ledger.snapshot().ledger_can_activate_verifier,false);

    const restored=new RsiVerifierEvolutionShadowLedger({statePath,source_sha:SOURCE});
    await restored.init();
    assert.equal(restored.snapshot().row_count,1);
    assert.equal(restored.qualified().length,1);

    const raw=JSON.parse(await fs.readFile(statePath,'utf8'));
    raw.rows[0].admission.verifier_replacement_authorized=true;
    const core=structuredClone(raw.rows[0].admission);
    delete core.admission_digest;
    raw.rows[0].admission.admission_digest=dg(core);
    const stateCore=structuredClone(raw);
    delete stateCore.state_digest;
    raw.state_digest=dg(stateCore);
    const tamperedPath=path.join(root,'tampered.json');
    await fs.writeFile(tamperedPath,JSON.stringify(raw),'utf8');
    const tampered=new RsiVerifierEvolutionShadowLedger({statePath:tamperedPath,source_sha:SOURCE});
    await assert.rejects(()=>tampered.init(),/admission_policy_invalid/);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});

test('verifier evolution trust root freezes independent oversight and no replacement',()=>{
  const root=rsiVerifierEvolutionShadowTrustRootSnapshot();
  assert.equal(root.archive_based_verifier_evolution_required,true);
  assert.equal(root.in_place_verifier_rewrite_allowed,false);
  assert.equal(root.frozen_predecessor_verifier_required,true);
  assert.equal(root.distinct_secondary_verifier_required,true);
  assert.equal(root.hidden_acceptance_required,true);
  assert.equal(root.sabotage_suite_required,true);
  assert.equal(root.transfer_holdout_required,true);
  assert.equal(root.trajectory_integrity_required,true);
  assert.equal(root.legibility_holdout_required,true);
  assert.equal(root.monitorability_nonregression_required,true);
  assert.equal(root.candidate_self_evaluation_advisory_only,true);
  assert.equal(root.challenge_archive_append_only,true);
  assert.equal(root.discovered_exploits_become_negative_evidence,true);
  assert.equal(root.active_verifier_remains_predecessor,true);
  assert.equal(root.verifier_replacement_authorized,false);
  assert.equal(root.verifier_activation_authorized,false);
  assert.equal(root.authority_effect,false);
});
