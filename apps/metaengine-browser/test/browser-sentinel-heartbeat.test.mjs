import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { BrowserSentinelHeartbeat, __sentinelTest } from '../src/browser-sentinel-heartbeat.mjs';

const hash=(b)=>crypto.createHash('sha256').update(b).digest('hex');
async function fixture(){
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'sentinel-heartbeat-'));
 const resources=path.join(root,'resources'); const sentinelDir=path.join(resources,'sentinel'); await fs.mkdir(sentinelDir,{recursive:true});
 const exe=path.join(root,'METAENGINE Browser Test.exe'); const sentinel=path.join(sentinelDir,'browser-sentinel.exe');
 await fs.writeFile(exe,'browser'); await fs.writeFile(sentinel,'sentinel');
 const provenance={schema:'metaengine.browser-sentinel.provenance.v1',executable_sha256:hash(Buffer.from('browser')),source_commit_sha:'b'.repeat(40),package_sha256:'c'.repeat(64),sentinel_sha256:hash(Buffer.from('sentinel'))};
 await fs.writeFile(path.join(sentinelDir,'provenance.json'),JSON.stringify(provenance));
 return {root,resources,exe,sentinel,provenance};
}

test('sanitized sentinel launch environment excludes secrets',()=>{
 const env=__sentinelTest.safeChildEnv({LOCALAPPDATA:'C:\\Users\\A\\AppData\\Local',PATH:'evil',TOKEN:'secret',SYSTEMROOT:'C:\\Windows'});
 assert.equal(env.TOKEN,undefined); assert.equal(env.PATH,undefined); assert.equal(env.LOCALAPPDATA,'C:\\Users\\A\\AppData\\Local');
});

test('packaged heartbeat launches exact companion with no args and no shell',async()=>{
 const f=await fixture(); const calls=[];
 const runtime=new BrowserSentinelHeartbeat({packaged:true,platform:'win32',resourcesPath:f.resources,execPath:f.exe,env:{LOCALAPPDATA:path.join(f.root,'local'),SYSTEMROOT:'C:\\Windows',TOKEN:'secret'},pathImpl:path,spawnImpl:(file,args,opts)=>{calls.push({file,args,opts});return {pid:77,unref(){}}},clock:()=>123456789,uuid:()=> 'abcd-1234'});
 const snap=await runtime.start(); assert.equal(snap.state,'ACTIVE'); assert.equal(calls.length,1); assert.equal(calls[0].file,f.sentinel); assert.deepEqual(calls[0].args,[]); assert.equal(calls[0].opts.shell,false); assert.equal(calls[0].opts.env.TOKEN,undefined); await runtime.stop({intent:'USER_EXIT'});
});

test('browser or companion digest mismatch fails closed before spawn',async()=>{
 const f=await fixture(); await fs.writeFile(f.exe,'tampered'); let spawned=false;
 const runtime=new BrowserSentinelHeartbeat({packaged:true,platform:'win32',resourcesPath:f.resources,execPath:f.exe,env:{LOCALAPPDATA:path.join(f.root,'local')},pathImpl:path,spawnImpl:()=>{spawned=true;return {unref(){}}}});
 const snap=await runtime.start(); assert.equal(snap.state,'ERROR'); assert.equal(spawned,false); assert.match(snap.last_error,/digest_mismatch/);
});

test('update states map only to bounded sentinel phases',()=>{
 assert.equal(__sentinelTest.mapUpdatePhase('READY_RESTART'),'DOWNLOADED_RESTART_PENDING'); assert.equal(__sentinelTest.mapUpdatePhase('RESTARTING'),'RESTARTING'); assert.equal(__sentinelTest.mapUpdatePhase('PAGE_SAYS_UPDATE'),'NONE');
});

test('unpackaged/non-Windows runtime has no sentinel authority',async()=>{
 const runtime=new BrowserSentinelHeartbeat({packaged:false,platform:'win32'}); assert.equal((await runtime.start()).state,'DISABLED');
});
