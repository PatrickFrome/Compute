export const ADAPTIVE_ROUTER_VERSION='1.1.0';
const ID_RE=/^[a-z0-9][a-z0-9._:-]{2,127}$/;
const CAP_RE=/^[A-Z][A-Z0-9_]{1,63}$/;
const ENUM_RE=/^[A-Z][A-Z0-9_]{1,63}$/;
const SURFACES=new Set(['EXTENSION_COMPAT','COMPUTE_BROWSER_PRIMARY','REMOTE_BROWSER_POOL']);
const HEALTH=new Set(['HEALTHY','DRAINING','UNHEALTHY']);
const TRUST=new Set(['COMPAT_USER_SESSION','TRUSTED_LOCAL','ATTESTED_REMOTE']);
const SESSIONS=new Set(['USER_EXISTING','A2_DEDICATED','REMOTE_ISOLATED']);
const cmpString=(a,b)=>a<b?-1:a>b?1:0;

export class AdaptiveRouterError extends Error{constructor(code){super(code);this.name='AdaptiveRouterError';this.code=code;}}
function token(v,re,code){if(typeof v!=='string'||!re.test(v))throw new AdaptiveRouterError(code);return v;}
function integer(v,min,max,code){if(!Number.isInteger(v)||v<min||v>max)throw new AdaptiveRouterError(code);return v;}
function bool(v,code){if(typeof v!=='boolean')throw new AdaptiveRouterError(code);return v;}
function list(v,set,code,max=16){if(!Array.isArray(v)||!v.length||v.length>max)throw new AdaptiveRouterError(code);const out=v.map(x=>token(x,ENUM_RE,code));if(new Set(out).size!==out.length||out.some(x=>set&&!set.has(x)))throw new AdaptiveRouterError(code);return Object.freeze(out);}
function caps(v,code){if(!Array.isArray(v)||v.length>64)throw new AdaptiveRouterError(code);const out=v.map(x=>token(x,CAP_RE,code)).sort(cmpString);if(new Set(out).size!==out.length)throw new AdaptiveRouterError(code);return Object.freeze(out);}
function exact(v,keys,code){if(!v||typeof v!=='object'||Array.isArray(v))throw new AdaptiveRouterError(code);const a=Object.keys(v).sort(cmpString),b=[...keys].sort(cmpString);if(a.length!==b.length||a.some((k,i)=>k!==b[i]))throw new AdaptiveRouterError(code);}
function freeze(v){if(v&&typeof v==='object'&&!Object.isFrozen(v)){Object.freeze(v);for(const x of Object.values(v))freeze(x);}return v;}

