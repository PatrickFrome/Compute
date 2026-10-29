import crypto from 'node:crypto';

const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const SHA=/^[a-f0-9]{64}$/;
const stable=value=>Array.isArray(value)?value.map(stable):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value;
const digest=value=>crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
const fail=code=>{throw Error('browser_parent_suspension_'+code);};
const flags={automatic_retry_allowed:false,authority_effect:false,scheduler_authority:false};
// Only known per-view custody/readback holds are isolated. Do not classify by
// broad prefix: authentication, Owner control, receipt/list integrity, journal
// corruption and untyped network/provider errors must still fence the sweep.
const TASK_LOCAL_HOLDS=new Set([
  'browser_parent_transport_agent_missing','browser_parent_transport_not_quiescent',
  'browser_parent_transport_transcript_changed','browser_parent_transport_transcript_incomplete',
  'browser_parent_transport_old_target_changed','browser_parent_transport_old_conversation_changed',
  'browser_parent_transport_old_freeze_changed','browser_parent_transport_close_unconfirmed',
  'browser_parent_transport_completed_close_unconfirmed','browser_parent_transport_completion_binding_changed',
  'browser_parent_transport_freeze_transcript_changed','browser_parent_transport_active_resume_binding_changed',
  'browser_parent_transport_active_resume_conversation_changed','browser_parent_transport_restoration_changed',
  'browser_parent_transport_restore_freeze_changed','browser_parent_transport_restoration_epoch_changed',
  'fleet_parent_resume_physical_readback_required','fleet_parent_resume_old_tab_not_retired',
  'browser_parent_close_destroy_readback_required','browser_parent_close_not_destroyed',
  'browser_parent_freeze_target_changed','browser_parent_thaw_target_changed',
  'parent_suspension_physical_mutation_busy','parent_suspension_physical_mutation_fenced',
]);

