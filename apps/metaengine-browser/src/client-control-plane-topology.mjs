// Local authority boundary for the Windows-owned METAENGINE client.
// A GitHub PR, CI result or release proves source/provenance, NEVER the
// authority to operate a user's desktop, issue a lease, or mutate local PGDATA.
// Those privileges belong to the locally attested PostgreSQL/API/Host Agent.
export const CONTROL_PLANE_TOPOLOGY = Object.freeze({
  schema:'metaengine.client-control-plane-topology.v1',
  source_and_release:'GITHUB_GITOPS',
  task_and_lease_authority:'LOCAL_POSTGRES_API',
  machine_effect_authority:'LOCAL_HOST_AGENT_DB_LEASE_AND_OWNER_GRANT',
  hosted_supabase_required:false,
  automatic_cloud_fallback:false,
  github_is_execution_authority:false,
  github_is_secret_store:false,
});

export function requireLocalOnlySupervisorBase(raw) {
  let parsed;
  try { parsed=new URL(String(raw||'')); }
  catch { throw new Error('client_control_local_supervisor_required'); }
  const port=Number(parsed.port);
  if(parsed.protocol!=='http:' || parsed.hostname!=='127.0.0.1'
    || !Number.isSafeInteger(port) || port<1024 || port>65535
    || parsed.username || parsed.password || parsed.search || parsed.hash
    || parsed.pathname.replace(/\/+$/,'')!=='/a2-browser-native-supervisor-v1')
    throw new Error('client_control_local_supervisor_required');
  return parsed.origin+'/a2-browser-native-supervisor-v1';
}

export function authorizeClientControlPlaneRequest({
  source, operation, localProviderReady=false, deviceBound=false, dbLeaseAttested=false,
  ownerScopeGranted=false, targetIdentityAttested=false,
}={}) {
  const allowedSource=source==='LOCAL_POSTGRES_API';
  const allowedOperation=['READ_STATUS','SUBMIT_GOAL','EXECUTE_DEVICE_EFFECT'].includes(operation);
  if(!allowedSource || !allowedOperation || localProviderReady!==true)
    return Object.freeze({admitted:false,reason:'LOCAL_POSTGRES_AUTHORITY_REQUIRED',authority_effect:false});
  if(operation==='READ_STATUS') return Object.freeze({admitted:true,reason:null,authority_effect:false});
  if(deviceBound!==true || ownerScopeGranted!==true)
    return Object.freeze({admitted:false,reason:'OWNER_DEVICE_SCOPE_REQUIRED',authority_effect:false});
  if(operation==='EXECUTE_DEVICE_EFFECT' && (dbLeaseAttested!==true || targetIdentityAttested!==true))
    return Object.freeze({admitted:false,reason:'LEASE_AND_TARGET_IDENTITY_REQUIRED',authority_effect:false});
  return Object.freeze({admitted:true,reason:null,authority_effect:false});
}
