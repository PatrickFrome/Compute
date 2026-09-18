import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { RsiRuntimeService } from '../src/rsi-runtime-service.mjs';

const SOURCE='a'.repeat(40);
const dg=(v)=>`sha256:${crypto.createHash('sha256').update(JSON.stringify(v),'utf8').digest('hex')}`;

test('runtime records verifier evolution only as shadow admission with zero authority',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-rsi-runtime-verifier-shadow-'));
  try{
    const runtime=new RsiRuntimeService({
      source_sha:SOURCE,
      ledgerPath:path.join(root,'runtime-ledger.json'),
    });
    await runtime.start();

    const result=await runtime.recordVerifierEvolutionShadowAdmission({
      admission_id:'runtime.verifier.shadow.admission.1',
      candidate_id:'runtime.verifier.shadow.candidate.1',
      predecessor_verifier_root_digest:dg({root:'predecessor'}),
      candidate_verifier_root_digest:dg({root:'candidate'}),
      constitution_digest:dg({constitution:'rsi'}),
      candidate_package_digest:dg({pkg:'candidate'}),
      training_evidence_digest:dg({training:'archive'}),
      self_authored_eval_digest:dg({self:'advisory'}),
      hidden_suite_root_digest:dg({suite:'hidden-root'}),
      hidden_acceptance_digest:dg({suite:'acceptance'}),
      sabotage_suite_digest:dg({suite:'sabotage'}),
      transfer_holdout_digest:dg({suite:'transfer'}),
      trajectory_integrity_digest:dg({suite:'trajectory'}),
      legibility_holdout_digest:dg({suite:'legibility'}),
      challenge_archive_digest:dg({archive:'counterexamples'}),
      predecessor_receipt_id:'runtime.verifier.shadow.receipt.predecessor',
      predecessor_acceptance_pass:true,
      predecessor_sabotage_pass:true,
      predecessor_transfer_pass:true,
      predecessor_trajectory_integrity_pass:true,
      predecessor_legibility_pass:true,
      predecessor_monitorability_nonregression_pass:true,
      predecessor_constitution_match:true,
      predecessor_identity_match:true,
      predecessor_verdict:'PASS',
      predecessor_evidence_refs:['runtime:verifier:predecessor'],
      secondary_receipt_id:'runtime.verifier.shadow.receipt.secondary',
      secondary_verifier_root_digest:dg({root:'secondary'}),
      secondary_acceptance_pass:true,
      secondary_sabotage_pass:true,
      secondary_transfer_pass:true,
      secondary_trajectory_integrity_pass:true,
      secondary_legibility_pass:true,
      secondary_monitorability_nonregression_pass:true,
      secondary_constitution_match:true,
      secondary_identity_match:true,
      secondary_verdict:'PASS',
      secondary_evidence_refs:['runtime:verifier:secondary'],
      external_candidate_builder:true,
      external_predecessor_verifier:true,
      external_secondary_verifier:true,
      external_admission_owner:true,
      authored_by_candidate:false,
    });

    assert.equal(result.admission.state,'QUALIFIED_FOR_VERIFIER_SHADOW_ONLY');
    assert.equal(result.admission.active_verifier_remains_predecessor,true);
    assert.equal(result.admission.verifier_replacement_authorized,false);
    assert.equal(result.admission.verifier_activation_authorized,false);
    assert.equal(result.admission.authority_effect,false);
    assert.equal(runtime.verifierEvolutionShadowAdmissions().length,1);

    const snapshot=runtime.snapshot();
    assert.equal(snapshot.verifier_evolution_shadow_ledger.row_count,1);
    assert.equal(snapshot.verifier_evolution_shadow_ledger.qualified_count,1);
    assert.equal(snapshot.verifier_evolution_shadow_ledger.ledger_can_replace_verifier,false);
    assert.equal(snapshot.verifier_evolution_shadow_ledger.ledger_can_activate_verifier,false);
    assert.equal(snapshot.trust_roots.verifier_evolution_shadow.authority_effect,false);
  }finally{
    await fs.rm(root,{recursive:true,force:true});
  }
});
