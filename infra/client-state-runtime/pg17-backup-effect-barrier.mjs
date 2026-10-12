// Durable, source-bound, one-attempt barrier for a future protected pg_dump.
// This module NEVER invokes PostgreSQL, installer, shell, or live Owner actions.
// Returning from cross() authorizes the caller's one separately gated attempt;
// a lost acknowledgement or restart NEVER grants an automatic second attempt.
import {createHash,randomUUID} from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const HASH=/^[a-f0-9]{64}$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const failure=code=>Object.assign(new Error(code),{code});
const digest=data=>createHash('sha256').update(data).digest('hex');
function validIntent(input){
  if(!input||input.schema!=='metaengine.pg17.backup-effect-intent.v1'
    ||!UUID.test(input.intent_id)
    ||!Number.isSafeInteger(input.owner_pid)||input.owner_pid<=0
    ||!Number.isSafeInteger(input.keeper_pid)||input.keeper_pid<=0
    ||input.owner_pid===input.keeper_pid
    ||typeof input.source_head!=='string'||!/^[a-f0-9]{40}$/.test(input.source_head)
    ||typeof input.owner_sha256!=='string'||!HASH.test(input.owner_sha256)
    ||typeof input.keeper_postmaster_sha256!=='string'||!HASH.test(input.keeper_postmaster_sha256)
    ||typeof input.archive_path!=='string'||!path.isAbsolute(input.archive_path)
    ||input.state!=='PREPARED'||input.automatic_retry_allowed!==false
    ||input.authority_effect!==false||input.installer_started!==false
    ||input.credential_material_included!==false)
    throw failure('backup_effect_intent_invalid');
  return input;
}
export function buildBackupEffectIntent({intentId=randomUUID(),ownerPid,keeperPid,
  sourceHead,ownerSha256,postmasterSha256,archivePath}={}){
  return Object.freeze(validIntent({
    schema:'metaengine.pg17.backup-effect-intent.v1',
    intent_id:intentId,source_head:sourceHead,
    owner_pid:ownerPid,keeper_pid:keeperPid,
    owner_sha256:ownerSha256,keeper_postmaster_sha256:postmasterSha256,
    archive_path:archivePath,state:'PREPARED',
    automatic_retry_allowed:false,authority_effect:false,
    installer_started:false,credential_material_included:false,
  }));
}
async function privateJournal(root){
  if(typeof root!=='string'||!path.isAbsolute(root))throw failure('backup_effect_journal_invalid');
  const info=await fs.lstat(root);
  if(!info.isDirectory()||info.isSymbolicLink())throw failure('backup_effect_journal_invalid');
  const canonical=await fs.realpath(root);
  const same=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  if(!same(path.resolve(root),canonical))throw failure('backup_effect_journal_invalid');
  return canonical;
}
function boundArchive(dir,intent){
  const parent=path.resolve(path.dirname(intent.archive_path));
  const same=process.platform==='win32'
    ?parent.toLowerCase()===dir.toLowerCase():parent===dir;
  if(!same)throw failure('backup_effect_archive_outside_journal');
  return path.join(dir,'archive-reservation.json');
}
async function writeOnce(filename,record){
  const bytes=Buffer.from(JSON.stringify(record)+'\n','utf8');
  if(bytes.length>4096)throw failure('backup_effect_record_oversized');
  let file;
  try{
    file=await fs.open(filename,'wx',0o600);
    await file.writeFile(bytes);
    await file.sync();
  }catch{
    throw failure('backup_effect_write_ambiguous');
  }finally{
    if(file)await file.close().catch(()=>{});
  }
  // Read-after-write validates only owned bytes; never means an OS effect ran.
  if(digest(await fs.readFile(filename))!==digest(bytes))
    throw failure('backup_effect_readback_mismatch');
}
function filenames(dir,id){
  if(!UUID.test(id))throw failure('backup_effect_id_invalid');
  return {intent:path.join(dir,'intent-'+id+'.json'),
    crossed:path.join(dir,'crossed-'+id+'.json')};
}
export async function publishBackupEffectIntent({journalDirectory,intent}={}){
  validIntent(intent);
  const dir=await privateJournal(journalDirectory);
  const files=filenames(dir,intent.intent_id);
  const reservation=boundArchive(dir,intent);
  // Both must be fresh. A historical attempt, including 0-byte archives, is
  // not a new intent and its old destination must never be reused.
  try{await fs.lstat(intent.archive_path);throw failure('backup_effect_archive_existing');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  await writeOnce(files.intent,intent);
  // The archive is reserved at the directory level as well as the intent
  // level: two distinct UUIDs cannot race to write the same new destination.
  await writeOnce(reservation,{schema:'metaengine.pg17.archive-reservation.v1',
    intent_id:intent.intent_id,archive_path:intent.archive_path,
    automatic_retry_allowed:false,authority_effect:false});
  return Object.freeze({state:'PREPARED',intent_id:intent.intent_id,
    automatic_retry_allowed:false,authority_effect:false});
}
export async function crossBackupEffectBarrier({journalDirectory,intent}={}){
  validIntent(intent);
  const dir=await privateJournal(journalDirectory);
  const files=filenames(dir,intent.intent_id);
  const reservation=boundArchive(dir,intent);
  let stored;
  try{stored=await fs.readFile(files.intent,'utf8');}
  catch{throw failure('backup_effect_intent_missing');}
  if(stored.length>4096||stored.trimEnd()!==JSON.stringify(intent))
    throw failure('backup_effect_intent_drift');
  let reserved;
  try{reserved=JSON.parse(await fs.readFile(reservation,'utf8'));}
  catch{throw failure('backup_effect_reservation_unconfirmed');}
  if(reserved.schema!=='metaengine.pg17.archive-reservation.v1'
    ||reserved.intent_id!==intent.intent_id
    ||reserved.archive_path!==intent.archive_path
    ||reserved.automatic_retry_allowed!==false)
    throw failure('backup_effect_reservation_mismatch');
  try{await fs.lstat(intent.archive_path);throw failure('backup_effect_archive_existing');}
  catch(e){if(e.code!=='ENOENT')throw e;}
  const marker={schema:'metaengine.pg17.backup-effect-barrier.v1',
    state:'EFFECT_MAY_HAVE_STARTED',intent_id:intent.intent_id,
    intent_sha256:digest(Buffer.from(stored,'utf8')),
    automatic_retry_allowed:false,authority_effect:false,
    installer_started:false};
  // Durable marker MUST precede the external effect. A second caller sees
  // EEXIST and cannot cross even if the first caller lost its ACK.
  await writeOnce(files.crossed,marker);
  return Object.freeze({state:'EFFECT_MAY_HAVE_STARTED',
    intent_id:intent.intent_id,automatic_retry_allowed:false,
    authority_effect:false});
}
export async function readBackupEffectFence({journalDirectory,intentId}={}){
  const dir=await privateJournal(journalDirectory);
  const files=filenames(dir,intentId);
  let present=false,crossed=false;
  try{await fs.lstat(files.intent);present=true;}catch(e){if(e.code!=='ENOENT')present=true;}
  try{await fs.lstat(files.crossed);crossed=true;}catch(e){if(e.code!=='ENOENT')crossed=true;}
  return Object.freeze({schema:'metaengine.pg17.backup-effect-fence.v1',
    state:crossed?'EFFECT_UNKNOWN':present?'PRE_EFFECT_FENCED':'NO_INTENT',
    intent_found:present,barrier_found:crossed,
    automatic_retry_allowed:false,upgrade_authorized:false,authority_effect:false});
}
