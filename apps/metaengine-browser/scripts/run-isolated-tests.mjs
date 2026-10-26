#!/usr/bin/env node
// Unit tests import startup modules. Always give the entire process tree a
// disposable OS profile so imports cannot attach to the installed Owner.
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

const env={...process.env};
const electronMode=env.METAENGINE_TEST_ELECTRON_MODE;
if(electronMode!==undefined&&!['MAIN_PROCESS','ASAR_NODE'].includes(electronMode))throw Error('isolated_test_electron_mode_invalid');
const root=await fs.mkdtemp(path.join(os.tmpdir(),'metaengine-node-tests-'));
for(const key of Object.keys(env)) {
  if(key.startsWith('METAENGINE_')&&key!=='METAENGINE_TEST_ELECTRON_MODE'&&!/^METAENGINE_(?:PG_TEST_|PGLITE_)/.test(key))delete env[key];
}
for(const [key,folder] of Object.entries({APPDATA:'roaming',LOCALAPPDATA:'local',USERPROFILE:'home',HOME:'home',
  XDG_CONFIG_HOME:'config',XDG_CACHE_HOME:'cache',XDG_DATA_HOME:'data',XDG_STATE_HOME:'state',TEMP:'tmp',TMP:'tmp'})) {
  env[key]=path.join(root,folder);await fs.mkdir(env[key],{recursive:true});
}
const args=process.argv.slice(2);
const child=spawn(process.execPath,['--test',...(args.length?args:['test/*.test.mjs'])],{
  env,stdio:'inherit',windowsHide:true,shell:false,
});
try {
  process.exitCode=await new Promise((resolve,reject)=>{
    child.once('error',reject);child.once('exit',(code)=>resolve(code??1));
  });
} finally {
  // Test failures may retain owned processes/evidence. Keep their profile for
  // diagnosis; never erase a possibly running PostgreSQL test cluster.
  if(process.exitCode===0)await fs.rm(root,{recursive:true,force:true});
  else process.stderr.write('Isolated test profile retained: '+root+'\n');
}
