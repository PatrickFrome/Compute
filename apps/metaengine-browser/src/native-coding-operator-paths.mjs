import path from 'node:path';
import {readNativeCodingProtectedJson} from './native-coding-host-observers.mjs';

// Protected local paths and digest pins only. Own-PG remains the authority.
export async function readNativeCodingOperatorPaths(stateDirectory) {
  const {value}=await readNativeCodingProtectedJson(path.join(stateDirectory,'native-coding-operator-v1.json'));
  return validateNativeCodingOperatorPaths(value);
}

export function validateNativeCodingOperatorPaths(value){
  const keys=['schema','cli_executable','codex_home','git_executable','journal_root','worker_temp_root','result_index_root','sandbox_receipts'];
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error('native_coding_host_os_operator_paths_invalid');
  const expected=[...keys,...(Object.hasOwn(value,'provider_sandbox_receipts')?['provider_sandbox_receipts']:[])];
  if(Object.keys(value).sort().join(',')!==expected.sort().join(',')||value.schema!=='metaengine.native-coding.operator-paths.v1')
    throw Error('native_coding_host_os_operator_paths_invalid');
  for(const key of keys.filter(x=>!['schema','sandbox_receipts'].includes(x)))
    if(typeof value[key]!=='string'||!path.isAbsolute(value[key])||value[key].includes('\0'))throw Error('native_coding_host_os_operator_path_invalid');
  if(!value.sandbox_receipts||Object.keys(value.sandbox_receipts).sort().join(',')!=='CRITIC,IMPLEMENTER')throw Error('native_coding_host_os_sandbox_pins_invalid');
  for(const pin of Object.values(value.sandbox_receipts))
    if(!pin||Object.keys(pin).sort().join(',')!=='path,sha256'||!path.isAbsolute(pin.path||'')||!/^[a-f0-9]{64}$/.test(pin.sha256||''))
      throw Error('native_coding_host_os_sandbox_pin_invalid');
  if(Object.hasOwn(value,'provider_sandbox_receipts')){
    const seen=new Set();
    if(!Array.isArray(value.provider_sandbox_receipts)||value.provider_sandbox_receipts.length<2||value.provider_sandbox_receipts.length>64)
      throw Error('native_coding_host_os_provider_sandbox_pins_invalid');
    for(const pin of value.provider_sandbox_receipts){
      if(!pin||Object.keys(pin).sort().join(',')!=='agent_id,path,provider_id,role,sha256'
        ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(pin.provider_id||'')
        ||!/^agent_[a-z0-9-]{8,64}$/.test(pin.agent_id||'')||!['IMPLEMENTER','CRITIC'].includes(pin.role)
        ||!path.isAbsolute(pin.path||'')||!/^[a-f0-9]{64}$/.test(pin.sha256||'')||seen.has(pin.provider_id))
        throw Error('native_coding_host_os_provider_sandbox_pin_invalid');
      seen.add(pin.provider_id);
    }
  }
  return Object.freeze(value);
}

export function resolveNativeCodingSandboxPin(operator,provider){
  if(operator.provider_sandbox_receipts){
    const rows=operator.provider_sandbox_receipts.filter(pin=>pin.provider_id===provider.provider_id
      &&pin.agent_id===provider.agent_id&&pin.role===provider.role);
    if(rows.length!==1)throw Error('native_coding_host_os_provider_sandbox_pin_missing');
    return {path:rows[0].path,sha256:rows[0].sha256};
  }
  const pin=operator.sandbox_receipts?.[provider.role];
  if(!pin)throw Error('native_coding_host_os_sandbox_pin_missing');return {path:pin.path,sha256:pin.sha256};
}
