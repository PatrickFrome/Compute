import crypto from 'node:crypto';

import { verifyRsiSkillCapsule } from './rsi-verified-skill-library.mjs';

export const RSI_REPO_KNOWLEDGE_SNAPSHOT_SCHEMA = 'metaengine.rsi.repo-knowledge-snapshot.v1';
export const RSI_OPERATIONAL_CLAIM_SCHEMA = 'metaengine.rsi.operational-claim.v1';
export const RSI_DISTILLATION_ANALYSIS_SCHEMA = 'metaengine.rsi.distillation-analysis.v1';
export const RSI_OPERATIONAL_DISTILLATION_SCHEMA = 'metaengine.rsi.operational-distillation.v1';
export const RSI_OPERATIONAL_SKILL_HANDOFF_SCHEMA = 'metaengine.rsi.operational-skill-handoff.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_FILES=512;
const MAX_CLAIMS=256;
const MAX_ANALYSES=32;
const MAX_ANCHORS=16;
const MAX_REFS=32;

const FILE_KINDS=new Set(['SOURCE','TEST','DOC','CONFIG','WORKFLOW','SCHEMA']);
const CLAIM_KINDS=new Set(['PRECONDITION','PROCEDURE','FAILURE_MODE','VERIFICATION','INVARIANT','RECOVERY','PERFORMANCE']);
const MODES=new Set(['TASK_AGNOSTIC','TASK_ORIENTED']);

