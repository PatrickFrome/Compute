import fs from 'node:fs/promises';
import path from 'node:path';
import {nativeCodingCanonicalJson as json,nativeCodingCanonicalSha256 as sha} from './native-coding-task-context.mjs';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {createNativeCodingGitCommitter} from './native-coding-git-commit.mjs';
import {readNativeCodingGitCommitOperator} from './native-coding-git-commit-operator.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {protectOwnerOnlyWindowsDirectory,verifyOwnerOnlyWindowsStorage} from '../../apps/metaengine-browser/src/private-windows-storage-acl.mjs';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HASH=/^[0-9a-f]{64}$/,SHA=/^[0-9a-f]{40}$/;
const fail=reason=>{throw Error('native_coding_host_commit_'+reason);};
const exact=(value,keys)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('\0')===[...keys].sort().join('\0');
const same=(a,b)=>json(a)===json(b);
const selectors=['project_id','checkpoint_sha256'];
function select(value){if(!exact(value,selectors)||!UUID.test(value.project_id||'')||!HASH.test(value.checkpoint_sha256||''))fail('selectors_invalid');return structuredClone(value);}
const flags={production_qualified:false,automatic_retry_allowed:false,authority_effect:false};
const checkpointSql=`select to_jsonb(k) as checkpoint_record
 from destruktion_meta.native_coding_checkpoint_h205f22 k where k.project_id=$1::uuid and k.checkpoint_sha256=$2::text`;
const bundleSql=`select to_jsonb(k) as checkpoint_record,to_jsonb(j) as writer_registration,to_jsonb(cj) as critic_registration,
 to_jsonb(p) as permit_record,to_jsonb(cp) as critic_permit_record,to_jsonb(we) as writer_execution,to_jsonb(ce) as critic_execution,
 to_jsonb(w) as writer_task,to_jsonb(c) as critic_task,to_jsonb(f) as fence,to_jsonb(r) as project,
 (d.active and d.revoked_at is null and d.access_tier='ADMIN' and d.admin_revoked_at is null
   and d.admin_grant_epoch=p.admin_grant_epoch and d.profile='A2_DEVICE_HTTP_SIGNATURE_V1'
   and d.key_fingerprint_sha256=p.permit->>'device_key_fingerprint_sha256'
   and d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb) as device_valid,
 not exists(select 1 from destruktion_meta.devos_fleet_claim_h205f22 claim
   join destruktion_meta.devos_fleet_task_h205f22 claimed on claimed.task_id=claim.task_id
   join destruktion_meta.native_coding_operator_permit_h205f22 active_permit on active_permit.permit_id=(claimed.task_spec#>>'{native_coding,permit_id}')::uuid
   where claim.state='ACTIVE' and claim.expires_at>clock_timestamp()
     and active_permit.permit#>>'{worktree,root_identity_sha256}'=k.root_identity_sha256) as root_idle
 from destruktion_meta.native_coding_checkpoint_h205f22 k
 join destruktion_meta.native_coding_job_registration_h205f22 j on j.task_id=k.writer_task_id and j.lease_generation=k.writer_lease_generation
 join destruktion_meta.native_coding_job_registration_h205f22 cj on cj.task_id=k.critic_task_id and cj.lease_generation=k.critic_lease_generation
 join destruktion_meta.native_coding_operator_permit_h205f22 p on p.permit_id=j.permit_id
 join destruktion_meta.native_coding_operator_permit_h205f22 cp on cp.permit_id=cj.permit_id
 join destruktion_meta.native_coding_execution_h205f22 we on we.task_id=k.writer_task_id and we.lease_generation=k.writer_lease_generation
 join destruktion_meta.native_coding_execution_h205f22 ce on ce.task_id=k.critic_task_id and ce.lease_generation=k.critic_lease_generation
 join destruktion_meta.devos_fleet_task_h205f22 w on w.task_id=k.writer_task_id
 join destruktion_meta.devos_fleet_task_h205f22 c on c.task_id=k.critic_task_id
 join destruktion_meta.native_coding_worktree_fence_h205f22 f on f.workspace_id=k.workspace_id and f.root_identity_sha256=k.root_identity_sha256
 join destruktion_meta.project_run_h205f22 r on r.project_id=k.project_id
 join public.compute_fabric_a2_browser_device_h205f22 d on d.device_id=p.device_id and d.client_id=p.client_id
 where k.project_id=$1::uuid and k.checkpoint_sha256=$2::text`;
