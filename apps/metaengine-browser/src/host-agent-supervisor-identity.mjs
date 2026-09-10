import {
  SupervisorIdentitySignerClient,
  supervisorIdentitySignerEndpoint,
} from './supervisor-identity-delegation-ipc.mjs';

export const HOST_AGENT_SUPERVISOR_IDENTITY_SCHEMA = 'metaengine.host-agent-supervisor-identity.v1';

export function createHostAgentSupervisorIdentity({
  userDataPath,
  sessionKey,
  endpoint = null,
  netModule = undefined,
} = {}) {
  if (!String(userDataPath || '')) throw new Error('host_agent_supervisor_identity_user_data_path_required');
  if (!String(sessionKey || '')) throw new Error('host_agent_supervisor_identity_session_key_required');
  const resolvedEndpoint = endpoint || supervisorIdentitySignerEndpoint({ userDataPath });
  const client = new SupervisorIdentitySignerClient({
    endpoint: resolvedEndpoint,
    sessionKey,
    ...(netModule ? { netModule } : {}),
  });
  const identity = client.delegatedIdentity();

  return Object.freeze({
    identity,
    async connect() {
      await client.connect();
      await identity.ensure();
      return this.snapshot();
    },
    close() {
      client.close();
    },
    snapshot() {
      const identitySnapshot = identity.snapshot();
      const transport = client.snapshot();
      return Object.freeze({
        schema: HOST_AGENT_SUPERVISOR_IDENTITY_SCHEMA,
        connected: transport.connected === true,
        device_id_present: Boolean(identitySnapshot?.device_id),
        identity_cached: Boolean(identitySnapshot),
        signer_transport: structuredClone(transport),
        endpoint_exposed: false,
        session_key_exposed: false,
        private_key_material: false,
        enrollment_authority: false,
        browser_control_authority: false,
        authority_effect: false,
      });
    },
  });
}
