import crypto from 'node:crypto';
import { MATERIALS } from './education-library.mjs';

export const LIVE_SCHEMA='devfleet.education.live.v1';
export const EDIT_FIELDS=Object.freeze(['theory','example','exercise','check','extension']);
const clone=v=>structuredClone(v);
const sha=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=code=>{throw Error(code);};
const validText=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max;
const uuid=v=>typeof v==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(v);
const baseById=new Map(MATERIALS.map(m=>[m.id,m]));
const baseFor=id=>baseById.get(id)||fail('live_topic_unknown');
const fieldsFor=m=>Object.fromEntries(EDIT_FIELDS.map(f=>[f,f==='extension'?m.depth.extension:m[f]]));

export const liveRevision=(id,version,fields)=>sha({id,version,fields});

/** Reject executable/structural edits. Accepted strings are rendered using textContent. */
export function validateLessonAnswer(answer){
  if(!answer||Object.getPrototypeOf(answer)!==Object.prototype
    ||Object.keys(answer).sort().join(',')!=='change_summary,edits,reply'
    ||!validText(answer.reply,12000)||typeof answer.change_summary!=='string'
    ||answer.change_summary.length>600||!Array.isArray(answer.edits)||answer.edits.length>5)
    fail('live_answer_invalid');
  const seen=new Set();
  for(const edit of answer.edits){
    if(!edit||Object.keys(edit).sort().join(',')!=='field,text'
      ||!EDIT_FIELDS.includes(edit.field)||seen.has(edit.field)||!validText(edit.text,8000))
      fail('live_answer_invalid');
    seen.add(edit.field);
  }
  return clone(answer);
}

function fresh(){return {schema:LIVE_SCHEMA,topics:{}};}
function freshTopic(id){const base=baseFor(id);return {base_hash:sha(base),version:0,
  fields:fieldsFor(base),turns:[],revisions:[],requests:[]};}
function validateState(s){
  if(!s||s.schema!==LIVE_SCHEMA||!s.topics||Array.isArray(s.topics)
    ||Object.keys(s.topics).length>MATERIALS.length)fail('live_state_invalid');
  for(const [id,t] of Object.entries(s.topics)){
    if(t.base_hash!==sha(baseFor(id)))fail('live_base_changed');
    if(!Number.isSafeInteger(t.version)||t.version<0||!t.fields
      ||Object.keys(t.fields).sort().join(',')!==[...EDIT_FIELDS].sort().join(',')
      ||EDIT_FIELDS.some(f=>!validText(t.fields[f],8000))
      ||!Array.isArray(t.turns)||t.turns.length>400
      ||!Array.isArray(t.requests)||t.requests.length>200
      ||!Array.isArray(t.revisions)||t.revisions.length>100)fail('live_state_invalid');
    const requests=new Set();
    for(const r of t.requests){
      if(!uuid(r.id)||requests.has(r.id)||!['PENDING','COMPLETED','UNKNOWN','REJECTED'].includes(r.state)
        ||!Number.isFinite(Date.parse(r.at)))fail('live_state_invalid');
      requests.add(r.id);
    }
    for(const turn of t.turns){
      if(!['user','assistant'].includes(turn.role)||!validText(turn.text,12000)
        ||!requests.has(turn.request_id))fail('live_state_invalid');
    }
    for(const r of t.revisions){
      if(!Number.isSafeInteger(r.version)||r.version<1||r.version>t.version
        ||!validText(r.summary,600)||!['gpt_unverified','user_undo'].includes(r.origin)
        ||!r.before||EDIT_FIELDS.some(f=>!validText(r.before[f],8000)))fail('live_state_invalid');
    }
  }
  return s;
}

