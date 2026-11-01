import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

// Source dependency regression only. No installed Owner, actual backup,
// restoration or migration ordering is qualified by these generated fixtures.
// Existing verification must remain callable before execution setup exists.
const modules={
 host:new URL('../../apps/metaengine-browser/src/host-agent-runtime.mjs',import.meta.url).href,
 ipc:new URL('../../apps/metaengine-browser/src/host-agent-ipc.mjs',import.meta.url).href,
 protocol:new URL('../../apps/metaengine-browser/src/host-agent-protocol.mjs',import.meta.url).href,
 archive:new URL('./backup-verifier.mjs',import.meta.url).href,
 upgrade:new URL('./upgrade-backup-gate.mjs',import.meta.url).href,
};
async function isolated(t,body){
 const root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-backup-independent-')));
 t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const code=`
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import processTools from 'node:child_process';
import {registerHooks,syncBuiltinESMExports} from 'node:module';
const blocked=[],effects=[],root=${JSON.stringify(root)},modules=${JSON.stringify(modules)};
for(const key of ['exec','execFile','fork','spawn','execSync','execFileSync','spawnSync'])processTools[key]=()=>{
 effects.push(key);throw Error('backup_process_effect_forbidden');
};
syncBuiltinESMExports();
const hook=registerHooks({resolve(specifier,context,next){
 if(['postgres','pg','electron','@electric-sql/pglite'].includes(specifier)
  ||/(?:^|\\/)(?:main|runtime-host|local-runtime-migrations|attached-postgres-onboarding|native-coding-runtime|native-coding-operator-paths|codex-cli-runner|codex-cli-sandbox-probe)\\.mjs(?:[?#]|$)/.test(specifier)){
  blocked.push(specifier);throw Error('backup_execution_dependency_forbidden');
 }
 return next(specifier,context);
}});
try{
${body}
 assert.deepEqual(blocked,[]);assert.deepEqual(effects,[]);
}finally{hook.deregister();}
console.log('backup_readonly_independent');
`;
 const result=spawnSync(process.execPath,['--input-type=module','--eval',code],{
  encoding:'utf8',windowsHide:true,timeout:15000,maxBuffer:64*1024,
 });
 assert.equal(result.error,undefined);
 assert.equal(result.status,0,result.stderr);
 assert.equal(result.stdout,'backup_readonly_independent\n');
 assert.equal(result.stderr,'');
}

test('authenticated fixed-root backup ACL readback remains available without execution or migration modules',async t=>{
 await isolated(t,`
 const {HostAgentRuntime}=await import(modules.host);
 const {HostAgentClient,hostAgentEndpoint}=await import(modules.ipc);
 const {createHostAgentSessionKey}=await import(modules.protocol);
 const unavailable=async()=>{effects.push('execution-boundary');throw Error('execution_setup_missing');};
 const endpoint=hostAgentEndpoint({userDataPath:root}),sessionKey=createHostAgentSessionKey();
 const host=new HostAgentRuntime({endpoint,sessionKey,
  developmentPlane:{request:unavailable},fastControl:{invoke:unavailable},
  browserStatus:unavailable,browserPlanExecute:unavailable,browserPlanCancel:unavailable});
 const client=new HostAgentClient({endpoint,sessionKey});
 const foreign=new HostAgentClient({endpoint,sessionKey:createHostAgentSessionKey()});
 await host.start();
 try{
  const acl=await client.request('BACKUP_ACL_READBACK',{});
  assert.equal(acl.state,'UNKNOWN');assert.equal(acl.native_acl_verified,false);
  assert.equal(acl.installed_owner_proven,false);assert.equal(acl.upgrade_authorized,false);
  assert.equal(acl.authority_effect,false);assert.equal(acl.automatic_retry_allowed,false);
  await assert.rejects(client.request('BACKUP_ACL_READBACK',{archivePath:path.join(root,'foreign.dump')}),/payload_forbidden/);
  const before=host.snapshot().requests;
  await assert.rejects(foreign.request('BACKUP_ACL_READBACK',{}, {timeoutMs:1000}));
  assert.equal(host.snapshot().requests,before);
 }finally{client.close();foreign.close();await host.close();}
 `);
});

test('standalone archive and installed-backup verification keep honest refusal without database, tools or execution setup',async t=>{
 await isolated(t,`
 const {verifyBackup}=await import(modules.archive);
 const {verifyInstalledUpgradeBackup}=await import(modules.upgrade);
 const project='abcdefghijklmnopqrst',sha=bytes=>createHash('sha256').update(bytes).digest('hex');
 const table=(name)=>({schema:name==='state'?'public':'storage',name,rows:'0',content_md5:'d41d8cd98f00b204e9800998ecf8427e'});
 const inventory={database:'postgres',snapshot_id:'00000003-00000008-1',schemas:[],extensions:[],roles:[{rolname:'postgres'}],
  functions:[],policies:[],publications:[],tables:['state','objects','buckets'].map(table),vault_plaintext_rows:0};
 const contents={
  'database.dump':'PGDMP generated format fixture',
  'database.sql':'--\\n-- PostgreSQL database dump\\n--\\n',
  'roles.sql':'-- PostgreSQL database cluster dump\\n',
  'archive-toc.txt':'; Format: CUSTOM\\n',
  'database-inventory.json':JSON.stringify(inventory),
  'storage-buckets.json':'[]','storage-object-manifest.json':'[]',
 };
 const manifest={schema:'metaengine.full-database-backup.v1',project,database_complete:true,status:'DATABASE_COMPLETE_PLATFORM_PARTIAL',
  stages:{database:'CONSISTENT_ALL_SCHEMA_DUMP',roles:'METADATA_WITHOUT_LOGIN_PASSWORDS',archive:'OFFLINE_FULL_SQL_EXTRACTION_VERIFIED',
   storage_objects:'EMPTY_CONFIRMED_BY_DATABASE_SNAPSHOT'},files:[]};
 for(const [name,text] of Object.entries(contents)){
  const bytes=Buffer.from(text);await fs.writeFile(path.join(root,name),bytes,{mode:0o600});
  manifest.files.push({path:name,bytes:bytes.length,sha256:sha(bytes)});
 }
 await fs.writeFile(path.join(root,'backup-manifest.json'),JSON.stringify(manifest),{mode:0o600});
 const result=await verifyBackup({root,expectedProject:project});
 assert.equal(result.archive_integrity_verified,true);assert.equal(result.database_archive_complete,true);
 assert.equal(result.storage_bytes_complete,true);assert.equal(result.restore_verified,false);
 assert.equal(result.source_authenticity_attested,false);assert.equal(result.promotion_authorized,false);
 assert.equal(result.authority_effect,false);assert.equal(result.data_policy.remote_export_allowed,false);
 const installed=await verifyInstalledUpgradeBackup({});
 assert.equal(installed.reason,'RECEIPT_MISSING_OR_UNQUALIFIED');
 assert.equal(installed.backup_verified,false);assert.equal(installed.upgrade_authorized,false);
 assert.equal(installed.automatic_retry_allowed,false);assert.equal(installed.authority_effect,false);
 `);
});
