import path from 'node:path';
// Predescriptor setup is repository ADMIN preparation, NOT a task lease or CLI permit.
export const NATIVE_SETUP_ACTIONS=Object.freeze(['DISCOVER_NATIVE_SETUP_V1','BEGIN_NATIVE_SETUP_V1','READ_NATIVE_SETUP_V1','CANCEL_NATIVE_SETUP_V1','READ_NATIVE_SETUP_ROUTE_V1']);
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH=/^[a-f0-9]{64}$/;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join('|')===[...keys].sort().join('|');
export function validateNativeSetupInput(action,value){
 const keys=['workspace_id',...(['DISCOVER_NATIVE_SETUP_V1','READ_NATIVE_SETUP_ROUTE_V1'].includes(action)?[]:['operation_id']),
  ...(action==='BEGIN_NATIVE_SETUP_V1'?['repository_scope_sha256','repo_root_identity_sha256','managed_root_identity_sha256']:[])];
 if(!NATIVE_SETUP_ACTIONS.includes(action)||!exact(value,keys)||!(action==='READ_NATIVE_SETUP_ROUTE_V1'&&value.workspace_id===null)&&!UUID.test(value.workspace_id||'')
  ||!['DISCOVER_NATIVE_SETUP_V1','READ_NATIVE_SETUP_ROUTE_V1'].includes(action)&&!UUID.test(value.operation_id||'')
  ||keys.filter(k=>k.endsWith('_sha256')).some(k=>!HASH.test(value[k]||'')))throw Error('native_setup_input_invalid');
 return Object.freeze(structuredClone(value));
}

// Canonical lexical boundaries precede actual inode/volume identity reads.
// Never prepare a filesystem/volume/share root; mixed or trailing separators
// are not accepted as a second spelling of the same authority path.
export function validateNativeSetupRoots(repo,managed,{platform=process.platform}={}){
 const paths=platform==='win32'?path.win32:path.posix;
 const key=v=>platform==='win32'?v.toLowerCase():v;
 const within=(a,b)=>{const relative=paths.relative(key(a),key(b));return relative===''||!paths.isAbsolute(relative)&&relative!=='..'&&!relative.startsWith('..'+paths.sep);};
 if(![repo,managed].every(v=>typeof v==='string'&&!/[\x00-\x1f]/.test(v)&&paths.isAbsolute(v)&&paths.resolve(v)===v&&paths.dirname(v)!==v)
  ||within(repo,managed)||within(managed,repo))throw Error('native_setup_repository_roots_invalid');
 return true;
}
