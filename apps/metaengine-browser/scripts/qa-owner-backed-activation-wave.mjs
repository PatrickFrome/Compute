// Real installed Owner UI may be load-tested only after a verified local PG17
// incarnation and native Window have been independently admitted. This module
// checks each exact nonce/sequence against the durable SAME-BOOT startup journal.
// A forged callback receipt, a detached Owner or repeated launch cannot pass.
export const OWNER_BACKED_ACTIVATION_WAVE_SCHEMA='metaengine.browser.owner-backed-activation-wave.v1';
const SHA=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail=x=>{throw new Error('owner_backed_activation_wave_'+x);};
function receiptOk(ack,{pid,version}){
  return ack?.schema==='metaengine.browser.secondary-launch.v1'
    && ack.state==='PRIMARY_UI_ACTIVATION_ACKNOWLEDGED'
    && ack.primary_pid===pid&&ack.primary_version===version
    && SHA.test(ack.launch_id||'')
    && Number.isSafeInteger(ack.event_sequence)&&ack.event_sequence>0
    && ack.second_browser_runtime_started===false&&ack.authority_effect===false;
}
function journalOk(value,{pid,version,windowId},acks){
  if(!value?.current_boot_id||value.current_pid!==pid||value.current_version!==version
    ||!Array.isArray(value.events))fail('startup_identity_unverified');
  const current=value.events.filter(e=>e?.boot_id===value.current_boot_id);
  if(current.some(e=>e.pid!==pid||e.version!==version))fail('cross_process_event');
  const rows=current.filter(e=>e.state==='PRIMARY_WINDOW_ACTIVATED');
  for(const ack of acks){
    const matched=rows.filter(e=>e.sequence===ack.event_sequence
      && e.details?.launch_id===ack.launch_id&&e.details?.visible===true
      && e.details?.window_id===windowId);
    if(matched.length!==1)fail('durable_activation_missing');
  }
  return true;
}
export async function qualifyOwnerBackedActivationWave({
  activate,readJournal,inspectWindow,pid,version,windowId,
  sequentialCount=64,concurrentCount=8,
  p95BudgetMs=1000,concurrentBudgetMs=8000,
  clock=()=>performance.now()
}={}){
  if(typeof activate!=='function'||typeof readJournal!=='function'
    ||typeof inspectWindow!=='function'||!Number.isSafeInteger(pid)||pid<1
    ||typeof version!=='string'||version.length>128||version.length<1
    ||!Number.isSafeInteger(windowId)||windowId<1
    ||!Number.isSafeInteger(sequentialCount)||sequentialCount<1||sequentialCount>96
    ||!Number.isSafeInteger(concurrentCount)||concurrentCount<1||concurrentCount>16
    ||!Number.isFinite(p95BudgetMs)||p95BudgetMs<100
    ||!Number.isFinite(concurrentBudgetMs)||concurrentBudgetMs<100
    ||typeof clock!=='function')fail('arguments_invalid');
  const acks=[],latencies=[],launchIds=new Set(),sequences=new Set();
  // With fixed N, more than N-ceil(.95*N) slow samples makes the final P95
  // impossible. Fail at that point; do not launch the remaining secondaries
  // for minutes only to have the outer qualifier kill the real failure.
  const maximumSlowSamples=sequentialCount+concurrentCount
    -Math.ceil((sequentialCount+concurrentCount)*.95);
  let slowSamples=0;
  const one=async()=>{
    const start=clock();const ack=await activate();const elapsed=clock()-start;
    if(!receiptOk(ack,{pid,version})||!Number.isFinite(elapsed)||elapsed<0)
      fail('secondary_receipt_unverified');
    if(launchIds.has(ack.launch_id)||sequences.has(ack.event_sequence))
      fail('secondary_duplicate');
    launchIds.add(ack.launch_id);sequences.add(ack.event_sequence);
    acks.push(ack);latencies.push(elapsed);
    if(elapsed>p95BudgetMs&&++slowSamples>maximumSlowSamples)
      fail('activation_latency_budget_exceeded');
  };
  for(let i=0;i<sequentialCount;i++)await one();
  const concurrentStart=clock();
  await Promise.all(Array.from({length:concurrentCount},()=>one()));
  const burstMs=clock()-concurrentStart;
  if(acks.length!==sequentialCount+concurrentCount
    ||sequences.size!==acks.length||launchIds.size!==acks.length)
    fail('count_unverified');
  journalOk(await readJournal(),{pid,version,windowId},acks);
  const window=await inspectWindow();
  if(window?.pid!==pid||window.handle==null||window.visible!==true
    ||window.minimized!==false||window.width<=400||window.height<=300
    ||window.authority_effect!==false)fail('native_window_not_stable');
  const sorted=latencies.toSorted((a,b)=>a-b);
  const p95=sorted[Math.ceil(sorted.length*.95)-1];
  if(p95>p95BudgetMs)fail('activation_latency_budget_exceeded');
  if(burstMs>concurrentBudgetMs)fail('burst_budget_exceeded');
  return Object.freeze({
    schema:OWNER_BACKED_ACTIVATION_WAVE_SCHEMA,
    owner_backed_activation_wave_verified:true,
    sequential_activations:sequentialCount,concurrent_activations:concurrentCount,
    total_activations:acks.length,unique_nonce_count:launchIds.size,
    unique_durable_sequence_count:sequences.size,
    activation_p95_ms:Math.round(p95*100)/100,
    activation_p95_budget_ms:p95BudgetMs,
    concurrent_burst_ms:Math.round(burstMs*100)/100,
    concurrent_burst_budget_ms:concurrentBudgetMs,
    same_native_window_verified:true,
    authority_effect:false,production_ready:false
  });
}
