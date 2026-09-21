import { createDevosPromotionRoutes as createCoreDevosPromotionRoutes } from './devos-promotion-routes-core.mjs';
import { createNativeSupervisorHeartbeatRoute } from './heartbeat-routes.mjs';
import { createWorkspaceObservationRoutes } from './workspace-observation-routes.mjs';

// Compatibility composition point: the proven transport-promotion implementation
// remains byte-identical in devos-promotion-routes-core.mjs. Typed Workspaces and
// heartbeat add only device-authenticated, read-only routes and no scheduler/lease path.
export function createDevosPromotionRoutes(options={}){
  const heartbeat=createNativeSupervisorHeartbeatRoute(options);
  const workspace=createWorkspaceObservationRoutes(options);
  const promotion=createCoreDevosPromotionRoutes(options);
  return async(context={})=>{
    const pulse=await heartbeat(context);
    if(pulse)return pulse;
    const observed=await workspace(context);
    if(observed)return observed;
    return promotion(context);
  };
}