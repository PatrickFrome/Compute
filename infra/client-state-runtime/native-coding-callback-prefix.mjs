import fs from 'node:fs/promises';
import path from 'node:path';
import {readDirectoryIdentity} from './native-coding-fs-identity.mjs';
import {readNativeCodingProtectedJson} from '../../apps/metaengine-browser/src/native-coding-host-observers.mjs';
import {readNativeRunCallbackJournal} from '../../apps/metaengine-browser/src/native-coding-run-callback-journal.mjs';
import {nativeCodingCanonicalSha256 as sha,nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';
import {assertNativeCodingHostRequestOpen as open} from './native-coding-host-request-lifetime.mjs';
const fail=()=>{throw Error('native_callback_publication_prefix_hold');};
const sameAttempt=(a,b)=>json(a)===json(b);
// All ancestors are part of physical identity, not just the leaf. No path is
// persisted in publication evidence. This does not claim directory durability.
async function identity(directory){
 const chain=[];let current=directory;
 for(;;){chain.push(await readDirectoryIdentity(current));const next=path.dirname(current);if(next===current)break;current=next;}
 return sha(chain);
}
// Only the protected OS composition derives directory. Test injection here is
// a generated ACL fixture, NEVER a producer of trusted publication authority.
export async function readNativeCallbackProtectedPrefix({directory,expected=null,intent=null,publicationCursor=null,request,readProtectedJson=readNativeCodingProtectedJson}={}){
 open(request);if(!path.isAbsolute(directory||''))fail();
 const root=path.join(directory,'host-callback-custody'),before=await identity(root);
 const attempt=(await readProtectedJson(path.join(directory,'attempt.json'),{maximumBytes:256*1024,signal:request?.signal})).value;
 const first=await readNativeRunCallbackJournal(directory);
 if(first.state==='HOLD'||first.records<2||!Number.isSafeInteger(first.records))fail();
 let head='0'.repeat(64),header=null,bound=null,anchorSeen=expected===null,initialHead=null;
 let publicationSeen=publicationCursor===null,intentSequence=null;
 for(let sequence=0;sequence<first.records;sequence++){
  open(request);
  const file=path.join(root,String(sequence).padStart(16,'0')+'.json'),s=await fs.lstat(file,{bigint:true});
  if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1n||s.size>8192n)fail();
  const record=(await readProtectedJson(file,{maximumBytes:8192,signal:request?.signal})).value;
  const after=await fs.lstat(file,{bigint:true});
  if(['dev','ino','birthtimeNs','ctimeNs','mtimeNs','size','nlink'].some(k=>s[k]!==after[k])
   ||record.sequence!==sequence||record.previous_sha256!==head)fail();
  head=sha(record);
  if(sequence===0){header=record.event;if(header?.kind!=='HEADER')fail();}
  if(sequence===1){bound=record.event;initialHead=head;if(bound?.kind!=='BOUND')fail();}
  if(expected&&sequence+1===expected.record_count){if(head!==expected.head_sha256)fail();anchorSeen=true;}
  if(publicationCursor&&sequence+1===publicationCursor.record_count){if(head!==publicationCursor.head_sha256)fail();publicationSeen=true;}
  if(intent&&record.event?.request_id===intent.request_id){
   const event=record.event;
   if(intentSequence!==null||event.kind!=='INTENT'||event.request_sha256!==intent.request_sha256
    ||event.operation!==intent.operation||event.job_binding_sha256!==intent.job_binding_sha256)fail();
   intentSequence=sequence;
  }
 }
 const last=await readNativeRunCallbackJournal(directory);open(request);
 const attemptAfter=(await readProtectedJson(path.join(directory,'attempt.json'),{maximumBytes:256*1024,signal:request?.signal})).value;
 if(!sameAttempt(attempt,attemptAfter)||!anchorSeen||!publicationSeen||head!==first.head_sha256||json(first)!==json(last)||before!==await identity(root)
  ||intent&&(intentSequence===null||first.dispatch_fenced||sha(intent.binding)!==bound.binding_sha256
    ||publicationCursor&&intentSequence>=publicationCursor.record_count))fail();
 return Object.freeze({attempt:structuredClone(attempt),attempt_sha256:sha(attempt),run_id:header.run_id,lease_binding_sha256:header.lease_binding_sha256,
  bound_binding_sha256:bound.binding_sha256,host_instance_id:bound.instance_id,host_pid:bound.host_pid,
  prefix_identity_sha256:before,header_sha256:sha(header),bound_sha256:initialHead,
  record_count:first.records,intent_count:first.requests,head_sha256:head,dispatch_fenced:first.dispatch_fenced,
  ...(intent?{intent_sha256:sha(intent),intent_sequence:intentSequence}:{}),
  local_durability:'DIRECTORY_DURABILITY_UNQUALIFIED',structural_only:true});
}
