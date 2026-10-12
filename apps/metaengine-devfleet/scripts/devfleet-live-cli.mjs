#!/usr/bin/env node
// A separate developer capability; the Chat Fleet token cannot stage/activate.
import fs from 'node:fs/promises';
import path from 'node:path';

const [verb,...args]=process.argv.slice(2);
if (!['status','stage','activate','rollback','reconcile'].includes(verb)||args.length) {
  throw Error('usage: devfleet-live-cli.mjs status|stage|activate|rollback|reconcile');
}
if (!process.env.APPDATA) throw Error('profile_appdata_unavailable');
const file=path.join(process.env.APPDATA,'METAENGINE DevFleet','developer-rpc.json');
const manifest=JSON.parse(await fs.readFile(file,'utf8'));
const url=new URL(String(manifest.url));
if (manifest.schema!=='metaengine.devfleet.developer-rpc.v1'
  || manifest.app!=='METAENGINE DevFleet'
  || url.protocol!=='http:' || url.hostname!=='127.0.0.1'
  || url.pathname!=='/rpc' || url.search || url.hash || url.username || url.password
  || !Number.isSafeInteger(manifest.pid) || manifest.pid<=0
  || manifest.workspace_pinned!==true
  || typeof manifest.token!=='string'||!/^[0-9a-f]{64}$/i.test(manifest.token)) {
  throw Error('untrusted_developer_manifest');
}
const response=await fetch(url,{
  method:'POST',redirect:'error',signal:AbortSignal.timeout(25000),
  headers:{Authorization:'Bearer '+manifest.token,'Content-Type':'application/json'},
  body:JSON.stringify({method:'dev.'+verb,params:{}}),
});
const result=await response.json();
if (!response.ok||result.ok!==true){
  console.error(JSON.stringify({ok:false,status:response.status,
    code:result.error||'DEV_OPERATION_REFUSED',automatic_retry_allowed:false}));
  process.exitCode=1;
} else {
  console.log(JSON.stringify({ok:true,result:result.result},null,2));
}