async function durable(file,value){const handle=await fs.open(file,'wx',0o600);try{await handle.writeFile(json(value)+'\n');await handle.sync();}finally{await handle.close();}}

// Mount only in the existing trusted runtime Host. sql is the already-open
// state_owner connection; physical/protected readers are private dependencies.
// Caller input never supplies SQL, a receipt, registry content, paths or Git args.
export async function createNativeCodingHostCommitService({sql,stateDirectory,readNativeScope,readProtectedReceipt,
  readOperator=readNativeCodingGitCommitOperator,readProtectedJson=readNativeCodingProtectedJson,
  protectStorage=protectOwnerOnlyWindowsDirectory,verifyStorage=verifyOwnerOnlyWindowsStorage}={}){
  if(typeof sql?.unsafe!=='function'||typeof sql?.begin!=='function'
    ||![readNativeScope,readProtectedReceipt,readOperator,readProtectedJson,protectStorage,verifyStorage].every(fn=>typeof fn==='function'))fail('private_dependencies_required');
  let closed=false;const open=()=>{if(closed)fail('closed');};
  async function owner(db=sql){open();const rows=await db.unsafe('select current_user::text as current_user,session_user::text as session_user');
    if(rows.length!==1||rows[0].current_user!=='state_owner'||rows[0].session_user!=='state_owner')fail('state_owner_required');}
  await owner();const operator=await readOperator(stateDirectory),pins=operator.value;
  await fs.mkdir(pins.journal_root,{recursive:true,mode:0o700});await protectStorage(pins.journal_root);
  await verifyStorage(pins.journal_root,{operation:'VERIFY_DIRECTORY'});await readDirectoryIdentity(pins.journal_root);
  async function unchangedOperator(){open();const current=await readOperator(stateDirectory);if(current.sha256!==operator.sha256||!same(current.value,pins))fail('operator_changed');}
  async function checkpoint(query){
    await owner();const rows=await sql.unsafe(checkpointSql,[query.project_id,query.checkpoint_sha256]);
    const row=rows[0]?.checkpoint_record,k=row?.checkpoint;
    if(rows.length!==1||!UUID.test(k?.checkpoint_id||'')||k.schema!=='metaengine.native-coding.checkpoint.v1'
      ||k.project_id!==query.project_id||row.checkpoint_sha256!==query.checkpoint_sha256||sha(k)!==query.checkpoint_sha256
      ||row.canonical_checkpoint!==json(k)||row.checkpoint_id!==k.checkpoint_id||row.project_id!==k.project_id
      ||k.trust_namespace!=='LOCAL_OPERATOR_QA'||!SHA.test(k.source_head||'')||!HASH.test(k.root_identity_sha256||'')
      ||['production_qualified','automatic_retry_allowed','successor_admitted','authority_effect'].some(key=>k[key]!==false))fail('checkpoint_unverified');
    for(const field of ['workspace_id','writer_task_id','critic_task_id','writer_run_id','critic_run_id','writer_receipt_sha256','critic_receipt_sha256',
      'result_sha256','git_artifact_sha256','source_head','root_identity_sha256'])if(row[field]!==k[field])fail('checkpoint_column_changed');
    for(const field of ['writer_lease_generation','critic_lease_generation'])if(Number(row[field])!==k[field])fail('checkpoint_generation_changed');
    await unchangedOperator();return structuredClone(k);
  }
  const queryFor=k=>({project_id:k.project_id,checkpoint_id:k.checkpoint_id,checkpoint_sha256:sha(k)});
  async function protectedContext(request){
    const query={project_id:request.project_id,checkpoint_sha256:request.checkpoint_sha256},k=await checkpoint(query);
    if(request.checkpoint_id!==k.checkpoint_id)fail('checkpoint_selector_changed');
    const rows=await sql.unsafe(bundleSql,[query.project_id,query.checkpoint_sha256]),b=rows[0],p=b?.permit_record?.permit,cp=b?.critic_permit_record?.permit;
    if(rows.length!==1||!same(b.checkpoint_record.checkpoint,k)||b.device_valid!==true||b.root_idle!==true||b.project?.state!=='ACTIVE'
      ||b.project.project_id!==k.project_id||b.project.workspace_id!==k.workspace_id||!p||p.role!=='IMPLEMENTER'
      ||p.trust_namespace!=='LOCAL_OPERATOR_QA'||p.project_id!==k.project_id||p.workspace_id!==k.workspace_id
      ||p.goal_id!==k.goal_id||p.goal_sha256!==k.goal_sha256||p.owner_epoch!==k.owner_epoch||p.revoked!==false
      ||b.permit_record.revoked_at!==null||Date.parse(p.expires_at)<=Date.now()||!Number.isFinite(Date.parse(p.expires_at))
      ||b.fence?.state!=='CHECKPOINTED_PENDING_COMMIT'||b.fence.checkpoint_sha256!==query.checkpoint_sha256
      ||b.fence.project_id!==k.project_id||b.fence.workspace_id!==k.workspace_id||b.fence.root_identity_sha256!==k.root_identity_sha256
      ||b.fence.writer_task_id!==k.writer_task_id||Number(b.fence.writer_lease_generation)!==k.writer_lease_generation)fail('pending_checkpoint_unavailable');
    if(!cp||cp.role!=='CRITIC'||cp.project_id!==k.project_id||cp.workspace_id!==k.workspace_id||cp.goal_id!==p.goal_id
      ||cp.goal_sha256!==p.goal_sha256||cp.owner_epoch!==p.owner_epoch||cp.user_sid!==p.user_sid
      ||cp.revoked!==false||b.critic_permit_record.revoked_at!==null||!Number.isFinite(Date.parse(cp.expires_at))
      ||Date.parse(cp.expires_at)<=Date.now()||cp.worktree?.path!==p.worktree?.path
      ||cp.worktree?.root_identity_sha256!==p.worktree?.root_identity_sha256||cp.worktree?.base_sha!==k.source_head
      ||!same(cp.artifact,p.artifact))fail('critic_permit_unavailable');
    for(const role of ['writer','critic']){
      const j=b[role+'_registration'],e=b[role+'_execution'],t=b[role+'_task'],generation=k[role+'_lease_generation'];
      if(j?.task_id!==k[role+'_task_id']||j.run_id!==k[role+'_run_id']||Number(j.lease_generation)!==generation
        ||j.canonical_result_receipt!==json(j.result_receipt)||j.result_receipt_sha256!==sha(j.result_receipt)
        ||j.result_receipt_sha256!==k[role+'_receipt_sha256']||e?.state!=='CHECKPOINTED'||e.checkpoint_sha256!==query.checkpoint_sha256
        ||e.task_id!==j.task_id||Number(e.lease_generation)!==generation||t?.task_id!==j.task_id||t.state!=='COMPLETED'
        ||Number(t.lease_generation)!==generation)fail('registered_pair_changed');
    }
    const j=b.writer_registration,receipt=j.result_receipt;
    if(j.permit_id!==p.permit_id||receipt.schema!=='metaengine.codex-cli.run-receipt.v1'||receipt.state!=='RESULT_READY'
      ||receipt.project_id!==k.project_id||receipt.workspace_id!==k.workspace_id||receipt.permit_id!==p.permit_id
      ||receipt.task_id!==k.writer_task_id||receipt.run_id!==k.writer_run_id||receipt.role!=='IMPLEMENTER'
      ||receipt.result_sha256!==k.result_sha256||receipt.git_after?.head!==k.source_head
      ||receipt.git_after?.artifact_sha256!==k.git_artifact_sha256||p.worktree?.path!==k.worktree.path
      ||p.worktree?.root_identity_sha256!==k.worktree.root_identity_sha256
      ||!same(p.artifact,k.artifact)||p.postgres?.system_identifier!==k.postgres?.system_identifier
      ||p.postgres.data_directory_identity_sha256!==k.postgres.data_directory_identity_sha256)fail('writer_receipt_changed');
    const physicalReceipt=await readProtectedReceipt({scope:k.writer_execution_scope,permit:p,job:j.job_envelope});
    if(!same(physicalReceipt,receipt))fail('protected_writer_changed');
    const current=await readNativeScope(p,false);
    if(!current||!same(current.artifact,k.artifact)||!same(current.postgres,k.postgres)||current.user_sid!==p.user_sid
      ||current.worktree?.path!==k.worktree.path||current.worktree.root_identity_sha256!==k.root_identity_sha256
      ||!current.host_process)fail('physical_scope_changed');
    const bindings=pins.bindings.filter(row=>row.project_id===k.project_id&&row.workspace_id===k.workspace_id
      &&row.root_identity_sha256===k.root_identity_sha256&&row.path===k.worktree.path);
    if(bindings.length!==1)fail('managed_registry_unavailable');
    const gates=await sql.unsafe('select destruktion_meta.native_coding_commit_gate_v1($1::uuid) as value',[k.checkpoint_id]),gate=gates[0]?.value;
    if(gates.length!==1||gate?.schema!=='metaengine.native-coding.commit-gate.v1'||gate.checkpoint_id!==k.checkpoint_id
      ||gate.checkpoint_sha256!==query.checkpoint_sha256||gate.project_id!==k.project_id||gate.workspace_id!==k.workspace_id
      ||gate.root_identity_sha256!==k.root_identity_sha256||gate.writer_permit_id!==p.permit_id||gate.critic_permit_id!==cp.permit_id
      ||gate.admitted!==true||gate.authority_effect!==false)fail('sql_commit_gate_unavailable');
    const {project_id,workspace_id,...managed_worktree}=bindings[0];
    await unchangedOperator();return {schema:'metaengine.native-coding.git-commit-context.v1',state:'CHECKPOINTED_PENDING_COMMIT',
      checkpoint:k,checkpoint_sha256:query.checkpoint_sha256,reviewed_git:receipt.git_after,managed_worktree};
  }
  const committer=createNativeCodingGitCommitter({gitExecutable:pins.git_executable,expectedGitExecutableSha256:pins.git_executable_sha256,
    journalRoot:path.join(pins.journal_root,'git'),readCheckpoint:protectedContext,protectStorage,verifyStorage});
  function verifiedGit(receipt,k){
    if(!receipt||receipt.schema!=='metaengine.native-coding.git-commit-receipt.v1'||receipt.state!=='COMMITTED'
      ||receipt.project_id!==k.project_id||receipt.checkpoint_id!==k.checkpoint_id||receipt.checkpoint_sha256!==sha(k)
      ||receipt.previous_head!==k.source_head||!SHA.test(receipt.head||'')||!SHA.test(receipt.tree||'')||receipt.head===receipt.previous_head
      ||receipt.root_identity_sha256!==k.root_identity_sha256||receipt.reviewed_git_artifact_sha256!==k.git_artifact_sha256
      ||!HASH.test(receipt.intent_sha256||'')||['working_tree_preserved','index_clean','ref_update_cas_verified','commit_object_readback_verified'].some(key=>receipt[key]!==true)
      ||['production_qualified','automatic_retry_allowed','successor_admitted','authority_effect'].some(key=>receipt[key]!==false))fail('git_receipt_unverified');
    const managed=pins.bindings.filter(row=>row.project_id===k.project_id&&row.workspace_id===k.workspace_id&&row.root_identity_sha256===k.root_identity_sha256);
    if(managed.length!==1||receipt.branch_ref!==managed[0].branch_ref)fail('git_branch_unverified');return receipt;
  }
  async function sqlReadback(k){
    await owner();const rows=await sql.unsafe('select destruktion_meta.native_coding_read_commit_v1($1::uuid) as value',[k.checkpoint_id]);
    if(rows.length!==1)fail('sql_readback_unavailable');const value=rows[0].value;if(value===null)return null;
    const receipt=verifiedGit(value.receipt,k);
    if(value.schema!=='metaengine.native-coding.commit-checkpoint.v1'||value.project_id!==k.project_id||value.checkpoint_id!==k.checkpoint_id
      ||value.checkpoint_sha256!==sha(k)||value.canonical_receipt!==json(receipt)||value.commit_receipt_sha256!==sha(receipt)
      ||!['SUCCESSOR_ADMITTED','COMMITTED_NO_SUCCESSOR','COMMITTED_PENDING_SUCCESSOR'].includes(value.state)
      ||value.previous_head!==receipt.previous_head||value.head!==receipt.head||value.tree!==receipt.tree
      ||value.root_fence_released!==true||['production_qualified','automatic_retry_allowed','authority_effect'].some(key=>value[key]!==false)
      ||value.successor_admitted!==(value.state==='SUCCESSOR_ADMITTED')
      ||![value.next_writer_permit_id,value.next_critic_permit_id].every(id=>UUID.test(id||''))
      ||value.successor_task_id!==null&&!UUID.test(value.successor_task_id||'')
      ||value.successor_admitted!==(value.successor_task_id!==null))fail('sql_commit_record_unverified');
    await unchangedOperator();return structuredClone(value);
  }
  const result=(query,state,extra={})=>({schema:'metaengine.native-coding.host-commit-service.v1',...query,state,...flags,successor_admitted:false,...extra});
  async function journal(k){
    const root=path.join(pins.journal_root,'sql-finalize'),directory=path.join(root,sha(k));
    await fs.mkdir(directory,{recursive:true,mode:0o700});await protectStorage(root);await verifyStorage(root,{operation:'VERIFY_DIRECTORY'});
    await readDirectoryIdentity(root);await readDirectoryIdentity(directory);
    const file=path.join(directory,'intent.json');let intent=null;
    try{intent=(await readProtectedJson(file)).value;}catch(error){if(error.code!=='ENOENT')throw error;}
    if(intent&&(intent.schema!=='metaengine.native-coding.sql-commit-intent.v1'||intent.checkpoint_sha256!==sha(k)
      ||intent.operator_sha256!==operator.sha256||intent.canonical_receipt!==json(intent.receipt)||intent.receipt_sha256!==sha(intent.receipt)))fail('sql_intent_changed');
    if(intent)verifiedGit(intent.receipt,k);return {file,intent};
  }
  async function read(query){
    const k=await checkpoint(query),stored=await sqlReadback(k);
    if(stored)return result(query,stored.state,{commit:stored,successor_admitted:stored.successor_admitted});
    const {intent}=await journal(k);if(intent)return result(query,'SQL_FINALIZE_UNKNOWN',{checkpoint_id:k.checkpoint_id,git_receipt:intent.receipt});
    return result(query,'PENDING_COMMIT',{checkpoint_id:k.checkpoint_id,git_readback:await committer.READ_COMMIT(queryFor(k))});
  }
  return Object.freeze({
    async READ_FINISH_CHECKPOINT(request){open();return read(select(request));},
    async FINISH_CHECKPOINT(request){
      const query=select(request),k=await checkpoint(query),stored=await sqlReadback(k);
      if(stored)return result(query,stored.state,{commit:stored,successor_admitted:stored.successor_admitted});
      const state=await journal(k);if(state.intent)return result(query,'SQL_FINALIZE_UNKNOWN',{checkpoint_id:k.checkpoint_id,git_receipt:state.intent.receipt});
      let gitReceipt=await committer.COMMIT_CHECKPOINT(queryFor(k));
      if(['COMMITTED_INDEX_PENDING','COMMITTED_RECEIPT_PENDING'].includes(gitReceipt.state))gitReceipt=await committer.RECONCILE_COMMIT(queryFor(k));
      if(gitReceipt.state!=='COMMITTED')return result(query,'GIT_READBACK_REQUIRED',{checkpoint_id:k.checkpoint_id,git_readback:gitReceipt});
      verifiedGit(gitReceipt,k);await protectedContext(queryFor(k));await unchangedOperator();
      const intent={schema:'metaengine.native-coding.sql-commit-intent.v1',checkpoint_sha256:sha(k),operator_sha256:operator.sha256,
        receipt:gitReceipt,canonical_receipt:json(gitReceipt),receipt_sha256:sha(gitReceipt)};
      try{await durable(state.file,intent);}catch(error){if(error.code==='EEXIST')return read(query);throw error;}
      // Intent is durable BEFORE the sole SQL effect. If this process dies or
      // loses the COMMIT ACK, every future call performs SQL readback only.
      let acknowledged=false;
      try{await sql.begin('isolation level serializable',async tx=>{
        await owner(tx);await tx.unsafe('set local synchronous_commit=on');await unchangedOperator();
        await tx.unsafe('select destruktion_meta.native_coding_finish_checkpoint_v1($1::uuid,$2::text::jsonb,$2::text,$3::text) as value',
          [k.checkpoint_id,intent.canonical_receipt,intent.receipt_sha256]);
      });acknowledged=true;}catch{}
      let confirmed=null;try{confirmed=await sqlReadback(k);}catch{}
      if(!confirmed)return result(query,'SQL_FINALIZE_UNKNOWN',{checkpoint_id:k.checkpoint_id,git_receipt:gitReceipt,sql_acknowledged:acknowledged});
      if(!same(confirmed.receipt,gitReceipt))fail('sql_receipt_changed');
      return result(query,confirmed.state,{commit:confirmed,successor_admitted:confirmed.successor_admitted});
    },
    close(){closed=true;committer.close();},
  });
}
