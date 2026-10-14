// Pure, bounded admission decisions. No clocks, IO, background loops or Send authority.
import {createHash} from 'node:crypto';

export const CODING_QUEUE_SCHEMA = 'metaengine.devfleet.coding-queue.v1';
export const HOT_SLOTS = 4;
export const QUEUE_LIMIT = 32;
export const QUEUE_CHAR_LIMIT = 64000;
const idPattern = /^[a-zA-Z0-9._:-]{12,100}$/;
const projectPattern = /^[a-zA-Z0-9._:-]{3,64}$/;
const states = new Set(['QUEUED','CANCELLED','RESERVED','CREATION_UNKNOWN',
  'READY_NOT_SENT','SENT','AMBIGUOUS','INTERRUPTED_UNKNOWN']);
const clone = value => structuredClone(value);
const fingerprint = values => createHash('sha256').update(JSON.stringify(values)).digest('hex');

export function emptyCodingQueue() {
  return {schema:CODING_QUEUE_SCHEMA,last_project:null,items:[]};
}
export function readCodingQueue(value) {
  if(value===undefined)return emptyCodingQueue();
  if(!value || value.schema!==CODING_QUEUE_SCHEMA ||
    (value.last_project!==null && (typeof value.last_project!=='string' ||
      !projectPattern.test(value.last_project))) ||
    !Array.isArray(value.items) || value.items.length>QUEUE_LIMIT)
    throw Error('coding_queue_state_invalid');
  const ids=new Set(),requestIds=new Set();
  let total=0;
  for(const item of value.items){
    if(!item || typeof item!=='object' ||
      typeof item.task_id!=='string' || !idPattern.test(item.task_id) ||
      typeof item.request_id!=='string' || !idPattern.test(item.request_id) ||
      typeof item.project_id!=='string' || !projectPattern.test(item.project_id) ||
      !states.has(item.state) ||
      typeof item.text!=='string' || !item.text.trim() ||
      item.text.length>4000 || typeof item.fingerprint!=='string' ||
      !/^[a-f0-9]{64}$/.test(item.fingerprint) ||
      (item.tab_id!==null && (typeof item.tab_id!=='string' ||
        !/^tab_[a-f0-9-]{36}$/i.test(item.tab_id))) ||
      ids.has(item.task_id) || requestIds.has(item.request_id))
      throw Error('coding_queue_state_invalid');
    ids.add(item.task_id);requestIds.add(item.request_id);total+=item.text.length;
  }
  if(total>QUEUE_CHAR_LIMIT)throw Error('coding_queue_state_invalid');
  return clone(value);
}
export function enqueueCodingTask(queue, task, maxPromptChars=4000) {
  if(!task || typeof task!=='object' || Array.isArray(task) ||
    Object.keys(task).some(k=>!['task_id','request_id','project_id','text',
      'kind','scope','draft_pr_only'].includes(k)) ||
    typeof task.task_id!=='string' || !idPattern.test(task.task_id) ||
    typeof task.request_id!=='string' || !idPattern.test(task.request_id) ||
    typeof task.project_id!=='string' || !projectPattern.test(task.project_id) ||
    task.kind!=='SOURCE_CODING' || task.scope!=='SOURCE_ONLY' ||
    task.draft_pr_only!==true || typeof task.text!=='string' ||
    !task.text.trim() || task.text.length>Math.min(4000,maxPromptChars))
    throw Error('coding_queue_task_invalid');
  const hash=fingerprint([task.task_id,task.request_id,task.project_id,task.text]);
  const prior=queue.items.find(x=>x.task_id===task.task_id || x.request_id===task.request_id);
  if(prior){
    if(prior.task_id!==task.task_id || prior.request_id!==task.request_id ||
      prior.fingerprint!==hash)throw Error('coding_queue_identity_collision');
    return {queue:clone(queue),item:clone(prior),duplicate:true};
  }
  if(queue.items.length>=QUEUE_LIMIT ||
    queue.items.reduce((n,x)=>n+x.text.length,0)+task.text.length>QUEUE_CHAR_LIMIT)
    throw Error('coding_queue_capacity_exceeded');
  const next=clone(queue);
  const item={task_id:task.task_id,request_id:task.request_id,
    project_id:task.project_id,text:task.text,fingerprint:hash,
    tab_id:null,state:'QUEUED'};
  next.items.push(item);
  return {queue:next,item:clone(item),duplicate:false};
}
export function cancelQueuedTask(queue, task_id) {
  if(typeof task_id!=='string' || !idPattern.test(task_id))throw Error('coding_queue_task_invalid');
  const next=clone(queue),item=next.items.find(x=>x.task_id===task_id);
  if(!item)throw Error('coding_queue_task_not_found');
  if(item.state!=='QUEUED' && item.state!=='CANCELLED')
    throw Error('coding_queue_inflight_cannot_cancel');
  item.state='CANCELLED';
  return next;
}
// Projects alternate deterministically, retaining FIFO within each project.
// last_project survives explicit waves and restart. This is a proposal only.
export function chooseFairCodingWave(queue, count) {
  if(!Number.isSafeInteger(count)||count<0||count>HOT_SLOTS)
    throw Error('coding_queue_admission_budget_invalid');
  const projects=new Map();
  for(const item of queue.items)if(item.state==='QUEUED'){
    if(!projects.has(item.project_id))projects.set(item.project_id,[]);
    projects.get(item.project_id).push(item.task_id);
  }
  const picks=[];
  let cursor=queue.last_project;
  while(picks.length<count && projects.size){
    const keys=[...projects.keys()].sort();
    const next=keys.find(x=>cursor===null || x>cursor) ?? keys[0];
    picks.push(projects.get(next).shift());
    if(!projects.get(next).length)projects.delete(next);
    cursor=next;
  }
  return {task_ids:picks,last_project:cursor};
}
export function codingQueueSummary(queue, sessionCount, sessionIds=[]) {
  if(!Number.isSafeInteger(sessionCount) || sessionCount<0)
    throw Error('coding_queue_session_count_invalid');
  const hold=queue.items.filter(x=>['RESERVED','CREATION_UNKNOWN','INTERRUPTED_UNKNOWN'].includes(x.state) &&
    (!x.tab_id || !sessionIds.includes(x.tab_id))).length;
  const used=sessionCount+hold;
  const counts={};
  for(const item of queue.items)counts[item.state]=(counts[item.state]||0)+1;
  return {schema:CODING_QUEUE_SCHEMA,hot_limit:HOT_SLOTS,
    occupied_or_reserved:used,free_hot_slots:Math.max(0,HOT_SLOTS-used),
    counts,last_project:queue.last_project,
    items:queue.items.map(x=>({task_id:x.task_id,request_id:x.request_id,
      project_id:x.project_id,state:x.state,tab_id:x.tab_id})),
    prompts_exposed:false,auto_admission:false,authority_effect:false};
}
