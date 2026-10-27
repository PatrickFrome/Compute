import test from 'node:test';
import assert from 'node:assert/strict';
import {OpenAILessonTransport,parseSelectedKey,validModel,RESPONSES_ENDPOINT,LIVE_RESPONSE_SCHEMA} from '../src/education-live-openai.mjs';
const FAKE='sk-'+('unit_test_non_credential_').repeat(2);
const good={reply:'Объяснение',change_summary:'Новый пример',edits:[{field:'example',text:'Другая задача'}]};
const wrap=answer=>({status:'completed',output:[{type:'message',role:'assistant',content:[{type:'output_text',text:JSON.stringify(answer)}]}]});
const input={context:{material_id:'material-03-01',notes:[]},text:'Обнови пример',allow_edits:true};
function setup(fetchImpl,config={key:FAKE,model:'test-model',accept_billing:true}){return new OpenAILessonTransport({credentials:()=>config,fetchImpl});}

test('Calls only official Responses endpoint with strict schema, bounded output and no remote state',async()=>{
 let called=0;const t=setup(async(url,req)=>{
  called++;assert.equal(url,RESPONSES_ENDPOINT);assert.equal(req.method,'POST');assert.equal(req.redirect,'error');
  assert.equal(req.headers.Authorization,'Bearer '+FAKE);const body=JSON.parse(req.body);
  assert.equal(body.store,false);assert.equal(body.max_output_tokens,6000);
  assert.equal(body.text.format.strict,true);assert.deepEqual(body.text.format.schema,LIVE_RESPONSE_SCHEMA);
  assert.ok(!body.tools&&!body.previous_response_id);assert.ok(!req.body.includes(FAKE));
  assert.equal(JSON.parse(body.input[0].content).context.material_id,'material-03-01');
  return new Response(JSON.stringify(wrap(good)),{status:200});
 });
 assert.equal(t.status().connection_verified,false);assert.deepEqual(await t.complete(input),good);
 assert.equal(called,1);assert.equal(t.status().connection_verified,true);assert.ok(!JSON.stringify(t.status()).includes(FAKE));
});
test('Changing credentials/model clears verified indication without revealing a key',async()=>{
 const config={key:FAKE,model:'model-a',accept_billing:true};
 const t=setup(async()=>new Response(JSON.stringify(wrap(good))),config);await t.complete(input);
 config.model='model-b';assert.equal(t.status().connection_verified,false);config.key='';assert.equal(t.status().ready,false);
});
test('Missing key, model, or explicit billing consent causes zero network activity',async()=>{
 for(const config of [{},{key:FAKE,model:'x',accept_billing:false},{key:FAKE,accept_billing:true}]){
  let n=0;const t=setup(async()=>{n++;throw Error('not_expected');},config);
  await assert.rejects(t.complete(input),/live_not_connected/);assert.equal(n,0);
 }
});
test('Refusals, incomplete output and malformed content never produce usable edits',async()=>{
 const examples=[
  [{status:'incomplete',output:[]},'live_api_incomplete'],
  [{status:'completed',output:[{type:'message',content:[{type:'refusal',refusal:'no'}]}]},'live_api_refused'],
  [wrap({...good,edits:[{field:'apiKey',text:'x'}]}),'live_answer_invalid'],
  [wrap({...good,edits:[{field:'example',text:'x'.repeat(8001)}]}),'live_answer_invalid']
 ];
 for(const [payload,code] of examples){let n=0;
  const t=setup(async()=>{n++;return new Response(JSON.stringify(payload));});
  await assert.rejects(t.complete(input),e=>e.message===code);assert.equal(n,1);assert.equal(t.status().connection_verified,false);
 }
});
test('HTTP errors do not leak bodies, credentials or sensitive exception strings and never retry',async()=>{
 for(const [status,code] of [[401,'live_api_auth_failed'],[429,'live_api_rate_or_quota'],[503,'live_remote_outcome_unknown'],[400,'live_api_rejected']]){
  let n=0;const t=setup(async()=>{n++;return new Response(FAKE,{status});});
  await assert.rejects(t.complete(input),e=>e.message===code&&!e.message.includes(FAKE));assert.equal(n,1);
 }
 let n=0;const t=setup(async()=>{n++;throw Error('private '+FAKE);});
 await assert.rejects(t.complete(input),e=>e.message==='live_remote_outcome_unknown');assert.equal(n,1);
});
test('Response and input size bounds reject oversized data',async()=>{
 let n=0;const t=setup(async()=>{n++;return new Response('x'.repeat(524289));});
 await assert.rejects(t.complete(input),/live_api_response_too_large/);assert.equal(n,1);
 await assert.rejects(t.complete({...input,context:{text:'x'.repeat(66000)}}),/live_context_too_large/);assert.equal(n,1);
});
test('Secure import parser accepts only bounded key values, never arbitrary file content',()=>{
 for(const x of [FAKE,'OPENAI_API_KEY="'+FAKE+'"',JSON.stringify({api_key:FAKE})])assert.equal(parseSelectedKey(x),FAKE);
 for(const x of ['not a key','sk-short','x'.repeat(17000),'{"api_key":123}',FAKE+'\nOTHER=bad'])
  assert.throws(()=>parseSelectedKey(x),/live_key_file_invalid/);
 assert.equal(validModel('model-name-2026'),true);assert.equal(validModel('https://other.example'),false);
});
