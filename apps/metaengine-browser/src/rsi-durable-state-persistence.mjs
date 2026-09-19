import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const RSI_DURABLE_STATE_PERSISTENCE_SCHEMA='metaengine.rsi.durable-state-persistence.v1';
export const RSI_DURABLE_STATE_PERSISTENCE_ERROR_SCHEMA='metaengine.rsi.durable-state-persistence-error.v1';
export const RSI_DURABLE_STATE_RECONCILIATION_SCHEMA='metaengine.rsi.durable-state-reconciliation.v1';

const SHA256_RE=/^sha256:[0-9a-f]{64}$/;

function stable(value){
  if(Array.isArray(value))return value.map(stable);
  if(!value||typeof value!=='object')return value;
  return Object.fromEntries(Object.keys(value).sort().map((key)=>[key,stable(value[key])]));
}
function digestBytes(value){
  return `sha256:${crypto.createHash('sha256').update(value).digest('hex')}`;
}
function digestJson(value){
  return digestBytes(Buffer.from(JSON.stringify(stable(value)),'utf8'));
}
function exactDigest(value,label){
  const out=String(value||'').trim().toLowerCase();
  if(!SHA256_RE.test(out))throw new Error(`rsi_durable_state_${label}_digest_invalid`);
  return out;
}
function normalizePlatform(value){
  const out=String(value||'').trim().toLowerCase();
  if(!/^[a-z0-9_-]{2,32}$/.test(out))throw new Error('rsi_durable_state_platform_invalid');
  return out;
}
function stateBytes(state){
  const text=`${JSON.stringify(state)}\n`;
  return Buffer.from(text,'utf8');
}
function zero(extra={}){
  return Object.freeze({
    ...extra,
    execution_authority:false,
    browser_authority:false,
    task_authority:false,
    scheduler_authority:false,
    production_mutation_authority:false,
    promotion_authority:false,
    self_update_authority:false,
    signing_authority:false,
    automatic_retry_allowed:false,
    authority_effect:false,
  });
}

export class RsiDurableStatePersistenceError extends Error{
  constructor(message,{
    stage,
    rename_completed,
    final_file_sync_completed=false,
    parent_directory_sync_completed=false,
    expected_state_digest,
    expected_file_digest,
    cause=null,
  }={}){
    super(message,{cause});
    this.name='RsiDurableStatePersistenceError';
    this.schema=RSI_DURABLE_STATE_PERSISTENCE_ERROR_SCHEMA;
    this.stage=String(stage||'UNKNOWN');
    this.rename_completed=rename_completed===true;
    this.final_file_sync_completed=final_file_sync_completed===true;
    this.parent_directory_sync_completed=parent_directory_sync_completed===true;
    this.expected_state_digest=expected_state_digest;
    this.expected_file_digest=expected_file_digest;
    this.no_rename_proven=this.rename_completed===false;
    this.reconciliation_required=this.rename_completed===true;
    this.new_attempt_allowed=this.rename_completed===false;
    this.same_attempt_retry_allowed=false;
    this.automatic_retry_allowed=false;
    this.authority_effect=false;
  }

  snapshot(){
    return zero({
      schema:RSI_DURABLE_STATE_PERSISTENCE_ERROR_SCHEMA,
      version:1,
      stage:this.stage,
      rename_completed:this.rename_completed,
      final_file_sync_completed:this.final_file_sync_completed,
      parent_directory_sync_completed:this.parent_directory_sync_completed,
      expected_state_digest:this.expected_state_digest,
      expected_file_digest:this.expected_file_digest,
      no_rename_proven:this.no_rename_proven,
      reconciliation_required:this.reconciliation_required,
      new_attempt_allowed:this.new_attempt_allowed,
      same_attempt_retry_allowed:false,
    });
  }
}

async function safeClose(handle){
  if(handle&&typeof handle.close==='function'){
    await handle.close();
  }
}

