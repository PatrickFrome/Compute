import {AsyncLocalStorage} from 'node:async_hooks';
// PRIVATE owned-ChildProcess cleanup protocol, never effect/readiness authority.
// A terminal caller response (including UNKNOWN) is independent of settlement.
export const NATIVE_CODING_HOST_SETTLEMENT='metaengine.native-coding.host-settlement.v1';
const keys=['schema','instance_id','host_pid','request_id','action','request_sha256','state','cleanup_confirmed','authority_effect'];
export function nativeCodingHostSettlement(binding,held=false){
 return Object.freeze({schema:NATIVE_CODING_HOST_SETTLEMENT,instance_id:binding.instance_id,host_pid:binding.host_pid,
  request_id:binding.request_id,action:binding.action,request_sha256:binding.request_sha256,
  state:held?'HOLD':'SETTLED',cleanup_confirmed:!held,authority_effect:false});
}
export function validateNativeCodingHostSettlement(value,binding){
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|')
  ||value.schema!==NATIVE_CODING_HOST_SETTLEMENT||['instance_id','host_pid','request_id','action','request_sha256'].some(k=>value[k]!==binding[k])
  ||!['SETTLED','HOLD'].includes(value.state)||value.cleanup_confirmed!==(value.state==='SETTLED')||value.authority_effect!==false)
  throw Error('native_host_settlement_invalid');
 return value.state;
}
// Only exact in-process errors tagged by a physical resource owner qualify.
// An arbitrary error property, SQL diagnostic or serialized payload cannot tag
// an operation as safely settled (and this marker can only REMOVE readiness).
const unconfirmed=new WeakSet(),physicalScope=new AsyncLocalStorage();
export function runNativePhysicalSettlementScope(operation){
 const scope={held:false};
 return Object.freeze({promise:physicalScope.run(scope,()=>Promise.resolve().then(operation)),unconfirmed:()=>scope.held});
}
export function markNativePhysicalSettlementUnconfirmed(error){
 const safe=error instanceof Error?error:Error('native_physical_settlement_unconfirmed');unconfirmed.add(safe);const scope=physicalScope.getStore();if(scope)scope.held=true;return safe;
}
export const nativePhysicalSettlementUnconfirmed=error=>!!error&&unconfirmed.has(error);
