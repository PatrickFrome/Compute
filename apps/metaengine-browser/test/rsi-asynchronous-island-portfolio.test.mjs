import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRsiIslandMember,
  verifyRsiIslandMember,
  createRsiIslandState,
  verifyRsiIslandState,
  createRsiIslandPortfolio,
  verifyRsiIslandPortfolio,
  createRsiIslandMigrationPlan,
  verifyRsiIslandMigrationPlan,
  createRsiIslandMigrationReceipt,
  verifyRsiIslandMigrationReceipt,
  createRsiIslandWorkProposals,
  rsiAsynchronousIslandTrustRootSnapshot,
} from '../src/rsi-asynchronous-island-portfolio.mjs';

const sha=(c)=>c.repeat(40);
const d=(c)=>`sha256:${c.repeat(64)}`;
const cid=(c)=>`candidate_sha256_${c.repeat(64)}`;

function member(char,{quality=0.7,novelty=0.5,state='PARETO_ELITE'}={}){
  return createRsiIslandMember({
    member_id:`member.${char}`,
    candidate_id:cid(char),
    candidate_sha:sha(char),
    source_archive_digest:d('a'),
    evaluator_root_digest:d('f'),
    state,
    quality_score:quality,
    novelty_score:novelty,
    features:{complexity:Number.parseInt(char,16)||1,diversity:novelty},
    external_evaluator:true,
    authored_by_candidate:false,
  });
}

function island(id, chars,{health='READY',pending=0,completed=8,budget=16,epoch=3,generation=11}={}){
  return createRsiIslandState({
    island_id:`island.${id}`,
    epoch,
    descriptor:{
      mutation_surface:'BROWSER_RUNTIME',
      model_family:id==='b'?'GLM_5':'GPT_5_6_SOL',
      environment_family:'WINDOWS_BROWSER',
      niche_id:`niche.${id}`,
    },
    members:chars.map((char,index)=>member(char,{quality:0.55+index*0.1,novelty:0.4+index*0.15})),
    health,
    local_generation:generation,
    completed_evaluations:completed,
    pending_external_evaluations:pending,
    work_budget_units:budget,
    external_owner:true,
    authored_by_candidate:false,
  });
}

function portfolio(){
  return createRsiIslandPortfolio({
    portfolio_id:'portfolio.rsi.islands.1',
    epoch:7,
    islands:[
      island('a',['1','2']),
      island('b',['3','4']),
      island('c',['5','6']),
    ],
    migration_interval:4,
    migration_rate:0.2,
    external_owner:true,
    authored_by_candidate:false,
  });
}

test('member and island state are external evidence with no scheduler/promotion authority',()=>{
  const m=member('1');
  verifyRsiIslandMember(m);
  assert.equal(m.external_evaluator,true);
  assert.equal(m.authored_by_candidate,false);
  assert.equal(m.member_is_scheduler_authority,false);
  assert.equal(m.member_is_promotion_authority,false);
  assert.equal(m.authority_effect,false);

  const i=island('a',['1','2']);
  verifyRsiIslandState(i);
  assert.equal(i.independent_progress_allowed,true);
  assert.equal(i.global_generation_barrier_required,false);
  assert.equal(i.scheduler_owned_by_island,false);
  assert.equal(i.candidate_can_edit_island_state,false);
  assert.equal(i.authority_effect,false);
});

test('portfolio is asynchronous but explicitly reuses the one existing scheduler',()=>{
  const p=portfolio();
  verifyRsiIslandPortfolio(p);
  assert.equal(p.asynchronous_islands,true);
  assert.equal(p.global_generation_barrier_required,false);
  assert.equal(p.one_existing_scheduler_required,true);
  assert.equal(p.second_scheduler_allowed,false);
  assert.equal(p.migration_topology,'DETERMINISTIC_RING');
  assert.equal(p.bounded_migration,true);
  assert.equal(p.target_validation_required_after_migration,true);
  assert.equal(p.migration_is_promotion,false);
  assert.equal(p.authority_effect,false);
});

test('migration rate is hard bounded to avoid rapid island homogenization',()=>{
  assert.throws(()=>createRsiIslandPortfolio({
    portfolio_id:'portfolio.too-much-gene-flow',
    epoch:1,
    islands:[island('a',['1']),island('b',['2'])],
    migration_interval:4,
    migration_rate:0.25,
    external_owner:true,
    authored_by_candidate:false,
  }),/migration_rate_invalid/);
});

test('no migration is proposed outside the deterministic interval',()=>{
  const p=portfolio();
  const plan=createRsiIslandMigrationPlan({portfolio:p,migration_round:3});
  verifyRsiIslandMigrationPlan(plan,p);
  assert.equal(plan.state,'NO_MIGRATION_DUE');
  assert.equal(plan.migration_due,false);
  assert.equal(plan.route_count,0);
  assert.equal(plan.scheduler_action_authorized,false);
  assert.equal(plan.second_scheduler_allowed,false);
});

test('ring migration is bounded, deterministic and requires target revalidation before parent use',()=>{
  const p=portfolio();
  const left=createRsiIslandMigrationPlan({portfolio:p,migration_round:4});
  const right=createRsiIslandMigrationPlan({portfolio:p,migration_round:4});
  verifyRsiIslandMigrationPlan(left,p);
  assert.equal(left.plan_digest,right.plan_digest);
  assert.deepEqual(left.routes,right.routes);
  assert.equal(left.state,'MIGRATION_DUE');
  assert.equal(left.route_count,3,'two-member islands at 20% migrate exactly one member each');
  const routesBySource=new Map(left.routes.map(row=>[row.source_island_id,row]));
  assert.equal(routesBySource.get('island.a').target_island_id,'island.b');
  assert.equal(routesBySource.get('island.b').target_island_id,'island.c');
  assert.equal(routesBySource.get('island.c').target_island_id,'island.a');
  for(const route of left.routes){
    assert.equal(route.target_validation_required,true);
    assert.equal(route.migrant_becomes_parent_before_validation,false);
    assert.equal(route.migration_is_promotion,false);
    assert.equal(route.scheduler_action_authorized,false);
  }
});

