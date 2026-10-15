import path from 'node:path';
import { readClientBackupAclNativeW58 } from './client-backup-acl-native-w58.mjs';
import { createHostAgentServer } from './host-agent-ipc.mjs';
import { hostAgentProtocolManifest } from './host-agent-protocol.mjs';
import { readWindowsKernelProcessW60 } from './host-native-owner-producers-w60.mjs';

export const HOST_AGENT_RUNTIME_SCHEMA = 'metaengine.host-agent.runtime.v1';

function requireFunction(value, code) {
  if (typeof value !== 'function') throw new Error(code);
  return value;
}

function unwrapGatewayResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  return Object.hasOwn(value, 'result') ? value.result : value;
}

function bindBrowserBoundary({ browserClient, browserStatus, browserPlanExecute, browserPlanCancel }) {
  if (browserClient != null) {
    if (!browserClient || typeof browserClient.status !== 'function' || typeof browserClient.execute !== 'function' || typeof browserClient.cancel !== 'function') {
      throw new Error('host_agent_browser_client_invalid');
    }
    if (browserStatus || browserPlanExecute || browserPlanCancel) throw new Error('host_agent_browser_boundary_ambiguous');
    return Object.freeze({
      mode: 'EXTERNAL_TYPED_IPC',
      status: (payload) => browserClient.status(payload),
      execute: (payload) => browserClient.execute(payload),
      cancel: (payload) => browserClient.cancel(payload),
      snapshot: () => typeof browserClient.snapshot === 'function' ? browserClient.snapshot() : null,
    });
  }
  return Object.freeze({
    mode: 'IN_PROCESS_TYPED_CALLBACK',
    status: requireFunction(browserStatus, 'host_agent_browser_status_required'),
    execute: requireFunction(browserPlanExecute, 'host_agent_browser_plan_execute_required'),
    cancel: requireFunction(browserPlanCancel, 'host_agent_browser_plan_cancel_required'),
    snapshot: () => null,
  });
}

export class HostAgentRuntime {
  #server;
  #developmentPlane;
  #fastControl;
  #browserBoundary;
  #backupDirectory;
  #backupOwnerIncarnation;
  #trustedOwnerReadback;
  #guardianOwnerReadback;
  #startedAt = null;
  #requests = 0;
  #browserPlanRequests = 0;