/** Per-topic local journal; no key or remote browser session enters this store. */
export class LiveLessonStore{
  #disk;#state;#serial=Promise.resolve();#fenced=false;
  constructor(disk){this.#disk=disk;}
  async init(){
    this.#state=validateState(await this.#disk.load()??fresh());
    // A crashed call is never automatically resent. Its remote outcome is unknown.
    const next=clone(this.#state);let changed=false;
    for(const t of Object.values(next.topics))for(const r of t.requests)
      if(r.state==='PENDING'){r.state='UNKNOWN';r.error='live_interrupted';changed=true;}
    if(changed){await this.#disk.save(next);this.#state=next;}
  }
  #mutate(fn){
    const task=this.#serial.then(async()=>{
      if(this.#fenced)fail('live_persistence_fenced');
      const next=clone(this.#state),result=fn(next);
      validateState(next);
      try{await this.#disk.save(next);}catch{this.#fenced=true;fail('live_persistence_fenced');}
      this.#state=next;return result;
    });this.#serial=task.catch(()=>{});return task;
  }
  #topic(id){baseFor(id);return this.#state.topics[id]??freshTopic(id);}
  material(id){
    const m=clone(baseFor(id)),t=this.#topic(id);
    for(const f of EDIT_FIELDS){if(f==='extension')m.depth.extension=t.fields[f];else m[f]=t.fields[f];}
    m.dynamic={version:t.version,revision:liveRevision(id,t.version,t.fields),
      origin:t.version?'gpt_or_user_revision_unverified':'authored_base',
      source_claims_verified:false};return m;
  }
  materials(){return MATERIALS.map(m=>this.material(m.id));}
  topic(id){const t=this.#topic(id);return clone({material_id:id,material:this.material(id),
    version:t.version,revision:liveRevision(id,t.version,t.fields),turns:t.turns.slice(-60),
    revisions:t.revisions.slice(-20).map(({before,...r})=>r),
    requests:t.requests.slice(-8),pending:t.requests.some(r=>r.state==='PENDING'),
    persistence_fenced:this.#fenced,total_turns:t.turns.length,
    can_undo:t.revisions.some(r=>r.origin==='gpt_unverified'&&!t.revisions.some(u=>u.undo_of===r.version))});}
  async begin({material_id,request_id,text,expected_revision}){
    baseFor(material_id);
    if(!uuid(request_id)||!validText(text,4000))fail('live_request_invalid');
    return this.#mutate(s=>{
      const t=s.topics[material_id]??=freshTopic(material_id);
      if(t.requests.some(r=>r.id===request_id))fail('live_request_seen');
      if(t.requests.some(r=>r.state==='PENDING'))fail('live_topic_busy');
      if(expected_revision!==liveRevision(material_id,t.version,t.fields))fail('live_stale_revision');
      if(t.turns.length>397||t.requests.length>=200||t.revisions.length>=100)fail('live_capacity');
      t.requests.push({id:request_id,state:'PENDING',at:new Date().toISOString()});
      t.turns.push({request_id,role:'user',text,at:new Date().toISOString()});
    });
  }
  async finish({material_id,request_id,expected_revision,answer,allow_edits}){
    baseFor(material_id);
    if(typeof allow_edits!=='boolean')fail('live_request_invalid');
    const checked=validateLessonAnswer(answer);
    return this.#mutate(s=>{
      const t=s.topics[material_id],req=t?.requests.find(r=>r.id===request_id);
      if(!req||req.state!=='PENDING')fail('live_request_not_pending');
      const current=liveRevision(material_id,t.version,t.fields);
      const conflict=current!==expected_revision;
      const applied=allow_edits&&!conflict&&checked.edits.length>0;
      if(applied){
        t.revisions.push({version:t.version+1,before:clone(t.fields),
          summary:checked.change_summary||'Переработка по запросу ученика',
          origin:'gpt_unverified',request_id,at:new Date().toISOString()});
        for(const edit of checked.edits)t.fields[edit.field]=edit.text;
        t.version++;
      }
      req.state='COMPLETED';req.applied=applied;
      req.conflict=conflict;req.ignored_edits=!allow_edits&&checked.edits.length>0;
      t.turns.push({request_id,role:'assistant',text:checked.reply,at:new Date().toISOString()});
      return {applied,conflict,changed_fields:applied?checked.edits.map(e=>e.field):[]};
    });
  }
  failRequest(id,request_id,code){return this.#mutate(s=>{
    const req=s.topics[id]?.requests.find(r=>r.id===request_id);
    if(req?.state==='PENDING'){req.state='UNKNOWN';req.error=/^live_[a-z0-9_]{1,80}$/.test(code)?code:'live_request_failed';}
  });}
  undo({material_id,expected_revision}){baseFor(material_id);return this.#mutate(s=>{
    const t=s.topics[material_id];if(!t||!t.revisions.length)fail('live_no_revision');
    if(t.requests.some(r=>r.state==='PENDING'))fail('live_topic_busy');
    if(expected_revision!==liveRevision(material_id,t.version,t.fields))fail('live_stale_revision');
    if(t.revisions.length>=100)fail('live_capacity');
    const undone=new Set(t.revisions.filter(r=>r.undo_of).map(r=>r.undo_of));
    const revision=[...t.revisions].reverse().find(r=>r.origin==='gpt_unverified'&&!undone.has(r.version));
    if(!revision)fail('live_no_revision');
    const target=clone(revision.before),before=clone(t.fields);
    t.fields=target;t.version++;
    t.revisions.push({version:t.version,before,origin:'user_undo',undo_of:revision.version,
      summary:'Возврат предыдущей редакции',at:new Date().toISOString()});
    return {restored:true,version:t.version};
  });}
}