function wrapFailure(error,meta){
  if(error instanceof RsiDurableStatePersistenceError)return error;
  return new RsiDurableStatePersistenceError(
    `rsi_durable_state_persist_failed:${meta.stage}`,
    {...meta,cause:error},
  );
}

export async function persistRsiDurableJsonState({
  file_path,
  state,
  io=fs,
  platform=process.platform,
}={}){
  if(typeof file_path!=='string'||file_path.trim()==='')throw new Error('rsi_durable_state_file_path_required');
  if(!state||typeof state!=='object'||Array.isArray(state))throw new Error('rsi_durable_state_object_required');
  if(!io||typeof io.open!=='function'||typeof io.rename!=='function'||typeof io.readFile!=='function'){
    throw new Error('rsi_durable_state_io_invalid');
  }

  const finalPath=path.resolve(file_path);
  const tempPath=`${finalPath}.tmp`;
  if(path.dirname(tempPath)!==path.dirname(finalPath))throw new Error('rsi_durable_state_temp_must_share_parent');
  const checkedPlatform=normalizePlatform(platform);
  const bytes=stateBytes(state);
  const expectedStateDigest=digestJson(state);
  const expectedFileDigest=digestBytes(bytes);

  let stage='OPEN_TEMP';
  let renameCompleted=false;
  let finalFileSyncCompleted=false;
  let parentDirectorySyncCompleted=false;
  let tempHandle=null;
  let finalHandle=null;
  let dirHandle=null;

  try{
    tempHandle=await io.open(tempPath,'w',0o600);
    stage='WRITE_TEMP';
    await tempHandle.writeFile(bytes);
    stage='SYNC_TEMP';
    await tempHandle.sync();
    stage='CLOSE_TEMP';
    await safeClose(tempHandle);
    tempHandle=null;

    stage='RENAME';
    await io.rename(tempPath,finalPath);
    renameCompleted=true;

    stage='OPEN_FINAL';
    finalHandle=await io.open(finalPath,'r+');
    stage='SYNC_FINAL';
    await finalHandle.sync();
    finalFileSyncCompleted=true;
    stage='CLOSE_FINAL';
    await safeClose(finalHandle);
    finalHandle=null;

    if(checkedPlatform!=='win32'){
      stage='OPEN_PARENT_DIRECTORY';
      dirHandle=await io.open(path.dirname(finalPath),'r');
      stage='SYNC_PARENT_DIRECTORY';
      await dirHandle.sync();
      parentDirectorySyncCompleted=true;
      stage='CLOSE_PARENT_DIRECTORY';
      await safeClose(dirHandle);
      dirHandle=null;
    }

    stage='READBACK';
    const readback=await io.readFile(finalPath);
    const observedFileDigest=digestBytes(Buffer.isBuffer(readback)?readback:Buffer.from(String(readback),'utf8'));
    if(observedFileDigest!==expectedFileDigest){
      throw new Error('rsi_durable_state_readback_digest_mismatch');
    }

    return zero({
      schema:RSI_DURABLE_STATE_PERSISTENCE_SCHEMA,
      version:1,
      file_path:finalPath,
      temp_path:tempPath,
      platform:checkedPlatform,
      expected_state_digest:expectedStateDigest,
      expected_file_digest:expectedFileDigest,
      observed_file_digest:observedFileDigest,
      temp_file_sync_completed:true,
      rename_completed:true,
      final_file_sync_completed:true,
      parent_directory_sync_completed:parentDirectorySyncCompleted,
      parent_directory_sync_required:checkedPlatform!=='win32',
      windows_write_through_rename_used:false,
      readback_digest_verified:true,
      durability_barriers_completed:checkedPlatform==='win32'
        ? finalFileSyncCompleted
        : finalFileSyncCompleted&&parentDirectorySyncCompleted,
      power_loss_durability_claimed:false,
      windows_rename_metadata_durability_claimed:false,
      platform_power_loss_qualification_required:true,
      reconciliation_required:false,
      new_attempt_allowed:false,
      same_attempt_retry_allowed:false,
    });
  }catch(error){
    const wrapped=wrapFailure(error,{
      stage,
      rename_completed:renameCompleted,
      final_file_sync_completed:finalFileSyncCompleted,
      parent_directory_sync_completed:parentDirectorySyncCompleted,
      expected_state_digest:expectedStateDigest,
      expected_file_digest:expectedFileDigest,
    });
    throw wrapped;
  }finally{
    try{await safeClose(tempHandle)}catch{}
    try{await safeClose(finalHandle)}catch{}
    try{await safeClose(dirHandle)}catch{}
  }
}

