import crypto from 'node:crypto';

import { verifyRsiMutationContract } from './supervisor-rsi-mutation-contract.mjs';

export const RSI_ARTIFACT_SPEC_AUDIT_RECEIPT_SCHEMA = 'metaengine.rsi.artifact-spec-audit-receipt.v1';
export const RSI_ARTIFACT_SPEC_ASSESSMENT_SCHEMA = 'metaengine.rsi.artifact-spec-assessment.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const CANDIDATE_ID_RE=/^candidate_sha256_[0-9a-f]{64}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digest(value){
  return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;
}
function zeroAuthority(value,label){
  for(const field of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect']){
    if(value?.[field]!==false)throw new Error(`rsi_artifact_${label}_${field}_invalid`);
  }
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_artifact_${label}_automatic_retry_invalid`);
}
function exactDigest(value,label){
  const out=String(value||'').toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_artifact_${label}_digest_invalid`);
  return out;
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>32)throw new Error('rsi_artifact_evidence_refs_invalid');
  const seen=new Set();
  return value.map((entry)=>{
    const out=String(entry||'').trim();
    if(!out||out.length>220||seen.has(out))throw new Error('rsi_artifact_evidence_ref_invalid');
    seen.add(out);return out;
  }).sort();
}
function normalizedComponents(candidateHandoff){
  const id=String(candidateHandoff?.candidate_capsule?.candidate_id||'').toLowerCase();
  const sha=String(candidateHandoff?.candidate_sha||'').toLowerCase();
  const handoff=String(candidateHandoff?.handoff_digest||'').toLowerCase();
  if(!CANDIDATE_ID_RE.test(id)||!SHA40_RE.test(sha)||!SHA256_RE.test(handoff))throw new Error('rsi_artifact_candidate_identity_invalid');
  if(candidateHandoff?.candidate_capsule?.source?.head!==sha)throw new Error('rsi_artifact_candidate_capsule_source_mismatch');
  if(candidateHandoff?.eligible_for_evaluation!==true||candidateHandoff?.eligible_for_promotion!==false)throw new Error('rsi_artifact_candidate_state_invalid');
  zeroAuthority(candidateHandoff,'candidate_handoff');
  const components=Array.isArray(candidateHandoff?.candidate_capsule?.components)?candidateHandoff.candidate_capsule.components:[];
  if(components.length<1||components.length>32)throw new Error('rsi_artifact_candidate_components_invalid');
  const normalized=components.map((row)=>{
    const path=String(row?.path||'');
    const change=String(row?.change||'').toUpperCase();
    const componentDigest=exactDigest(row?.digest,'component');
    if(!path||path.length>240||!['CREATE','MODIFY','DELETE'].includes(change))throw new Error('rsi_artifact_component_invalid');
    return {path,change,digest:componentDigest};
  }).sort((a,b)=>a.path.localeCompare(b.path)||a.change.localeCompare(b.change));
  return {candidate_id:id,candidate_sha:sha,handoff_digest:handoff,components:normalized};
}
function expectedMutations(hypothesis,mutationContract){
  const checked=verifyRsiMutationContract(mutationContract,{hypothesis});
  return checked.allowed_mutations.map((row)=>({path:String(row.path),change:String(row.change).toUpperCase()}))
    .sort((a,b)=>a.path.localeCompare(b.path)||a.change.localeCompare(b.change));
}