function requestId(task,generation) {
  const h=digest(['browser-parent-suspend',task,generation]);
  return `${h.slice(0,8)}-${h.slice(8,12)}-4${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
function control(value) {
  if(value?.authoritative!==true||value.state!=='OPEN'||value.continuous_service_allowed!==true
    ||value.owner_stop===true||!Number.isSafeInteger(value.generation_floor)||value.generation_floor<0)fail('owner_control_fenced');
  return value.generation_floor;
}
export function assertBrowserParentSuspensionReceipt(value, expected={}) {
  if(!value||value.schema!=='metaengine.devos.browser-parent-suspension.v1'||value.authority_effect!==false
    ||value.automatic_retry_allowed!==false||!UUID.test(value.suspension_id||'')||!UUID.test(value.task_id||'')
    ||!UUID.test(value.project_id||'')||!SHA.test(value.checkpoint_sha256||'')||!['SUSPENDED','RESUMED'].includes(value.status)
    ||value.checkpoint?.schema!=='metaengine.browser.parent-checkpoint.v1')fail('receipt_invalid');
  for(const key of ['suspension_id','task_id','project_id','old_claim_id','old_lease_generation']) {
    if(expected[key]!=null&&value[key]!==expected[key])fail('receipt_binding_changed');
  }
  if(expected.checkpoint&&digest(value.checkpoint)!==digest(expected.checkpoint))fail('checkpoint_changed');
  if(value.status==='RESUMED') {
    const l=value.lease,c=value.checkpoint;
    if(l?.task_id!==value.task_id||l.agent_id!==c.agent_id||!Number.isSafeInteger(l.lease_generation)
      ||l.lease_generation<=value.old_lease_generation||l.agent_generation_epoch<=c.agent_generation_epoch
      ||l.conversation_url_sha256!==c.conversation_url_sha256)fail('resume_binding_changed');
  }
  return value;
}

/** Private host composition invoked by the existing project heartbeat only.
 * No timer, independent lease allocator or model-callable suspension action. */
export class BrowserParentSuspension {
  #journal;#request;#transport;#readControl;#taskSnapshot;#cursor=0;#retirementCursor=null;#last=null;
  constructor({journal,request,transport,readControl,taskSnapshot}) {
    this.#journal=journal;this.#request=request;this.#transport=transport;this.#readControl=readControl;this.#taskSnapshot=taskSnapshot;
  }
  snapshot(){return this.#last?structuredClone(this.#last):{state:'IDLE',...flags};}
  async #post(operation,body){return this.#request({method:'POST',path:`/v1/devos/project/${operation}`,body});}
  async #read(task_id){return this.#post('suspension-read',{task_id});}
  async #rememberResume(receipt) {
    const value=assertBrowserParentSuspensionReceipt(receipt),lease=value.lease,c=value.checkpoint;
    if(value.status!=='RESUMED')fail('resume_receipt_required');
    const key=`turn:${lease.task_id}:${lease.lease_generation}:resume:${value.suspension_id}`;
    const intent={schema:'metaengine.devos.project-conversation-resume.v1',project_id:value.project_id,
      task_id:lease.task_id,agent_id:lease.agent_id,lease_generation:lease.lease_generation,
      transcript_floor:c.transcript_floor,delivered_tool_results:c.delivered_tool_results,
      delivery_history_complete:true,suspension_id:value.suspension_id,checkpoint_sha256:value.checkpoint_sha256,...flags};
    await this.#journal.begin(key,intent);
    await this.#journal.confirm(key,{effect_state:'RESTORED_EXISTING_CONVERSATION',transcript_floor:c.transcript_floor,
      suspension_id:value.suspension_id,checkpoint_sha256:value.checkpoint_sha256,...flags});
  }
  async suspend(lease) {
    if(!this.#transport)return {state:'SUSPENSION_TRANSPORT_UNAVAILABLE',...flags};
    const generation=control(this.#readControl());
    const current=await this.#taskSnapshot(lease);if(!current)return {state:'NOT_PROJECT_TASK',...flags};
    // Preserve mutable worktree custody until a separately verified transfer
    // exists. Never release a writer claim on a checkpoint digest alone.
    if(current.task.claim_class!=='READ_ONLY')return {state:'MUTATING_PARENT_CUSTODY_REQUIRED',...flags};
    const suspension_id=requestId(lease.task_id,lease.lease_generation),effectKey=`suspend:${suspension_id}`;
    const expected={suspension_id,project_id:current.snapshot.project_id,task_id:lease.task_id,
      old_claim_id:current.task.claim_id,old_lease_generation:lease.lease_generation};
    const prior=await this.#journal.find(effectKey);
    if(prior) {
      // The request may have committed. Observe its exact result; never send a
      // replacement checkpoint, replay a model turn or silently reuse its tab.
      const read=await this.#read(lease.task_id);
      if(read?.found===false)return {state:'SUSPENSION_READBACK_REQUIRED',...flags};
      const receipt=assertBrowserParentSuspensionReceipt(read,{...expected,checkpoint:prior.intent.checkpoint});
      if(receipt.status==='SUSPENDED')await this.#transport.hibernateStored(receipt);
      return receipt;
    }
    if(typeof this.#journal.conversationCheckpoint!=='function')return {state:'DURABLE_DELIVERY_CHECKPOINT_REQUIRED',...flags};
    const saved=await this.#journal.conversationCheckpoint(lease);
    if(saved?.state!=='CONFIRMED')return {state:saved?.state||'CONFIRMED_CONTINUATION_REQUIRED',...flags};
    return this.#transport.withQuiescentParent({lease,checkpointContext:{
      transcript_floor:saved.transcript_floor,confirmed_turn_sha256:saved.confirmed_turn_sha256,
      delivered_tool_results:saved.delivered_tool_results,control_generation:generation,worktree_custody:null,
    }},async checkpoint=>{
      if(control(this.#readControl())!==generation)fail('owner_generation_changed');
      const body={project_id:expected.project_id,task_id:lease.task_id,claim_id:expected.old_claim_id,
        lease_generation:lease.lease_generation,suspension_id,checkpoint};
      await this.#journal.begin(effectKey,{schema:'metaengine.browser.parent-suspend-intent.v1',...body,...flags});
      let receipt;
      try {receipt=assertBrowserParentSuspensionReceipt(await this.#post('suspend-browser',body),{...expected,checkpoint});}
      catch(error) {
        try {receipt=assertBrowserParentSuspensionReceipt(await this.#read(lease.task_id),{...expected,checkpoint});}
        catch {throw error;}
      }
      // Receipt projections may change as children complete; persist only the
      // immutable binding, never replace a confirmed journal row on readback.
      await this.#journal.confirm(effectKey,{suspension_id,checkpoint_sha256:receipt.checkpoint_sha256,...flags});
      return receipt;
    });
  }
  async releaseCompleted(lease, completion) {
    if (!this.#transport?.releaseCompletedBrowserChild || !['RESULT_READY','COMPLETED'].includes(completion?.state)) return null;
    const generation=control(this.#readControl());
    if (typeof this.#journal.hasPendingTaskEffect !== 'function' || await this.#journal.hasPendingTaskEffect(lease))
      return {state:'PENDING_EFFECT_REQUIRES_READBACK',...flags};
    // GET task/status may be reconstructed from a bounded event tail. It is
    // not sufficient custody evidence. Read the current project task directly.
    const snapshot=await this.#post('snapshot',{project_id:null,task_id:lease.task_id,task_after_seq:0,limit:1});
    const task=snapshot?.selected_task;
    if(snapshot?.schema!=='metaengine.devos.project-snapshot.v1'||snapshot.found!==true||snapshot.authority_effect!==false
      ||task?.task_id!==lease.task_id||!task.parent_task_id||task.claim_class!=='READ_ONLY'
      ||!['RESULT_READY','COMPLETED'].includes(task.state)||task.active_claim_count!==0||task.active_workspace_binding_count!==0
      ||task.agent_id!==lease.agent_id||task.lease_generation!==lease.lease_generation
      ||task.tab_id!==lease.tab_id||task.target_id!==lease.target_id||task.agent_generation_epoch!==lease.agent_generation_epoch)
      return {state:'COMPLETION_CUSTODY_READBACK_REQUIRED',...flags};
    if(control(this.#readControl())!==generation)fail('owner_generation_changed');
    const key=`child-retire:${lease.task_id}:${lease.lease_generation}`;
    await this.#journal.begin(key,{schema:'metaengine.browser.child-retirement-intent.v1',lease,completion,...flags});
    // This idempotent SQL transition reserves the exact old physical incarnation
    // against concurrent claim admission; a snapshot alone cannot do that.
    const certificate=await this.#post('release-browser-child',{task_id:lease.task_id,lease_generation:lease.lease_generation,
      agent_id:lease.agent_id,tab_id:lease.tab_id,target_id:lease.target_id,agent_generation_epoch:lease.agent_generation_epoch});
    if(certificate?.schema!=='metaengine.devos.browser-child-retirement.v1'||certificate.retired!==true
      ||certificate.authority_effect!==false||certificate.automatic_retry_allowed!==false||!UUID.test(certificate.retirement_id||'')
      ||certificate.claim_class!=='READ_ONLY'||!['RESULT_READY','COMPLETED'].includes(certificate.state)
      ||['task_id','lease_generation','agent_id','tab_id','target_id','agent_generation_epoch'].some(k=>certificate[k]!==lease[k]))
      fail('child_retirement_unproven');
    if(control(this.#readControl())!==generation)fail('owner_generation_changed');
    const {replayed,...immutable}=certificate;
    const released=await this.#transport.releaseCompletedBrowserChild({lease,receipt:immutable});
    if(released===true)await this.#journal.confirm(key,immutable);
    return released;
  }
  async tick() {
    if(!this.#transport)return this.snapshot();
    const generation=control(this.#readControl());
    const held={count:0,items:[],truncated:false};
    const checkControl=()=>{if(control(this.#readControl())!==generation)fail('owner_generation_changed');};
    const recordHold=(stage,taskId,reason)=>{
      held.count++;
      if(held.items.length<16)held.items.push({stage,task_id:UUID.test(taskId||'')?taskId:null,reason});
      else held.truncated=true;
    };
    const reconcile=async(stage,taskId,operation)=>{
      checkControl();
      try {
        const result=await operation();checkControl();
        if(['PENDING_EFFECT_REQUIRES_READBACK','COMPLETION_CUSTODY_READBACK_REQUIRED'].includes(result?.state))
          recordHold(stage,taskId,result.state);
        return result;
      } catch(error) {
        // Never conceal a stop or epoch change behind a task-local exception.
        checkControl();
        if(!TASK_LOCAL_HOLDS.has(error?.message))throw error;
        recordHold(stage,taskId,error.message); // fixed nonsecret code, no raw error text
        return null; // custody retained; no replay, close, or fabricated success
      }
    };
    await reconcile('COMPLETED_RELEASE_SWEEP',null,()=>this.#transport.reconcileCompletedBrowserChildren?.());
    let retirementPage=null;
    let retirements;
    if(typeof this.#journal.pendingPage==='function') {
      retirementPage=await this.#journal.pendingPage({after_key:this.#retirementCursor,limit:32,prefix:'child-retire:'});
      if(retirementPage?.schema!=='metaengine.project.pending-effect-page.v1'||retirementPage.authority_effect!==false
        ||retirementPage.automatic_retry_allowed!==false||!Array.isArray(retirementPage.entries)||retirementPage.entries.length>32
        ||retirementPage.cursor?.after_key!==this.#retirementCursor||typeof retirementPage.cursor?.has_more!=='boolean')fail('retirement_page_invalid');
      let previous=this.#retirementCursor;
      for(const entry of retirementPage.entries) {
        if(typeof entry?.effect_key!=='string'||entry.effect_key.length>256||!/^child-retire:[A-Za-z0-9:._-]+$/.test(entry.effect_key)
          ||(previous!==null&&entry.effect_key<=previous)||entry.receipt!==null
          ||entry.intent?.schema!=='metaengine.browser.child-retirement-intent.v1'
          ||!UUID.test(entry.intent.lease?.task_id||'')||!Number.isSafeInteger(entry.intent.lease?.lease_generation)||entry.intent.lease.lease_generation<1
          ||entry.effect_key!==`child-retire:${entry.intent.lease.task_id}:${entry.intent.lease.lease_generation}`
          ||!['RESULT_READY','COMPLETED'].includes(entry.intent.completion?.state))fail('retirement_page_invalid');
        previous=entry.effect_key;
      }
      if(retirementPage.cursor.next_key!==previous||(retirementPage.cursor.has_more&&retirementPage.entries.length===0))fail('retirement_page_invalid');
      retirements=retirementPage.entries;
    } else {
      // Compatibility for older injected journals. The production SQLite
      // journal always supplies pendingPage; its custody schema is unchanged.
      retirements=await this.#journal.pending?.({limit:32}) || [];
    }
    for(const pending of retirements) {
      if(pending.intent?.schema==='metaengine.browser.child-retirement-intent.v1')
        await reconcile('CHILD_RETIREMENT',pending.intent.lease?.task_id,()=>this.releaseCompleted(pending.intent.lease,pending.intent.completion));
    }
    const page=await this.#post('suspension-list',{after_seq:this.#cursor,limit:32});
    if(page?.schema!=='metaengine.devos.browser-parent-suspension-list.v1'||page.authority_effect!==false
      ||page.automatic_retry_allowed!==false||!Array.isArray(page.entries)||page.entries.length>32
      ||!Number.isSafeInteger(page.cursor?.next_seq)||page.cursor.next_seq<this.#cursor
      ||typeof page.cursor.has_more!=='boolean'
      ||(page.cursor.has_more && (page.cursor.next_seq<=this.#cursor||page.entries.length===0)))fail('list_invalid');
    // Authenticate/validate the entire page before acting on even its first
    // entry. A malformed later receipt is not a task-local physical hold.
    const entries=page.entries.map(raw=>assertBrowserParentSuspensionReceipt(raw));
    for(const receipt of entries) {
      await reconcile('PARENT_RECONCILIATION',receipt.task_id,async()=>{
      if(control(this.#readControl())!==generation)fail('owner_generation_changed');
      if(receipt.status==='SUSPENDED')await this.#transport.hibernateStored(receipt);
      if(['READY_TO_RESUME','READY_FOR_MESSAGE'].includes(receipt.state)||receipt.status==='RESUMED') {
        const resumed=await this.#transport.resumeStored({receipt,control_generation:generation},async restoration=>{
          if(control(this.#readControl())!==generation)fail('owner_generation_changed');
          // An already committed resume is never posted a second time.
          if(receipt.status==='RESUMED')return receipt;
          let result;
          try {result=await this.#post('resume-browser',{suspension_id:receipt.suspension_id,restoration});}
          catch(error) {try {result=await this.#read(receipt.task_id);}catch {throw error;}}
          const checked=assertBrowserParentSuspensionReceipt(result,{suspension_id:receipt.suspension_id,checkpoint:receipt.checkpoint});
          return checked;
        });
        if(resumed?.status==='RESUMED')await this.#rememberResume(resumed);
      }
      });
    }
    checkControl();
    this.#cursor=page.cursor.has_more?page.cursor.next_seq:0;
    // Advance only after global fences passed. Task-local holds remain durable
    // and are revisited on wrap. Restart deliberately starts a new read sweep;
    // cursor loss grants no completion, release, or permission to replay.
    if(retirementPage)this.#retirementCursor=retirementPage.cursor.has_more?retirementPage.cursor.next_key:null;
    this.#last={state:held.count?'SUSPENSIONS_RECONCILED_WITH_HOLDS':'SUSPENSIONS_RECONCILED',observed:page.entries.length,held,...flags};return this.snapshot();
  }
}
