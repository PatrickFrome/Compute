import { assertZeroAuthorityMetaOutput } from './meta-orchestrator-core.mjs';
import { metaTaskProposalToDurableAdmission } from './meta-orchestrator-devos-adapter.mjs';

const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROADMAP_RE=/^[a-z0-9][a-z0-9._:-]{2,159}$/;

function workspaceId(value){const out=String(value||'').toLowerCase();if(!UUID_RE.test(out))throw new Error('meta_cycle_workspace_id_invalid');return out}
function roadmapId(value){const out=String(value||'').trim().toLowerCase();if(!ROADMAP_RE.test(out))throw new Error('meta_cycle_roadmap_id_invalid');return out}
function positive(value,name){const out=Number(value);if(!Number.isSafeInteger(out)||out<1)throw new Error(`meta_cycle_${name}_invalid`);return out}
function classifyProviderError(error){const message=String(error?.message||error||'').toLowerCase();if(message.includes('device_not_enrolled'))return'DEVICE_NOT_ENROLLED';if(message.includes('active_plan_missing'))return'ACTIVE_PLAN_MISSING';if(message.includes('http_404'))return'PROVIDER_ROUTE_UNAVAILABLE';if(message.includes('http_401'))return'PROVIDER_AUTH_REJECTED';if(message.includes('authoritative_inputs'))return'AUTHORITATIVE_INPUTS_UNAVAILABLE';return'PROVIDER_UNAVAILABLE'}
function baseState(extra={}){return{schema:'metaengine.meta-orchestrator.cycle-stage.v2',state:'IDLE',cycle_seq:0,provider_probe:false,next_provider_probe_cycle:1,reconcile:null,task_admission_proposals:[],devos_enqueue_proposals:[],direct_enqueue_disabled:true,automatic_retry_allowed:false,task_content_authority:false,scheduler_authority:false,browser_authority:false,release_authority:false,second_scheduler_loop:false,authority_effect:false,...extra}}

export class MetaOrchestratorCycleStage{
  #adapter;
  #workspaceId;
  #roadmapId;
  #providerBackoffCycles;
  #cycleSeq=0;
  #nextProviderProbeCycle=1;
  #last=baseState();

  constructor({adapter,workspace_id,roadmap_id='metaengine-development-os-v1',providerBackoffCycles=30}={}){
    if(!adapter||typeof adapter.reconcile!=='function')throw new Error('meta_cycle_adapter_required');
    this.#adapter=adapter;
    this.#workspaceId=workspaceId(workspace_id);
    this.#roadmapId=roadmapId(roadmap_id);
    this.#providerBackoffCycles=positive(providerBackoffCycles,'provider_backoff_cycles');
  }

  snapshot(){return structuredClone(this.#last)}

  async cycle({leader={},policy={},worker_observer=null}={}){
    this.#cycleSeq+=1;
    if(this.#cycleSeq<this.#nextProviderProbeCycle)return this.#record({state:'PROVIDER_BACKOFF',provider_probe:false,next_provider_probe_cycle:this.#nextProviderProbeCycle});

    let reconcile;
    try{
      reconcile=await this.#adapter.reconcile({workspace_id:this.#workspaceId,roadmap_id:this.#roadmapId,leader,policy,worker_observer});
    }catch(error){
      this.#nextProviderProbeCycle=this.#cycleSeq+this.#providerBackoffCycles;
      return this.#record({state:'PROVIDER_NOT_READY',provider_probe:true,next_provider_probe_cycle:this.#nextProviderProbeCycle,provider_error_code:classifyProviderError(error)});
    }

    this.#nextProviderProbeCycle=this.#cycleSeq+1;
    try{assertZeroAuthorityMetaOutput(reconcile)}catch{return this.#record({state:'RECONCILE_FENCED',provider_probe:true,next_provider_probe_cycle:this.#nextProviderProbeCycle})}

    const proposals=[];
    try{
      for(const action of Array.isArray(reconcile.actions)?reconcile.actions:[]){
        if(action?.type!=='PROPOSE_TASK')continue;
        proposals.push(metaTaskProposalToDurableAdmission(action,{workspace_id:this.#workspaceId}));
      }
    }catch{return this.#record({state:'PROPOSAL_FENCED',provider_probe:true,next_provider_probe_cycle:this.#nextProviderProbeCycle,reconcile:structuredClone(reconcile)})}

    return this.#record({state:String(reconcile.state||'UNKNOWN'),provider_probe:true,next_provider_probe_cycle:this.#nextProviderProbeCycle,reconcile:structuredClone(reconcile),task_admission_proposals:proposals});
  }

  #record(extra={}){this.#last=Object.freeze(baseState({cycle_seq:this.#cycleSeq,...extra}));return this.snapshot()}
}
