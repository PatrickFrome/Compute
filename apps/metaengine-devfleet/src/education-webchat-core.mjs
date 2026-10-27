export const WEBCHAT_SCHEMA='education.chatgpt.subscription.v1';
export const REQUESTED_MODEL='GPT-6 Pro';
export function chatConversation(value){
  if(typeof value!=='string'||value.length>200)throw Error('web_chat_url_invalid');
  let u;try{u=new URL(value);}catch{throw Error('web_chat_url_invalid');}
  if(u.protocol!=='https:'||u.hostname!=='chatgpt.com'||u.port||u.username||u.password||u.search||u.hash
    ||!/^\/c\/[a-z0-9-]{8,100}\/?$/i.test(u.pathname))throw Error('web_chat_url_invalid');
  return u.origin+u.pathname.replace(/\/$/,'');
}
// Links are navigation records, not proof that a model was selected or a prompt sent.
export class WebChatBindings{
  #disk;#topic;#state;#serial=Promise.resolve();#fenced=false;
  constructor({disk,topic}){this.#disk=disk;this.#topic=topic;}
  async init(){
    this.#state=await this.#disk.load()??{schema:WEBCHAT_SCHEMA,links:{}};
    const s=this.#state;
    if(!s||s.schema!==WEBCHAT_SCHEMA||!s.links||Array.isArray(s.links))throw Error('web_state_invalid');
    const used=new Set();
    for(const [id,r] of Object.entries(s.links)){
      this.#topic(id);const url=chatConversation(r.url);if(used.has(url))throw Error('web_duplicate_chat');used.add(url);
    }
  }
  topic(id){const topic=this.#topic(id);return {material_id:id,title:topic.material.title,
    url:this.#state.links[id]?.url||null,requested_model:REQUESTED_MODEL,
    model_verified:false,api_disabled:true,dynamic_sync:'NOT_CONNECTED',revision:topic.revision};}
  bind({material_id,url}){
    const job=this.#serial.then(async()=>{
      if(this.#fenced)throw Error('web_persistence_fenced');
      this.#topic(material_id);url=chatConversation(url);
      if(Object.entries(this.#state.links).some(([id,v])=>id!==material_id&&v.url===url))throw Error('web_duplicate_chat');
      const next=structuredClone(this.#state);next.links[material_id]={url,bound_at:new Date().toISOString()};
      try{await this.#disk.save(next);}catch{this.#fenced=true;throw Error('web_persistence_fenced');}
      this.#state=next;return this.topic(material_id);
    });this.#serial=job.catch(()=>{});return job;
  }
}
