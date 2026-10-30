import {createNativeWorkspacePreparation} from './native-coding-workspace-preparation.mjs';
import {assertNativeCodingHostRequestOpen} from './native-coding-host-request-lifetime.mjs';
import {validateNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {createNativeCodingHostSeedService} from './native-coding-host-seed-service.mjs';
import {createNativeCodingDeviceRequestVerifier,createNativeCodingAuthenticatedRequestContext} from './native-coding-device-request.mjs';

const PREPARATION_ACTIONS=['PREPARE_WORKSPACE_V1','READ_WORKSPACE_PREPARATION_V1','ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1'];
const ACTIONS=['SEED_GOAL','READ_SEED','LIST_SEEDS'];
const fail=reason=>{throw Error('native_coding_host_seed_binding_'+reason);};

// The verified native Host already owns the connection and fixed private state
// directory. A profile published after Host startup may prepare this optional
// service on readonly discovery. Preparation never dispatches a goal, changes
// its protected pins, or grants the caller an authenticated invocation.
export function createNativeCodingHostSeedBinding({sql,stateDirectory,readNativeScope,hostInstanceId,hostPid,workspaceTransaction=null,
 createService=createNativeCodingHostSeedService,createVerifier=createNativeCodingDeviceRequestVerifier,
 createContext=createNativeCodingAuthenticatedRequestContext}={}){
 if(![createService,createVerifier,createContext].every(value=>typeof value==='function'))fail('private_dependencies_required');
 const verifier=createVerifier({sql,hostInstanceId,hostPid});
 let context;
 try{context=createContext({verifier});}catch(error){verifier.close();throw error;}
 let closed=false,service=null,pending=null;
 const active=new Set();
 let workspacePreparation;
 try{workspacePreparation=workspaceTransaction?createNativeWorkspacePreparation({transaction:workspaceTransaction,stateDirectory,readNativeScope,readCurrentDevice:context.readCurrentDevice}):null;}
 catch(error){try{context.close();}finally{verifier.close();}throw error;}
 const open=()=>{if(closed)fail('closed');};
 function prepare(){
  open();
  if(service)return Promise.resolve(service);
  if(pending)return pending;
  const attempt=Promise.resolve().then(()=>{
   open();
   return createService({sql,stateDirectory,readNativeScope,readCurrentDevice:context.readCurrentDevice});
  }).then(candidate=>{
   if(!candidate||![...ACTIONS,'close'].every(action=>typeof candidate[action]==='function')){
    candidate?.close?.();fail('service_invalid');
   }
   if(closed){candidate.close();fail('closed');}
   service=candidate;return service;
  });
  pending=attempt;
  // Only overlapping preparations join. A missing or invalid profile can be
  // corrected by the operator and read again; a mounted service is never
  // replaced and continues enforcing its original protected pins.
  const settled=()=>{if(pending===attempt)pending=null;};
  attempt.then(settled,settled);
  return attempt;
 }
 async function invoke(action,request,requestContext){
  open();assertNativeCodingHostRequestOpen(requestContext);
  const checked=validateNativeCodingDeviceRequest(request,action);
  if(PREPARATION_ACTIONS.includes(action)){
   if(!workspacePreparation)fail('preparation_transaction_required');
   return context.run(action,checked,async input=>{
    open();assertNativeCodingHostRequestOpen(requestContext);
    const result=await workspacePreparation[action](input,requestContext);
    open();assertNativeCodingHostRequestOpen(requestContext);return result;
   });
  }
  // A write never boots an unavailable service or waits for its cold setup.
  // The caller must first obtain an authenticated readonly catalog/readback.
  if(action==='SEED_GOAL'&&!service)fail('not_ready');
  const current=service||await prepare();
  open();assertNativeCodingHostRequestOpen(requestContext);
  // Cold image/ACL preparation precedes the existing cryptographic freshness
  // check. A packet that expired during setup is rejected, never re-signed or
  // retried here. The next readonly request must carry a fresh signature.
  return context.run(action,checked,async input=>{
   open();assertNativeCodingHostRequestOpen(requestContext);
   const result=await current[action](input,requestContext);
   open();assertNativeCodingHostRequestOpen(requestContext);return result;
  });
 }
 function close(){
  if(closed)return;
  closed=true;
  const current=service;service=null;
  try{workspacePreparation?.close();current?.close();}finally{try{context.close();}finally{verifier.close();}}
 }
 const operations=Object.freeze({...Object.fromEntries([...ACTIONS,...PREPARATION_ACTIONS].map(action=>[action,(request,requestContext)=>{
  const attempt=Promise.resolve().then(()=>invoke(action,request,requestContext));active.add(attempt);
  const settled=()=>active.delete(attempt);attempt.then(settled,settled);return attempt;
 }])),close});
 async function drain(){while(active.size||pending){await Promise.allSettled([...active,...(pending?[pending]:[])]);}}
 // prepare/close are native lifecycle methods, not additional IPC operations.
 return Object.freeze({operations,prepare,close,drain});
}
