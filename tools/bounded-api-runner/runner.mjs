import https from 'node:https';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash, randomUUID} from 'node:crypto';
import {StringDecoder} from 'node:string_decoder';
const ROOT=path.dirname(fileURLToPath(import.meta.url));
export const STATE=path.join(ROOT,'run-state.json');
export const LIMIT=32*1024*1024;
const fail=code=>{throw new Error(code)};
const safe=s=>typeof s==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(s)?s:null;
export const cost=(i,o)=>i*25+o*100; // integer micro-USD, 30m cache-write worst case; discounts deliberately ignored
export function bounds(bytes,max=32000){
 if(!Number.isInteger(bytes)||bytes<1||bytes>200000)fail('prompt_size');
 if(!Number.isInteger(max)||max<1||max>128000)fail('output_tokens');
 return {input_bound:bytes+4096,max_output_tokens:max,worst_micro:cost(bytes+4096,max)};
}
async function atomic(file,obj){const tmp=file+'.'+randomUUID()+'.tmp';const h=await fs.open(tmp,'wx',0o600);try{await h.writeFile(JSON.stringify(obj,null,2)+'\n');await h.sync();}finally{await h.close();}await fs.rename(tmp,file);}
export async function locked(file,fn){
 const lock=file+'.lock';const start=Date.now();
 for(;;){try{await fs.mkdir(lock,{mode:0o700});break;}catch(e){if(e.code!=='EEXIST')throw e;if(Date.now()-start>30000)fail('state_lock_busy');await new Promise(r=>setTimeout(r,20));}}
 try{return await fn();}finally{await fs.rmdir(lock);}
}
export async function init(file=STATE,metadata={}){
 if(!Number.isSafeInteger(metadata.new_work_cap_micro)||metadata.new_work_cap_micro<=0)fail('explicit_positive_cap_required');
 return locked(file,async()=>{
 try{await fs.access(file);fail('state_exists');}catch(e){if(e.code!=='ENOENT')throw e;}
 const s={version:1,history:'OLD_ACCOUNTING_UNAVAILABLE_NOT_RESTORED',...metadata,new_work_cap_micro:metadata.new_work_cap_micro,cap_is_not_account_balance:true,tasks:{}};await atomic(file,s);return s;
});}
export async function admit(key,b,file=STATE){if(!safe(key)||['__proto__','constructor','prototype'].includes(key))fail('invalid_task_key');return locked(file,async()=>{
 const s=JSON.parse(await fs.readFile(file,'utf8'));
 if(s.version!==1||(!Number.isSafeInteger(s.new_work_cap_micro)||s.new_work_cap_micro<=0))fail('state_policy_mismatch');
 if(Object.hasOwn(s.tasks,key))return {skip:'duplicate_logical_key'};
 const tasks=Object.values(s.tasks),used=tasks.reduce((a,t)=>a+t.exposure_micro,0);
 if(tasks.filter(t=>t.status==='in_flight').length>=20)return {skip:'concurrency_ceiling'};
 if(used+b.worst_micro>s.new_work_cap_micro)return {skip:'new_work_cap'};
 s.tasks[key]={status:'in_flight',...b,exposure_micro:b.worst_micro,started_at:new Date().toISOString()};await atomic(file,s);return {admitted:true};
});}
export async function settle(key,result,file=STATE){return locked(file,async()=>{
 const s=JSON.parse(await fs.readFile(file,'utf8')),t=s.tasks[key];if(!t||t.status!=='in_flight')fail('invalid_settlement');
 const u=result.usage;const valid=result.status==='completed'&&u&&Number.isInteger(u.input_tokens)&&u.input_tokens>=0&&u.input_tokens<=t.input_bound&&Number.isInteger(u.output_tokens)&&u.output_tokens>=0&&u.output_tokens<=t.max_output_tokens&&result.model?.startsWith('gpt-6-astra')&&['priority','fast','default'].includes(result.service_tier);
 Object.assign(t,{status:valid?'completed':'unknown',finished_at:new Date().toISOString(),receipt:result});
 if(valid)t.exposure_micro=cost(u.input_tokens,u.output_tokens);
 await atomic(file,s);return t;
});}
export class SSE {
 constructor(onEvent){this.decoder=new StringDecoder('utf8');this.buffer='';this.onEvent=onEvent;this.bytes=0;}
 push(chunk){this.bytes+=chunk.length;if(this.bytes>LIMIT)fail('output_limit');this.buffer+=this.decoder.write(chunk);this.drain();}
 drain(){let m;while((m=/\r?\n\r?\n/.exec(this.buffer))){const event=this.buffer.slice(0,m.index);this.buffer=this.buffer.slice(m.index+m[0].length);const data=event.split(/\r?\n/).filter(l=>l.startsWith('data:')).map(l=>l.slice(5).replace(/^ /,'')).join('\n');if(data&&data!=='[DONE]')this.onEvent(JSON.parse(data));}}
 end(){this.buffer+=this.decoder.end();this.drain();if(this.buffer.trim())fail('truncated_sse');}
}
function extract(r){return (r.output||[]).filter(x=>x.type==='message'&&x.role==='assistant'&&(!x.phase||x.phase==='final_answer')).flatMap(x=>x.content||[]).filter(x=>x.type==='output_text').map(x=>x.text).join('\n');}
export function streamRequest(body,key,{request=https.request,deadline=1800000,onCreated=()=>{}}={}){
 return new Promise(resolve=>{
 let req,res,done=false,terminal=null,terminalCount=0,meta={status:'unknown',reason:'missing_terminal'},timer;
 const finish=(reason)=>{if(done)return;done=true;clearTimeout(timer);resolve({...meta,...(reason?{status:'unknown',reason}:{}),text:terminal&&meta.status==='completed'?extract(terminal):''});res?.destroy();req?.destroy();};
 const parser=new SSE(e=>{
  if(e.type==='response.created'){meta.response_id=safe(e.response?.id);onCreated(meta.response_id);}
  if(['response.completed','response.failed','response.incomplete'].includes(e.type)){
   terminalCount++;if(terminalCount>1){finish('duplicate_terminal');return;}
   terminal=e.response;meta={...meta,status:e.type==='response.completed'&&terminal?.status==='completed'&&extract(terminal).length>0?'completed':'unknown',reason:e.type,model:safe(terminal?.model),service_tier:safe(terminal?.service_tier),response_id:safe(terminal?.id),usage:terminal?.usage?{input_tokens:terminal.usage.input_tokens,output_tokens:terminal.usage.output_tokens}:null};
  }else if(e.type==='error')finish('stream_error');
 });
 timer=setTimeout(()=>finish('absolute_deadline'),Math.min(deadline,1800000));
 try{
  req=request({protocol:'https:',hostname:'api.openai.com',port:443,path:'/v1/responses',method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json','Content-Length':Buffer.byteLength(body)},agent:request===https.request?new https.Agent({proxyEnv:process.env}):false},response=>{
   res=response;meta.http_status=res.statusCode;meta.request_id=safe(res.headers['x-request-id']);
   if(res.statusCode!==200){finish('http_rejected_or_unknown');return;}
   res.on('data',chunk=>{if(done)return;try{parser.push(chunk);}catch{finish('invalid_or_oversized_stream');}});
   res.on('end',()=>{if(done)return;try{parser.end();}catch{finish('truncated_stream');return;}if(terminalCount===1)finish();else finish('missing_terminal');});
   res.on('error',()=>finish('response_transport_error'));
   res.on('aborted',()=>finish('response_aborted'));
  });
  req.on('error',()=>finish('request_transport_error'));req.end(body);
 }catch{finish('request_setup_error');}
 });
}
export async function run(key,promptFile,max=32000,dryRun=false){
 if(!safe(key)||['__proto__','constructor','prototype'].includes(key))fail('invalid_task_key');
 // Caller provides only pre-reviewed authorized source snippets, tests and deidentified logs.
 if(/(^|\/)\.env(?:\.|$)/.test(promptFile))fail('forbidden_prompt_path');
 const h=await fs.open(promptFile,'r');let raw;try{const st=await h.stat();bounds(st.size,max);raw=Buffer.alloc(st.size+1);let total=0;while(total<raw.length){const {bytesRead}=await h.read(raw,total,raw.length-total,total);if(!bytesRead)break;total+=bytesRead;}const end=await h.stat();if(total!==st.size||end.size!==st.size||end.mtimeMs!==st.mtimeMs)fail('prompt_changed');raw=raw.subarray(0,total);}finally{await h.close();}
 const b=bounds(raw.length,max);const prompt=new TextDecoder('utf-8',{fatal:true}).decode(raw);
 if(dryRun)return {validated:true,task_key:key,...b,requested_model:'gpt-6-astra',requested_service_tier:'fast',reasoning_effort:'max',paid_request_made:false};
 const apiKey=process.env.OPENAI_API_KEY;if(!apiKey||/[\r\n]/.test(apiKey))fail('missing_or_invalid_key');
 const admitted=await admit(key,b);if(!admitted.admitted)return admitted;
 console.log(JSON.stringify({task_key:key,status:'admitted',...b}));
 const body=JSON.stringify({tools:[],instructions:'Analyze the supplied authorized project task. Return proposed code changes as JSON patches and test guidance only. Do not execute tools or apply changes.',model:'gpt-6-astra',reasoning:{effort:'max',mode:'standard'},prompt_cache_options:{ttl:'30m'},service_tier:'fast',input:prompt,max_output_tokens:max,stream:true,store:false});
 const result=await streamRequest(body,apiKey,{onCreated:id=>console.log(JSON.stringify({task_key:key,status:'response_created',response_id:id}))});const text=result.text;delete result.text;
 result.prompt_sha256=createHash('sha256').update(raw).digest('hex');
 const task=await settle(key,result);
 const dir=path.join(ROOT,'outputs');await fs.mkdir(dir,{recursive:true,mode:0o700});
 await fs.writeFile(path.join(dir,key+'.txt'),text,{flag:'wx',mode:0o600});
 await atomic(path.join(dir,key+'.receipt.json'),{task_key:key,...result,accounting_status:task.status});
 return {task_key:key,status:task.status,output:path.join(dir,key+'.txt'),receipt:path.join(dir,key+'.receipt.json')};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{const [cmd,...args]=process.argv.slice(2);let r;if(cmd==='init')r={initialized:!!(await init(STATE,JSON.parse(await fs.readFile(path.join(ROOT,'private-init.json'),'utf8'))))};else if(['run','--validate','dry-run'].includes(cmd)&&args.length>=2)r=await run(args[0],args[1],args[2]===undefined?32000:Number(args[2]),cmd!=='run');else fail('usage_init_or_run_key_prompt_optional_max');console.log(JSON.stringify(r));}
 catch{console.error(JSON.stringify({status:'blocked',reason:'local_validation_or_state_failure_no_retry',hint:'Check CLI arguments, state and filesystem; raw errors suppressed.'}));process.exitCode=1;}
}