function plainObject(value){
  if(!value||typeof value!=='object'||Array.isArray(value)) return false;
  const p=Object.getPrototypeOf(value);
  return p===Object.prototype||p===null;
}
function stable(value){
  if(Array.isArray(value)) return value.map(stable);
  if(!value||typeof value!=='object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
}
function digest(value){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(value)),'utf8').digest('hex')}`;}
function exactDigest(value,label){const x=String(value||'').toLowerCase();if(!SHA256_RE.test(x))throw new Error(`rsi_distill_${label}_digest_invalid`);return x;}
function exactSha(value,label){const x=String(value||'').toLowerCase();if(!SHA40_RE.test(x))throw new Error(`rsi_distill_${label}_sha_invalid`);return x;}
function boundedId(value,label){const x=String(value||'').trim();if(!SAFE_ID_RE.test(x))throw new Error(`rsi_distill_${label}_invalid`);return x;}
function token(value,label){const x=String(value||'').trim().toUpperCase();if(!/^[A-Z0-9][A-Z0-9_.:-]{0,95}$/.test(x))throw new Error(`rsi_distill_${label}_invalid`);return x;}
function repoPath(value,label){
  const x=String(value||'').trim();
  if(!x||x.length>240||x.startsWith('/')||x.includes('\\')||x.includes('\0')||x.split('/').some(p=>!p||p==='.'||p==='..')) throw new Error(`rsi_distill_${label}_path_invalid`);
  return x;
}
function refs(value){
  if(!Array.isArray(value)||value.length<1||value.length>MAX_REFS)throw new Error('rsi_distill_evidence_refs_invalid');
  const s=new Set();return Object.freeze(value.map(v=>{const x=boundedId(v,'evidence_ref');if(s.has(x))throw new Error('rsi_distill_evidence_ref_duplicate');s.add(x);return x;}).sort());
}
function zeroAuthority(extra={}){
  return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false});
}
function assertZeroAuthority(value,label){
  for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','scheduler_authority','signing_authority','direct_tool_execution_authority','authority_effect'])if(value?.[f]!==false)throw new Error(`rsi_distill_${label}_${f}_invalid`);
  if(value?.automatic_retry_allowed!==false)throw new Error(`rsi_distill_${label}_automatic_retry_invalid`);
}

export function createRsiRepoKnowledgeSnapshot({
  snapshot_id,repository,source_sha,files,external_source_reader=false,authored_by_candidate=true,
}={}){
  if(external_source_reader!==true||authored_by_candidate!==false)throw new Error('rsi_distill_snapshot_external_origin_required');
  if(!Array.isArray(files)||files.length<1||files.length>MAX_FILES)throw new Error('rsi_distill_snapshot_files_invalid');
  const seen=new Set();
  const normalized=files.map(row=>{
    if(!plainObject(row))throw new Error('rsi_distill_snapshot_file_invalid');
    const path=repoPath(row.path,'snapshot_file');
    if(seen.has(path))throw new Error('rsi_distill_snapshot_file_duplicate');seen.add(path);
    const kind=token(row.kind,'file_kind');if(!FILE_KINDS.has(kind))throw new Error('rsi_distill_file_kind_invalid');
    return Object.freeze({path,blob_digest:exactDigest(row.blob_digest,'blob'),kind,source_bytes:Number(row.source_bytes)>=0?Number(row.source_bytes):(()=>{throw new Error('rsi_distill_source_bytes_invalid')})()});
  }).sort((a,b)=>a.path.localeCompare(b.path));
  const core={
    schema:RSI_REPO_KNOWLEDGE_SNAPSHOT_SCHEMA,version:1,
    snapshot_id:boundedId(snapshot_id,'snapshot_id'),
    repository:boundedId(repository,'repository'),
    source_sha:exactSha(source_sha,'source'),
    files:Object.freeze(normalized),
    file_count:normalized.length,
    exact_source_snapshot:true,
    raw_source_text_stored:false,
    secret_material_stored:false,
    generated_file_inference_allowed:false,
    external_source_reader:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,snapshot_digest:digest(core)});
}

export function verifyRsiRepoKnowledgeSnapshot(snapshot){
  if(!plainObject(snapshot)||snapshot.schema!==RSI_REPO_KNOWLEDGE_SNAPSHOT_SCHEMA||snapshot.version!==1)throw new Error('rsi_distill_snapshot_invalid');
  assertZeroAuthority(snapshot,'snapshot');
  if(snapshot.exact_source_snapshot!==true||snapshot.raw_source_text_stored!==false||snapshot.secret_material_stored!==false||snapshot.generated_file_inference_allowed!==false||snapshot.external_source_reader!==true||snapshot.authored_by_candidate!==false)throw new Error('rsi_distill_snapshot_policy_invalid');
  const canonical=createRsiRepoKnowledgeSnapshot({snapshot_id:snapshot.snapshot_id,repository:snapshot.repository,source_sha:snapshot.source_sha,files:snapshot.files,external_source_reader:true,authored_by_candidate:false});
  if(canonical.snapshot_digest!==exactDigest(snapshot.snapshot_digest,'snapshot'))throw new Error('rsi_distill_snapshot_digest_mismatch');
  return canonical;
}

export function createRsiOperationalClaim({
  claim_id,snapshot,kind,capability_family,source_anchors,claim_payload_digest,evidence_refs,
  external_analyst=false,authored_by_candidate=true,
}={}){
  const snap=verifyRsiRepoKnowledgeSnapshot(snapshot);
  if(external_analyst!==true||authored_by_candidate!==false)throw new Error('rsi_distill_claim_external_origin_required');
  const k=token(kind,'claim_kind');if(!CLAIM_KINDS.has(k))throw new Error('rsi_distill_claim_kind_invalid');
  if(!Array.isArray(source_anchors)||source_anchors.length<1||source_anchors.length>MAX_ANCHORS)throw new Error('rsi_distill_claim_anchors_invalid');
  const seen=new Set();
  const anchors=source_anchors.map(row=>{
    if(!plainObject(row))throw new Error('rsi_distill_claim_anchor_invalid');
    const path=repoPath(row.path,'claim_anchor');
    const file=snap.files.find(f=>f.path===path);if(!file)throw new Error('rsi_distill_claim_anchor_outside_snapshot');
    const blob=exactDigest(row.blob_digest,'claim_anchor_blob');if(blob!==file.blob_digest)throw new Error('rsi_distill_claim_anchor_blob_mismatch');
    const fragment=exactDigest(row.fragment_digest,'claim_fragment');
    const key=`${path}:${fragment}`;if(seen.has(key))throw new Error('rsi_distill_claim_anchor_duplicate');seen.add(key);
    return Object.freeze({path,blob_digest:blob,fragment_digest:fragment});
  }).sort((a,b)=>a.path.localeCompare(b.path)||a.fragment_digest.localeCompare(b.fragment_digest));
  const core={
    schema:RSI_OPERATIONAL_CLAIM_SCHEMA,version:1,
    claim_id:boundedId(claim_id,'claim_id'),
    snapshot_digest:snap.snapshot_digest,
    source_sha:snap.source_sha,
    kind:k,
    capability_family:token(capability_family,'capability_family'),
    source_anchors:Object.freeze(anchors),
    claim_payload_digest:exactDigest(claim_payload_digest,'claim_payload'),
    evidence_refs:refs(evidence_refs),
    raw_source_text_stored:false,
    raw_claim_text_trusted:false,
    source_traceability_required:true,
    external_analyst:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,claim_digest:digest(core)});
}

export function verifyRsiOperationalClaim(claim,snapshot){
  if(!plainObject(claim)||claim.schema!==RSI_OPERATIONAL_CLAIM_SCHEMA||claim.version!==1)throw new Error('rsi_distill_claim_invalid');
  assertZeroAuthority(claim,'claim');
  if(claim.raw_source_text_stored!==false||claim.raw_claim_text_trusted!==false||claim.source_traceability_required!==true||claim.external_analyst!==true||claim.authored_by_candidate!==false)throw new Error('rsi_distill_claim_policy_invalid');
  const canonical=createRsiOperationalClaim({claim_id:claim.claim_id,snapshot,kind:claim.kind,capability_family:claim.capability_family,source_anchors:claim.source_anchors,claim_payload_digest:claim.claim_payload_digest,evidence_refs:claim.evidence_refs,external_analyst:true,authored_by_candidate:false});
  if(canonical.claim_digest!==exactDigest(claim.claim_digest,'claim'))throw new Error('rsi_distill_claim_digest_mismatch');
  return canonical;
}

export function createRsiDistillationAnalysis({
  analysis_id,snapshot,analyst_id,supported_claims,conflicting_claims=[],coverage_digest,evidence_refs,
  external_analyst=false,authored_by_candidate=true,
}={}){
  const snap=verifyRsiRepoKnowledgeSnapshot(snapshot);
  if(external_analyst!==true||authored_by_candidate!==false)throw new Error('rsi_distill_analysis_external_origin_required');
  const support=[...new Set((supported_claims||[]).map(v=>exactDigest(v,'supported_claim')))].sort();
  const conflicts=[...new Set((conflicting_claims||[]).map(v=>exactDigest(v,'conflicting_claim')))].sort();
  if(support.length<1||support.length>MAX_CLAIMS||conflicts.length>MAX_CLAIMS)throw new Error('rsi_distill_analysis_claims_invalid');
  if(support.some(v=>conflicts.includes(v)))throw new Error('rsi_distill_analysis_claim_conflict_overlap');
  const core={
    schema:RSI_DISTILLATION_ANALYSIS_SCHEMA,version:1,
    analysis_id:boundedId(analysis_id,'analysis_id'),
    analyst_id:boundedId(analyst_id,'analyst_id'),
    snapshot_digest:snap.snapshot_digest,
    supported_claim_digests:Object.freeze(support),
    conflicting_claim_digests:Object.freeze(conflicts),
    coverage_digest:exactDigest(coverage_digest,'coverage'),
    evidence_refs:refs(evidence_refs),
    independent_analysis:true,
    raw_model_transcript_stored:false,
    analyst_is_commit_authority:false,
    external_analyst:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,analysis_digest:digest(core)});
}

export function createRsiOperationalDistillation({
  distillation_id,snapshot,mode,task_intent_digest=null,claims,analyses,min_independent_support=2,
  external_synthesizer=false,authored_by_candidate=true,
}={}){
  const snap=verifyRsiRepoKnowledgeSnapshot(snapshot);
  if(external_synthesizer!==true||authored_by_candidate!==false)throw new Error('rsi_distill_external_origin_required');
  const m=token(mode,'mode');if(!MODES.has(m))throw new Error('rsi_distill_mode_invalid');
  if(m==='TASK_ORIENTED'&&task_intent_digest==null)throw new Error('rsi_distill_task_intent_required');
  if(m==='TASK_AGNOSTIC'&&task_intent_digest!=null)throw new Error('rsi_distill_task_intent_forbidden');
  if(!Array.isArray(claims)||claims.length<1||claims.length>MAX_CLAIMS)throw new Error('rsi_distill_claims_invalid');
  if(!Array.isArray(analyses)||analyses.length<2||analyses.length>MAX_ANALYSES)throw new Error('rsi_distill_analyses_invalid');
  const checkedClaims=claims.map(c=>verifyRsiOperationalClaim(c,snap));
  const claimDigests=new Set();for(const c of checkedClaims){if(claimDigests.has(c.claim_digest))throw new Error('rsi_distill_claim_duplicate');claimDigests.add(c.claim_digest);}
  const checkedAnalyses=analyses.map(a=>{
    if(!plainObject(a)||a.schema!==RSI_DISTILLATION_ANALYSIS_SCHEMA||a.version!==1)throw new Error('rsi_distill_analysis_invalid');
    assertZeroAuthority(a,'analysis');
    if(a.snapshot_digest!==snap.snapshot_digest||a.external_analyst!==true||a.authored_by_candidate!==false||a.independent_analysis!==true||a.analyst_is_commit_authority!==false)throw new Error('rsi_distill_analysis_policy_invalid');
    exactDigest(a.analysis_digest,'analysis');
    return a;
  });
  const analysts=new Set(checkedAnalyses.map(a=>a.analyst_id));if(analysts.size!==checkedAnalyses.length)throw new Error('rsi_distill_analyst_duplicate');
  const minSupport=positiveInt(min_independent_support,'min_support',checkedAnalyses.length);
  const decisions=checkedClaims.map(claim=>{
    const support=checkedAnalyses.filter(a=>a.supported_claim_digests.includes(claim.claim_digest)).length;
    const conflicts=checkedAnalyses.filter(a=>a.conflicting_claim_digests.includes(claim.claim_digest)).length;
    return Object.freeze({claim_id:claim.claim_id,claim_digest:claim.claim_digest,support_count:support,conflict_count:conflicts,admitted:support>=minSupport&&conflicts===0});
  });
  const allAdmitted=decisions.every(d=>d.admitted);
  const core={
    schema:RSI_OPERATIONAL_DISTILLATION_SCHEMA,version:1,
    distillation_id:boundedId(distillation_id,'distillation_id'),
    snapshot_digest:snap.snapshot_digest,
    source_sha:snap.source_sha,
    mode:m,
    task_intent_digest:task_intent_digest==null?null:exactDigest(task_intent_digest,'task_intent'),
    claim_digests:Object.freeze(checkedClaims.map(c=>c.claim_digest).sort()),
    analysis_digests:Object.freeze(checkedAnalyses.map(a=>a.analysis_digest).sort()),
    decisions:Object.freeze(decisions),
    min_independent_support:minSupport,
    every_claim_independently_supported:allAdmitted,
    unresolved_conflict_count:decisions.filter(d=>d.conflict_count>0).length,
    parallel_holistic_analysis_required:true,
    sequential_single_trace_overfit_forbidden:true,
    source_traceability_required:true,
    raw_source_summary_is_skill_authority:false,
    external_synthesizer:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,distillation_digest:digest(core)});
}

export function createRsiOperationalSkillHandoff({
  handoff_id,snapshot,distillation,claims,skill,claim_component_map,
  external_materializer=false,authored_by_candidate=true,
}={}){
  const snap=verifyRsiRepoKnowledgeSnapshot(snapshot);
  if(!plainObject(distillation)||distillation.schema!==RSI_OPERATIONAL_DISTILLATION_SCHEMA||distillation.version!==1)throw new Error('rsi_distill_distillation_invalid');
  assertZeroAuthority(distillation,'distillation');
  if(distillation.snapshot_digest!==snap.snapshot_digest||distillation.every_claim_independently_supported!==true||distillation.unresolved_conflict_count!==0)throw new Error('rsi_distill_not_ready');
  if(external_materializer!==true||authored_by_candidate!==false)throw new Error('rsi_distill_handoff_external_origin_required');
  const checkedSkill=verifyRsiSkillCapsule(skill);
  const checkedClaims=claims.map(c=>verifyRsiOperationalClaim(c,snap));
  const claimById=new Map(checkedClaims.map(c=>[c.claim_id,c]));
  if(!Array.isArray(claim_component_map)||claim_component_map.length<1||claim_component_map.length>MAX_CLAIMS)throw new Error('rsi_distill_claim_component_map_invalid');
  const coveredClaims=new Set(), coveredComponents=new Set();
  const mapping=claim_component_map.map(row=>{
    if(!plainObject(row))throw new Error('rsi_distill_claim_component_row_invalid');
    const claim=claimById.get(String(row.claim_id||''));if(!claim)throw new Error('rsi_distill_claim_component_claim_missing');
    const component=checkedSkill.components.find(c=>c.component_id===String(row.component_id||''));if(!component)throw new Error('rsi_distill_claim_component_component_missing');
    if(exactDigest(row.component_digest,'mapped_component')!==component.artifact_digest)throw new Error('rsi_distill_claim_component_digest_mismatch');
    coveredClaims.add(claim.claim_id);coveredComponents.add(component.component_id);
    return Object.freeze({claim_id:claim.claim_id,claim_digest:claim.claim_digest,component_id:component.component_id,component_digest:component.artifact_digest});
  }).sort((a,b)=>a.claim_id.localeCompare(b.claim_id)||a.component_id.localeCompare(b.component_id));
  if(coveredClaims.size!==checkedClaims.length)throw new Error('rsi_distill_claim_coverage_incomplete');
  if(coveredComponents.size!==checkedSkill.components.length)throw new Error('rsi_distill_component_coverage_incomplete');
  const core={
    schema:RSI_OPERATIONAL_SKILL_HANDOFF_SCHEMA,version:1,
    handoff_id:boundedId(handoff_id,'handoff_id'),
    snapshot_digest:snap.snapshot_digest,
    source_sha:snap.source_sha,
    distillation_digest:distillation.distillation_digest,
    skill:checkedSkill,
    skill_digest:checkedSkill.skill_digest,
    claim_component_map:Object.freeze(mapping),
    all_claims_traceable:true,
    all_components_claim_grounded:true,
    operational_knowledge_not_raw_summary:true,
    v126_behavioral_scope_validation_required:true,
    v124_external_skill_evidence_required:true,
    directly_admitted_to_library:false,
    external_materializer:true,
    authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,handoff_digest:digest(core)});
}

export function rsiOperationalDistillationTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.operational-distillation-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-operational-knowledge-distillation.mjs',
    exact_repository_snapshot_required:true,
    task_agnostic_and_task_oriented_modes:true,
    parallel_independent_analysis_required:true,
    minimum_independent_claim_support:2,
    unresolved_claim_conflicts_allowed:false,
    claim_to_source_traceability_required:true,
    component_to_claim_traceability_required:true,
    raw_source_summary_is_skill_authority:false,
    raw_source_text_stored:false,
    v126_behavioral_scope_validation_required:true,
    v124_external_skill_evidence_required:true,
    candidate_can_self_distill:false,
    candidate_can_self_admit:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,scheduler_authority:false,signing_authority:false,direct_tool_execution_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,distillation_root_digest:digest(root)});
}
