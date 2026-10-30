import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as jsx from 'react/jsx-runtime';
import {renderToStaticMarkup} from 'react-dom/server';
import {projectNativeRuntimeBadge} from './client-native-runtime-badge.ts';
import {projectClientWorkBadge} from './client-work-badge-text.mjs';
const code=ts.transpileModule(fs.readFileSync(new URL('../components/me2/shell/topbar.tsx',import.meta.url),'utf8'),
 {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
test('shipped TopBar renders native bookkeeping independently and clears it on disconnect without commands',()=>{
 let reads=0;const calls=[];
 const runtime={state:'LIVE',readback:{connection:{local_runtime_ready:true,admin_ready:true,native_runtime:{
 schema:'metaengine.client.native-runtime-observation.v1',observed_at:new Date().toISOString(),state:'OBSERVED',closed:false,
 physical_slot_budget:4,retained_records:1,counts:{preparing:0,running:0,result_ready:0,readback_required:1,other:0},
 logical_agent_limit:null,readback_only:true,physical_execution_proven:false,useful_work_verified:false,authority_effect:false}},work:null}};
 const exports={};const imports={
 'react/jsx-runtime':jsx,
 '@/components/me2/store':{useMe2:selector=>selector({page:'browser',setPalette:()=>calls.push('palette'),setPage:()=>calls.push('page')})},
 '@/hooks/use-client-runtime-status':{useClientRuntimeStatus:()=>{reads++;return runtime;}},
 '@/lib/client-native-runtime-badge':{projectNativeRuntimeBadge},
 '@/lib/client-work-badge-text.mjs':{projectClientWorkBadge},
 '@/lib/client-readiness-labels':{capabilityLabel:()=>{throw Error('unexpected_work_read');}},
 };
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});
 const render=()=>renderToStaticMarkup(exports.TopBar({}));
 const html=render();assert.match(html,/Native: 1 need readback/);assert.match(html,/require separate verification/);
 assert.doesNotMatch(html,/Native: ready|Native: verified/i);assert.match(html,/data-native-state="OBSERVED"/);
 runtime.state='UNAVAILABLE';const disconnected=render();assert.match(disconnected,/Native: unknown/);assert.doesNotMatch(disconnected,/Native: 1 need readback/);
 assert.equal(reads,2);assert.deepEqual(calls,[]);
});

const visualSource=fs.readFileSync(new URL('../../../metaengine-browser/test/me2-r85-visual-evidence.mjs',import.meta.url),'utf8');
const visualCheck=reason=>{
 const line=visualSource.split('\n').find(line=>line.trim().startsWith('if (')&&line.includes("throw new Error('"+reason+"')"));
 assert.ok(line,'the actual W69 assertion must remain registered: '+reason);return line;
};
for(const state of ['BLOCKED','READY'])test(`W69 exact badge assertion accepts shipped ${state} TopBar without granting autonomous readiness`,()=>{
 const calls=[],ready=state==='READY';
 const runtime={state:'LIVE',readback:{connection:{local_runtime_ready:true,admin_ready:true},work:{
  schema:'metaengine.client.work-readiness.v1',state,reason:ready?null:'SUPERVISOR_RECOVERY_REQUIRED',
  execution_ready:ready,automatic_retry_allowed:false,authority_effect:false,continuous_autonomy_ready:false,
  label:ready?'Chats ready':'Recovery required',detail:'Synthetic UI readback',
  capabilities:{chat_dispatch:{ready},coding_execution:{ready:false},host_continuity:{ready:false},continuous_autonomy:{ready:false}},
 }}};
 const exports={},imports={
  'react/jsx-runtime':jsx,
  '@/components/me2/store':{useMe2:select=>select({page:'browser',setPalette:()=>calls.push('palette'),setPage:()=>calls.push('page')})},
  '@/hooks/use-client-runtime-status':{useClientRuntimeStatus:()=>runtime},
  '@/lib/client-native-runtime-badge':{projectNativeRuntimeBadge},
  '@/lib/client-work-badge-text.mjs':{projectClientWorkBadge},
  '@/lib/client-readiness-labels':{capabilityLabel:()=> 'Unavailable'},
 };
 vm.runInNewContext(code,{exports,require:name=>{assert.ok(Object.hasOwn(imports,name),name);return imports[name];}});
 const html=renderToStaticMarkup(exports.TopBar({}));
 const button=html.match(/<button[^>]*data-testid="admin-connection-badge"[^>]*>[\s\S]*?<\/button>/)?.[0];
 assert.ok(button);
 const badge={text:button.replace(/<[^>]*>/g,''),state:button.match(/data-work-state="([^"]*)"/)[1],
  autonomous_ready_color:button.includes('text-emerald-300')};
 assert.equal(badge.text,ready?'Chat: Chats ready':'Chat: Recovery required');
 assert.equal(badge.state,state);assert.equal(badge.autonomous_ready_color,false);assert.deepEqual(calls,[]);
 if(ready){
  const check=visualCheck('ui1_positive_chat_readiness_label_missing')+'\n'+visualCheck('ui1_chat_readiness_masquerades_as_autonomous_coding');
  const run=value=>vm.runInNewContext(check,{readyCapture:{metrics:{work_badge:value}}});
  run(badge);assert.throws(()=>run({...badge,autonomous_ready_color:true}),/ui1_chat_readiness_masquerades_as_autonomous_coding/);
 }else{
  const check=visualCheck('ui1_admin_connection_masquerades_as_execution_ready');
  const run=value=>vm.runInNewContext(check,{mainCapture:{metrics:{work_badge:value}}});
  run(badge);assert.throws(()=>run({...badge,state:'READY'}),/ui1_admin_connection_masquerades_as_execution_ready/);
 }
});