test('stale island epoch/state fences invalidate migration plans',()=>{
  const p=portfolio();
  const plan=createRsiIslandMigrationPlan({portfolio:p,migration_round:4});
  const stale=createRsiIslandPortfolio({
    portfolio_id:p.portfolio_id,
    epoch:p.epoch,
    islands:[
      island('a',['1','2'],{epoch:4}),
      island('b',['3','4']),
      island('c',['5','6']),
    ],
    migration_interval:p.migration_interval,
    migration_rate:p.migration_rate,
    external_owner:true,
    authored_by_candidate:false,
  });
  assert.throws(()=>verifyRsiIslandMigrationPlan(plan,stale),/policy_invalid|fence_invalid|digest/);
});

test('migrant becomes eligible for target parent pool only after external target validation',()=>{
  const p=portfolio();
  const plan=createRsiIslandMigrationPlan({portfolio:p,migration_round:4});
  const route=plan.routes[0];
  assert.throws(()=>createRsiIslandMigrationReceipt({
    plan,portfolio:p,route_id:route.route_id,outcome:'TARGET_VALIDATED',
    target_holdout_digest:d('b'),target_evaluator_root_digest:d('f'),
    target_quality_score:0.8,target_novelty_score:0.6,target_hard_invariants_pass:false,
    external_target_evaluator:true,authored_by_candidate:false,
  }),/validated_without_hard_invariants/);

  const receipt=createRsiIslandMigrationReceipt({
    plan,portfolio:p,route_id:route.route_id,outcome:'TARGET_VALIDATED',
    target_holdout_digest:d('b'),target_evaluator_root_digest:d('f'),
    target_quality_score:0.8,target_novelty_score:0.6,target_hard_invariants_pass:true,
    external_target_evaluator:true,authored_by_candidate:false,
  });
  verifyRsiIslandMigrationReceipt(receipt,plan,p);
  assert.equal(receipt.eligible_for_target_parent_pool,true);
  assert.equal(receipt.migration_is_promotion,false);
  assert.equal(receipt.scheduler_action_authorized,false);
  assert.equal(receipt.authority_effect,false);
});

test('rejected or uncertain migration never becomes a target parent',()=>{
  const p=portfolio();
  const plan=createRsiIslandMigrationPlan({portfolio:p,migration_round:4});
  for(const outcome of ['TARGET_REJECTED','TARGET_EVIDENCE_INSUFFICIENT']){
    const receipt=createRsiIslandMigrationReceipt({
      plan,portfolio:p,route_id:plan.routes[0].route_id,outcome,
      target_holdout_digest:d('b'),target_evaluator_root_digest:d('f'),
      target_quality_score:0.3,target_novelty_score:0.7,target_hard_invariants_pass:false,
      external_target_evaluator:true,authored_by_candidate:false,
    });
    assert.equal(receipt.eligible_for_target_parent_pool,false);
  }
});

test('islands propose work independently without creating tasks, leases or second scheduler',()=>{
  const p=createRsiIslandPortfolio({
    portfolio_id:'portfolio.work.1',epoch:1,
    islands:[
      island('a',['1','2'],{pending:0,completed:8,budget:12}),
      island('b',['3','4'],{pending:10,completed:2,budget:12}),
      island('c',['5','6'],{health:'PAUSED'}),
    ],
    migration_interval:5,migration_rate:0.1,external_owner:true,authored_by_candidate:false,
  });
  const work=createRsiIslandWorkProposals({portfolio:p,proposal_round:9,max_proposals:8});
  assert.equal(work.asynchronous_islands,true);
  assert.equal(work.global_generation_barrier_required,false);
  assert.equal(work.existing_scheduler_admission_required,true);
  assert.equal(work.scheduler_action_authorized,false);
  assert.equal(work.second_scheduler_allowed,false);
  assert.equal(work.proposal_count,2);
  assert.equal(work.proposals.some(row=>row.island_id==='island.c'),false);
  for(const row of work.proposals){
    assert.equal(row.work_proposal_is_task,false);
    assert.equal(row.work_proposal_is_lease,false);
    assert.equal(row.existing_scheduler_admission_required,true);
    assert.equal(row.scheduler_action_authorized,false);
    assert.equal(row.authority_effect,false);
  }
});

test('island trust root records async/QD mechanics without scheduler authority',()=>{
  const root=rsiAsynchronousIslandTrustRootSnapshot();
  assert.equal(root.asynchronous_islands,true);
  assert.equal(root.map_elites_compatible_members,true);
  assert.equal(root.deterministic_ring_migration,true);
  assert.equal(root.bounded_migration_rate_max,0.2);
  assert.equal(root.target_validation_required_after_migration,true);
  assert.equal(root.global_generation_barrier_required,false);
  assert.equal(root.one_existing_scheduler_required,true);
  assert.equal(root.second_scheduler_allowed,false);
  assert.equal(root.scheduler_action_authorized,false);
  assert.equal(root.migration_is_promotion,false);
  assert.equal(root.authority_effect,false);
  assert.match(root.island_root_digest,/^sha256:[0-9a-f]{64}$/);
});
