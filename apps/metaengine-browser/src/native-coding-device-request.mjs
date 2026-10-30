import {validateNativeCapacityReadInput} from './native-coding-capacity-contract.mjs';
import {NATIVE_SETUP_ACTIONS,validateNativeSetupInput} from './native-coding-setup-contract.mjs';
import {pendingActivationInput} from './native-coding-pending-activation-phase.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';

export const NATIVE_CODING_DEVICE_PATHS=Object.freeze({SERVICE_HEARTBEAT_V2:'/private/native-coding/service-heartbeat-v2',READ_SERVICE_HEARTBEAT_V2:'/private/native-coding/read-service-heartbeat-v2',READ_NATIVE_CAPACITY_V1:'/private/native-coding/read-native-capacity-v1',...Object.fromEntries(NATIVE_SETUP_ACTIONS.map(action=>[action,'/private/native-coding/'+action.toLowerCase().replaceAll('_','-')])),ACTIVATE_PREPARED_GOAL_V1:'/private/native-coding/activate-prepared-goal-v1',READ_PREPARED_GOAL_ACTIVATION_V1:'/private/native-coding/read-prepared-goal-activation-v1',ESTABLISH_PENDING_OWNER_V1:'/private/native-coding/establish-pending-owner-v1',READ_PENDING_OWNER_V1:'/private/native-coding/read-pending-owner-v1',ADMIT_PREPARED_GOAL_V1:'/private/native-coding/admit-prepared-goal-v1',READ_PREPARED_GOAL_V1:'/private/native-coding/read-prepared-goal-v1',PREPARE_WORKSPACE_V1:'/private/native-coding/prepare-workspace-v1',READ_WORKSPACE_PREPARATION_V1:'/private/native-coding/read-workspace-preparation-v1',SEED_GOAL:'/private/native-coding/seed-goal',
  READ_SEED:'/private/native-coding/read-seed',LIST_SEEDS:'/private/native-coding/list-seeds',
  SERVICE_HEARTBEAT:'/private/native-coding/service-heartbeat',READ_SERVICE_HEARTBEAT:'/private/native-coding/read-service-heartbeat'});
export const NATIVE_CODING_DEVICE_HEADER_KEYS=Object.freeze(['content-type','x-a2-chat-bridge-client','x-a2-device-profile',
  'x-a2-device-id','x-a2-device-timestamp','x-a2-device-nonce','x-a2-device-body-sha256','x-a2-device-signature']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const fail=reason=>{throw Error('native_coding_device_request_'+reason);};
const exact=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)
  &&Object.keys(value).sort().join('\0')===[...fields].sort().join('\0');