  constructor({
    endpoint,
    sessionKey,
    developmentPlane,
    fastControl,
    browserClient = null,
    browserStatus = null,
    browserPlanExecute = null,
    browserPlanCancel = null,
    backupDirectory = null,
    readBackupOwnerIncarnation = null,
    readTrustedHostOwnerIncarnation = null,
    readGuardianOwnerChallenge = null,
    netModule,
  } = {}) {
    if (!developmentPlane || typeof developmentPlane.request !== 'function') throw new Error('host_agent_development_plane_required');
    if (!fastControl || typeof fastControl.invoke !== 'function') throw new Error('host_agent_fast_control_required');
    // Host-owned configured directory only. IPC must never select a filesystem path.
    this.#backupDirectory = backupDirectory;
    this.#backupOwnerIncarnation = readBackupOwnerIncarnation;
    if (readTrustedHostOwnerIncarnation !== null && typeof readTrustedHostOwnerIncarnation !== 'function')
      throw new Error('host_owner_custody_reader_invalid');
    if (readGuardianOwnerChallenge !== null && typeof readGuardianOwnerChallenge !== 'function')
      throw new Error('host_guardian_challenge_reader_invalid');
    this.#trustedOwnerReadback = readTrustedHostOwnerIncarnation;
    this.#guardianOwnerReadback = readGuardianOwnerChallenge;
    this.#developmentPlane = developmentPlane;
    this.#fastControl = fastControl;
    this.#browserBoundary = bindBrowserBoundary({ browserClient, browserStatus, browserPlanExecute, browserPlanCancel });

    const invokeFast = async (tool, payload) => {
      this.#requests += 1;
      return unwrapGatewayResponse(await this.#fastControl.invoke(tool, payload));
    };
    this.#server = createHostAgentServer({
      endpoint,
      sessionKey,
      ...(netModule ? { netModule } : {}),
      handlers: {
        PING: async () => {
          this.#requests += 1;
          return { pong: true, runtime: HOST_AGENT_RUNTIME_SCHEMA, authority_effect: false };
        },
        HOST_STATUS: async () => {
          this.#requests += 1;
          return this.snapshot();
        },
        BACKUP_ACL_READBACK: async (payload) => {
          this.#requests += 1;
          if (Object.keys(payload || {}).length) throw new Error('host_backup_acl_payload_forbidden');
          // Absence of a Host-pinned archive root remains UNKNOWN, not success.
          const root = this.#backupDirectory;
          return readClientBackupAclNativeW58({
            backupDirectory: root,
            archivePath: root ? path.win32.join(root,'postgresql-17-snapshot.dump') : null,
            readOwnerIncarnation: this.#backupOwnerIncarnation,
          });
        },
        // Existing session-HMAC pipe + nonce replay fence is the only wire.
        // No requested PID/path/credential: the Host samples ITS OWN kernel
        // birth, and never declares Owner-binding based on a running process.
        OWNER_NATIVE_READBACK: async (payload) => {
          this.#requests += 1;
          if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
              Object.keys(payload).length !== 0)
            throw new Error('host_owner_native_payload_denied');
          const kernel = await readWindowsKernelProcessW60(process.pid);
          // The Host cannot turn its own kernel PID or device enrollment into
          // an Owner. Both sources must exist: own-PG/private Host custody and
          // a *separate* signed native Guardian challenge with OS client birth.
          let owner = null;
          if (kernel && this.#trustedOwnerReadback && this.#guardianOwnerReadback) {
            try {
              const first = await this.#trustedOwnerReadback();
              const guardian = await this.#guardianOwnerReadback();
              const last = await this.#trustedOwnerReadback();
              const equal = ['owner_id','project_id','device_id','pid','created_at',
                'process_incarnation_id','generation','epoch','source_sha']
                .every(k => first?.[k] === last?.[k]);
              if (first?.schema === 'metaengine.host.owner-incarnation.v1' &&
                  first.source === 'LOCAL_HOST_OWNER' && first.authority_effect === false &&
                  first.fixture_classification == null && first.staging !== true &&
                  first.synthetic !== true && first.untrusted !== true && equal &&
                  first.pid === kernel.pid &&
                  Date.parse(first.created_at) === Date.parse(kernel.created_at) &&
                  Number.isSafeInteger(first.epoch) && first.epoch > 0 &&
                  Number.isSafeInteger(first.generation) && first.generation > 0 &&
                  /^[0-9a-f]{40}$/i.test(first.source_sha || '') &&
                  /^[A-Za-z0-9_.:-]{1,128}$/.test(first.project_id || '') &&
                  /^[A-Za-z0-9_.:-]{8,128}$/.test(first.process_incarnation_id || '') &&
                  guardian?.schema === 'metaengine.browser-guardian.machine-bootstrap-launcher.v1' &&
                  guardian.fixture_classification == null && guardian.staging !== true &&
                  guardian.synthetic !== true && guardian.untrusted !== true &&
                  guardian.authority_effect === false && guardian.state === 'READY' && guardian.owner_binding_proven === true &&
                  guardian.device_binding_proven === true &&
                  guardian.guardian_client_kernel_birth_verified === true &&
                  guardian.guardian_client_pid === kernel.pid &&
                  Date.parse(guardian.guardian_client_created_at) === Date.parse(kernel.created_at) &&
                  /^[0-9a-f]{64}$/i.test(guardian.guardian_enrollment_evidence_sha256 || '') &&
                  /^[0-9a-f]{64}$/i.test(guardian.guardian_device_key_fingerprint_sha256 || '') &&
                  first.device_key_fingerprint_sha256 === guardian.guardian_device_key_fingerprint_sha256 &&
                  first.owner_id === last.owner_id && first.device_id === last.device_id &&
                  first.project_id === last.project_id &&
                  /^[A-Za-z0-9_.:-]{1,128}$/.test(first.owner_id || '') &&
                  /^[A-Za-z0-9_.:-]{1,128}$/.test(first.device_id || '') &&
                  Number.isFinite(Date.parse(first.observed_at)) &&
                  Date.parse(first.observed_at) >= Date.now() - 30000 &&
                  Date.parse(first.observed_at) <= Date.now() + 5000 &&
                  Date.parse(last.observed_at) >= Date.now() - 30000 &&
                  Date.parse(last.observed_at) <= Date.now() + 5000) {
                owner = Object.freeze({ ...last });
              }
            } catch { /* missing owner/custody/Guardian remains UNKNOWN */ }
          }
          return Object.freeze({
            schema: 'metaengine.host.owner-native-readback.w60.v1',
            state: kernel ? 'KERNEL_PROCESS_OBSERVED' : 'UNKNOWN',
            kernel: kernel ? Object.freeze({pid:kernel.pid,
              created_at:kernel.created_at,observed_at:kernel.observed_at,
              source:'OS_PROCESS_INVENTORY',authority_effect:false}) : null,
            owner_binding_proven: owner !== null,
            owner,
            signed_installed_exe_proven: false,
            credential_exposed: false,
            authority_effect: false,
          });
        },
        SOURCE_STATUS: async () => {
          this.#requests += 1;
          return this.#developmentPlane.request('REPO_HEAD_READ');
        },
        DEV_QUERY: (payload) => invokeFast('dev_query', payload),
        CONTROL_CONTEXT_GET: (payload) => invokeFast('context_get', payload),
        CONTROL_RUN_SUBMIT: (payload) => invokeFast('run_submit', payload),
        CONTROL_RUN_STATUS: (payload) => invokeFast('run_status', payload),
        CONTROL_EMERGENCY_STOP: (payload) => invokeFast('emergency_stop', payload),
        BROWSER_STATUS: async (payload) => {
          this.#requests += 1;
          return this.#browserBoundary.status(payload);
        },
        BROWSER_PLAN_EXECUTE: async (payload) => {
          this.#requests += 1;
          this.#browserPlanRequests += 1;
          return this.#browserBoundary.execute(payload);
        },
        BROWSER_PLAN_CANCEL: async (payload) => {
          this.#requests += 1;
          this.#browserPlanRequests += 1;
          return this.#browserBoundary.cancel(payload);
        },
      },
    });
  }

  async start() {
    await this.#server.start();
    this.#startedAt ||= new Date().toISOString();
    return this.snapshot();
  }

  async close() {
    await this.#server.close();
    this.#startedAt = null;
    return this.snapshot();
  }

  snapshot() {
    return Object.freeze({
      schema: HOST_AGENT_RUNTIME_SCHEMA,
      state: this.#startedAt ? 'READY' : 'STOPPED',
      started_at: this.#startedAt,
      requests: this.#requests,
      browser_plan_requests: this.#browserPlanRequests,
      ipc: this.#server.snapshot(),
      protocol: hostAgentProtocolManifest(),
      development_plane: typeof this.#developmentPlane.snapshot === 'function' ? this.#developmentPlane.snapshot() : null,
      fast_control: typeof this.#fastControl.snapshot === 'function' ? this.#fastControl.snapshot() : null,
      transport_role: 'CONTROL_COORDINATOR',
      browser_role: 'TYPED_EXECUTOR_ONLY',
      browser_boundary_mode: this.#browserBoundary.mode,
      browser_executor_transport: this.#browserBoundary.snapshot(),
      chat_dom_scheduler: false,
      raw_shell: false,
      raw_cdp_passthrough: false,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
