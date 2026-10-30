import test from 'node:test';
import assert from 'node:assert/strict';
import {NATIVE_SETUP_ACTIONS,validateNativeSetupInput,validateNativeSetupRoots} from '../src/native-coding-setup-contract.mjs';
const workspace_id='11111111-1111-4111-8111-111111111111',operation_id='22222222-2222-4222-8222-222222222222';
for(const action of NATIVE_SETUP_ACTIONS)test(action+' has an exact closed input contract, never paths/commands/authority flags',()=>{
 const input={workspace_id,...(['DISCOVER_NATIVE_SETUP_V1','READ_NATIVE_SETUP_ROUTE_V1'].includes(action)?{}:{operation_id}),...(action==='BEGIN_NATIVE_SETUP_V1'?{repository_scope_sha256:'a'.repeat(64),repo_root_identity_sha256:'b'.repeat(64),managed_root_identity_sha256:'c'.repeat(64)}:{})};
 assert.deepEqual(validateNativeSetupInput(action,input),input);
 for(const extra of [{workspace_id:'invalid'},{path:'/tmp/work'},{codexHome:'/tmp/home'},{command:'cli'},{verified:true},{admin:true},...(action==='READ_NATIVE_SETUP_ROUTE_V1'?[]:[{workspace_id:null}])])assert.throws(()=>validateNativeSetupInput(action,{...input,...extra}));
});
test('canonical disjoint roots refuse filesystem/volume/share roots, trailing/mixed separators, nested and case aliases',()=>{
 assert.equal(validateNativeSetupRoots('/repo','/managed',{platform:'linux'}),true);
 assert.equal(validateNativeSetupRoots('C:\\repo','C:\\managed',{platform:'win32'}),true);
 for(const [repo,managed,platform] of [
  ['/','/managed','linux'],['/repo','/','linux'],['/repo/','/managed','linux'],['/repo','/repo/sub','linux'],['/repo/sub','/repo','linux'],
  ['C:\\','D:\\managed','win32'],['C:\\repo','D:\\','win32'],['C:/','D:\\managed','win32'],['C:\\repo\\','C:\\managed','win32'],
  ['C:\\Repo','c:\\repo\\nested','win32'],['C:\\repo','C:/repo/sub','win32'],['\\\\server\\share\\','C:\\managed','win32'],
 ])assert.throws(()=>validateNativeSetupRoots(repo,managed,{platform}),/roots_invalid/,`${platform}: ${repo} vs ${managed}`);
});