export function validateNativeCodingDeviceRequest(value,operation){
  if(!Object.hasOwn(NATIVE_CODING_DEVICE_PATHS,operation)||!exact(value,['body','headers']))fail('request_invalid');
  const {body,headers}=value;
  if(!exact(body,['host_instance_id','host_pid','operation','input'])||body.operation!==operation
    ||!UUID.test(body.host_instance_id||'')||!Number.isSafeInteger(body.host_pid)||body.host_pid<1
    ||!exact(headers,NATIVE_CODING_DEVICE_HEADER_KEYS)||Object.values(headers).some(v=>typeof v!=='string'||v.length>256)
    ||headers['content-type']!=='application/json'||headers['x-a2-device-profile']!=='A2_DEVICE_HTTP_SIGNATURE_V1'
    ||!UUID.test(headers['x-a2-device-id']||'')||!UUID.test(headers['x-a2-chat-bridge-client']||'')
    ||!/^[-_a-zA-Z0-9]{32,96}$/.test(headers['x-a2-device-nonce']||'')
    ||!/^[-_a-zA-Z0-9]{86}$/.test(headers['x-a2-device-signature']||'')
    ||!/^[a-f0-9]{64}$/.test(headers['x-a2-device-body-sha256']||''))fail('binding_invalid');
  if(operation==='READ_NATIVE_CAPACITY_V1'){validateNativeCapacityReadInput(body.input);
  }else if(NATIVE_SETUP_ACTIONS.includes(operation)){validateNativeSetupInput(operation,body.input);
  }else if(['ACTIVATE_PREPARED_GOAL_V1','READ_PREPARED_GOAL_ACTIVATION_V1'].includes(operation)){
    pendingActivationInput(body.input);
  }else if(['SEED_GOAL','READ_SEED'].includes(operation)){
    const input=body.input;
    if(!exact(input,['request_id','objective'])||!UUID.test(input.request_id||'')||typeof input.objective!=='string'
      ||!input.objective||input.objective!==input.objective.trim()||[...input.objective].length>480
      ||Buffer.byteLength(input.objective)>1920||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.objective))fail('input_invalid');
  }else if(['ESTABLISH_PENDING_OWNER_V1','READ_PENDING_OWNER_V1','ADMIT_PREPARED_GOAL_V1','READ_PREPARED_GOAL_V1'].includes(operation)){
    const input=body.input;
    if(!exact(input,['preparation_id','configuration_sha256','request_id','objective'])||!UUID.test(input.request_id||'')
      ||!UUID.test(input.preparation_id||'')||!/^[a-f0-9]{64}$/.test(input.configuration_sha256||'')
      ||typeof input.objective!=='string'||!input.objective||input.objective!==input.objective.trim()
      ||[...input.objective].length>480||Buffer.byteLength(input.objective)>1920||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.objective))fail('input_invalid');
  }else if(['PREPARE_WORKSPACE_V1','READ_WORKSPACE_PREPARATION_V1'].includes(operation)){
    if(!exact(body.input,['preparation_id','configuration_sha256'])||!UUID.test(body.input.preparation_id||'')
      ||!/^[a-f0-9]{64}$/.test(body.input.configuration_sha256||''))fail('input_invalid');
  }else if(operation==='LIST_SEEDS'){
    if(!exact(body.input,['after_seq','limit'])||!Number.isSafeInteger(body.input.after_seq)||body.input.after_seq<0
      ||!Number.isSafeInteger(body.input.limit)||body.input.limit<1||body.input.limit>16)fail('input_invalid');
  }else if(['READ_SERVICE_HEARTBEAT','READ_SERVICE_HEARTBEAT_V2'].includes(operation)){
    if(!exact(body.input,['workspace_id','body_sha256'])||!UUID.test(body.input.workspace_id||'')
      ||!/^[a-f0-9]{64}$/.test(body.input.body_sha256||''))fail('input_invalid');
  }else if(!body.input||typeof body.input!=='object'||Array.isArray(body.input))fail('input_invalid');
  if(Buffer.byteLength(json(body))>65536)fail('body_budget');
  return structuredClone(value);
}

// Native main only. The caller supplies a fixed action and the actual private
// ChildProcess capability snapshot, never a renderer-selected signing path.
function signingDevice(identity){
 const device=identity?.snapshot?.();
 if(device?.enrolled!==true||!UUID.test(device.device_id||'')||!UUID.test(device.client_id||''))fail('enrolled_identity_required');
 return device;
}
function signingBody(binding,operation,input){
 const body={host_instance_id:binding?.instance_id,host_pid:binding?.host_pid,operation,input:structuredClone(input)};
 if(!UUID.test(body.host_instance_id||'')||!Number.isSafeInteger(body.host_pid)||body.host_pid<1)fail('host_binding_required');
 return body;
}
function signedRequest(identity,device,body,headers){
 if(identity.snapshot()?.enrolled!==true||identity.snapshot()?.device_id!==device.device_id||identity.snapshot()?.client_id!==device.client_id
  ||identity.snapshot()?.key_fingerprint_sha256!==device.key_fingerprint_sha256
  ||headers['x-a2-device-id']!==device.device_id||headers['x-a2-chat-bridge-client']!==device.client_id)fail('identity_changed');
 return validateNativeCodingDeviceRequest({body,headers},body.operation);
}
export async function signNativeCodingDeviceRequest({identity,binding,operation,input}={}){
 const device=signingDevice(identity);
 if(typeof identity.deviceHeaders!=='function'||!Object.hasOwn(NATIVE_CODING_DEVICE_PATHS,operation))fail('enrolled_identity_required');
 const body=signingBody(binding,operation,input),headers=await identity.deviceHeaders('POST',NATIVE_CODING_DEVICE_PATHS[operation],json(body));
 return signedRequest(identity,device,body,headers);
}
// A presentation read may use only an already-loaded key and this fixed route.
// No generic signing path, effect operation, or initialize-if-missing fallback.
export async function signLoadedNativeSetupRouteRead({identity,binding,input}={}){
 const device=signingDevice(identity);
 if(typeof identity.nativeSetupRouteReadHeaders!=='function')fail('loaded_read_signer_required');
 const body=signingBody(binding,'READ_NATIVE_SETUP_ROUTE_V1',input);
 const headers=await identity.nativeSetupRouteReadHeaders(body);
 return signedRequest(identity,device,body,headers);
}
