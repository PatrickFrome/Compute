import { createHash } from 'node:crypto';
import { FleetProvisioner } from '../../src/fleet-provisioner-core.mjs';
import { createBrowserParentSuspensionMutationGate } from '../../src/browser-parent-suspension-mutation-gate.mjs';
import { createBrowserParentSuspensionTransport } from '../../src/browser-parent-suspension-transport.mjs';
export const hash = s => createHash('sha256').update(s).digest('hex');
export const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export async function fixture() {
  const tabs=new Map(), urls=[], closed=[], frozen=new Set(); let state=null, seq=0, body='confirmed parent transcript'; const transcripts=new Map();
  const deps={policy:{warm_agents:0,desired_agents:1},uuid:()=>id(++seq),
    loadState:async()=>state,saveState:async s=>{state=structuredClone(s);},tabExists:t=>tabs.has(t),
    createTab:async({url})=>{if(tabs.size>=1)throw Error('tab_capacity_exceeded');const tab_id=`tab-${++seq}`;
      tabs.set(tab_id,{url,target_id:`webcontents:${seq}`});urls.push(url);return {tab_id,webcontents_id:seq};},
    loadTab:async(t,url)=>{tabs.get(t).url=url;return {effect_outcome:'CONFIRMED'};}};
  let fleet=new FleetProvisioner(deps);await fleet.init();await fleet.reconcile({active:true,target_agents:1});
  let row=fleet.snapshot().agents.find(a=>a.tab_id); const url=`https://chatgpt.com/c/${id(77)}`;
  tabs.get(row.tab_id).url=url;
  await fleet.markTransportProven({agent_id:row.agent_id,tab_id:row.tab_id,target_id:row.target_id,
    generation_epoch:row.generation_epoch,conversation_url:url,agent_surface_sha256:hash('origin')});
  row=fleet.snapshot().agents.find(a=>a.agent_id===row.agent_id);
  const lease={task_id:id(10),agent_id:row.agent_id,tab_id:row.tab_id,target_id:row.target_id,agent_generation_epoch:row.generation_epoch,lease_generation:1};
  const capture=async t=>({url:tabs.get(t).url,target_id:tabs.get(t).target_id,authority_effect:false,
    semantic_targets:[{role:'textbox',name:'Message ChatGPT',semantic_ref:'ref',value_length:0}]});
  const transport=createBrowserParentSuspensionTransport({gate:createBrowserParentSuspensionMutationGate(),getFleet:()=>fleet,
    capture,transcript:async(t,offset)=>{const text=transcripts.get(tabs.get(t).url) ?? body;return {url:tabs.get(t).url,target_id:tabs.get(t).target_id,offset,
      total_chars:text.length,text:text.slice(offset),has_more:false,census_truncated:false};},
    freeze:async t=>{frozen.add(t);},thaw:async t=>{frozen.delete(t);},
    closeTab:async t=>{tabs.delete(t);closed.push(t);await fleet.onTabClosed(t);},tabExists:t=>tabs.has(t),
    readControl:()=>({authoritative:true,state:'OPEN',continuous_service_allowed:true,generation_floor:1})});
  const context={transcript_floor:0,confirmed_turn_sha256:hash('confirmed'),delivered_tool_results:[],control_generation:1,worktree_custody:null};
  const receipt=c=>({schema:'metaengine.devos.browser-parent-suspension.v1',suspension_id:id(11),task_id:lease.task_id,
    project_id:id(12),old_claim_id:id(13),old_lease_generation:1,checkpoint:c,checkpoint_sha256:hash(JSON.stringify(c)),
    status:'SUSPENDED',state:'WAITING_CHILDREN',lease:null,authority_effect:false,automatic_retry_allowed:false});
  return {transport,lease,context,receipt,tabs,urls,closed,frozen,row,
    setTranscript:(url,text)=>transcripts.set(url,text),capture, fleet:()=>fleet,
    spawn: async task => {
      await fleet.reconcile({active:true,target_agents:1});
      const a=fleet.snapshot().agents.find(a=>a.lifecycle_state==='BOUND_UNVERIFIED');
      const u=`https://chatgpt.com/c/${task}`;tabs.get(a.tab_id).url=u;
      await fleet.markTransportProven({agent_id:a.agent_id,tab_id:a.tab_id,target_id:a.target_id,
        generation_epoch:a.generation_epoch,conversation_url:u,agent_surface_sha256:hash(task)});
      return {task_id:task,agent_id:a.agent_id,tab_id:a.tab_id,target_id:a.target_id,agent_generation_epoch:a.generation_epoch,lease_generation:1};
    },
    restart:async()=>{tabs.clear();fleet=new FleetProvisioner(deps);await fleet.init();},drift:()=>{body+=' changed';}};
}
