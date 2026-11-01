import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

// This entry runs disposable fixtures only. Requiring inputs before launching
// Node's tests prevents an absent PG17 environment from becoming a green SKIP.
try{
 const bin=process.env.METAENGINE_PG_TEST_BIN,driver=process.env.METAENGINE_PG_TEST_DRIVER;
 if(!path.isAbsolute(bin||'')||!path.isAbsolute(driver||''))throw Error('physical_pg17_explicit_inputs_required');
 for(const name of ['initdb','pg_ctl','postgres'])if(!(await fs.stat(path.join(bin,name+(process.platform==='win32'?'.exe':'')))).isFile())throw Error('physical_pg17_binary_missing');
 if(!(await fs.stat(driver)).isFile())throw Error('physical_pg17_driver_missing');
 const files=['native-coding-physical-custody.pg17.test.mjs','native-coding-physical-restart.pg17.test.mjs','native-coding-setup.pg17.test.mjs']
  .map(file=>fileURLToPath(new URL('../'+file,import.meta.url)));
 const output=await new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--test','--test-isolation=process','--test-concurrency=1','--test-reporter=tap',...files],
   {stdio:['ignore','pipe','inherit'],shell:false,windowsHide:true});
  const chunks=[];child.stdout.on('data',chunk=>{chunks.push(chunk);process.stdout.write(chunk);});
  child.once('error',()=>reject(Error('physical_pg17_test_launch_failed')));
  child.once('close',code=>code===0?resolve(Buffer.concat(chunks).toString('utf8')):reject(Error('physical_pg17_tests_failed')));
 });
 if(!/^# skipped 0\s*$/m.test(output)||/^\s*(?:not )?ok \d+ - .*# (?:SKIP|TODO)\b/m.test(output)
  ||!/^# fail 0\s*$/m.test(output)||!/^# cancelled 0\s*$/m.test(output)||!/^# todo 0\s*$/m.test(output))throw Error('physical_pg17_required_case_not_executed');
}catch(error){
 const code=/^physical_pg17_[a-z_]+$/.test(error?.message||'')?error.message:'physical_pg17_input_or_execution_failed';
 console.error(code);process.exitCode=1;
}