export async function reconcileRsiDurableJsonState({
  file_path,
  expected_state_digest,
  expected_file_digest,
  io=fs,
}={}){
  if(typeof file_path!=='string'||file_path.trim()==='')throw new Error('rsi_durable_state_file_path_required');
  if(!io||typeof io.readFile!=='function')throw new Error('rsi_durable_state_io_invalid');
  const stateDigest=exactDigest(expected_state_digest,'expected_state');
  const fileDigest=exactDigest(expected_file_digest,'expected_file');
  const finalPath=path.resolve(file_path);

  let bytes;
  try{
    bytes=await io.readFile(finalPath);
  }catch(error){
    if(error?.code==='ENOENT'){
      return zero({
        schema:RSI_DURABLE_STATE_RECONCILIATION_SCHEMA,
        version:1,
        file_path:finalPath,
        state:'NO_EFFECT_PROVEN',
        expected_state_digest:stateDigest,
        expected_file_digest:fileDigest,
        observed_file_digest:null,
        final_file_present:false,
        exact_readback_match:false,
        new_attempt_allowed:true,
        reconciliation_required:false,
      });
    }
    throw error;
  }

  const buffer=Buffer.isBuffer(bytes)?bytes:Buffer.from(String(bytes),'utf8');
  const observedFileDigest=digestBytes(buffer);
  let observedStateDigest=null;
  try{
    const parsed=JSON.parse(buffer.toString('utf8'));
    observedStateDigest=digestJson(parsed);
  }catch{}

  const exact=observedFileDigest===fileDigest&&observedStateDigest===stateDigest;
  return zero({
    schema:RSI_DURABLE_STATE_RECONCILIATION_SCHEMA,
    version:1,
    file_path:finalPath,
    state:exact?'CONFIRMED_EXACT_READBACK':'AMBIGUOUS_READBACK',
    expected_state_digest:stateDigest,
    expected_file_digest:fileDigest,
    observed_state_digest:observedStateDigest,
    observed_file_digest:observedFileDigest,
    final_file_present:true,
    exact_readback_match:exact,
    new_attempt_allowed:false,
    reconciliation_required:!exact,
  });
}

export function rsiDurableStatePersistenceTrustRootSnapshot(){
  const root=zero({
    schema:'metaengine.rsi.durable-state-persistence-root.v1',
    version:1,
    policy_path:'apps/metaengine-browser/src/rsi-durable-state-persistence.mjs',
    temp_and_final_same_directory_required:true,
    temp_file_sync_before_rename_required:true,
    final_file_sync_after_rename_required:true,
    posix_parent_directory_sync_required:true,
    exact_final_readback_required:true,
    post_rename_failure_is_ambiguous:true,
    post_rename_failure_reconciliation_only:true,
    same_attempt_retry_allowed:false,
    pre_rename_failure_may_start_new_attempt:true,
    windows_write_through_rename_claimed:false,
    windows_rename_metadata_durability_claimed:false,
    power_loss_durability_claimed:false,
    platform_power_loss_qualification_required:true,
    second_lifecycle_authority_created:false,
  });
  return Object.freeze({...root,root_digest:digestJson(root)});
}
