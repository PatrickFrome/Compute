import {createHash,createPublicKey,verify} from 'node:crypto';
import {AsyncLocalStorage} from 'node:async_hooks';
import {NATIVE_CODING_DEVICE_PATHS,validateNativeCodingDeviceRequest} from '../../apps/metaengine-browser/src/native-coding-device-request.mjs';
import {nativeCodingDeviceKeyFingerprint} from '../../apps/metaengine-browser/src/native-coding-transport-proof.mjs';
import {nativeCodingCanonicalJson as json} from './native-coding-task-context.mjs';

const fail=reason=>{throw Error('native_coding_device_request_'+reason);};
const hash=value=>createHash('sha256').update(value).digest('hex');
// The enrolled key proves the current private caller. SQL and OS checks in
// each mounted service still determine its current grant and physical scope.
export function createNativeCodingDeviceRequestVerifier({sql,hostInstanceId,hostPid,now=Date.now,maxNonces=512}={}){
  if(typeof sql?.unsafe!=='function'||typeof now!=='function'||!Number.isSafeInteger(maxNonces)||maxNonces<1||maxNonces>512
    ||!/^[a-f0-9-]{36}$/.test(hostInstanceId||'')||!Number.isSafeInteger(hostPid)||hostPid<1)fail('private_dependencies_required');
  const nonces=new Map();let closed=false;
  return Object.freeze({
    async verify({operation,...request}={}){
      if(closed)fail('closed');const value=validateNativeCodingDeviceRequest(request,operation),{body,headers}=value;
      if(body.host_instance_id!==hostInstanceId||body.host_pid!==hostPid)fail('host_changed');
      const timestamp=Date.parse(headers['x-a2-device-timestamp']);
      const fresh=()=>Number.isFinite(timestamp)&&now()>=timestamp-5000&&now()-timestamp<=30000;
      if(!fresh()||new Date(timestamp).toISOString()!==headers['x-a2-device-timestamp'])fail('timestamp_invalid');
      const canonical=json(body),bodyHash=hash(canonical);
      if(headers['x-a2-device-body-sha256']!==bodyHash)fail('body_changed');
      const rows=await sql.unsafe(`select d.device_id,d.client_id,d.profile,d.public_jwk,d.key_fingerprint_sha256,d.admin_grant_epoch,
        (current_user='state_owner' and session_user='state_owner' and d.active and d.revoked_at is null
          and d.access_tier='ADMIN' and d.admin_revoked_at is null and d.admin_grant_epoch>0
          and d.admin_scopes @> '["CONTROL_PLANE","DEVOS"]'::jsonb
          and exists(select 1 from public.compute_fabric_a2_chat_bridge_remote_pairing_h205f22 p
            where p.token_hash=d.enrollment_pairing_token_hash and p.active)) as admitted
        from public.compute_fabric_a2_browser_device_h205f22 d where d.device_id=$1::uuid and d.client_id=$2::text`,
        [headers['x-a2-device-id'],headers['x-a2-chat-bridge-client']]);
      const device=rows[0],epoch=Number(device?.admin_grant_epoch);
      if(rows.length!==1||device.admitted!==true||device.profile!=='A2_DEVICE_HTTP_SIGNATURE_V1'
        ||device.device_id!==headers['x-a2-device-id']||device.client_id!==headers['x-a2-chat-bridge-client']
        ||!Number.isSafeInteger(epoch)||epoch<1)fail('current_device_unavailable');
      let key;try{key=createPublicKey({key:device.public_jwk,format:'jwk'});
        if(nativeCodingDeviceKeyFingerprint(key)!==device.key_fingerprint_sha256)fail('key_changed');
      }catch{fail('key_invalid');}
      const material=['A2_DEVICE_HTTP_SIGNATURE_V1',`device_id:${device.device_id}`,'method:POST',
        `path:${NATIVE_CODING_DEVICE_PATHS[operation]}`,`timestamp:${headers['x-a2-device-timestamp']}`,
        `nonce:${headers['x-a2-device-nonce']}`,`body_sha256:${bodyHash}`].join('\n');
      if(!verify('sha256',Buffer.from(material),{key,dsaEncoding:'ieee-p1363'},Buffer.from(headers['x-a2-device-signature'],'base64url')))fail('signature_invalid');
      if(closed||!fresh())fail('timestamp_invalid');
      for(const [id,expires] of nonces)if(expires<now())nonces.delete(id);
      const nonceKey=hash(device.device_id+'\n'+headers['x-a2-device-nonce']);
      if(nonces.has(nonceKey))fail('nonce_reused');if(nonces.size>=maxNonces)fail('nonce_capacity');
      nonces.set(nonceKey,timestamp+30000);
      return Object.freeze({device_id:device.device_id,client_id:device.client_id,
        key_fingerprint_sha256:device.key_fingerprint_sha256,admin_grant_epoch:epoch});
    },
    close(){closed=true;nonces.clear();},
  });
}

// The current device exists only inside one successfully authenticated private
// invocation. Concurrent callers cannot replace a shared "current device" slot.
export function createNativeCodingAuthenticatedRequestContext({verifier,now=Date.now}={}){
  if(typeof verifier?.verify!=='function'||typeof now!=='function')fail('verifier_required');
  const storage=new AsyncLocalStorage();let closed=false;
  return Object.freeze({
    async run(operation,request,handler){
      if(closed||typeof handler!=='function')fail('context_closed');
      const checked=validateNativeCodingDeviceRequest(request,operation);
      const device=await verifier.verify({operation,...checked});if(closed)fail('context_closed');
      return storage.run({device,expires:now()+30000},()=>handler(checked.body.input,checked));
    },
    async readCurrentDevice(){
      const scope=storage.getStore();if(closed||!scope||scope.expires<now())fail('authenticated_scope_required');
      return structuredClone(scope.device);
    },
    close(){closed=true;},
  });
}
