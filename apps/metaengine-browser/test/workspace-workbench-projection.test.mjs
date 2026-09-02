import assert from 'node:assert/strict';
import test from 'node:test';
import { projectWorkspaceWorkbench } from '../src/workspace-workbench-projection.mjs';

const workspace='11111111-1111-4111-8111-111111111111';
const coordination='33333333-3333-4333-8333-333333333333';
const task='22222222-2222-4222-8222-222222222222';
const tab='tab_44444444-4444-4444-8444-444444444444';
const binding=(overrides={})=>({workspace_id:workspace,workspace_generation:2,coordination_workspace_id:coordination,task_id:task,claim_id:7,point_id:'c5',repo_id:'PatrickFrome/Compute',base_sha:'a'.repeat(40),branch_name:'work/example',agent_id:'agent_12345678',tab_id:tab,target_id:'webcontents:9',agent_generation_epoch:3,lease_generation:4,lease_expires_at:'2026-09-02T12:00:00.000Z',lease_current:true,state:'READY',ambiguity_code:null,dirty_hold:false,automatic_retry_allowed:false,authority_effect:false,...overrides});
const snapshot=(overrides={})=>({tabs:{selected_tab_id:tab,tabs:[{tab_id:tab,title:'Misleading Project Name',url:'https://chatgpt.com/c/abc',kind:'CHATGPT'},{tab_id:'tab_other',title:'work/example',url:'https://example.com/work/example',kind:'WEB'}]},fleet:{agents:[{agent_id:'agent_12345678',role:'IMPLEMENTER',tab_id:tab,target_id:'webcontents:9',generation_epoch:3,lifecycle_state:'ACTIVE'}]},supervisor:{workspace_bindings:{schema:'metaengine.browser.workspace-binding-observer.v1',state:'AVAILABLE',source_implemented:true,runtime_deployed:true,bindings:[binding()],authority_effect:false}},...overrides});

test('exact current durable binding creates workspace group and leaves unrelated tab as session',()=>{
  const out=projectWorkspaceWorkbench(snapshot());
  assert.equal(out.counts.workspaces,1);
  assert.equal(out.counts.sessions,1);
  assert.equal(out.groups[0].group_id,`workspace:${workspace}:2`);
  assert.equal(out.groups[0].branch_name,'work/example');
  assert.equal(out.groups[0].role,'IMPLEMENTER');
  assert.equal(out.grouping_authority,'DURABLE_WORKSPACE_BINDING_ONLY');
  assert.equal(out.url_heuristic_grouping,false);
  assert.equal(out.title_heuristic_grouping,false);
});

test('stale lease never groups a tab even when title and URL look related',()=>{
  const s=snapshot();s.supervisor.workspace_bindings.bindings=[binding({lease_current:false})];
  const out=projectWorkspaceWorkbench(s);
  assert.equal(out.counts.workspaces,0);
  assert.equal(out.counts.sessions,2);
  assert.equal(out.issues[0].reason,'LEASE_STALE');
});

test('target and generation drift fail closed into issues',()=>{
  const target=snapshot();target.fleet.agents[0].target_id='webcontents:10';
  assert.equal(projectWorkspaceWorkbench(target).issues[0].reason,'TARGET_BINDING_DRIFT');
  const generation=snapshot();generation.fleet.agents[0].generation_epoch=4;
  assert.equal(projectWorkspaceWorkbench(generation).issues[0].reason,'AGENT_GENERATION_DRIFT');
});

test('FROZEN workspace remains visible only when exact current binding still matches',()=>{
  const s=snapshot();s.supervisor.workspace_bindings.bindings=[binding({state:'FROZEN',ambiguity_code:'MATERIALIZATION_EFFECT_AMBIGUOUS'})];
  const out=projectWorkspaceWorkbench(s);
  assert.equal(out.counts.frozen,1);
  assert.equal(out.groups[0].state,'FROZEN');
  assert.equal(out.groups[0].ambiguity_code,'MATERIALIZATION_EFFECT_AMBIGUOUS');
  assert.equal(out.automatic_retry_allowed,false);
});

test('missing or not-deployed runtime creates sessions only and no inferred workspaces',()=>{
  const s=snapshot();s.supervisor.workspace_bindings={state:'RUNTIME_NOT_DEPLOYED',source_implemented:true,runtime_deployed:false,bindings:[],authority_effect:false};
  const out=projectWorkspaceWorkbench(s);
  assert.equal(out.counts.workspaces,0);
  assert.equal(out.counts.sessions,2);
  assert.equal(out.source_state,'RUNTIME_NOT_DEPLOYED');
  assert.equal(out.runtime_deployed,false);
});

test('post-restart replacement tab never inherits predecessor workspace authority',()=>{
  const successorTab='tab_55555555-5555-4555-8555-555555555555';
  const s=snapshot({
    tabs:{selected_tab_id:successorTab,tabs:[
      {tab_id:successorTab,title:'Misleading Project Name',url:'https://chatgpt.com/c/abc',kind:'CHATGPT'},
      {tab_id:'tab_other',title:'work/example',url:'https://example.com/work/example',kind:'WEB'},
    ]},
    fleet:{agents:[{
      agent_id:'agent_12345678',role:'IMPLEMENTER',tab_id:successorTab,target_id:'webcontents:19',generation_epoch:4,lifecycle_state:'BOUND_UNVERIFIED',
    }]},
  });
  const out=projectWorkspaceWorkbench(s);
  assert.equal(out.counts.workspaces,0);
  assert.equal(out.counts.sessions,2);
  assert.equal(out.issues[0].reason,'TAB_NOT_LIVE');
  assert.equal(out.grouping_authority,'DURABLE_WORKSPACE_BINDING_ONLY');
  assert.equal(out.url_heuristic_grouping,false);
  assert.equal(out.title_heuristic_grouping,false);
  assert.equal(out.browser_actuation_authority,false);
  assert.equal(out.automatic_retry_allowed,false);
});
