import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { compileMetaPlan, reconcileMetaOrchestrator } from '../src/meta-orchestrator-core.mjs';
import { MetaOrchestratorCycleStage } from '../src/meta-orchestrator-cycle-stage.mjs';

const workspace='11111111-1111-4111-8111-111111111111';
const authority={roadmap_id:'compute-unified-v1',active_milestone_key:'META_ORCHESTRATOR_V1',integration_line:'integration/compute-unified-v1',baseline_sha:'d91e94b307ed60e890aabc53a2678a8ae9c6a79d',alignment_epoch:7};
const plan=compileMetaPlan({authority,plan_generation:3,nodes:[{point_id:'meta.core',role:'IMPLEMENTER',objective:'Implement meta.core',dependencies:[],required_capabilities:['capability.repo_write'],evidence_contract:{required:['ci_green'],min_verified:1},risk:'NORMAL',priority:50}]});
const reconcile=(capacity=2)=>reconcileMetaOrchestrator({plan,observed_alignment_epoch:7,observed_plan_generation:3,leader:{expected_epoch:4,observed_epoch:4},tasks:[],evidence:[],capacity:{available_slots:capacity},policy:{max_parallel_proposals:4}});

test('cycle emits only zero-authority DevOS enqueue proposals and never executes them',async()=>{let calls=0;const stage=new MetaOrchestratorCycleStage({workspace_id:workspace,roadmap_id:'compute-unified-v1',adapter:{async reconcile(){calls++;return reconcile(2)}}});const out=await stage.cycle();assert.equal(calls,1);assert.equal(out.state,'DISPATCH_READY');assert.equal(out.devos_enqueue_proposals.length,1);assert.equal(out.devos_enqueue_proposals[0].rpc,'devos_fleet_enqueue_v1');assert.equal(out.devos_enqueue_proposals[0].scheduler_admission_required,true);assert.equal(out.scheduler_authority,false);assert.equal(out.second_scheduler_loop,false);assert.equal(out.authority_effect,false)});

test('zero scheduler capacity yields request-capacity state and no enqueue proposal',async()=>{const stage=new MetaOrchestratorCycleStage({workspace_id:workspace,roadmap_id:'compute-unified-v1',adapter:{async reconcile(){return reconcile(0)}}});const out=await stage.cycle();assert.equal(out.state,'CAPACITY_WAIT');assert.equal(out.devos_enqueue_proposals.length,0);assert.equal(out.reconcile.actions[0].type,'REQUEST_CAPACITY')});

test('provider failure uses cycle-count backoff and does not spam reads',async()=>{let calls=0;const stage=new MetaOrchestratorCycleStage({workspace_id:workspace,roadmap_id:'compute-unified-v1',providerBackoffCycles:3,adapter:{async reconcile(){calls++;throw new Error('meta_native_authoritative_inputs_http_502')}}});const first=await stage.cycle();assert.equal(first.state,'PROVIDER_NOT_READY');assert.equal(first.provider_error_code,'AUTHORITATIVE_INPUTS_UNAVAILABLE');assert.equal(calls,1);assert.equal((await stage.cycle()).state,'PROVIDER_BACKOFF');assert.equal((await stage.cycle()).state,'PROVIDER_BACKOFF');assert.equal(calls,1);assert.equal((await stage.cycle()).state,'PROVIDER_NOT_READY');assert.equal(calls,2)});

test('scheduler identity laundering in proposal is fenced before DevOS proposal output',async()=>{const bad={...reconcile(2),actions:[{...reconcile(2).actions[0],agent_id:'agent_12345678'}]};const stage=new MetaOrchestratorCycleStage({workspace_id:workspace,roadmap_id:'compute-unified-v1',adapter:{async reconcile(){return bad}}});const out=await stage.cycle();assert.equal(out.state,'PROPOSAL_FENCED');assert.equal(out.devos_enqueue_proposals.length,0);assert.equal(out.scheduler_authority,false)});

test('cycle stage source owns no timer, fetch, RPC, lease or Browser actuator',async()=>{const source=await readFile(new URL('../src/meta-orchestrator-cycle-stage.mjs',import.meta.url),'utf8');for(const forbidden of ['setInterval','setTimeout','fetch(','devos_fleet_lease_v1','TYPED_CLICK','SEMANTIC_TYPE'])assert.equal(source.includes(forbidden),false);assert.match(source,/metaTaskProposalToDevosEnqueue/);assert.match(source,/second_scheduler_loop:false/)});
