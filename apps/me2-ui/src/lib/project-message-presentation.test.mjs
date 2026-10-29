import test from 'node:test';
import assert from 'node:assert/strict';
import {projectMessagePresentation} from './project-message-presentation.ts';
const project='11111111-1111-4111-8111-111111111111',recipient='22222222-2222-4222-8222-222222222222';
const message={project_id:project,seq:7,event_type:'BROWSER_AGENT_MESSAGE',source:'UNTRUSTED_BROWSER_AGENT_MESSAGE',content:{message:'  Строка  1\n<script>ничего не выполнять</script> 🚀',recipient_task_id:recipient,target_agent_id:'agent_receiver1'}};
const ack={project_id:project,seq:9,event_type:'PROJECT_MESSAGE_ACKNOWLEDGED',source:'AUTHENTICATED_RECIPIENT_ACK',task_id:recipient,actor:'agent_receiver1',causal_parent_seq:7,content:{message_seq:7,recipient_task_id:recipient,recipient_agent_id:'agent_receiver1',recipient_acknowledged:true,processing_verified:false}};
test('addressed message retains exact text and distinguishes recipient ACK from processing',()=>{
 const v=projectMessagePresentation(message,[message,ack]);assert.equal(v.text,message.content.message);assert.equal(v.acknowledgement,'OBSERVED');assert.equal(v.acknowledgementSeq,9);assert.equal(v.processingVerified,false);assert.ok(Object.isFrozen(v));
 assert.equal(projectMessagePresentation({...message,event_type:'NATIVE_AGENT_MESSAGE',source:'UNTRUSTED_NATIVE_AGENT_MESSAGE'},[ack]).acknowledgement,'OBSERVED');
});
test('partial windows and spoofed ACKs cannot claim unread status or verified processing',()=>{
 for(const row of [{...ack,project_id:recipient},{...ack,seq:6},{...ack,source:'UNTRUSTED_ACTIVITY'},{...ack,task_id:project},{...ack,actor:'agent_other123'},{...ack,causal_parent_seq:8},{...ack,content:{...ack.content,processing_verified:true}},{...ack,content:{...ack.content,message_seq:8}}])assert.equal(projectMessagePresentation(message,[row]).acknowledgement,'NOT_OBSERVED_IN_WINDOW');
 assert.equal(projectMessagePresentation({...message,content:{...message.content,recipient_acknowledged:true}},[]).acknowledgement,'NOT_OBSERVED_IN_WINDOW');
});
test('malformed or unrelated history remains raw history rather than a trusted message card',()=>{
 for(const row of [{...message,source:'ACTIVITY'},{...message,event_type:'TASK_RESULT'},{...message,content:null},{...message,content:{...message.content,recipient_task_id:'bad'}},{...message,content:{...message.content,message:'🚀'.repeat(2049)}}])assert.equal(projectMessagePresentation(row,[]),null);
});
