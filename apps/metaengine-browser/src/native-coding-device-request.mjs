import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';

export const NATIVE_CODING_DEVICE_PATHS=Object.freeze({SEED_GOAL:'/private/native-coding/seed-goal',
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
  if(['SEED_GOAL','READ_SEED'].includes(operation)){
    const input=body.input;
    if(!exact(input,['request_id','objective'])||!UUID.test(input.request_id||'')||typeof input.objective!=='string'
      ||!input.objective||input.objective!==input.objective.trim()||[...input.objective].length>480
      ||Buffer.byteLength(input.objective)>1920||/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(input.objective))fail('input_invalid');
  }else if(operation==='LIST_SEEDS'){
    if(!exact(body.input,['after_seq','limit'])||!Number.isSafeInteger(body.input.after_seq)||body.input.after_seq<0
      ||!Number.isSafeInteger(body.input.limit)||body.input.limit<1||body.input.limit>16)fail('input_invalid');
  }else if(operation==='READ_SERVICE_HEARTBEAT'){
    if(!exact(body.input,['workspace_id','body_sha256'])||!UUID.test(body.input.workspace_id||'')
      ||!/^[a-f0-9]{64}$/.test(body.input.body_sha256||''))fail('input_invalid');
  }else if(!body.input||typeof body.input!=='object'||Array.isArray(body.input))fail('input_invalid');
  if(Buffer.byteLength(json(body))>65536)fail('body_budget');
  return structuredClone(value);
}

// Native main only. The caller supplies a fixed action and the actual private
// ChildProcess capability snapshot, never a renderer-selected signing path.
export async function signNativeCodingDeviceRequest({identity,binding,operation,input}={}){
  const device=identity?.snapshot?.();
  if(device?.enrolled!==true||!UUID.test(device.device_id||'')||!UUID.test(device.client_id||'')
    ||typeof identity.deviceHeaders!=='function'||!Object.hasOwn(NATIVE_CODING_DEVICE_PATHS,operation))fail('enrolled_identity_required');
  const body={host_instance_id:binding?.instance_id,host_pid:binding?.host_pid,operation,input:structuredClone(input)};
  if(!UUID.test(body.host_instance_id||'')||!Number.isSafeInteger(body.host_pid)||body.host_pid<1)fail('host_binding_required');
  const headers=await identity.deviceHeaders('POST',NATIVE_CODING_DEVICE_PATHS[operation],json(body));
  if(identity.snapshot()?.device_id!==device.device_id||identity.snapshot()?.key_fingerprint_sha256!==device.key_fingerprint_sha256
    ||headers['x-a2-device-id']!==device.device_id||headers['x-a2-chat-bridge-client']!==device.client_id)fail('identity_changed');
  return validateNativeCodingDeviceRequest({body,headers},operation);
}
