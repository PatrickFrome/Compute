import os from 'node:os';

// One owner-started loop. All physical create/Send effects remain in the
// existing DevFleetOperator, with its durable request IDs and receipts.
const GiB=1024**3;
const MiB=1024**2;
export class DevFleetConveyor {
  #operator;
  #enabled=false;
  #running=false;
  #timer=null;
  #stopped=false;
  #held=new Set();
  #blocked=new Set();
  #nextAttempt=new Map();
  #error=null;
  #explicitTarget=null;
  #retryDelayMs=5000;
  constructor(operator,{retryDelayMs=5000}={}){
    if(!Number.isSafeInteger(retryDelayMs)||retryDelayMs<1)throw Error('conveyor_retry_delay_invalid');
    this.#retryDelayMs=retryDelayMs;
    if(!operator||typeof operator.admitCoding!=='function'||
        typeof operator.queueStatus!=='function'||typeof operator.assign!=='function'||
        typeof operator.conveyorIntent!=='function'||typeof operator.setConveyorIntent!=='function')
      throw Error('conveyor_operator_missing');
    this.#operator=operator;
    this.#enabled=operator.conveyorIntent();
  }
  status(){
    const q=this.#operator.queueStatus();
    const orphaned=q.items.filter(item=>item.state==='READY_NOT_SENT' &&
      item.tab_id && this.#operator.codingTaskReceiptStatus(item.task_id).tab_state==='MISSING').length;
    return {schema:'metaengine.devfleet.conveyor.v1',
      enabled:this.#enabled,running:this.#running,
      hot_slots:q.hot_limit,free_slots:q.free_hot_slots,
      occupied_or_reserved:q.occupied_or_reserved,
      counts:q.counts,items:q.items,last_error:this.#error,
      sent_confirmed:q.counts.SENT||0,
      restore_blocked_tasks:this.#blocked.size,
      orphaned_tasks:orphaned,
      send_unknown:q.counts.AMBIGUOUS||0,
      automatic_retry_of_ambiguous:false,
      read_only:true,authority_effect:false};
  }
  async enqueueBatch({tasks}={}){
    if(!Array.isArray(tasks)||!tasks.length)throw Error('conveyor_tasks_invalid');
    const items=[];
    for(const task of tasks){
      const item=await this.#operator.enqueueCoding(task);
      items.push({task_id:item.task_id,request_id:item.request_id,
        state:item.state,duplicate:item.duplicate});
    }
    if(this.#enabled)this.#schedule();
    return {schema:'metaengine.devfleet.conveyor-enqueue.v1',
      accepted:items.length,items,auto_started:this.#enabled,
      automatic_retry_of_ambiguous:false};
  }
  async start({hot_slots}={}){
    if(hot_slots!==undefined && (!Number.isSafeInteger(hot_slots)||hot_slots<1))
      throw Error('conveyor_hot_slots_invalid');
    await this.#operator.setConveyorIntent({enabled:true});
    this.#explicitTarget=hot_slots??null;
    this.#stopped=false;
    this.#enabled=true;
    this.#error=null;
    this.#schedule();
    return {schema:'metaengine.devfleet.conveyor.v1',state:'STARTED',
      adaptive_capacity:hot_slots===undefined,
      automatic_retry_of_ambiguous:false};
  }
  resume(){
    if(this.#enabled){
      if(this.#timer){clearTimeout(this.#timer);this.#timer=null;}
      this.#schedule();
    }
  }
  async stop(){
    this.#enabled=false;this.#stopped=true;
    if(this.#timer){clearTimeout(this.#timer);this.#timer=null;}
    await this.#operator.setConveyorIntent({enabled:false});
    return {schema:'metaengine.devfleet.conveyor.v1',state:'STOPPING',
      in_flight:this.#running,automatic_retry_of_ambiguous:false};
  }
  #schedule(delay=0){
    if(!this.#enabled||this.#running||this.#timer)return;
    this.#timer=setTimeout(()=>{
      this.#timer=null;
      void this.#pump();
    },delay);
  }
  async #capacity(q){
    const queued=q.counts.QUEUED||0;
    const used=q.occupied_or_reserved;
    // RAM-backed capacity, not an arbitrary tab-count constant.
    const free=os.freemem();
    const room=Math.max(0,Math.floor((free-GiB)/(350*MiB)));
    const target=this.#explicitTarget??Math.max(1,used+Math.min(queued,room));
    if(target!==q.hot_limit)await this.#operator.configureCodingSlots({hot_slots:target});
  }
  async #pump(){
    if(this.#running||!this.#enabled)return;
    this.#running=true;
    let waiting=false;
    try{
      for(;;){
        if(!this.#enabled||this.#stopped)break;
        let q=this.#operator.queueStatus();
        this.#error=null;
        this.#blocked.clear();
        await this.#capacity(q);
        q=this.#operator.queueStatus();
        let progress=false;
        // READY_NOT_SENT is a pre-Send condition. Do not re-send any
        // AMBIGUOUS/SENT task. Same request IDs are idempotent in operator.
        for(const task of q.items){
          if(!this.#enabled)break;
          if(task.state!=='READY_NOT_SENT'||!task.tab_id||this.#held.has(task.request_id))continue;
          if((this.#nextAttempt.get(task.request_id)||0)>Date.now()){waiting=true;continue;}
          const row=this.#operator.queueTask(task.task_id);
          if(!row)continue;
          try {
            const current=this.#operator.codingTaskReceiptStatus(row.task_id);
            if(['SENT','AMBIGUOUS'].includes(current.ledger_state)){
              // Durably committed effect: resolve only, never Send again.
              await this.#operator.resolveCodingTask({
                task_id:row.task_id,state:current.ledger_state});
              this.#held.add(row.request_id);
              progress=true;
              continue;
            }
            if(current.ledger_state!=='NONE'){
              this.#error='CONVEYOR_UNRECONCILED_SEND';
              this.#held.add(row.request_id);
              continue;
            }
            if(current.tab_state==='RESTORE_BLOCKED'){
              this.#blocked.add(row.task_id);
              waiting=true;
              continue;
            }
            if(current.tab_state==='MISSING'){
              // A retired/rotated cell is not proof the queued request was sent.
              // Never select an arbitrary other tab or manufacture a receipt.
              this.#error='CONVEYOR_ORPHANED_TAB_BINDING';
              waiting=true;
              continue;
            }
            if(current.tab_state!=='OPEN'){
              waiting=true;
              continue;
            }
            const receipt=await this.#operator.assign({request_id:row.request_id,
              tab_id:row.tab_id,text:row.text});
            if(['SENT','AMBIGUOUS'].includes(receipt.state)){
              await this.#operator.resolveCodingTask({task_id:row.task_id,state:receipt.state});
              this.#held.add(row.request_id);
            }else this.#nextAttempt.set(row.request_id,Date.now()+this.#retryDelayMs);
          }catch{
            // May include a committed receipt and a failed queue save;
            // re-read the ledger on the next pass rather than assuming Send failed.
            this.#nextAttempt.set(row.request_id,Date.now()+this.#retryDelayMs);
            waiting=true;
          }
          progress=true;
        }
        if(!this.#enabled)break;
        q=this.#operator.queueStatus();
        if((q.counts.QUEUED||0)>0 && q.free_hot_slots>0){
          await this.#operator.admitCoding({max_items:Math.min(q.free_hot_slots,4)});
          progress=true;
        }
        if(!progress)break;
      }
    }catch(error){
      this.#error=String(error?.message||'CONVEYOR_FAILURE').slice(0,120);
      waiting=true;
    }finally{
      this.#running=false;
      if(this.#enabled){
        let pending=true;
        try{
          const q=this.#operator.queueStatus();
          pending=waiting||(q.counts.READY_NOT_SENT||0)>0||(q.counts.QUEUED||0)>0;
        }catch(error){
          // RESTORING is transient; do not disable an owner-started conveyor.
          this.#error=String(error?.message||'CONVEYOR_WAITING_FOR_RESTORE').slice(0,120);
        }
        if(pending)this.#schedule(this.#retryDelayMs);
      }
    }
  }
}
