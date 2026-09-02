const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TARGET_RE=/^webcontents:[1-9][0-9]*$/;

const clone=(v)=>v==null?v:structuredClone(v);
const text=(v,n=240)=>String(v??'').slice(0,n);

function byId(rows,key){const out=new Map();for(const row of rows||[]){const id=String(row?.[key]||'');if(id&&!out.has(id))out.set(id,row)}return out}
function issue(reason,binding,tab=null){return Object.freeze({reason,workspace_id:binding?.workspace_id||null,workspace_generation:Number(binding?.workspace_generation)||null,task_id:binding?.task_id||null,agent_id:binding?.agent_id||null,tab_id:binding?.tab_id||tab?.tab_id||null,target_id:binding?.target_id||null,lease_generation:Number(binding?.lease_generation)||null,authority_effect:false})}

export function projectWorkspaceWorkbench(snapshot={}){
  const tabs=Array.isArray(snapshot?.tabs?.tabs)?snapshot.tabs.tabs:[];
  const fleet=Array.isArray(snapshot?.fleet?.agents)?snapshot.fleet.agents:[];
  const observer=snapshot?.supervisor?.workspace_bindings||null;
  const sourceState=String(observer?.state||'NOT_EXPOSED').toUpperCase();
  const tabMap=byId(tabs,'tab_id');
  const agentMap=byId(fleet,'agent_id');
  const groupedTabIds=new Set();
  const groups=[];
  const issues=[];
  let ready=0;
  let frozen=0;
  let reserved=0;

  if(sourceState==='AVAILABLE'&&Array.isArray(observer?.bindings)){
    for(const binding of observer.bindings){
      const workspaceId=String(binding?.workspace_id||'').toLowerCase();
      const workspaceGeneration=Number(binding?.workspace_generation);
      const tabId=String(binding?.tab_id||'');
      const targetId=String(binding?.target_id||'').toLowerCase();
      const agentId=String(binding?.agent_id||'').toLowerCase();
      const agentGeneration=Number(binding?.agent_generation_epoch);
      const leaseGeneration=Number(binding?.lease_generation);
      if(!UUID_RE.test(workspaceId)||!Number.isSafeInteger(workspaceGeneration)||workspaceGeneration<1||!tabId||!TARGET_RE.test(targetId)||!agentId||!Number.isSafeInteger(agentGeneration)||agentGeneration<1||!Number.isSafeInteger(leaseGeneration)||leaseGeneration<1){issues.push(issue('BINDING_SCHEMA_INVALID',binding));continue}
      const tab=tabMap.get(tabId)||null;
      if(!tab){issues.push(issue('TAB_NOT_LIVE',binding));continue}
      if(binding.lease_current!==true){issues.push(issue('LEASE_STALE',binding,tab));continue}
      const agent=agentMap.get(agentId)||null;
      if(!agent){issues.push(issue('FLEET_AGENT_NOT_LIVE',binding,tab));continue}
      if(String(agent.tab_id||'')!==tabId){issues.push(issue('TAB_BINDING_DRIFT',binding,tab));continue}
      if(String(agent.target_id||'').toLowerCase()!==targetId){issues.push(issue('TARGET_BINDING_DRIFT',binding,tab));continue}
      if(Number(agent.generation_epoch)!==agentGeneration){issues.push(issue('AGENT_GENERATION_DRIFT',binding,tab));continue}
      const state=String(binding.state||'').toUpperCase();
      if(!['READY','FROZEN','RESERVED'].includes(state)){issues.push(issue('WORKSPACE_STATE_INVALID',binding,tab));continue}
      if(state==='READY')ready+=1;else if(state==='FROZEN')frozen+=1;else reserved+=1;
      groupedTabIds.add(tabId);
      groups.push(Object.freeze({
        group_id:`workspace:${workspaceId}:${workspaceGeneration}`,
        workspace_id:workspaceId,
        workspace_generation:workspaceGeneration,
        coordination_workspace_id:String(binding.coordination_workspace_id||'').toLowerCase(),
        task_id:String(binding.task_id||'').toLowerCase(),
        point_id:text(binding.point_id,160),
        repo_id:text(binding.repo_id,240),
        branch_name:text(binding.branch_name,240),
        base_sha:String(binding.base_sha||'').toLowerCase(),
        agent_id:agentId,
        role:text(agent.role,64).toUpperCase(),
        tab_id:tabId,
        target_id:targetId,
        agent_generation_epoch:agentGeneration,
        lease_generation:leaseGeneration,
        lease_expires_at:binding.lease_expires_at||null,
        state,
        ambiguity_code:binding.ambiguity_code||null,
        dirty_hold:binding.dirty_hold===true,
        tab:clone(tab),
        agent:clone(agent),
        current_binding:true,
        automatic_retry_allowed:false,
        page_data_authority:false,
        authority_effect:false,
      }));
    }
  }

  groups.sort((a,b)=>a.branch_name.localeCompare(b.branch_name)||a.group_id.localeCompare(b.group_id));
  const sessions=tabs.filter((tab)=>!groupedTabIds.has(String(tab?.tab_id||''))).map((tab)=>clone(tab));
  return Object.freeze({
    schema:'metaengine.browser.workspace-workbench-projection.v1',
    source_state:sourceState,
    source_implemented:observer?.source_implemented===true,
    runtime_deployed:observer?.runtime_deployed===true?true:(observer?.runtime_deployed===false?false:null),
    groups,
    sessions,
    issues,
    counts:{workspaces:groups.length,sessions:sessions.length,issues:issues.length,ready,frozen,reserved},
    grouping_authority:'DURABLE_WORKSPACE_BINDING_ONLY',
    url_heuristic_grouping:false,
    title_heuristic_grouping:false,
    automatic_retry_allowed:false,
    browser_actuation_authority:false,
    authority_effect:false,
  });
}
