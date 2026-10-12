import test from 'node:test';
import assert from 'node:assert/strict';
import {summarizeModeNodes, inferModeFromAttributes, classifyPageFailure, retryWaitMs} from '../src/chat-fleet-preflight.mjs';
const node=(name,selected)=>({name:{value:name},role:{value:'tab'},backendDOMNodeId:1,properties:[{name:'selected',value:{value:selected}}]});
test('Chat selected, Work deselected => only CHAT',()=>{
 assert.equal(summarizeModeNodes([node('Чат',true),node('Работа',false)]).state,'CHAT');
 assert.equal(summarizeModeNodes([node('Chat',true),node('Work',false)]).state,'CHAT');
});
test('Work selected blocks send; ambiguous and duplicated controls fail closed',()=>{
 assert.equal(summarizeModeNodes([node('Чат',false),node('Работа',true)]).state,'WORK');
 assert.equal(summarizeModeNodes([node('Чат',false),node('Работа',false)]).state,'UNKNOWN');
 assert.equal(summarizeModeNodes([node('Чат',true),node('Чат',true),node('Работа',false)]).state,'UNKNOWN');
 assert.equal(summarizeModeNodes([node('Чат',true)]).state,'UNKNOWN');
});
test('DOM selection proof cannot infer Chat from menu visibility',()=>{
 assert.equal(inferModeFromAttributes({},{}) ,'UNKNOWN');
 assert.equal(inferModeFromAttributes({'aria-selected':'true'},{'aria-selected':'false'}),'CHAT');
 assert.equal(inferModeFromAttributes({'aria-selected':'false'},{'aria-selected':'true'}),'WORK');
});
test('errors warrant bounded reload, not repeated Send',()=>{
 assert.equal(classifyPageFailure('Не удалось загрузить вашу учетную запись'),'ACCOUNT');
 assert.equal(classifyPageFailure('Не удалось проверить режим блокировки'),'LOCKDOWN');
 assert.equal(classifyPageFailure('С чего начнем?'),'null'.replace('null','')||null);
 assert.ok(retryWaitMs(5)<=30000);
});
