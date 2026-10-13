// W5/P3 advisory DAG admission for the existing /v1/devos/cycle leased executor.
// This code has no timers, claims, RPCs or effect authority; PostgreSQL claim
// transaction is the final arbiter. Unproven dependencies are never promoted.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA=/^[0-9a-f]{64}$/i;
export const FLEET_DAG_LIMITS=Object.freeze({
  tasks:128,dependencies:16,global:16,
  roles:Object.freeze({IMPLEMENTER:8,RESEARCHER:4,CRITIC:4}),
  resources:Object.freeze({BROWSER:12,COMPUTE:8,HOST:2}),
});
const upper=x=>String(x||'').toUpperCase();
const spec=t=>t?.task_spec?.fleet_coordination_v1??t?.fleet_coordination_v1;
const id=t=>String(t?.task_id||'').toLowerCase();
const opt=t=>spec(t)!==undefined;
function valid(t){
  const s=spec(t);
  if(!s||typeof s!=='object'||Array.isArray(s)||s.version!==1||!Object.hasOwn(FLEET_DAG_LIMITS.roles,upper(t.role))||upper(s.role)!==upper(t.role))return false;
  if(!Object.hasOwn(FLEET_DAG_LIMITS.resources,upper(s.resource))||!Number.isSafeInteger(s.slots)||s.slots<1||s.slots>2)return false;
  if(!Array.isArray(s.dependencies)||s.dependencies.length>FLEET_DAG_LIMITS.dependencies)return false;
  const deps=s.dependencies.map(String);
  return deps.every(d=>UUID.test(d)&&d.toLowerCase()!==id(t))&&new Set(deps.map(d=>d.toLowerCase())).size===deps.length;
}
export function planFleetDagAdmission(snapshot){
  const tasks=snapshot?.active_tasks;
  if(!Array.isArray(tasks)||!tasks.some(opt))return null; // legacy lane unchanged
  const blocked={},roles={};
  const result=(state,ready,remaining)=>Object.freeze({
    schema:'metaengine.fleet-dag-admission.v1',state,ready,by_role:Object.freeze(roles),
    blocked:Object.freeze(blocked),remaining_slots:remaining,
    scheduler_authority:false,authority_effect:false,automatic_retry_allowed:false,
    second_scheduler_loop:false,lease_authority:'EXISTING_DEVOS_FLEET_LEASE_V1',
  });
  const claims=snapshot?.active_claims, completed=snapshot?.completed_tasks;
  if(tasks.length>FLEET_DAG_LIMITS.tasks||!Array.isArray(claims)||claims.length>FLEET_DAG_LIMITS.tasks
    ||completed!==undefined&&(!Array.isArray(completed)||completed.length>FLEET_DAG_LIMITS.tasks)){
    blocked['*']='BOUNDS_OR_READBACK_UNKNOWN';return result('FENCED',0,0);
  }
  const byId=new Map();
  for(const t of [...tasks,...(completed||[])]){
    if(!UUID.test(id(t))||byId.has(id(t))){blocked['*']='TASK_ID_CONFLICT';return result('FENCED',0,0);}
    byId.set(id(t),t);
  }
  const visiting=new Set(),visited=new Set(),bad=new Set();
  function walk(t,depth){
    const key=id(t);
    if(visiting.has(key)||depth>FLEET_DAG_LIMITS.tasks)return false;
    if(visited.has(key))return !bad.has(key);
    visited.add(key);
    if(!opt(t))return true;
    if(!valid(t)){bad.add(key);return false;}
    visiting.add(key);
    let ok=true;
    for(const d of spec(t).dependencies){
      const child=byId.get(String(d).toLowerCase());
      if(child&&!walk(child,depth+1))ok=false;
    }
    visiting.delete(key);
    if(!ok)bad.add(key);
    return ok;
  }
  tasks.filter(opt).forEach(t=>walk(t,0));
  const occupied=Math.max(claims.filter(c=>upper(c.state)==='ACTIVE').length,
    tasks.filter(t=>['LEASED','RUNNING'].includes(upper(t.state))).length);
  const remaining=Math.max(0,FLEET_DAG_LIMITS.global-occupied);
  const usedRole={},usedResource={};
  for(const t of tasks.filter(t=>['LEASED','RUNNING'].includes(upper(t.state)))){
    const r=upper(t.role),s=spec(t);
    usedRole[r]=(usedRole[r]||0)+1;
    const resource=Object.hasOwn(FLEET_DAG_LIMITS.resources,upper(s?.resource))?upper(s.resource):'BROWSER';
    usedResource[resource]=(usedResource[resource]||0)+(Number.isSafeInteger(s?.slots)?s.slots:1);
  }
  const ready=tasks.filter(t=>upper(t.state)==='READY').sort((a,b)=>
    (Number(b.priority)||0)-(Number(a.priority)||0)||
    String(a.created_at||'').localeCompare(String(b.created_at||''))||id(a).localeCompare(id(b)));
  let admitted=0,reserved=0;
  for(const t of ready){
    const key=id(t),s=spec(t),role=upper(t.role);
    if(!opt(t)){roles[role]=(roles[role]||0)+1;admitted++;continue;}
    let reason=!valid(t)?'GRAPH_INVALID':bad.has(key)?'GRAPH_CYCLE_OR_ANCESTOR_INVALID':null;
    if(!reason)for(const depId of s.dependencies){
      const dep=byId.get(String(depId).toLowerCase());
      if(!dep||upper(dep.state)!=='COMPLETED'||!SHA.test(String(dep.result_sha256||''))
        ||dep.proof_verified!==true||dep.authority_effect!==false){reason='DEPENDENCY_PROOF_UNKNOWN';break;}
      if(role==='CRITIC'&&dep.lease_agent_id&&dep.lease_agent_id===t.lease_agent_id){reason='CRITIC_NOT_INDEPENDENT';break;}
    }
    const resource=upper(s?.resource);
    if(!reason&&reserved>=remaining)reason='GLOBAL_SLOTS_FULL';
    if(!reason&&(usedRole[role]||0)>=FLEET_DAG_LIMITS.roles[role])reason='ROLE_SLOTS_FULL';
    if(!reason&&(usedResource[resource]||0)+s.slots>FLEET_DAG_LIMITS.resources[resource])reason='RESOURCE_SLOTS_FULL';
    if(reason){blocked[key]=reason;continue;}
    usedRole[role]=(usedRole[role]||0)+1;usedResource[resource]=(usedResource[resource]||0)+s.slots;
    reserved++;admitted++;roles[role]=(roles[role]||0)+1;
  }
  return result(Object.keys(blocked).length?'DEGRADED':'OPEN',admitted,remaining);
}
