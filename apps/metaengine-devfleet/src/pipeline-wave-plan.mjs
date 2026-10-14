// Advisory-only bounded planner for DevFleet coding waves.
// The existing owner/operator remains the sole authority for all tab effects.
const idRe=/^[a-zA-Z0-9._:-]{12,100}$/;
const shaRe=/^[a-f0-9]{40}$/;
const roles=['researcher','implementer','critic'];
const statuses=['PENDING','ACTIVE','DONE','FAILED','UNKNOWN'];
const int=(n,lo,hi)=>Number.isSafeInteger(n)&&n>=lo&&n<=hi;
const invalid=msg=>{throw Error('pipeline_plan_'+msg);};
export function proposeCodingWave(input) {
 if(!input||typeof input!=='object'||Array.isArray(input))invalid('input_invalid');
 const {tasks,source_sha,open_tab_ids=[],retiring_tab_ids=[],
   free_ram_mb,max_hot_tabs=4,max_wave=4,memory_reserve_mb=512,mb_per_tab=256,
   historical_request_ids=[]}=input;
 if(!shaRe.test(source_sha||''))invalid('source_sha_invalid');
 if(!Array.isArray(tasks)||tasks.length>128||tasks.length<1)invalid('tasks_invalid');
 if(!Array.isArray(open_tab_ids)||open_tab_ids.length>16||
    !Array.isArray(retiring_tab_ids)||retiring_tab_ids.length>4)invalid('tabs_invalid');
 for(const n of [free_ram_mb,max_hot_tabs,max_wave,memory_reserve_mb,mb_per_tab])
  if(!Number.isSafeInteger(n)||n<0)invalid('budget_invalid');
 if(!int(max_hot_tabs,1,8)||!int(max_wave,1,4)||
    !int(mb_per_tab,128,2048)||!int(memory_reserve_mb,128,16384)||
    !int(free_ram_mb,0,1048576))invalid('budget_out_of_range');
 const tabIds=new Set(open_tab_ids);
 if(tabIds.size!==open_tab_ids.length||[...tabIds].some(x=>!/^tab_[a-f0-9-]{36}$/i.test(x)))
  invalid('tab_ids_invalid');
 const retiring=new Set(retiring_tab_ids);
 if(retiring.size!==retiring_tab_ids.length||[...retiring].some(x=>!tabIds.has(x)))
  invalid('retiring_tab_ids_invalid');
 if(!Array.isArray(historical_request_ids)||historical_request_ids.length>5000||
    historical_request_ids.some(x=>!idRe.test(x)))invalid('history_invalid');
 const oldIds=new Set(historical_request_ids);
 const map=new Map(),requests=new Set();
 for(const t of tasks) {
  if(!t||typeof t!=='object'||Array.isArray(t)||
    !idRe.test(t.task_id)||!idRe.test(t.request_id)||
    !roles.includes(t.role)||!statuses.includes(t.state)||
    !Array.isArray(t.depends_on)||t.depends_on.length>16||
    t.depends_on.some(x=>!idRe.test(x))||
    !int(t.priority,0,100)||!int(t.created_seq,0,1e9)||
    !['CODE_ONLY','EXTERNAL_EFFECT'].includes(t.effect_scope)||
    !shaRe.test(t.source_sha||''))
      invalid('task_contract_invalid');
  if(map.has(t.task_id)||requests.has(t.request_id))invalid('task_identity_conflict');
  requests.add(t.request_id);map.set(t.task_id,t);
 }
 const eligible=[],blocked=[];
 for(const t of tasks){
  if(t.state!=='PENDING'){blocked.push({task_id:t.task_id,reason:'NOT_PENDING'});continue;}
  if(t.effect_scope!=='CODE_ONLY'){blocked.push({task_id:t.task_id,reason:'EXTERNAL_EFFECT_FORBIDDEN'});continue;}
  if(t.source_sha!==source_sha){blocked.push({task_id:t.task_id,reason:'SOURCE_SHA_MISMATCH'});continue;}
  if(oldIds.has(t.request_id)){blocked.push({task_id:t.task_id,reason:'REQUEST_ID_ALREADY_USED'});continue;}
  if(new Set(t.depends_on).size!==t.depends_on.length ||
    t.depends_on.includes(t.task_id)){blocked.push({task_id:t.task_id,reason:'DEPENDENCY_CONFLICT'});continue;}
  if(t.depends_on.some(id=>map.get(id)?.state!=='DONE')){
    blocked.push({task_id:t.task_id,reason:'DEPENDENCY_NOT_PROVEN_DONE'});continue;
  }
  eligible.push(t);
 }
 eligible.sort((a,b)=>b.priority-a.priority||a.created_seq-b.created_seq||a.task_id.localeCompare(b.task_id));
 const projected_hot=tabIds.size-retiring.size;
 const freePhysical=Math.max(0,max_hot_tabs-projected_hot);
 const memSlots=Math.max(0,Math.floor((free_ram_mb-memory_reserve_mb)/mb_per_tab));
 const capacity=Math.max(0,Math.min(max_wave,freePhysical,memSlots));
 const picked=[],remaining=[...eligible];
 // Fair role mix while retaining priority within each role.
 let roleIndex=0;
 while(picked.length<capacity&&remaining.length){
  let chosen=-1;
  for(let shift=0;shift<roles.length;shift++){
    const role=roles[(roleIndex+shift)%roles.length];
    chosen=remaining.findIndex(t=>t.role===role);
    if(chosen>=0){roleIndex=(roleIndex+shift+1)%roles.length;break;}
  }
  if(chosen<0)break;
  const t=remaining.splice(chosen,1)[0];
  picked.push({task_id:t.task_id,request_id:t.request_id,role:t.role,
    source_sha:t.source_sha,priority:t.priority});
 }
 for(const t of remaining)blocked.push({task_id:t.task_id,reason:'CAPACITY_EXCEEDED'});
 return {schema:'metaengine.devfleet.coding-wave-plan.v1',state:'PROPOSED_ONLY',
   source_sha,active_tabs:tabIds.size,retiring_tabs:retiring.size,
   projected_hot_tabs:projected_hot,capacity,selected:picked,blocked,
   memory_budget_mb:free_ram_mb,authority_effect:false,
   dispatch_performed:false,automatic_retry_allowed:false};
}
