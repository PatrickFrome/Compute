// GENERATED UNIT FIXTURE ONLY. This adapter does not create attempt/HEADER
// files, attest native custody, reserve SQL or confer production readiness.
// Production must use the real runner's prepared lifecycle, never this adapter.
export function preparedRunnerTestAdapter(implementation,{runId,onPrepare=null,onFence=null,prior=false}={}) {
 const handles=new WeakMap();
 const owned=handle=>{const row=handles.get(handle);if(!row)throw Error('fixture_prepared_handle_invalid');return row;};
 return Object.freeze({
  async prepare(request,options={}) {
   const copied=structuredClone(request);await onPrepare?.(copied,options);
   const handle=Object.freeze({toJSON(){throw Error('fixture_prepared_handle_not_serializable');}});
   const descriptor=Object.freeze({schema:'metaengine.codex-cli.prepared-run.v1',state:prior?'READBACK_ONLY':'PREPARED',runId,
    binding:Object.freeze({...copied.lease,role:copied.role}),worktreePath:copied.worktreePath,
    expiresAt:new Date(Date.now()+3600000).toISOString(),sql_reservation:'NOT_ATTESTED',authority_effect:false,
    automatic_retry_allowed:false,production_qualified:false});
   handles.set(handle,{request:copied,options,descriptor,state:'PREPARED'});return handle;
  },
  describePrepared(handle){return owned(handle).descriptor;},
  async runPrepared(handle){const row=owned(handle);if(row.state!=='PREPARED')throw Error('fixture_prepared_handle_consumed');
   row.state='CONSUMED';return implementation.run(row.request,row.options);},
  abandonPrepared(handle){const row=owned(handle);row.state='FENCED';onFence?.();return Object.freeze({state:'FENCED',physical_settlement:'NOT_ATTESTED'});},
 });
}
