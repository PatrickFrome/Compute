import { createDevosPromotionRoutes as createCoreDevosPromotionRoutes } from './devos-promotion-routes-core.mjs';
import { createWorkspaceObservationRoutes } from './workspace-observation-routes.mjs';

// Compatibility composition point: the proven transport-promotion implementation
// remains byte-identical in devos-promotion-routes-core.mjs. Typed Workspaces adds
// only a device-authenticated, read-only observation route and no scheduler/lease path.
export function createDevosPromotionRoutes(options={}){
  const workspace=createWorkspaceObservationRoutes(options);
  const promotion=createCoreDevosPromotionRoutes(options);
  return async(context={})=>{
    const observed=await workspace(context);
    if(observed)return observed;
    return promotion(context);
  };
}
