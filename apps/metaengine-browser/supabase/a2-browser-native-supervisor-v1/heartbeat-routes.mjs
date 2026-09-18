import { readDevosRuntimeControl } from './devos-routes.mjs';

const json=(status,body)=>new Response(JSON.stringify(body),{
  status,
  headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store'},
});

export function createNativeSupervisorHeartbeatRoute({rpc,workspaceId}={}){
  return async function nativeSupervisorHeartbeatRoute(context={}){
    if(context?.req?.method!=='POST'||context?.path!=='/v1/heartbeat')return null;
    const runtime_control=await readDevosRuntimeControl({rpc,workspaceId});
    return json(202,{
      accepted:true,
      runtime_control,
      ts:new Date().toISOString(),
      automatic_retry_allowed:false,
      authority_effect:false,
    });
  };
}