export function createRsiArtifactSpecAuditReceipt({
  candidate_handoff,hypothesis,mutation_contract,
  observed_artifacts,no_op_ablation,
  external_mechanical_auditor=false,authored_by_candidate=true,evidence_refs=[],
}={}){
  const candidate=normalizedComponents(candidate_handoff);
  const expected=expectedMutations(hypothesis,mutation_contract);
  const actualShape=candidate.components.map(({path,change})=>({path,change}));
  if(JSON.stringify(actualShape)!==JSON.stringify(expected))throw new Error('rsi_artifact_candidate_mutation_contract_mismatch');
  if(external_mechanical_auditor!==true||authored_by_candidate!==false)throw new Error('rsi_artifact_external_auditor_required');
  if(!Array.isArray(observed_artifacts)||observed_artifacts.length!==expected.length)throw new Error('rsi_artifact_observed_count_invalid');

  const observed=observed_artifacts.map((row)=>{
    const path=String(row?.path||'');
    const change=String(row?.change||'').toUpperCase();
    const artifactDigest=exactDigest(row?.artifact_digest,'observed_artifact');
    const expectedState=change==='DELETE'?false:true;
    if(row?.artifact_present_after!==expectedState||row?.expected_change_observed!==true||row?.artifact_exercised_by_verification!==true){
      throw new Error('rsi_artifact_observed_state_invalid');
    }
    return {path,change,artifact_digest:artifactDigest,artifact_present_after:expectedState,expected_change_observed:true,artifact_exercised_by_verification:true};
  }).sort((a,b)=>a.path.localeCompare(b.path)||a.change.localeCompare(b.change));
  if(JSON.stringify(observed.map(({path,change})=>({path,change})))!==JSON.stringify(expected))throw new Error('rsi_artifact_observed_mutation_set_mismatch');

  const ablation=no_op_ablation||{};
  if(
    ablation.performed!==true
    || ablation.kind!=='EXACT_MUTATION_REVERT_TO_PARENT'
    || ablation.same_harness_and_holdout!==true
    || ablation.candidate_effect_observed!==true
    || ablation.no_op_effect_equivalent!==false
  )throw new Error('rsi_artifact_noop_ablation_invalid');
  const ablationRow={
    performed:true,
    kind:'EXACT_MUTATION_REVERT_TO_PARENT',
    same_harness_and_holdout:true,
    candidate_effect_observed:true,
    no_op_effect_equivalent:false,
    candidate_evidence_digest:exactDigest(ablation.candidate_evidence_digest,'candidate_ablation'),
    no_op_evidence_digest:exactDigest(ablation.no_op_evidence_digest,'noop_ablation'),
  };
  if(ablationRow.candidate_evidence_digest===ablationRow.no_op_evidence_digest)throw new Error('rsi_artifact_noop_ablation_digest_alias');

  const core={
    schema:RSI_ARTIFACT_SPEC_AUDIT_RECEIPT_SCHEMA,version:1,
    candidate_id:candidate.candidate_id,candidate_sha:candidate.candidate_sha,handoff_digest:candidate.handoff_digest,
    hypothesis_id:hypothesis.hypothesis_id,hypothesis_digest:hypothesis.hypothesis_digest,
    mutation_contract_digest:mutation_contract.contract_digest,
    expected_mutation_set_digest:digest(expected),
    candidate_component_digest:digest(candidate.components),
    observed_artifacts:observed,
    no_op_ablation:ablationRow,
    external_mechanical_auditor:true,authored_by_candidate:false,
    free_text_spec_is_authority:false,
    model_self_report_is_artifact_evidence:false,
    evidence_refs:refs(evidence_refs),
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,receipt_digest:digest(core)});
}

export function verifyRsiArtifactSpecAuditReceipt(row,inputs={}){
  if(!row||typeof row!=='object'||Array.isArray(row)||row.schema!==RSI_ARTIFACT_SPEC_AUDIT_RECEIPT_SCHEMA)throw new Error('rsi_artifact_receipt_invalid');
  zeroAuthority(row,'receipt');
  const expected=createRsiArtifactSpecAuditReceipt({...inputs,
    observed_artifacts:row.observed_artifacts,
    no_op_ablation:row.no_op_ablation,
    external_mechanical_auditor:true,authored_by_candidate:false,evidence_refs:row.evidence_refs,
  });
  if(JSON.stringify(stable(row))!==JSON.stringify(stable(expected)))throw new Error('rsi_artifact_receipt_mismatch');
  return expected;
}

export function assessRsiArtifactSpecAudit({receipt,candidate_handoff,hypothesis,mutation_contract}={}){
  const verified=verifyRsiArtifactSpecAuditReceipt(receipt,{candidate_handoff,hypothesis,mutation_contract});
  const core={
    schema:RSI_ARTIFACT_SPEC_ASSESSMENT_SCHEMA,version:1,
    candidate_id:verified.candidate_id,candidate_sha:verified.candidate_sha,handoff_digest:verified.handoff_digest,
    receipt_digest:verified.receipt_digest,
    state:'ARTIFACT_VERIFIED',
    exact_mutation_set_present:true,
    requested_artifacts_present:true,
    requested_artifacts_exercised:true,
    no_op_ablation_passed:true,
    no_op_equivalent:false,
    eligible_for_archive_evidence:true,
    artifact_score_is_promotion_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,assessment_digest:digest(core)});
}