export function buildLiveContext(topic,education,{includeNotebook=false}={}){
  const id=topic.material_id,linked=education.chats.find(c=>c.material_id===id)?.tab_id;
  const notes=includeNotebook?(education.notebook_entries||[])
    .filter(e=>e.notebook_key===id||(linked&&e.notebook_key===linked)).slice(-8):[];
  const context={material:topic.material,material_id:id,revision:topic.revision,
    notes:notes.map(e=>({title:e.title,body:e.body.slice(0,1500),source:e.source})),
    practice:education.study_contexts.find(c=>c.subject===topic.material.subject)??null,
    messages:topic.turns.slice(-12).map(t=>({role:t.role,text:t.text.slice(0,3000)})),
    notes_included:includeNotebook,source_claims_verified:false,
    context_limits:{older_messages_omitted:Math.max(0,(topic.total_turns??topic.turns.length)-12),older_notes_omitted:0,
      long_message_excerpt_chars:3000,note_excerpt_chars:1500}};
  while(JSON.stringify(context).length>57000&&context.messages.length){
    context.messages.shift();context.context_limits.older_messages_omitted++;
  }
  while(JSON.stringify(context).length>57000&&context.notes.length){
    context.notes.shift();context.context_limits.older_notes_omitted++;
  }
  return context;
}

export class LiveLessonCoordinator{
  #store;#education;#transport;#active=new Set();
  constructor({store,education,transport}){this.#store=store;this.#education=education;this.#transport=transport;}
  async send(p){
    const {material_id,request_id,text,expected_revision,allow_edits=true,include_notebook=false}=p||{};
    if(typeof allow_edits!=='boolean'||typeof include_notebook!=='boolean')fail('live_request_invalid');
    if(this.#active.has(material_id))fail('live_topic_busy');
    if(this.#active.size>=3)fail('live_concurrency_limit');
    // No request or record is made when credentials/billing are unconfigured.
    if(!this.#transport.status().ready)fail('live_not_connected');
    const topic=this.#store.topic(material_id);
    const context=buildLiveContext(topic,this.#education.snapshot(),{includeNotebook:include_notebook});
    this.#active.add(material_id);let began=false;
    try{
      await this.#store.begin({material_id,request_id,text,expected_revision});began=true;
      const answer=await this.#transport.complete({context,text,allow_edits});
      const result=await this.#store.finish({material_id,request_id,expected_revision,answer,allow_edits});
      return {...result,topic:this.#store.topic(material_id)};
    }catch(error){
      const code=/^live_[a-z0-9_]{1,80}$/.test(error?.message)?error.message:'live_request_failed';
      if(began)await this.#store.failRequest(material_id,request_id,code).catch(()=>{});
      throw Error(code);
    }finally{this.#active.delete(material_id);}
  }
}
