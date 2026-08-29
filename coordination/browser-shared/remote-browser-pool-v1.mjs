export const REMOTE_BROWSER_POOL_VERSION = '1.0.0';
const ID_RE = /^[a-z0-9][a-z0-9._:-]{2,127}$/;
const CAP_RE = /^[A-Z][A-Z0-9_]{1,63}$/;
const HEALTH = new Set(['HEALTHY','DRAINING','UNHEALTHY']);
const TERMINALS = new Set(['COMMITTED','NO_EFFECT','AMBIGUOUS']);
const cmp = (a,b) => a < b ? -1 : a > b ? 1 : 0;

export class RemoteBrowserPoolError extends Error {
  constructor(code) { super(code); this.name='RemoteBrowserPoolError'; this.code=code; }
}
function token(value,re,code){ if(typeof value!=='string'||!re.test(value)) throw new RemoteBrowserPoolError(code); return value; }
function integer(value,min,max,code){ if(!Number.isInteger(value)||value<min||value>max) throw new RemoteBrowserPoolError(code); return value; }
function bool(value,code){ if(typeof value!=='boolean') throw new RemoteBrowserPoolError(code); return value; }
function exactKeys(value,expected,code){
  if(!value||typeof value!=='object'||Array.isArray(value)) throw new RemoteBrowserPoolError(code);
  const a=Object.keys(value).sort(), b=[...expected].sort();
  if(a.length!==b.length||a.some((k,i)=>k!==b[i])) throw new RemoteBrowserPoolError(code);
}
function capabilities(value,code){
  if(!Array.isArray(value)||value.length>64) throw new RemoteBrowserPoolError(code);
  const out=value.map(v=>token(v,CAP_RE,code)).sort(cmp);
  if(new Set(out).size!==out.length) throw new RemoteBrowserPoolError(code);
  return Object.freeze(out);
}
function freeze(value){ if(value&&typeof value==='object'&&!Object.isFrozen(value)){ Object.freeze(value); for(const child of Object.values(value)) freeze(child); } return value; }
function clone(value){ return value==null?value:structuredClone(value); }

function normalizeNode(input){
  exactKeys(input,['node_id','node_epoch','process_incarnation_id','surface','health','capabilities','context_isolation','raw_engine_exposed','region','max_leases'],'pool_node_fields_invalid');
  const surface=token(input.surface,/^[A-Z][A-Z0-9_]{1,63}$/,'pool_node_surface_invalid');
  if(surface!=='REMOTE_BROWSER_NODE') throw new RemoteBrowserPoolError('pool_node_surface_invalid');
  const health=token(input.health,/^[A-Z]+$/,'pool_node_health_invalid');
  if(!HEALTH.has(health)) throw new RemoteBrowserPoolError('pool_node_health_invalid');
  return freeze({
    node_id:token(input.node_id,ID_RE,'pool_node_id_invalid'),
    node_epoch:integer(input.node_epoch,1,Number.MAX_SAFE_INTEGER,'pool_node_epoch_invalid'),
    process_incarnation_id:token(input.process_incarnation_id,ID_RE,'pool_process_incarnation_invalid'),
    surface,
    health,
    capabilities:capabilities(input.capabilities,'pool_node_capabilities_invalid'),
    context_isolation:bool(input.context_isolation,'pool_node_context_isolation_invalid'),
    raw_engine_exposed:bool(input.raw_engine_exposed,'pool_node_raw_engine_invalid'),
    region:token(input.region,/^[a-z0-9][a-z0-9.-]{1,63}$/,'pool_node_region_invalid'),
    max_leases:integer(input.max_leases,1,1024,'pool_node_max_leases_invalid'),
  });
}

export class RemoteBrowserPoolV1 {
  #nodes=new Map();
  #leases=new Map();

  registerNode(input){
    const node=normalizeNode(input);
    const old=this.#nodes.get(node.node_id);
    if(old && node.node_epoch<=old.node_epoch) throw new RemoteBrowserPoolError('pool_node_epoch_not_advanced');
    if(old) this.#terminateNodeLeases(old,'NODE_REPLACED');
    this.#nodes.set(node.node_id,node);
    return clone(node);
  }

