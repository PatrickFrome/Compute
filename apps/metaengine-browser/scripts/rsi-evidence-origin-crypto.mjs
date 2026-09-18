import crypto from 'node:crypto';
import fs from 'node:fs';
import { verifyRsiEvidenceOriginSubject } from '../src/supervisor-rsi-evidence-origin.mjs';

export const RSI_ORIGIN_PREDICATE_TYPE='https://github.com/PatrickFrome/Compute/attestations/rsi-evidence-origin/v1';
export const RSI_ORIGIN_PREDICATE_SCHEMA='metaengine.rsi.evidence-origin-attestation-predicate.v1';
export const RSI_ORIGIN_CRYPTO_RECEIPT_SCHEMA='metaengine.rsi.evidence-origin-cryptographic-verification.v1';
export const RSI_ORIGIN_WORKFLOW='.github/workflows/rsi-evidence-origin-attestation.yml';
export const RSI_ORIGIN_PRODUCER_WORKFLOW='.github/workflows/rsi-hypothesis-evidence-producer.yml';
const REPO='PatrickFrome/Compute', REPO_ID=1341371143, REF='refs/heads/main';
const SHA40=/^[0-9a-f]{40}$/, SHA256=/^[0-9a-f]{64}$/;
const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
const hash=v=>crypto.createHash('sha256').update(Buffer.isBuffer(v)?v:JSON.stringify(stable(v))).digest('hex');
const sha=(v,n)=>{v=String(v||'').toLowerCase();if(!SHA40.test(v))throw Error(`rsi_origin_crypto_${n}_sha_invalid`);return v};
const pos=(v,n)=>{v=Number(v);if(!Number.isSafeInteger(v)||v<1)throw Error(`rsi_origin_crypto_${n}_invalid`);return v};
const read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
const write=(p,v)=>fs.writeFileSync(p,JSON.stringify(stable(v))+'\n');
const zero=a=>['project_authority_granted','execution_authority','production_mutation_authority','promotion_authority','self_update_authority','automatic_retry_allowed','authority_effect'].every(k=>a?.[k]===false);

export function buildOriginPredicate({subject,workflow_sha,workflow_blob_sha,run_id,run_attempt,producer_run_id,producer_run_attempt,producer_head_sha}){
  verifyRsiEvidenceOriginSubject(subject);
  const core={schema:RSI_ORIGIN_PREDICATE_SCHEMA,source:{repository_id:REPO_ID,repository:REPO,workflow_path:RSI_ORIGIN_WORKFLOW,workflow_sha:sha(workflow_sha,'workflow'),workflow_blob_sha:sha(workflow_blob_sha,'workflow_blob'),run_id:pos(run_id,'run'),run_attempt:pos(run_attempt,'attempt'),event:'workflow_dispatch',ref:REF},subject:{id:subject.subject_id,digest:subject.subject_digest,file_sha256:hash(Buffer.from(JSON.stringify(stable(subject))+'\n')),candidate_sha:subject.plan.candidate_sha,source_sha:subject.plan.source_sha,receipt_set_digest:subject.receipt_set_digest,terminal_state:subject.terminal_result.state},producer:{workflow_path:RSI_ORIGIN_PRODUCER_WORKFLOW,run_id:pos(producer_run_id,'producer_run'),run_attempt:pos(producer_run_attempt,'producer_attempt'),head_sha:sha(producer_head_sha,'producer_head')},authority:{cryptographic_origin_candidate:true,cryptographic_origin_verified_by_consumer:false,project_authority_granted:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false}};
  return {...core,predicate_sha256:hash(core)};
}

