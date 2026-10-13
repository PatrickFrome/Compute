import test from 'node:test';
import assert from 'node:assert/strict';
import {receiptMarker,postedMessageObserved,postedUserTurnObserved} from '../src/send-receipt-core.mjs';

const id='roadmap-agent-W2-20261013-req01';
const prompt='Implement native PostgreSQL readback.\n\n[DevFleet request: '+id+']';
const basis={url:'https://chatgpt.com/c/6acd104a-c7b4-83ea-b38b-79ab23de408d',
  composer_observed:true,composer_value:'',transcript:'Chat\\nWork\\nUser task\\n[DevFleet request: '+id+']',
  request_id:id};
test('strict marker extraction from full multi-paragraph prompt',()=>{
 assert.equal(receiptMarker(prompt),id);
 assert.equal(receiptMarker('No marker'),null);
 assert.equal(receiptMarker('[DevFleet request: short]'),null);
});
test('successful POST evidence uses marker, cleared composer and exact ChatGPT conversation',()=>{
 assert.equal(postedMessageObserved(basis),true);
 // Full prompt need not be one contiguous AX string: split paragraphs.
 assert.equal(basis.transcript.includes(prompt),false);
});
test('draft alone cannot prove Send even if AX text includes marker',()=>{
 assert.equal(postedMessageObserved({...basis,url:'https://chatgpt.com/',composer_value:prompt}),false);
 assert.equal(postedMessageObserved({...basis,composer_value:prompt}),false);
 assert.equal(postedMessageObserved({...basis,composer_observed:false}),false);
 assert.equal(postedMessageObserved({...basis,transcript:'No posted marker'}),false);
});
test('fail closed on hostile/invalid origin, wrong conversation and wrong marker',()=>{
 for(const url of ['http://chatgpt.com/c/test','https://example.com/c/test',
   'https://chatgpt.com/','https://chatgpt.com/share/abc','not-a-url']){
   assert.equal(postedMessageObserved({...basis,url}),false);
 }
 assert.equal(postedMessageObserved({...basis,request_id:'other-agent-20261013'}),false);
});

test('user-turn only reconciliation rejects assistant echo, draft and attribute injection',()=>{
 const evidence={url:basis.url,request_id:id,
   composer_observed:true,composer_value:'',
   user_turn_html:[
     '<div class="group" data-message-author-role="user"><p>Implement native PostgreSQL readback.<\/p><p>[DevFleet request: '+id+']<\/p><\/div>'
   ]};
 assert.equal(postedUserTurnObserved(evidence),true);
 assert.equal(postedUserTurnObserved({...evidence,
   user_turn_html:['<div data-message-author-role="assistant"><p>[DevFleet request: '+id+']<\/p><\/div>']}),false);
 assert.equal(postedUserTurnObserved({...evidence,
   user_turn_html:['<div data-message-author-role="user" title="[DevFleet request: '+id+']"><p>No receipt<\/p><\/div>']}),false);
 assert.equal(postedUserTurnObserved({...evidence,composer_value:prompt}),false);
 assert.equal(postedUserTurnObserved({...evidence,composer_observed:false}),false);
 assert.equal(postedUserTurnObserved({...evidence,user_turn_html:[]}),false);
 assert.equal(postedUserTurnObserved({...evidence,
   user_turn_html:[...evidence.user_turn_html,...evidence.user_turn_html]}),false);
 assert.equal(postedUserTurnObserved({...evidence,url:'https://chatgpt.com/'}),false);
 assert.equal(postedUserTurnObserved({...evidence,url:'https://chatgpt.com/c/valid?untrusted=1'}),false);
 assert.equal(postedUserTurnObserved({...evidence,user_turn_html:[
   '<div data-message-author-role="user"><p>Reply includes '+id+' but not a receipt<\/p><\/div>'
 ]}),false);
});
test('user-turn markup accommodates split marker paragraphs but not spoofed role',()=>{
 const base={url:basis.url,request_id:id,composer_observed:true,composer_value:''};
 assert.equal(postedUserTurnObserved({...base,user_turn_html:[
   '<article data-message-author-role="user"><p>[DevFleet request: </p><span>'+id+'</span><p>]</p></article>'
 ]}),true);
 assert.equal(postedUserTurnObserved({...base,user_turn_html:[
   '<article data-message-author-role="tool"><div data-message-author-role="user">[DevFleet request: '+id+']</div></article>'
 ]}),false);
});
