import {createRuntimeRecoveryTransaction} from './runtime-recovery-transaction.mjs';
import {evaluateRuntimeRecoveryEligibility} from './runtime-recovery-policy.mjs';

const PREFIX='--metaengine-runtime-recovery=';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export function runtimeRecoverySuccessorTicket(argv=process.argv) {
  const values=argv.filter(value=>String(value).startsWith(PREFIX));
  if(!values.length)return null;
  if(values.length!==1||!UUID.test(values[0].slice(PREFIX.length)))throw Error('runtime_recovery_successor_selector_invalid');
  return values[0].slice(PREFIX.length);
}

// Native main composition; this object is never exposed through renderer IPC.
// The transaction alone owns relaunch authority and its durable intent barrier.
export function createRuntimeRecoveryMainController({app,subscribeGeneration,readGeneration,readBinding,readGate,
  drain,fenceNative,beforeRelaunch,argv=process.argv,onReadback=()=>{},
  transactionFactory=createRuntimeRecoveryTransaction,setTimer=setTimeout,clearTimer=clearTimeout,now=Date.now}={}) {
  if([subscribeGeneration,readGeneration,readBinding,readGate,drain,fenceNative,beforeRelaunch,onReadback].some(fn=>typeof fn!=='function'))
    throw Error('runtime_recovery_main_dependencies_required');
  const transaction=transactionFactory({app,readGeneration,readBinding,readGate,drain,beforeRelaunch});
  let started=false,closed=false,unsubscribe=null,timer=null,pending=Promise.resolve(),armedNonce=null,attemptedNonce=null;
  let successorTicket=runtimeRecoverySuccessorTicket(argv),last=null;
  const publish=value=>{last=value;try{onReadback(value);}catch{}return value;};
  const hold=error=>publish({schema:'metaengine.browser.runtime-recovery-main.v1',state:'HOLD',
    reason:/^runtime_recovery_[a-z_]{1,100}$/.test(error?.message||'')?error.message:'runtime_recovery_native_observation_unproven',
    automatic_retry_allowed:false,authority_effect:false});
  function queue(fn){const next=pending.then(fn);pending=next.catch(hold);return next;}
  async function observe() {
    if(closed)return;
    const generation=await readGeneration();
    if(!generation)return;
    if(generation.ever_ready===true&&generation.exited===false&&generation.stopping===false
      &&generation.transport_failed===false&&generation.terminal===null&&generation.terminal_rejected===false) {
      if(successorTicket) {
        const ticket=successorTicket;successorTicket=null;
        publish(await transaction.acknowledgeSuccessor(ticket));
      }
      if(armedNonce!==generation.launch_nonce){publish(await transaction.arm());armedNonce=generation.launch_nonce;}
      return;
    }
    if(evaluateRuntimeRecoveryEligibility(generation).eligible!==true||attemptedNonce===generation.launch_nonce)return;
    attemptedNonce=generation.launch_nonce;
    const prepared=publish(await transaction.prepare());
    if(closed||prepared.state!=='PREPARED'||prepared.reason)return;
    timer=setTimer(()=>{
      timer=null;if(closed)return;
      void queue(async()=>publish(await transaction.dispatch(prepared.ticket_id))).catch(()=>{});
    },Math.max(0,prepared.not_before_ms-now()));
    timer?.unref?.();
  }
  return Object.freeze({
    start:()=>{
      if(started||closed)return pending;started=true;
      unsubscribe=subscribeGeneration(generation=>{
        if(closed)return;
        // Stop new command issuance synchronously at physical generation loss,
        // before awaiting private status reads or runner-tree cleanup.
        if(generation?.ever_ready&&(generation.exited||generation.stopping||generation.transport_failed||generation.terminal||generation.terminal_rejected)) {
          try{fenceNative();}catch(error){closed=true;transaction.cancel();hold(error);return;}
        }
        void queue(observe).catch(()=>{});
      });
      return queue(observe);
    },
    cancel:()=>{closed=true;transaction.cancel();if(timer)clearTimer(timer);timer=null;unsubscribe?.();unsubscribe=null;},
    snapshot:()=>last,
    settled:()=>pending,
  });
}
