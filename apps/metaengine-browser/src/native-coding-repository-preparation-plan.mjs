import path from 'node:path';
import {validateNativeSetupRoots,validateNativeRepositoryPreparation} from './native-coding-setup-contract.mjs';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {parseWorktreePorcelainZ,samePhysicalWorkspacePath} from './workspace-git-hardening.mjs';

export const NATIVE_REPOSITORY_PREPARATION_BINDING_SCHEMA='metaengine.native-coding.repository-preparation-binding.v1';
export const NATIVE_REPOSITORY_PREPARATION_PLAN_SCHEMA='metaengine.native-coding.repository-preparation-git-plan.v1';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/,SHA=/^[a-f0-9]{40}$/;
const fail=reason=>{throw Error('native_setup_preparation_'+reason);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).sort().join('|')===[...keys].sort().join('|');
const bindingKeys=['schema','operation_id','custody_id','workspace_id','actor','repository','repository_scope_sha256',
 'repo_root_identity_sha256','managed_root_identity_sha256','source','choices','original_request','postgres','host_instance_id','host_pid'];
const planKeys=['schema','effect','executable','argv','cwd','shell','operation_id','custody_id','workspace_id','managed_root',
 'worktree_path','branch_name','expected_initial_head_sha','preparation_binding_sha256','automatic_retry_allowed','authority_effect'];

// Syntax and deterministic derivation only. The original setup service supplies
// current ADMIN, physical roots, original request and durable custody checks.
export function validateNativeRepositoryPreparationBinding(value,{platform=process.platform}={}){
 if(!exact(value,bindingKeys)||value.schema!==NATIVE_REPOSITORY_PREPARATION_BINDING_SCHEMA
  ||![value.operation_id,value.custody_id,value.workspace_id,value.host_instance_id].every(v=>UUID.test(v||''))
  ||!Number.isSafeInteger(value.host_pid)||value.host_pid<1
  ||!['repository_scope_sha256','repo_root_identity_sha256','managed_root_identity_sha256'].every(k=>HASH.test(value[k]||''))
  ||!exact(value.actor,['device_id','client_id','key_fingerprint_sha256','admin_grant_epoch'])
  ||![value.actor.device_id,value.actor.client_id].every(v=>UUID.test(v||''))||!HASH.test(value.actor.key_fingerprint_sha256||'')
  ||!Number.isSafeInteger(value.actor.admin_grant_epoch)||value.actor.admin_grant_epoch<1
  ||!exact(value.repository,['coordination_workspace_id','device_id','client_id','admin_grant_epoch','repo_id','repo_root','managed_root'])
  ||value.repository.coordination_workspace_id!==value.workspace_id||value.repository.device_id!==value.actor.device_id
  ||value.repository.client_id!==value.actor.client_id||value.repository.admin_grant_epoch!==value.actor.admin_grant_epoch
  ||typeof value.repository.repo_id!=='string'||!/^[-a-zA-Z0-9:._/]{3,160}$/.test(value.repository.repo_id)
  ||sha(value.repository)!==value.repository_scope_sha256)fail('binding_invalid');
 validateNativeSetupRoots(value.repository.repo_root,value.repository.managed_root,{platform});
 validateNativeRepositoryPreparation({schema:'metaengine.native-coding.repository-preparation.v1',source:value.source,choices:value.choices});
 const original=value.original_request;
 if(!exact(original,['schema','action','requestId','requestDigest','bodyDigest','signedAt','deadlineAt','hostInstanceId','hostPid'])
  ||original.schema!=='metaengine.native-coding.setup-original-request.v1'||original.action!=='BEGIN_NATIVE_SETUP_V1'
  ||!UUID.test(original.requestId||'')||![original.requestDigest,original.bodyDigest].every(v=>HASH.test(v||''))
  ||original.hostInstanceId!==value.host_instance_id||original.hostPid!==value.host_pid
  ||!Number.isSafeInteger(original.deadlineAt)||!Number.isFinite(Date.parse(original.signedAt))
  ||new Date(original.signedAt).toISOString()!==original.signedAt||original.deadlineAt>Date.parse(original.signedAt)+30000)fail('original_request_invalid');
 const input={operation_id:value.operation_id,workspace_id:value.workspace_id,repository_scope_sha256:value.repository_scope_sha256,
  repo_root_identity_sha256:value.repo_root_identity_sha256,managed_root_identity_sha256:value.managed_root_identity_sha256,
  preparation:{schema:'metaengine.native-coding.repository-preparation.v1',source:value.source,choices:value.choices}};
 if(sha({host_instance_id:value.host_instance_id,host_pid:value.host_pid,operation:'BEGIN_NATIVE_SETUP_V1',input})!==original.bodyDigest)fail('signed_body_changed');
 if(!value.postgres||typeof value.postgres!=='object'||Array.isArray(value.postgres))fail('postgres_binding_invalid');
 return value;
}

