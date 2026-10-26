import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import {randomUUID} from 'node:crypto';
import {readNativeCodingGitCommitOperator,NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE} from './native-coding-git-commit-operator.mjs';
function fixture(){const base=path.resolve(os.tmpdir(),'generated-operator-pin-contract'),state=path.join(base,'state');
  const value={schema:'metaengine.native-coding.git-commit-operator.v1',registry_id:randomUUID(),generation:1,
    git_executable:path.join(base,'git.exe'),git_executable_sha256:'a'.repeat(64),journal_root:path.join(base,'journal'),
    bindings:[{project_id:randomUUID(),workspace_id:randomUUID(),path:path.join(base,'worker'),root_identity_sha256:'b'.repeat(64),
      branch_ref:'refs/heads/managed-task',git_dir_identity_sha256:'c'.repeat(64),common_dir_identity_sha256:'d'.repeat(64)}],
    model_paths_allowed:false,production_qualified:false,authority_effect:false};
  return {value,state,read:()=>readNativeCodingGitCommitOperator(state,{readProtectedJson:async file=>{
    assert.equal(file,path.join(state,NATIVE_CODING_GIT_COMMIT_OPERATOR_FILE));return{value,sha256:'e'.repeat(64)};}})};
}
test('protected Git operator has a separate fixed file and explicit physical pins, without allocation authority',async()=>{
  const f=fixture(),actual=await f.read();assert.deepEqual(actual.value,f.value);assert.equal(actual.value.authority_effect,false);
});
test('operator cannot add arbitrary commands, ambiguous roots, worker journals or unpinned Git bytes',async()=>{
  for(const mutate of [v=>{v.command='git commit';},v=>{v.bindings.push(structuredClone(v.bindings[0]));},
    v=>{v.journal_root=path.join(v.bindings[0].path,'journal');},v=>{v.git_executable_sha256='';},
    v=>{v.model_paths_allowed=true;},v=>{v.bindings[0].path+=path.sep+'..'+path.sep+'escape';}]){
    const f=fixture();mutate(f.value);await assert.rejects(f.read(),/native_coding_commit_operator_/);
  }
});
test('protected profile pins may authorize an initially unknown project without model-selected roots',async()=>{
  const f=fixture(),{project_id,...physical}=f.value.bindings[0];
  f.value.bindings=[];f.value.profile_bindings=[{...physical,profile_id:randomUUID(),profile_sha256:'f'.repeat(64)}];
  const out=await f.read();assert.equal(out.value.bindings.length,0);assert.equal(out.value.profile_bindings.length,1);
  for(const mutate of [v=>v.profile_bindings[0].profile_sha256='',v=>v.profile_bindings[0].project_id=randomUUID(),
    v=>v.profile_bindings.push(structuredClone(v.profile_bindings[0])),v=>v.bindings.push({project_id,...physical}),
    v=>v.profile_bindings=[],v=>v.journal_root=path.join(physical.path,'journal')]){
    const g=fixture(),{project_id:unused,...physicalPin}=g.value.bindings[0];
    g.value.bindings=[];g.value.profile_bindings=[{...physicalPin,profile_id:randomUUID(),profile_sha256:'f'.repeat(64)}];
    mutate(g.value);await assert.rejects(g.read(),/native_coding_commit_operator_/);
  }
});
