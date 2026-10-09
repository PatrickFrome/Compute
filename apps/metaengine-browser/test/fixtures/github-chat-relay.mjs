import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GithubChatRelayJournal } from '../../src/github-chat-relay-journal.mjs';
import { GithubChatRelay,GITHUB_CHAT_REQUEST_MARKER } from '../../src/github-chat-relay.mjs';
import { createChatCommandRoutes } from '../../supabase/a2-browser-native-supervisor-v1/chat-command-routes.mjs';

export const pairing=Object.freeze({schema:'metaengine.github-chat-pairing.v1',
  relay_id:'be421a54-a43b-43ed-a930-4e4e79af7dd0',client_id:'client_test_fixture',
  repository:'fixture/private-control',repository_id:12345,issue_number:7,
  operator_user_ids:[18],publisher_user_id:19,after_comment_id:100,
  permissions:['OBSERVE','CONTROL','GOALS'],expires_at:'2099-01-01T00:00:00Z',owner_action:'ENABLE_GITHUB_CHAT_CONTROL'});
export const commandId='06da9a8b-6356-478c-a467-3d6c0ad53e54';
export function request(method='STATUS',params={},overrides={}){
  return {id:101,user:{id:18,type:'User'},created_at:'2026-10-08T00:00:00Z',updated_at:'2026-10-08T00:00:00Z',
    issue_url:'https://api.github.com/repos/fixture/private-control/issues/7',body:GITHUB_CHAT_REQUEST_MARKER+'\n'+JSON.stringify({
      schema:'metaengine.github-chat-request.v1',relay_id:pairing.relay_id,client_id:pairing.client_id,method,params}),...overrides};
}
export const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return{promise,resolve};};

export async function harness(t,options={}){
  const directory=options.directory||await fs.mkdtemp(path.join(os.tmpdir(),'github-chat-fixture-'));
  if(!options.directory)t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const journal=await new GithubChatRelayJournal(path.join(directory,'journal')).initialize();
  const state={comments:options.comments||[],calls:[],admissions:[],reads:0,uploads:[],private:true,
    current:true,publisherId:19,clock:Date.parse('2026-10-08T00:00:00Z'),...options.state};
  const route=createChatCommandRoutes({local:true,json:(status,body)=>({status,body}),lookup:async()=>null,
    rpc:async(name,args)=>{state.admissions.push({name,args});return{accepted:true,command_id:commandId,status:'PENDING'};}});
  const control={
    status:async()=>{state.reads++;return{private_window_title:'owner fixture',authority_effect:false};},
    capabilities:async()=>({actions:['COMPUTER_ACTION'],authority_effect:false}),
    commandSubmit:async body=>{
      const response=await route({req:{method:'POST'},path:'/v1/commands/issue-chat',body,
        identity:{ok:true,id:pairing.client_id,admin_ready:true,admin_scopes:['CONTROL_PLANE']}});
      if(response.status!==200)throw new Error('local_admission_unconfirmed');return response.body;
    },
    commandLookup:async()=>({found:true,command_id:commandId,status:'PENDING',authority_effect:false}),
    commandReceipt:async()=>({found:true,terminal:false,command_id:commandId,authority_effect:false}),
    goalSubmit:async value=>{state.admissions.push({goal:value});return{state:'ADMITTED',request_id:value.request_id,authority_effect:false};},
    goalProgress:async()=>({state:'ADMITTED',authority_effect:false}),goalProof:async()=>({state:'UNPROVEN',authority_effect:false}),
    ...options.control,
  };
  const fetchImpl=async(url,init)=>{
    state.calls.push({url,init});
    if(options.fetchHook){const result=await options.fetchHook(url,init,state);if(result)return result;}
    if(url==='https://api.github.com/user')return Response.json({id:state.publisherId});
    if(url==='https://api.github.com/repos/fixture/private-control')return Response.json({
      id:12345,full_name:'fixture/private-control',private:state.private,default_branch:'main'});
    if(url.endsWith('/issues/7'))return Response.json({number:7,state:'open'});
    if(url.includes('/comments?'))return Response.json(state.comments);
    if(url.includes('/contents/')&&init.method==='PUT'){
      const body=JSON.parse(init.body),bytes=Buffer.from(body.content,'base64');state.uploads.push(body);
      return Response.json({content:{sha:createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')}});
    }
    if(url.endsWith('/comments')&&init.method==='POST'){
      const reply={id:1000+state.comments.length,user:{id:state.publisherId,type:'User'},body:JSON.parse(init.body).body};
      state.comments.push(reply);return Response.json(reply);
    }
    throw new Error('unexpected_fixture_request');
  };
  const relay=new GithubChatRelay({pairing:{...pairing,...options.pairing},control,journal,
    getToken:async()=> 'fixture-test-token-with-no-privileges',isPairingCurrent:async()=>state.current,
    fetchImpl,now:()=>state.clock,...(options.readCapture?{readCapture:options.readCapture}: {})});
  t.after(()=>relay.stop());
  return {relay,state,journal,directory,control};
}