function normalizeExecutor(v){
 exact(v,['executor_id','executor_incarnation_id','surface','health','trust_class','session_class','capabilities','raw_engine_exposed','locality','region','active_leases','max_leases','observed_latency_ms'],'router_executor_fields_invalid');
 const surface=token(v.surface,ENUM_RE,'router_surface_invalid');if(!SURFACES.has(surface))throw new AdaptiveRouterError('router_surface_invalid');
 const health=token(v.health,ENUM_RE,'router_health_invalid');if(!HEALTH.has(health))throw new AdaptiveRouterError('router_health_invalid');
 const trust=token(v.trust_class,ENUM_RE,'router_trust_invalid');if(!TRUST.has(trust))throw new AdaptiveRouterError('router_trust_invalid');
 const session=token(v.session_class,ENUM_RE,'router_session_invalid');if(!SESSIONS.has(session))throw new AdaptiveRouterError('router_session_invalid');
 const locality=token(v.locality,/^(LOCAL|REMOTE)$/,'router_locality_invalid');
 return freeze({executor_id:token(v.executor_id,ID_RE,'router_executor_id_invalid'),executor_incarnation_id:token(v.executor_incarnation_id,ID_RE,'router_incarnation_invalid'),surface,health,trust_class:trust,session_class:session,capabilities:caps(v.capabilities,'router_capabilities_invalid'),raw_engine_exposed:bool(v.raw_engine_exposed,'router_raw_engine_invalid'),locality,region:token(v.region,/^[a-z0-9][a-z0-9.-]{1,63}$/,'router_region_invalid'),active_leases:integer(v.active_leases,0,1000000,'router_active_leases_invalid'),max_leases:integer(v.max_leases,1,1000000,'router_max_leases_invalid'),observed_latency_ms:integer(v.observed_latency_ms,0,3600000,'router_latency_invalid')});
}
function normalizeRequest(v){
 exact(v,['action_id','resource_id','effect_state','required_capabilities','allowed_surfaces','allowed_trust_classes','allowed_session_classes','local_required','prefer_local','preferred_region','sticky_executor_id'],'router_request_fields_invalid');
 if(v.effect_state!=='PRE_EFFECT')throw new AdaptiveRouterError('router_post_effect_routing_forbidden');
 return freeze({action_id:token(v.action_id,ID_RE,'router_action_id_invalid'),resource_id:token(v.resource_id,ID_RE,'router_resource_id_invalid'),effect_state:'PRE_EFFECT',required_capabilities:caps(v.required_capabilities,'router_required_capabilities_invalid'),allowed_surfaces:list(v.allowed_surfaces,SURFACES,'router_allowed_surfaces_invalid'),allowed_trust_classes:list(v.allowed_trust_classes,TRUST,'router_allowed_trust_invalid'),allowed_session_classes:list(v.allowed_session_classes,SESSIONS,'router_allowed_session_invalid'),local_required:bool(v.local_required,'router_local_required_invalid'),prefer_local:bool(v.prefer_local,'router_prefer_local_invalid'),preferred_region:v.preferred_region==null?null:token(v.preferred_region,/^[a-z0-9][a-z0-9.-]{1,63}$/,'router_preferred_region_invalid'),sticky_executor_id:v.sticky_executor_id==null?null:token(v.sticky_executor_id,ID_RE,'router_sticky_invalid')});
}
function surfaceRank(preference,surface){const i=preference.indexOf(surface);return i<0?999:i;}
function compareEligible(req,surfacePreference,a,b){
 const aSticky=req.sticky_executor_id===a.executor_id?0:1,bSticky=req.sticky_executor_id===b.executor_id?0:1;if(aSticky!==bSticky)return aSticky-bSticky;
 const as=surfaceRank(surfacePreference,a.surface),bs=surfaceRank(surfacePreference,b.surface);if(as!==bs)return as-bs;
 const al=req.prefer_local?(a.locality==='LOCAL'?0:1):0,bl=req.prefer_local?(b.locality==='LOCAL'?0:1):0;if(al!==bl)return al-bl;
 const ar=req.preferred_region?(a.region===req.preferred_region?0:1):0,br=req.preferred_region?(b.region===req.preferred_region?0:1):0;if(ar!==br)return ar-br;
 const loadLeft=a.active_leases*b.max_leases,loadRight=b.active_leases*a.max_leases;if(loadLeft!==loadRight)return loadLeft-loadRight;
 if(a.observed_latency_ms!==b.observed_latency_ms)return a.observed_latency_ms-b.observed_latency_ms;
 return cmpString(a.executor_id,b.executor_id);
}
function rejectionReason(req,e){
 if(e.health==='DRAINING')return 'DRAINING';
 if(e.health!=='HEALTHY')return 'HEALTH';
 if(e.raw_engine_exposed)return 'RAW_ENGINE_EXPOSED';
 if(e.active_leases>=e.max_leases)return 'CAPACITY';
 if(!req.allowed_surfaces.includes(e.surface))return 'SURFACE';
 if(!req.allowed_trust_classes.includes(e.trust_class))return 'TRUST';
 if(!req.allowed_session_classes.includes(e.session_class))return 'SESSION';
 if(req.local_required&&e.locality!=='LOCAL')return 'LOCALITY';
 if(!req.required_capabilities.every(c=>e.capabilities.includes(c)))return 'CAPABILITY';
 return null;
}

export function routeAdaptiveV1({request,executors,policy}={}){
 const req=normalizeRequest(request);
 exact(policy,['policy_id','surface_preference'],'router_policy_fields_invalid');
 const policyId=token(policy.policy_id,ID_RE,'router_policy_id_invalid');
 const surfacePreference=list(policy.surface_preference,SURFACES,'router_surface_preference_invalid');
 if(!Array.isArray(executors)||!executors.length||executors.length>4096)throw new AdaptiveRouterError('router_executors_invalid');
 const rows=executors.map(normalizeExecutor);const ids=new Set();for(const e of rows){if(ids.has(e.executor_id))throw new AdaptiveRouterError('router_executor_duplicate');ids.add(e.executor_id);}
 const rejected=[],eligible=[];
 for(const e of rows){const reason=rejectionReason(req,e);if(reason)rejected.push(freeze({executor_id:e.executor_id,reason}));else eligible.push(e);}
 rejected.sort((a,b)=>cmpString(a.executor_id,b.executor_id)||cmpString(a.reason,b.reason));
 if(!eligible.length)throw new AdaptiveRouterError('router_no_eligible_executor');
 eligible.sort((a,b)=>compareEligible(req,surfacePreference,a,b));
 const chosen=eligible[0];
 return freeze({version:ADAPTIVE_ROUTER_VERSION,policy_id:policyId,action_id:req.action_id,resource_id:req.resource_id,executor_id:chosen.executor_id,executor_incarnation_id:chosen.executor_incarnation_id,surface:chosen.surface,trust_class:chosen.trust_class,session_class:chosen.session_class,locality:chosen.locality,region:chosen.region,rejected,eligible_executor_ids:eligible.map(e=>e.executor_id),selection_reason:req.sticky_executor_id===chosen.executor_id?'STICKY_ELIGIBLE':'FILTER_THEN_SCORE',score_inputs:Object.freeze({surface_rank:surfaceRank(surfacePreference,chosen.surface),local_preference:req.prefer_local,region_preference:req.preferred_region,active_leases:chosen.active_leases,max_leases:chosen.max_leases,observed_latency_ms:chosen.observed_latency_ms}),safety_filter_complete:true,fresh_authority_required:true,lease_required:true,automatic_retry_allowed:false,authority_effect:false,actuation_eligible:false});
}
