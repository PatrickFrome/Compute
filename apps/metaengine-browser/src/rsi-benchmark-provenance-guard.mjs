import crypto from 'node:crypto';

export const RSI_BENCHMARK_PROVENANCE_POLICY_SCHEMA = 'metaengine.rsi.benchmark-provenance-policy.v1';
export const RSI_BENCHMARK_TASK_PROVENANCE_SCHEMA = 'metaengine.rsi.benchmark-task-provenance.v1';
export const RSI_BENCHMARK_CONTAMINATION_ASSESSMENT_SCHEMA = 'metaengine.rsi.benchmark-contamination-assessment.v1';
export const RSI_BENCHMARK_EVIDENCE_ADMISSION_SCHEMA = 'metaengine.rsi.benchmark-evidence-admission.v1';

const SHA40_RE=/^[0-9a-f]{40}$/;
const SHA256_RE=/^sha256:[0-9a-f]{64}$/;
const SAFE_ID_RE=/^[A-Za-z0-9][A-Za-z0-9._:/#@+-]{2,255}$/;
const MAX_TASKS=4096;
const MAX_REFS=32;

const SOURCE_KINDS=new Set([
  'FRESH_PRIVATE_COMMIT',
  'CROSS_REPO_FRESH',
  'DYNAMIC_SEMANTIC_VARIANT',
  'PRIVATE_PRODUCTION_INCIDENT',
  'PUBLIC_STATIC',
]);
const SEARCHABILITY=new Set(['NOT_SEARCHABLE','SEARCHABLE','UNKNOWN']);
const RISK_STATES=new Set(['CONTAMINATION_RESISTANT','SUSPECT','CONTAMINATED','UNKNOWN']);

function plainObject(v){if(!v||typeof v!=='object'||Array.isArray(v))return false;const p=Object.getPrototypeOf(v);return p===Object.prototype||p===null}
function stable(v){if(Array.isArray(v))return v.map(stable);if(!v||typeof v!=='object')return v;return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]))}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`}
function exactDigest(v,l){const o=String(v||'').toLowerCase();if(!SHA256_RE.test(o))throw new Error(`rsi_benchmark_${l}_digest_invalid`);return o}
function exactSha(v,l){const o=String(v||'').toLowerCase();if(!SHA40_RE.test(o))throw new Error(`rsi_benchmark_${l}_sha_invalid`);return o}
function boundedId(v,l){const o=String(v||'').trim();if(!SAFE_ID_RE.test(o))throw new Error(`rsi_benchmark_${l}_invalid`);return o}
function positiveInt(v,l,max=Number.MAX_SAFE_INTEGER){const o=Number(v);if(!Number.isSafeInteger(o)||o<1||o>max)throw new Error(`rsi_benchmark_${l}_invalid`);return o}
function iso(v,l){const o=String(v||'');if(!Number.isFinite(Date.parse(o)))throw new Error(`rsi_benchmark_${l}_invalid`);return new Date(o).toISOString()}
function refs(v){if(!Array.isArray(v)||v.length<1||v.length>MAX_REFS)throw new Error('rsi_benchmark_evidence_refs_invalid');const s=new Set();return v.map(x=>{const r=boundedId(x,'evidence_ref');if(s.has(r))throw new Error('rsi_benchmark_evidence_ref_duplicate');s.add(r);return r}).sort()}
function zero(extra={}){return Object.freeze({...extra,execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false})}
function assertZero(v,l){for(const f of ['execution_authority','production_mutation_authority','promotion_authority','self_update_authority','authority_effect'])if(v?.[f]!==false)throw new Error(`rsi_benchmark_${l}_${f}_invalid`);if(v?.automatic_retry_allowed!==false)throw new Error(`rsi_benchmark_${l}_automatic_retry_invalid`)}

export function createRsiBenchmarkProvenancePolicy({
  policy_id,
  min_resistant_tasks=8,
  min_source_families=2,
  max_public_static_fraction=0.25,
  external_policy_owner=false,
  authored_by_candidate=true,
}={}){
  if(external_policy_owner!==true||authored_by_candidate!==false)throw new Error('rsi_benchmark_policy_external_origin_required');
  const fraction=Number(max_public_static_fraction);
  if(!Number.isFinite(fraction)||fraction<0||fraction>1)throw new Error('rsi_benchmark_public_fraction_invalid');
  const core={
    schema:RSI_BENCHMARK_PROVENANCE_POLICY_SCHEMA,version:1,
    policy_id:boundedId(policy_id,'policy_id'),
    min_resistant_tasks:positiveInt(min_resistant_tasks,'min_resistant_tasks',MAX_TASKS),
    min_source_families:positiveInt(min_source_families,'min_source_families',32),
    max_public_static_fraction:fraction,
    raw_task_content_in_trust_root:false,
    candidate_can_choose_tasks:false,
    candidate_can_choose_source_repositories:false,
    candidate_can_label_freshness:false,
    candidate_can_author_provenance:false,
    candidate_can_mutate_evaluator_harness:false,
    reference_solution_visible_to_candidate:false,
    hidden_tests_visible_to_candidate:false,
    benchmark_tasks_may_train_trusted_memory:false,
    benchmark_tasks_may_seed_skill_library:false,
    public_static_can_be_sole_promotion_evidence:false,
    unknown_can_be_sole_promotion_evidence:false,
    proven_uncontaminated_claim_allowed:false,
    exact_external_provenance_required:true,
    full_holdout_admission_requires_resistant_set:true,
    external_policy_owner:true,authored_by_candidate:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,policy_digest:digest(core)});
}

export function verifyRsiBenchmarkProvenancePolicy(row){
  if(!plainObject(row)||row.schema!==RSI_BENCHMARK_PROVENANCE_POLICY_SCHEMA||row.version!==1)throw new Error('rsi_benchmark_policy_invalid');
  assertZero(row,'policy');
  if(
    row.raw_task_content_in_trust_root!==false||row.candidate_can_choose_tasks!==false
    ||row.candidate_can_choose_source_repositories!==false||row.candidate_can_label_freshness!==false
    ||row.candidate_can_author_provenance!==false||row.candidate_can_mutate_evaluator_harness!==false
    ||row.reference_solution_visible_to_candidate!==false||row.hidden_tests_visible_to_candidate!==false
    ||row.benchmark_tasks_may_train_trusted_memory!==false||row.benchmark_tasks_may_seed_skill_library!==false
    ||row.public_static_can_be_sole_promotion_evidence!==false||row.unknown_can_be_sole_promotion_evidence!==false
    ||row.proven_uncontaminated_claim_allowed!==false||row.exact_external_provenance_required!==true
    ||row.full_holdout_admission_requires_resistant_set!==true||row.external_policy_owner!==true||row.authored_by_candidate!==false
  )throw new Error('rsi_benchmark_policy_contract_invalid');
  const canonical=createRsiBenchmarkProvenancePolicy({
    policy_id:row.policy_id,min_resistant_tasks:row.min_resistant_tasks,min_source_families:row.min_source_families,
    max_public_static_fraction:row.max_public_static_fraction,external_policy_owner:true,authored_by_candidate:false,
  });
  if(canonical.policy_digest!==exactDigest(row.policy_digest,'policy'))throw new Error('rsi_benchmark_policy_digest_mismatch');
  return canonical;
}

export function createRsiBenchmarkTaskProvenance({
  policy,
  task_id,
  benchmark_id,
  benchmark_version,
  task_prompt_digest,
  hidden_test_digest,
  source_kind,
  source_family,
  source_repository_digest,
  candidate_repository_digest,
  source_commit_sha=null,
  source_parent_task_digest=null,
  semantic_equivalence_receipt_digest=null,
  source_published_at,
  candidate_frozen_at,
  task_materialized_at,
  searchability='UNKNOWN',
  reference_solution_visible=false,
  hidden_tests_visible=false,
  evaluator_harness_visible=false,
  evaluator_harness_mutated_by_candidate=false,
  task_authored_by_candidate=false,
  task_selected_by_candidate=false,
  source_repository_selected_by_candidate=false,
  ingested_into_trusted_memory=false,
  ingested_into_skill_library=false,
  external_provenance_verifier=false,
  authored_by_candidate=true,
  evidence_refs,
}={}){
  const checked=verifyRsiBenchmarkProvenancePolicy(policy);
  if(external_provenance_verifier!==true||authored_by_candidate!==false)throw new Error('rsi_benchmark_task_external_origin_required');
  const kind=String(source_kind||'').toUpperCase();if(!SOURCE_KINDS.has(kind))throw new Error('rsi_benchmark_source_kind_invalid');
  const search=String(searchability||'').toUpperCase();if(!SEARCHABILITY.has(search))throw new Error('rsi_benchmark_searchability_invalid');
  const sourceRepo=exactDigest(source_repository_digest,'source_repository');
  const candidateRepo=exactDigest(candidate_repository_digest,'candidate_repository');
  if(kind==='CROSS_REPO_FRESH'&&sourceRepo===candidateRepo)throw new Error('rsi_benchmark_cross_repo_alias_forbidden');
  const sourceCommit=source_commit_sha==null?null:exactSha(source_commit_sha,'source_commit');
  if(['FRESH_PRIVATE_COMMIT','CROSS_REPO_FRESH'].includes(kind)&&sourceCommit==null)throw new Error('rsi_benchmark_source_commit_required');
  const parentTask=source_parent_task_digest==null?null:exactDigest(source_parent_task_digest,'parent_task');
  const semanticReceipt=semantic_equivalence_receipt_digest==null?null:exactDigest(semantic_equivalence_receipt_digest,'semantic_equivalence');
  if(kind==='DYNAMIC_SEMANTIC_VARIANT'&&(parentTask==null||semanticReceipt==null))throw new Error('rsi_benchmark_dynamic_variant_evidence_required');
  if(kind!=='DYNAMIC_SEMANTIC_VARIANT'&&(parentTask!=null||semanticReceipt!=null))throw new Error('rsi_benchmark_dynamic_variant_evidence_forbidden');
  const published=iso(source_published_at,'source_published_at');
  const frozen=iso(candidate_frozen_at,'candidate_frozen_at');
  const materialized=iso(task_materialized_at,'task_materialized_at');
  if(Date.parse(materialized)<Date.parse(published))throw new Error('rsi_benchmark_materialized_before_source');
  const core={
    schema:RSI_BENCHMARK_TASK_PROVENANCE_SCHEMA,version:1,
    policy_id:checked.policy_id,policy_digest:checked.policy_digest,
    task_id:boundedId(task_id,'task_id'),benchmark_id:boundedId(benchmark_id,'benchmark_id'),benchmark_version:boundedId(benchmark_version,'benchmark_version'),
    task_prompt_digest:exactDigest(task_prompt_digest,'task_prompt'),hidden_test_digest:exactDigest(hidden_test_digest,'hidden_test'),
    source_kind:kind,source_family:boundedId(source_family,'source_family'),
    source_repository_digest:sourceRepo,candidate_repository_digest:candidateRepo,source_commit_sha:sourceCommit,
    source_parent_task_digest:parentTask,semantic_equivalence_receipt_digest:semanticReceipt,
    source_published_at:published,candidate_frozen_at:frozen,task_materialized_at:materialized,
    source_published_after_candidate_freeze:Date.parse(published)>Date.parse(frozen),
    task_materialized_after_candidate_freeze:Date.parse(materialized)>Date.parse(frozen),
    searchability:search,
    reference_solution_visible:reference_solution_visible===true,
    hidden_tests_visible:hidden_tests_visible===true,
    evaluator_harness_visible:evaluator_harness_visible===true,
    evaluator_harness_mutated_by_candidate:evaluator_harness_mutated_by_candidate===true,
    task_authored_by_candidate:task_authored_by_candidate===true,
    task_selected_by_candidate:task_selected_by_candidate===true,
    source_repository_selected_by_candidate:source_repository_selected_by_candidate===true,
    ingested_into_trusted_memory:ingested_into_trusted_memory===true,
    ingested_into_skill_library:ingested_into_skill_library===true,
    raw_task_content_present:false,
    model_training_cutoff_proven:false,
    external_provenance_verifier:true,authored_by_candidate:false,evidence_refs:refs(evidence_refs),
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,task_provenance_digest:digest(core)});
}

export function verifyRsiBenchmarkTaskProvenance(row,policy){
  if(!plainObject(row)||row.schema!==RSI_BENCHMARK_TASK_PROVENANCE_SCHEMA||row.version!==1)throw new Error('rsi_benchmark_task_invalid');
  assertZero(row,'task');
  if(row.raw_task_content_present!==false||row.model_training_cutoff_proven!==false||row.external_provenance_verifier!==true||row.authored_by_candidate!==false)throw new Error('rsi_benchmark_task_policy_invalid');
  const canonical=createRsiBenchmarkTaskProvenance({
    policy,task_id:row.task_id,benchmark_id:row.benchmark_id,benchmark_version:row.benchmark_version,
    task_prompt_digest:row.task_prompt_digest,hidden_test_digest:row.hidden_test_digest,source_kind:row.source_kind,source_family:row.source_family,
    source_repository_digest:row.source_repository_digest,candidate_repository_digest:row.candidate_repository_digest,source_commit_sha:row.source_commit_sha,
    source_parent_task_digest:row.source_parent_task_digest,semantic_equivalence_receipt_digest:row.semantic_equivalence_receipt_digest,
    source_published_at:row.source_published_at,candidate_frozen_at:row.candidate_frozen_at,task_materialized_at:row.task_materialized_at,
    searchability:row.searchability,reference_solution_visible:row.reference_solution_visible,hidden_tests_visible:row.hidden_tests_visible,
    evaluator_harness_visible:row.evaluator_harness_visible,evaluator_harness_mutated_by_candidate:row.evaluator_harness_mutated_by_candidate,
    task_authored_by_candidate:row.task_authored_by_candidate,task_selected_by_candidate:row.task_selected_by_candidate,
    source_repository_selected_by_candidate:row.source_repository_selected_by_candidate,ingested_into_trusted_memory:row.ingested_into_trusted_memory,
    ingested_into_skill_library:row.ingested_into_skill_library,external_provenance_verifier:true,authored_by_candidate:false,evidence_refs:row.evidence_refs,
  });
  if(canonical.task_provenance_digest!==exactDigest(row.task_provenance_digest,'task'))throw new Error('rsi_benchmark_task_digest_mismatch');
  return canonical;
}

export function assessRsiBenchmarkContamination({policy,task}={}){
  const checked=verifyRsiBenchmarkProvenancePolicy(policy);
  const row=verifyRsiBenchmarkTaskProvenance(task,checked);
  const hard=[];
  if(row.reference_solution_visible)hard.push('REFERENCE_SOLUTION_VISIBLE');
  if(row.hidden_tests_visible)hard.push('HIDDEN_TESTS_VISIBLE');
  if(row.evaluator_harness_mutated_by_candidate)hard.push('EVALUATOR_HARNESS_MUTATED');
  if(row.task_authored_by_candidate)hard.push('TASK_AUTHORED_BY_CANDIDATE');
  if(row.task_selected_by_candidate)hard.push('TASK_SELECTED_BY_CANDIDATE');
  if(row.source_repository_selected_by_candidate)hard.push('SOURCE_REPOSITORY_SELECTED_BY_CANDIDATE');
  if(row.ingested_into_trusted_memory)hard.push('TASK_INGESTED_INTO_TRUSTED_MEMORY');
  if(row.ingested_into_skill_library)hard.push('TASK_INGESTED_INTO_SKILL_LIBRARY');

  const warnings=[];
  if(row.source_kind==='PUBLIC_STATIC')warnings.push('PUBLIC_STATIC_TASK');
  if(row.searchability==='SEARCHABLE')warnings.push('PROMPT_SEARCHABLE');
  if(row.searchability==='UNKNOWN')warnings.push('PROMPT_SEARCHABILITY_UNKNOWN');
  if(row.evaluator_harness_visible)warnings.push('EVALUATOR_HARNESS_VISIBLE');
  if(!row.task_materialized_after_candidate_freeze)warnings.push('TASK_NOT_MATERIALIZED_AFTER_CANDIDATE_FREEZE');

  let state='UNKNOWN';
  if(hard.length>0)state='CONTAMINATED';
  else if(row.source_kind==='PUBLIC_STATIC'||row.searchability==='SEARCHABLE')state='SUSPECT';
  else {
    const strongSource=['FRESH_PRIVATE_COMMIT','CROSS_REPO_FRESH','DYNAMIC_SEMANTIC_VARIANT','PRIVATE_PRODUCTION_INCIDENT'].includes(row.source_kind);
    const hidden=!row.reference_solution_visible&&!row.hidden_tests_visible&&!row.evaluator_harness_visible;
    const externallySeparated=!row.task_authored_by_candidate&&!row.task_selected_by_candidate&&!row.source_repository_selected_by_candidate;
    const noMemoryLeak=!row.ingested_into_trusted_memory&&!row.ingested_into_skill_library;
    if(strongSource&&hidden&&externallySeparated&&noMemoryLeak&&row.searchability==='NOT_SEARCHABLE')state='CONTAMINATION_RESISTANT';
    else if(warnings.length>0)state='SUSPECT';
  }

  const core={
    schema:RSI_BENCHMARK_CONTAMINATION_ASSESSMENT_SCHEMA,version:1,
    policy_id:checked.policy_id,policy_digest:checked.policy_digest,
    task_id:row.task_id,task_provenance_digest:row.task_provenance_digest,
    risk_state:state,hard_contamination_signals:hard.sort(),warning_signals:warnings.sort(),
    fresh_after_candidate_freeze:row.source_published_after_candidate_freeze,
    task_materialized_after_candidate_freeze:row.task_materialized_after_candidate_freeze,
    cross_repo_source:row.source_repository_digest!==row.candidate_repository_digest,
    dynamic_variant_verified:row.source_kind==='DYNAMIC_SEMANTIC_VARIANT',
    public_static_supplemental_only:row.source_kind==='PUBLIC_STATIC',
    eligible_for_full_holdout_evidence:state==='CONTAMINATION_RESISTANT',
    eligible_for_trusted_experience_memory:state==='CONTAMINATION_RESISTANT',
    eligible_for_skill_library_training: false,
    proven_uncontaminated:false,
    model_training_cutoff_proven:false,
    assessment_is_promotion_authority:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,assessment_digest:digest(core)});
}

export function verifyRsiBenchmarkContaminationAssessment(row,policy,task){
  if(!plainObject(row)||row.schema!==RSI_BENCHMARK_CONTAMINATION_ASSESSMENT_SCHEMA||row.version!==1)throw new Error('rsi_benchmark_assessment_invalid');
  assertZero(row,'assessment');
  if(!RISK_STATES.has(row.risk_state)||row.proven_uncontaminated!==false||row.model_training_cutoff_proven!==false||row.assessment_is_promotion_authority!==false)throw new Error('rsi_benchmark_assessment_policy_invalid');
  const canonical=assessRsiBenchmarkContamination({policy,task});
  if(canonical.assessment_digest!==exactDigest(row.assessment_digest,'assessment'))throw new Error('rsi_benchmark_assessment_digest_mismatch');
  return canonical;
}

export function createRsiBenchmarkEvidenceAdmission({policy,assessments,tasks}={}){
  const checked=verifyRsiBenchmarkProvenancePolicy(policy);
  if(!Array.isArray(assessments)||!Array.isArray(tasks)||assessments.length<1||assessments.length!==tasks.length||tasks.length>MAX_TASKS)throw new Error('rsi_benchmark_admission_inputs_invalid');
  const taskMap=new Map(tasks.map(task=>{const t=verifyRsiBenchmarkTaskProvenance(task,checked);return [t.task_id,t]}));
  if(taskMap.size!==tasks.length)throw new Error('rsi_benchmark_task_duplicate');
  const rows=assessments.map(a=>{
    const task=taskMap.get(a.task_id);if(!task)throw new Error('rsi_benchmark_assessment_task_missing');
    return verifyRsiBenchmarkContaminationAssessment(a,checked,task);
  });
  const resistant=rows.filter(r=>r.risk_state==='CONTAMINATION_RESISTANT');
  const contaminated=rows.filter(r=>r.risk_state==='CONTAMINATED');
  const suspect=rows.filter(r=>r.risk_state==='SUSPECT');
  const unknown=rows.filter(r=>r.risk_state==='UNKNOWN');
  const resistantFamilies=new Set(resistant.map(r=>taskMap.get(r.task_id).source_family));
  const publicStaticCount=tasks.filter(t=>t.source_kind==='PUBLIC_STATIC').length;
  const publicFraction=publicStaticCount/tasks.length;
  const eligible=
    contaminated.length===0
    &&resistant.length>=checked.min_resistant_tasks
    &&resistantFamilies.size>=checked.min_source_families
    &&publicFraction<=checked.max_public_static_fraction;

  const blockers=[];
  if(contaminated.length>0)blockers.push('CONTAMINATED_TASK_PRESENT');
  if(resistant.length<checked.min_resistant_tasks)blockers.push('INSUFFICIENT_RESISTANT_TASKS');
  if(resistantFamilies.size<checked.min_source_families)blockers.push('INSUFFICIENT_SOURCE_DIVERSITY');
  if(publicFraction>checked.max_public_static_fraction)blockers.push('PUBLIC_STATIC_FRACTION_EXCEEDED');

  const core={
    schema:RSI_BENCHMARK_EVIDENCE_ADMISSION_SCHEMA,version:1,
    policy_id:checked.policy_id,policy_digest:checked.policy_digest,
    task_count:tasks.length,resistant_task_count:resistant.length,suspect_task_count:suspect.length,
    contaminated_task_count:contaminated.length,unknown_task_count:unknown.length,
    resistant_source_family_count:resistantFamilies.size,public_static_fraction:publicFraction,
    task_provenance_digests:tasks.map(t=>t.task_provenance_digest).sort(),
    assessment_digests:rows.map(r=>r.assessment_digest).sort(),
    state:eligible?'ELIGIBLE_FOR_FULL_HOLDOUT_EVIDENCE':'HELD_FOR_BENCHMARK_REFRESH',
    blockers:blockers.sort(),
    eligible_for_full_holdout_evidence:eligible,
    eligible_as_sole_promotion_evidence:false,
    public_static_is_supplemental_only:true,
    suspect_or_unknown_counts_toward_required_resistant_set:false,
    contaminated_evidence_weight:0,
    proven_uncontaminated:false,
    existing_evaluator_and_promotion_gates_still_required:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...core,admission_digest:digest(core)});
}

export function rsiBenchmarkProvenanceTrustRootSnapshot(){
  const root={
    schema:'metaengine.rsi.benchmark-provenance-root.v1',version:1,
    policy_path:'apps/metaengine-browser/src/rsi-benchmark-provenance-guard.mjs',
    source_kinds:[...SOURCE_KINDS].sort(),risk_states:[...RISK_STATES].sort(),
    raw_task_content_in_trust_root:false,candidate_can_choose_tasks:false,candidate_can_choose_source_repositories:false,
    candidate_can_label_freshness:false,candidate_can_author_provenance:false,candidate_can_mutate_evaluator_harness:false,
    benchmark_tasks_may_train_trusted_memory:false,benchmark_tasks_may_seed_skill_library:false,
    public_static_can_be_sole_promotion_evidence:false,proven_uncontaminated_claim_allowed:false,
    hidden_tests_required:true,external_provenance_required:true,cross_repo_or_fresh_dynamic_evidence_preferred:true,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,automatic_retry_allowed:false,authority_effect:false,
  };
  return Object.freeze({...root,benchmark_root_digest:digest(root)});
}