export function verifyOriginAttestation({subject,verification,workflow_sha,workflow_blob_sha,run_id}){
  verifyRsiEvidenceOriginSubject(subject); workflow_sha=sha(workflow_sha,'workflow'); workflow_blob_sha=sha(workflow_blob_sha,'workflow_blob'); run_id=pos(run_id,'run');
  if(!Array.isArray(verification)||verification.length!==1||!verification[0]?.verificationResult)throw Error('rsi_origin_crypto_verification_single_required');
  const vr=verification[0].verificationResult, ts=vr.verifiedTimestamps, st=vr.statement;
  if(!Array.isArray(ts)||!ts.length)throw Error('rsi_origin_crypto_timestamp_missing');
  if(st?.predicateType!==RSI_ORIGIN_PREDICATE_TYPE)throw Error('rsi_origin_crypto_predicate_type_invalid');
  const canonical=Buffer.from(JSON.stringify(stable(subject))+'\n');
  if(st?.subject?.length!==1||st.subject[0]?.digest?.sha256!==hash(canonical))throw Error('rsi_origin_crypto_subject_digest_mismatch');
  const p=st.predicate, claimed=p?.predicate_sha256; if(!p||p.schema!==RSI_ORIGIN_PREDICATE_SCHEMA||!SHA256.test(String(claimed||'')))throw Error('rsi_origin_crypto_predicate_invalid');
  const pc=structuredClone(p);delete pc.predicate_sha256;if(hash(pc)!==claimed)throw Error('rsi_origin_crypto_predicate_hash_mismatch');
  const s=p.source;if(s?.repository_id!==REPO_ID||s.repository!==REPO||s.workflow_path!==RSI_ORIGIN_WORKFLOW||s.workflow_sha!==workflow_sha||s.workflow_blob_sha!==workflow_blob_sha||s.run_id!==run_id||s.event!=='workflow_dispatch'||s.ref!==REF)throw Error('rsi_origin_crypto_source_binding_mismatch');
  if(p.subject?.id!==subject.subject_id||p.subject?.digest!==subject.subject_digest||p.subject?.candidate_sha!==subject.plan.candidate_sha||p.subject?.receipt_set_digest!==subject.receipt_set_digest||p.subject?.terminal_state!==subject.terminal_result.state)throw Error('rsi_origin_crypto_subject_binding_mismatch');
  if(p.producer?.workflow_path!==RSI_ORIGIN_PRODUCER_WORKFLOW||!SHA40.test(String(p.producer?.head_sha||''))||!Number.isSafeInteger(p.producer?.run_id)||p.producer.run_id<1)throw Error('rsi_origin_crypto_producer_binding_invalid');
  if(p.authority?.cryptographic_origin_candidate!==true||p.authority?.cryptographic_origin_verified_by_consumer!==false||!zero(p.authority))throw Error('rsi_origin_crypto_authority_invalid');
  const core={schema:RSI_ORIGIN_CRYPTO_RECEIPT_SCHEMA,classification:'CRYPTOGRAPHICALLY_VERIFIED_RSI_EVIDENCE_ORIGIN_NONAUTHORITY',subject_id:subject.subject_id,subject_digest:subject.subject_digest,candidate_sha:subject.plan.candidate_sha,terminal_state:subject.terminal_result.state,workflow_sha,workflow_blob_sha,run_id,producer:p.producer,predicate_sha256:claimed,verified_timestamp_count:ts.length,cryptographic_origin_verified:true,persisted_readback_still_required_for_runtime_admission:true,eligible_for_evaluator_mesh:false,project_authority_granted:false,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false};
  return {...core,verification_receipt_sha256:hash(core)};
}

if(import.meta.url===`file://${process.argv[1]}`){
  const [cmd,...a]=process.argv.slice(2); try{
    if(cmd==='predicate'){const [subject,wsha,bsha,rid,att,prid,patt,phead,out]=a;write(out,buildOriginPredicate({subject:read(subject),workflow_sha:wsha,workflow_blob_sha:bsha,run_id:rid,run_attempt:att,producer_run_id:prid,producer_run_attempt:patt,producer_head_sha:phead}));}
    else if(cmd==='verify'){const [subject,ver,wsha,bsha,rid,out]=a;write(out,verifyOriginAttestation({subject:read(subject),verification:read(ver),workflow_sha:wsha,workflow_blob_sha:bsha,run_id:rid}));}
    else throw Error('rsi_origin_crypto_command_invalid');
  }catch(e){console.error(`RSI_ORIGIN_CRYPTO_REJECTED:${e.message}`);process.exit(1)}
}