  setNodeHealth({node_id,node_epoch,process_incarnation_id,health}={}){
    const id=token(node_id,ID_RE,'pool_node_id_invalid');
    const node=this.#nodes.get(id); if(!node) throw new RemoteBrowserPoolError('pool_node_not_found');
    if(node.node_epoch!==node_epoch||node.process_incarnation_id!==process_incarnation_id) throw new RemoteBrowserPoolError('pool_node_incarnation_mismatch');
    if(!HEALTH.has(health)) throw new RemoteBrowserPoolError('pool_node_health_invalid');
    const next=freeze({...node,health}); this.#nodes.set(id,next);
    if(health==='UNHEALTHY') this.#terminateNodeLeases(next,'NODE_UNAVAILABLE');
    return clone(next);
  }

  acquireLease({lease_id,action_id,resource_id,required_capabilities=[],now_ms,ttl_ms=120000}={}){
    const leaseId=token(lease_id,ID_RE,'pool_lease_id_invalid');
    if(this.#leases.has(leaseId)) throw new RemoteBrowserPoolError('pool_lease_id_exists');
    const actionId=token(action_id,ID_RE,'pool_action_id_invalid');
    const resourceId=token(resource_id,ID_RE,'pool_resource_id_invalid');
    const required=capabilities(required_capabilities,'pool_required_capabilities_invalid');
    const now=integer(now_ms,0,Number.MAX_SAFE_INTEGER,'pool_now_invalid');
    const ttl=integer(ttl_ms,1000,600000,'pool_ttl_invalid');
    this.sweepExpired(now);
    for(const lease of this.#leases.values()) if(lease.resource_id===resourceId && ['RESERVED','IN_FLIGHT'].includes(lease.state)) throw new RemoteBrowserPoolError('pool_resource_already_leased');

    const eligible=[...this.#nodes.values()].filter(node=>
      node.health==='HEALTHY' && node.context_isolation===true && node.raw_engine_exposed===false &&
      required.every(cap=>node.capabilities.includes(cap)) && this.#activeNodeLeases(node.node_id)<node.max_leases
    ).sort((a,b)=>this.#activeNodeLeases(a.node_id)-this.#activeNodeLeases(b.node_id)||cmp(a.node_id,b.node_id));
    if(!eligible.length) throw new RemoteBrowserPoolError('pool_no_eligible_node');
    const node=eligible[0];
    const lease=freeze({
      version:REMOTE_BROWSER_POOL_VERSION,lease_id:leaseId,action_id:actionId,resource_id:resourceId,
      node_id:node.node_id,node_epoch:node.node_epoch,process_incarnation_id:node.process_incarnation_id,
      required_capabilities:required,state:'RESERVED',actuation_started:false,issued_at_ms:now,expires_at_ms:now+ttl,
      terminal_outcome:null,terminal_reason:null,automatic_retry_allowed:false,authority_effect:false,actuation_eligible:false,
    });
    this.#leases.set(leaseId,lease); return clone(lease);
  }

  validateDispatch({lease_id,node_id,node_epoch,process_incarnation_id,now_ms}={}){
    const lease=this.#requireLease(lease_id); const now=integer(now_ms,0,Number.MAX_SAFE_INTEGER,'pool_now_invalid');
    if(now>=lease.expires_at_ms){ this.sweepExpired(now); throw new RemoteBrowserPoolError('pool_lease_expired'); }
    if(lease.state!=='RESERVED') throw new RemoteBrowserPoolError('pool_lease_not_reserved');
    if(lease.node_id!==node_id||lease.node_epoch!==node_epoch||lease.process_incarnation_id!==process_incarnation_id) throw new RemoteBrowserPoolError('pool_dispatch_incarnation_mismatch');
    const node=this.#nodes.get(lease.node_id);
    if(!node||!['HEALTHY','DRAINING'].includes(node.health)||node.node_epoch!==lease.node_epoch||node.process_incarnation_id!==lease.process_incarnation_id||node.context_isolation!==true||node.raw_engine_exposed!==false) throw new RemoteBrowserPoolError('pool_node_not_dispatch_eligible');
    return freeze({lease_id:lease.lease_id,node_id:lease.node_id,node_epoch:lease.node_epoch,process_incarnation_id:lease.process_incarnation_id,routing_eligible:true,authority_effect:false,actuation_eligible:false,automatic_retry_allowed:false});
  }

  markActuationStarted({lease_id,node_id,node_epoch,process_incarnation_id,now_ms}={}){
    this.validateDispatch({lease_id,node_id,node_epoch,process_incarnation_id,now_ms});
    const lease=this.#requireLease(lease_id);
    const next=freeze({...lease,state:'IN_FLIGHT',actuation_started:true}); this.#leases.set(lease.lease_id,next); return clone(next);
  }

  completeLease({lease_id,outcome,reason_code='EXECUTOR_RECEIPT'}={}){
    const lease=this.#requireLease(lease_id);
    if(!['RESERVED','IN_FLIGHT'].includes(lease.state)) throw new RemoteBrowserPoolError('pool_lease_terminal');
    if(!TERMINALS.has(outcome)) throw new RemoteBrowserPoolError('pool_outcome_invalid');
    if(lease.state==='RESERVED' && outcome!=='NO_EFFECT') throw new RemoteBrowserPoolError('pool_pre_actuation_effect_outcome_invalid');
    if(lease.state==='IN_FLIGHT' && outcome==='NO_EFFECT') throw new RemoteBrowserPoolError('pool_post_actuation_no_effect_invalid');
    return this.#terminalize(lease,outcome,token(reason_code,/^[A-Z][A-Z0-9_]{1,63}$/,'pool_reason_invalid'));
  }

  sweepExpired(now_ms){
    const now=integer(now_ms,0,Number.MAX_SAFE_INTEGER,'pool_now_invalid'); const changed=[];
    for(const lease of [...this.#leases.values()]){
      if(['RESERVED','IN_FLIGHT'].includes(lease.state) && now>=lease.expires_at_ms){
        changed.push(this.#terminalize(lease,lease.state==='IN_FLIGHT'?'AMBIGUOUS':'NO_EFFECT','LEASE_EXPIRED'));
      }
    }
    return changed;
  }

  getLease(id){ const lease=this.#leases.get(token(id,ID_RE,'pool_lease_id_invalid')); return clone(lease||null); }
  snapshot(){ return freeze({version:REMOTE_BROWSER_POOL_VERSION,nodes:[...this.#nodes.values()].map(clone),leases:[...this.#leases.values()].map(clone),auth_state_migration:false,raw_engine_transport_exposed:false,automatic_retry_allowed:false,authority_effect:false,actuation_eligible:false}); }

  #requireLease(id){ const lease=this.#leases.get(token(id,ID_RE,'pool_lease_id_invalid')); if(!lease) throw new RemoteBrowserPoolError('pool_lease_not_found'); return lease; }
  #activeNodeLeases(nodeId){ let n=0; for(const lease of this.#leases.values()) if(lease.node_id===nodeId&&['RESERVED','IN_FLIGHT'].includes(lease.state)) n++; return n; }
  #terminateNodeLeases(node,reason){
    for(const lease of [...this.#leases.values()]) if(lease.node_id===node.node_id&&lease.node_epoch===node.node_epoch&&lease.process_incarnation_id===node.process_incarnation_id&&['RESERVED','IN_FLIGHT'].includes(lease.state)) this.#terminalize(lease,lease.state==='IN_FLIGHT'?'AMBIGUOUS':'NO_EFFECT',reason);
  }
  #terminalize(lease,outcome,reason){
    const next=freeze({...lease,state:'TERMINAL',terminal_outcome:outcome,terminal_reason:reason,automatic_retry_allowed:false,authority_effect:false,actuation_eligible:false});
    this.#leases.set(lease.lease_id,next); return clone(next);
  }
}

export function createRemoteBrowserPoolV1(){ return new RemoteBrowserPoolV1(); }
