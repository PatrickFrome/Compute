import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import {validateNativeCodingOperatorPaths,resolveNativeCodingSandboxPin} from '../src/native-coding-operator-paths.mjs';
const pin=role=>({path:path.resolve('fixture-only',role+'.json'),sha256:'a'.repeat(64)});
const fixture=()=>({schema:'metaengine.native-coding.operator-paths.v1',...Object.fromEntries(
  ['cli_executable','codex_home','git_executable','journal_root','worker_temp_root','result_index_root'].map(key=>[key,path.resolve('fixture-only',key)])),
  sandbox_receipts:{IMPLEMENTER:pin('IMPLEMENTER'),CRITIC:pin('CRITIC')}});

test('legacy role pins remain exact protected-path inputs',()=>{
  const value=validateNativeCodingOperatorPaths(fixture());
  assert.deepEqual(resolveNativeCodingSandboxPin(value,{role:'CRITIC'}),pin('CRITIC'));
  assert.throws(()=>validateNativeCodingOperatorPaths({...fixture(),unknown:true}),/operator_paths_invalid/);
});
test('independent worktree providers resolve their own canary without crossing the role fallback',()=>{
  const agents=Array.from({length:4},(_,i)=>({provider_id:randomUUID(),agent_id:'agent_pin-test-'+i,
    role:i%2?'CRITIC':'IMPLEMENTER',...pin('root-'+Math.floor(i/2)+'-'+i)}));
  const value=validateNativeCodingOperatorPaths({...fixture(),provider_sandbox_receipts:agents});
  for(const agent of agents)assert.deepEqual(resolveNativeCodingSandboxPin(value,agent),{path:agent.path,sha256:agent.sha256});
  assert.throws(()=>resolveNativeCodingSandboxPin(value,{...agents[0],provider_id:randomUUID()}),/pin_missing/);
  assert.throws(()=>resolveNativeCodingSandboxPin(value,{...agents[0],agent_id:agents[1].agent_id}),/pin_missing/);
});
test('duplicate, malformed and oversized provider pin rosters cannot be published',()=>{
  const agent={provider_id:randomUUID(),agent_id:'agent_pin-test-1',role:'IMPLEMENTER',...pin('writer')};
  for(const roster of [[agent,agent],[agent,{...agent,provider_id:randomUUID(),path:'relative'}],
    [agent,{...agent,provider_id:randomUUID(),role:'ADMIN'}],Array(65).fill(agent)])
    assert.throws(()=>validateNativeCodingOperatorPaths({...fixture(),provider_sandbox_receipts:roster}),/provider_sandbox_pin/);
});
