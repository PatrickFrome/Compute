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
      // Establish the Browser-owned signer transport immediately, but do not make
      // Supervisor enrollment a startup dependency. DelegatedSupervisorIdentity
      // remains strict: its first signed remote request calls ensure() and fails
      // closed until the proven Browser identity has a valid device_id.
      await client.connect();
      return this.snapshot();
    },
    close() {
      client.close();
    },
    snapshot() {
      const identitySnapshot = identity.snapshot();
      const transport = client.snapshot();
      const connected = transport.connected === true;
      const enrolled = Boolean(identitySnapshot?.device_id);
      return Object.freeze({
        schema: HOST_AGENT_SUPERVISOR_IDENTITY_SCHEMA,
        state: !connected ? 'DISCONNECTED' : (enrolled ? 'ENROLLED' : 'WAITING_FOR_ENROLLMENT'),
        connected,
        device_id_present: enrolled,
        identity_cached: Boolean(identitySnapshot),
        remote_signing_ready: enrolled,
        signer_transport: structuredClone(transport),
        startup_requires_enrollment: false,
        remote_requests_require_enrollment: true,
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
