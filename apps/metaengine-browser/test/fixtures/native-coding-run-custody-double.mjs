// Generated lifecycle double ONLY; never a journal/settlement/proof producer.
// Real IPC/journal coupling is exercised separately by actual fork tests.
export function generatedRunCustodyDouble(agentOperation){
 return {async openAgentRunCustody(){
  let fenced=false,joined=null;const pending=new Set();
  return {agentOperation:value=>{if(fenced)throw Error('fixture_custody_fenced');return agentOperation(value);},
   trackCallback:operation=>{const work=Promise.resolve().then(operation);pending.add(work);work.then(()=>pending.delete(work),()=>pending.delete(work));return work;},
   fence:async()=>{fenced=true;},finish(){if(!joined)joined=(async()=>{fenced=true;while(pending.size)await Promise.allSettled([...pending]);
    return {state:'HOLD',lineage:'LINEAGE_UNBOUND',all_effects_cleanup:'UNCONFIRMED',fixture_only:true};})();return joined;}};
 }};
}
