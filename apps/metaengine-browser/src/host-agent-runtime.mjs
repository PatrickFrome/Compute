import { createHostAgentServer } from './host-agent-ipc.mjs';
import { hostAgentProtocolManifest } from './host-agent-protocol.mjs';

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
    netModule,
  } = {}) {
    if (!developmentPlane || typeof developmentPlane.request !== 'function') throw new Error('host_agent_development_plane_required');
    if (!fastControl || typeof fastControl.invoke !== 'function') throw new Error('host_agent_fast_control_required');
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
