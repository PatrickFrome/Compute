import test from 'node:test';
import assert from 'node:assert/strict';
import {classifyConversationSurface,classifyPostSendNavigation} from '../src/conversation-readiness-core.mjs';
const url='https://chatgpt.com/c/6acf5341-007c-83ea-bd09-2ee4ef185153';
test('conversation URL alone never proves body mounted',()=>{
 assert.equal(classifyConversationSurface({url}).state,'UNKNOWN');
 assert.equal(classifyConversationSurface({url,composer_count:1}).state,'CONTROL_VISIBLE');
 assert.equal(classifyConversationSurface({url,turn_count:3}).state,'TURNS_VISIBLE');
 assert.equal(classifyConversationSurface({url,generation_active:true}).state,'CONTROL_VISIBLE');
});
test('conflicting editor and foreign origins never promote readiness',()=>{
 assert.equal(classifyConversationSurface({url,composer_count:2}).state,'UNKNOWN');
 for(const u of ['https://evil.example/c/fake','https://chatgpt.com/','https://chatgpt.com/c/test?utm=1','about:blank'])
  assert.equal(classifyConversationSurface({url:u,composer_count:1}).state,'UNKNOWN');
});
test('one Send can traverse same-origin route without replay',()=>{
 assert.equal(classifyPostSendNavigation('https://chatgpt.com/'),'SAME_ORIGIN_TRANSITION');
 assert.equal(classifyPostSendNavigation('https://chatgpt.com/?model=auto'),'SAME_ORIGIN_TRANSITION');
 assert.equal(classifyPostSendNavigation(url),'CONVERSATION');
 for(const u of ['https://evil.example','file:///x','about:blank','javascript:x'])
  assert.equal(classifyPostSendNavigation(u),'UNTRUSTED');
});
