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
