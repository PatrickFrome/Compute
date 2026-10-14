import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeNativePageMount as proof} from '../src/native-page-mount-proof.mjs';
const url='https://chatgpt.com/c/6acf5341-007c-83ea-bd09-2ee4ef185153';
const counts={main:1,role_main:0,user_turn:0,assistant_turn:0,composer:0,article:0,loading:0};
const input={url,stable:true,is_loading:false,counts};
test('URL plus sidebar/main alone never proves live conversation',()=>{
 for(const x of [counts,{...counts,main:0}]){
   const r=proof({...input,counts:x});
   assert.equal(r.state,'UNKNOWN');assert.equal(r.body_mounted,false);
   assert.equal(r.send_authorized,false);
 }
});
test('one composer or user-turn yields only read-only evidence',()=>{
 for(const c of [{...counts,composer:1},{...counts,user_turn:2}]){
   const r=proof({...input,counts:c});
   assert.equal(r.body_mounted,true);assert.equal(r.completion_proven,false);
   assert.equal(r.effect_authority,false);assert.equal(r.send_authorized,false);
 }
});
test('stale, loading, duplicate composer, forged origin and malformed count fail closed',()=>{
 const cases=[
  {...input,is_loading:true,counts:{...counts,user_turn:2}},
  {...input,stable:false,counts:{...counts,composer:1}},
  {...input,counts:{...counts,composer:2}},
  {...input,url:'https://evil.example/c/test',counts:{...counts,composer:1}},
  {...input,url:'https://chatgpt.com/',counts:{...counts,composer:1}},
  {...input,counts:{...counts,main:-1}},
  {...input,counts:{...counts,main:99999}}
 ];
 for(const i of cases)assert.equal(proof(i).body_mounted,false);
});
test('result carries no untrusted text, secret or effect authority',()=>{
 const r=proof({...input,html:'PRIVATE CHAT TEXT',token:'secret'});
 assert.equal(JSON.stringify(r).includes('PRIVATE'),false);
 assert.equal(JSON.stringify(r).includes('secret'),false);
 assert.equal(r.effect_authority,false);
});
