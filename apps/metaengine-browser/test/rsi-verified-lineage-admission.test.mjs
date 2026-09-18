import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import test from 'node:test';

import {
  createRsiShadowTournamentPlan,
  createRsiTournamentPairReceipt,
  evaluateRsiShadowTournament,
} from '../src/rsi-shadow-tournament.mjs';
import { RSI_EVALUATOR_MESH_RESULT_SCHEMA } from '../src/rsi-evaluator-mesh.mjs';
import { RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA } from '../src/rsi-isolated-candidate-builder.mjs';
import { RsiVerifiedEvolutionArchive } from '../src/rsi-verified-evolution-archive.mjs';
import { admitRsiVerifiedLineage } from '../src/rsi-verified-lineage-admission.mjs';

const HARD=[
  'NO_DUPLICATE_IRREVERSIBLE_EFFECT','NO_AUTHORITY_VIOLATION','NO_WORKSPACE_ESCAPE',
  'EXACT_SOURCE_IDENTITY','NO_SECURITY_REGRESSION','NO_AMBIGUOUS_EFFECT_RETRY',
];
const d=(c)=>`sha256:${c.repeat(64)}`;
function stable(v){
  if(Array.isArray(v))return v.map(stable);
  if(!v||typeof v!=='object')return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function digest(v){return `sha256:${crypto.createHash('sha256').update(JSON.stringify(stable(v)),'utf8').digest('hex')}`;}
function hardPass(){return Object.fromEntries(HARD.map(k=>[k,'PASS']));}
function handoff({parent='a'.repeat(40),candidate='b'.repeat(40),id=`candidate_sha256_${'c'.repeat(64)}`,surface='BROWSER_RUNTIME'}={}){
  return {
    schema:RSI_ISOLATED_CANDIDATE_HANDOFF_SCHEMA,version:1,
    experiment_id:'rsi_exp_0123456789abcdef01234567',
    mutation_surface:surface,parent_sha:parent,candidate_sha:candidate,
    target_branch:'work/rsi/lineage-aaaaaaaa-01234567',
    handoff_digest:d('d'),
    candidate_capsule:{
      candidate_id:id,source:{head:candidate},
      components:[{path:'apps/metaengine-browser/src/result-delivery-transport.mjs',change:'CREATE',digest:d('1')}],
    },
    candidate_verification:{ok:true,executable:false,promotion_authorized:false},
    sandbox_plan:{mode:'PREPARE_ONLY'},sandbox_plan_verification:{execution_authorized:false},
    shadow_archive_proposal:{candidate_id:id,parent_sha:parent,candidate_sha:candidate,mutation_surface:surface,hypothesis:'Verified lineage candidate.'},
    eligible_for_evaluation:true,eligible_for_promotion:false,materialization_replay_authorized:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
}
function evaluatorResult(h){
  const core={
    schema:RSI_EVALUATOR_MESH_RESULT_SCHEMA,version:1,
    plan_id:`rsi_eval_${'2'.repeat(64)}`,
    candidate_id:h.candidate_capsule.candidate_id,candidate_sha:h.candidate_sha,
    state:'SHADOW_QUALIFIED',final_digest:'3'.repeat(64),
    receipt_digests:Array.from({length:7},(_,i)=>d(String((i+4)%10))),
    hard_invariants:hardPass(),
    objectives:[{name:'p95_latency_ms',baseline:120,candidate:90,direction:'MINIMIZE',improved:true}],
    eligible_for_promotion:false,
    execution_authority:false,production_mutation_authority:false,promotion_authority:false,self_update_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,result_digest:digest(core)};
}
function verifiedWrapper(h){
  const inner=evaluatorResult(h);
  const core={
    schema:'metaengine.rsi.verified-evaluator-result.v1',version:1,
    candidate_id:h.candidate_capsule.candidate_id,candidate_sha:h.candidate_sha,
    evaluator_plan_digest:d('a'),verified_admission_digest:d('b'),evaluator_result_digest:inner.result_digest,
    evaluator_state:'SHADOW_QUALIFIED',archive_apply_performed:true,
    benchmark_provenance_verified:true,harness_integrity_verified:true,
    mechanical_artifact_audit_verified:true,no_op_ablation_verified:true,sandbox_boundary_verified:true,
    direct_promotion_enabled:false,direct_self_update_enabled:false,
    promotion_authority:false,self_update_authority:false,execution_authority:false,production_mutation_authority:false,
    automatic_retry_allowed:false,authority_effect:false,
  };
  return {...core,result_digest:digest(core),evaluator_result:inner};
}
function workload(){
  return {task_class:'browser-soak',environment_fingerprint:'windows-node-electron',suite_digest:d('e'),holdout_digest:d('f')};
}
function metrics({latency=100,rss=1000}={}){
  return {task_success_rate:1,p95_latency_ms:latency,peak_rss_bytes:rss,recovery_p95_ms:50};
}
function receipts(plan,{candidateLatency=80,candidateRss=1000}={}){
  return Array.from({length:plan.pair_policy.pair_count},(_,i)=>createRsiTournamentPairReceipt({
    plan,pair_index:i+1,order:plan.pair_policy.precommitted_order_schedule[i],seed:plan.pair_policy.precommitted_seed_schedule[i],
    incumbent_metrics:metrics(),candidate_metrics:metrics({latency:candidateLatency,rss:candidateRss}),
    hard_invariants:hardPass(),evidence_refs:[`run:${900+i}`,`pair:${i+1}`],
  }));
}
function tournamentArtifacts(h,v,{candidateLatency=80,candidateRss=1000}={}){
  const plan=createRsiShadowTournamentPlan({candidate_handoff:h,evaluator_result:v.evaluator_result,workload:workload(),pair_count:5});
  const rs=receipts(plan,{candidateLatency,candidateRss});
  return {plan,receipts:rs,result:evaluateRsiShadowTournament({plan,receipts:rs})};
}

test('verified evaluator result enters diverse archive without gaining promotion or skill authority',()=>{
  const archive=new RsiVerifiedEvolutionArchive();
  const h=handoff();
  const v=verifiedWrapper(h);
  const t=tournamentArtifacts(h,v,{candidateLatency:75,candidateRss:1000});
  const admission=admitRsiVerifiedLineage({
    archive,candidate_handoff:h,verified_evaluator_result:v,workload:workload(),
    tournament_receipts:t.receipts,tournament_result:t.result,pair_count:5,
    benchmark_solved:18,benchmark_total:20,
  });
  assert.equal(admission.archive_active,true);
  assert.ok(['PARETO_ELITE','STEPPING_STONE'].includes(admission.archive_state));
  assert.equal(admission.scalar_rank_authoritative,false);
  assert.equal(admission.non_elite_stepping_stones_may_remain_active,true);
  assert.equal(admission.skill_distillation_research_eligible,true);
  assert.equal(admission.direct_skill_library_admission_allowed,false);
  assert.equal(admission.transfer_evidence_required_before_skill_library,true);
  assert.equal(admission.lifecycle_governance_required_before_skill_activation,true);
  assert.equal(admission.eligible_for_promotion,false);
  assert.equal(admission.authority_effect,false);
});

test('tradeoff stepping stone remains active rather than being deleted by scalar ranking',()=>{
  const archive=new RsiVerifiedEvolutionArchive();
  const h=handoff();
  const v=verifiedWrapper(h);
  const t=tournamentArtifacts(h,v,{candidateLatency:75,candidateRss:1300});
  const admission=admitRsiVerifiedLineage({
    archive,candidate_handoff:h,verified_evaluator_result:v,workload:workload(),
    tournament_receipts:t.receipts,tournament_result:t.result,pair_count:5,
    benchmark_solved:15,benchmark_total:20,
  });
  assert.equal(t.result.relation,'TRADEOFF_STEPPING_STONE');
  assert.equal(admission.archive_state,'STEPPING_STONE');
  assert.equal(admission.archive_active,true);
  assert.equal(admission.skill_distillation_research_eligible,true);
});

test('declared parent candidate must already exist and exactly match parent SHA',()=>{
  const archive=new RsiVerifiedEvolutionArchive();
  const h=handoff();
  const v=verifiedWrapper(h);
  const t=tournamentArtifacts(h,v);
  assert.throws(()=>admitRsiVerifiedLineage({
    archive,candidate_handoff:h,verified_evaluator_result:v,workload:workload(),
    tournament_receipts:t.receipts,tournament_result:t.result,pair_count:5,
    parent_candidate_id:`candidate_sha256_${'9'.repeat(64)}`,
    benchmark_solved:10,benchmark_total:20,
  }),/parent_archive_binding_invalid/);
});

test('missing artifact or sandbox verification in evaluator envelope fails before tournament admission',()=>{
  const archive=new RsiVerifiedEvolutionArchive();
  const h=handoff();
  const v=verifiedWrapper(h);
  v.sandbox_boundary_verified=false;
  const t=tournamentArtifacts(h,{...v,sandbox_boundary_verified:true});
  assert.throws(()=>admitRsiVerifiedLineage({
    archive,candidate_handoff:h,verified_evaluator_result:v,workload:workload(),
    tournament_receipts:t.receipts,tournament_result:t.result,pair_count:5,
    benchmark_solved:10,benchmark_total:20,
  }),/verified_evaluator_policy_invalid/);
});
