import path from 'node:path';
import {readNativeCodingProtectedJson} from './native-coding-host-observers.mjs';

// Protected local paths and digest pins only. Own-PG remains the authority.
export async function readNativeCodingOperatorPaths(stateDirectory) {
  const {value}=await readNativeCodingProtectedJson(path.join(stateDirectory,'native-coding-operator-v1.json'));
  const keys=['schema','cli_executable','codex_home','git_executable','journal_root','worker_temp_root','result_index_root','sandbox_receipts'];
  if(Object.keys(value).sort().join(',')!==keys.sort().join(',')||value.schema!=='metaengine.native-coding.operator-paths.v1')
    throw Error('native_coding_host_os_operator_paths_invalid');
  for(const key of keys.filter(x=>!['schema','sandbox_receipts'].includes(x)))
    if(typeof value[key]!=='string'||!path.isAbsolute(value[key])||value[key].includes('\0'))throw Error('native_coding_host_os_operator_path_invalid');
  if(!value.sandbox_receipts||Object.keys(value.sandbox_receipts).sort().join(',')!=='CRITIC,IMPLEMENTER')throw Error('native_coding_host_os_sandbox_pins_invalid');
  for(const pin of Object.values(value.sandbox_receipts))
    if(!pin||Object.keys(pin).sort().join(',')!=='path,sha256'||!path.isAbsolute(pin.path||'')||!/^[a-f0-9]{64}$/.test(pin.sha256||''))
      throw Error('native_coding_host_os_sandbox_pin_invalid');
  return Object.freeze(value);
}
