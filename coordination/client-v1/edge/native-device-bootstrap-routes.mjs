// Only the authenticated identity supplies the device. Caller payloads cannot
// select the coordinator or override the exact client/agent/tab/target binding.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const refuse = (status, error) => new Response(JSON.stringify({error, automatic_retry_allowed:false, authority_effect:false}),
  {status, headers:{'content-type':'application/json','cache-control':'no-store'}});

export function createNativeDeviceBootstrapRoutes({rpc,workspaceId,clientId,createPromotionRoutes}={}) {
  if(typeof rpc!=='function'||typeof createPromotionRoutes!=='function'||!UUID.test(String(workspaceId||''))) {
    throw new Error('native_bootstrap_route_dependencies_invalid');
  }
  return async function nativeBootstrap(context={}) {
    if(context.path!=='/v1/devos/promotion-lease') return null;
    if(clientId!=null&&context.clientId!==clientId) return null;
    if(context.identity?.ok!==true||context.identity.id!==context.clientId
      ||!UUID.test(String(context.identity.device_id||''))) return refuse(401,'native_bootstrap_verified_device_required');
    const route=createPromotionRoutes({workspaceId,rpc:(name,args)=>{
      if(name!=='devos_fleet_transport_promotion_lease_v1') throw new Error('native_bootstrap_route_rpc_forbidden');
      return rpc('devos_fleet_transport_promotion_lease_v2',{...args,p_device:context.identity.device_id});
    }});
    try { return await route(context); }
    catch(error) {
      if(/^native_bootstrap_/.test(String(error?.message||''))) return refuse(409,String(error.message).slice(0,200));
      throw error;
    }
  };
}
