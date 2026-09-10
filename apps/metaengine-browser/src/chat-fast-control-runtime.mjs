import { ChatDevelopmentControlState } from './chat-development-control-state.mjs';
import { ChatDevelopmentQueryProvider } from './chat-development-query-provider.mjs';
import { FastControlGatewayCore } from './fast-control-gateway-core.mjs';
import { createFastControlMcpAdapter } from './fast-control-mcp-adapter.mjs';

export const CHAT_FAST_CONTROL_RUNTIME_SCHEMA = 'metaengine.chat-fast-control-runtime.v1';

export class ChatFastControlRuntime {
  #controlState;
  #queryProvider;
  #gateway;
  #mcp;
  #getBrowserState;
  #browserStateReads = 0;

  constructor({
    developmentPlane,
    controlState = new ChatDevelopmentControlState(),
    getBrowserState,
    issueBatch,
    resultDelta,
    issueEmergency,
  } = {}) {
    if (!developmentPlane || typeof developmentPlane.request !== 'function') throw new Error('chat_fast_control_development_plane_required');
    if (!controlState || typeof controlState.query !== 'function' || typeof controlState.fastContext !== 'function') throw new Error('chat_fast_control_state_required');
    if (typeof getBrowserState !== 'function') throw new Error('chat_fast_control_browser_state_required');
    if (typeof issueBatch !== 'function') throw new Error('chat_fast_control_issue_batch_required');
    if (typeof resultDelta !== 'function') throw new Error('chat_fast_control_result_delta_required');
    if (typeof issueEmergency !== 'function') throw new Error('chat_fast_control_issue_emergency_required');
    this.#controlState = controlState;
    this.#getBrowserState = getBrowserState;
    this.#queryProvider = new ChatDevelopmentQueryProvider({ developmentPlane, evidenceIndex: controlState });
    this.#gateway = new FastControlGatewayCore({
      contextGet: async (input) => {
        this.#browserStateReads += 1;
        const state = await this.#getBrowserState();
        return this.#controlState.fastContext({ state, ...input });
      },
      devQuery: (input) => this.#queryProvider.query(input),
      issueBatch,
      resultDelta,
      issueEmergency,
    });
    this.#mcp = createFastControlMcpAdapter(this.#gateway);
  }

  setSource(source, now) { return this.#controlState.setSource(source, now); }
  setCapabilityRevision(revision, now) { return this.#controlState.setCapabilityRevision(revision, now); }
  setRepoIndexRevision(revision, options) { return this.#controlState.setRepoIndexRevision(revision, options); }
  upsertCi(row, now) { return this.#controlState.upsertCi(row, now); }
  upsertEvidence(row, now) { return this.#controlState.upsertEvidence(row, now); }
  removeEvidence(id, now) { return this.#controlState.removeEvidence(id, now); }

  listTools() { return this.#mcp.listTools(); }
  callTool(name, input) { return this.#mcp.callTool(name, input); }
  invoke(name, input) { return this.#gateway.invoke(name, input); }

  snapshot() {
    return Object.freeze({
      schema: CHAT_FAST_CONTROL_RUNTIME_SCHEMA,
      control_state: this.#controlState.snapshot(),
      query_provider: this.#queryProvider.snapshot(),
      tools: this.#gateway.manifest().tools.map((row) => row.name),
      browser_state_reads: this.#browserStateReads,
      periodic_source_discovery: false,
      periodic_ci_discovery: false,
      second_scheduler: false,
      command_leasing_authority: false,
      browser_execution_authority: false,
      authority_effect: false,
    });
  }
}