function planBase(binding){
 validateNativeRepositoryPreparationBinding(binding);
 const worktree_path=path.join(binding.repository.managed_root,'native-setup--'+binding.operation_id);
 return {schema:NATIVE_REPOSITORY_PREPARATION_PLAN_SCHEMA,executable:'git',cwd:binding.repository.repo_root,shell:false,
  operation_id:binding.operation_id,custody_id:binding.custody_id,workspace_id:binding.workspace_id,
  managed_root:binding.repository.managed_root,worktree_path,branch_name:'metaengine/setup/'+binding.operation_id,
  expected_initial_head_sha:binding.source.head,preparation_binding_sha256:sha(binding),automatic_retry_allowed:false,authority_effect:false};
}
export function planNativeRepositoryPreparation(binding){
 const base=planBase(binding);
 return Object.freeze({...base,effect:'REPOSITORY_PREPARE_LOCKED',argv:Object.freeze(['worktree','add','--lock','--reason',
  `METAENGINE:setup:${base.operation_id}:custody:${base.custody_id}`,'-b',base.branch_name,base.worktree_path,base.expected_initial_head_sha])});
}
export function planNativeRepositoryPreparationInventory(binding){
 return Object.freeze({...planBase(binding),effect:'REPOSITORY_PREPARATION_INVENTORY_READ',argv:Object.freeze(['worktree','list','--porcelain','-z'])});
}
export function assertNativeRepositoryPreparationGitPlan(plan,{platform=process.platform}={}){
 const paths=platform==='win32'?path.win32:path.posix;
 if(!exact(plan,planKeys)||plan.schema!==NATIVE_REPOSITORY_PREPARATION_PLAN_SCHEMA||plan.executable!=='git'||plan.shell!==false
  ||plan.automatic_retry_allowed!==false||plan.authority_effect!==false
  ||![plan.operation_id,plan.custody_id,plan.workspace_id].every(v=>UUID.test(v||''))||!HASH.test(plan.preparation_binding_sha256||'')
  ||!SHA.test(plan.expected_initial_head_sha||'')||plan.branch_name!=='metaengine/setup/'+plan.operation_id
  ||plan.worktree_path!==paths.join(plan.managed_root||'','native-setup--'+plan.operation_id)||!Array.isArray(plan.argv))fail('git_plan_invalid');
 validateNativeSetupRoots(plan.cwd,plan.managed_root,{platform});
 const expected=plan.effect==='REPOSITORY_PREPARATION_INVENTORY_READ'?['worktree','list','--porcelain','-z']
  :plan.effect==='REPOSITORY_PREPARE_LOCKED'?['worktree','add','--lock','--reason',`METAENGINE:setup:${plan.operation_id}:custody:${plan.custody_id}`,
   '-b',plan.branch_name,plan.worktree_path,plan.expected_initial_head_sha]:null;
 if(!expected||json(plan.argv)!==json(expected))fail('git_plan_invalid');
 return undefined;
}
export function readNativeRepositoryPreparationInventory(binding,stdout){
 const plan=planNativeRepositoryPreparation(binding),records=parseWorktreePorcelainZ(stdout);
 const matches=records.filter(row=>samePhysicalWorkspacePath(row.worktree,plan.worktree_path));
 if(matches.length===0)return null;
 if(matches.length!==1)fail('inventory_path_ambiguous');
 const row=matches[0];
 if(row.HEAD!==binding.source.head||row.branch!=='refs/heads/'+plan.branch_name||row.locked!==plan.argv[4]
  ||row.prunable||row.detached)fail('inventory_identity_changed');
 return Object.freeze({schema:'metaengine.native-coding.repository-preparation-readback.v1',operation_id:binding.operation_id,
  custody_id:binding.custody_id,worktree_path:plan.worktree_path,head:row.HEAD,branch:row.branch,lock_reason:row.locked,
  preparation_binding_sha256:sha(binding),automatic_retry_allowed:false,authority_effect:false});
}
