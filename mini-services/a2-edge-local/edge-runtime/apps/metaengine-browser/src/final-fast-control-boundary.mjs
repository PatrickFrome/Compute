import { ChatFastControlRuntime } from './chat-fast-control-runtime.mjs';

export const FINAL_FAST_CONTROL_BOUNDARY_SCHEMA = 'metaengine.final-fast-control-boundary.v1';
export const FINAL_FAST_CONTROL_READ_TOOLS = Object.freeze(['context_get', 'dev_query']);
export const FINAL_FAST_CONTROL_BLOCKED_TOOLS = Object.freeze(['run_submit', 'run_status', 'emergency_stop']);

const READ_TOOLS = new Set(FINAL_FAST_CONTROL_READ_TOOLS);
const BLOCKED_TOOLS = new Set(FINAL_FAST_CONTROL_BLOCKED_TOOLS);

function authorityNotPromoted(tool) {
  const error = new Error(`fast_control_authority_not_promoted:${tool}`);
  error.code = 'FAST_CONTROL_AUTHORITY_NOT_PROMOTED';
  return error;
}

export class FinalFastControlBoundary {
  #runtime;

  constructor({ developmentPlane, getBrowserState, controlState } = {}) {
    this.#runtime = new ChatFastControlRuntime({
      developmentPlane,
      ...(controlState ? { controlState } : {}),
      getBrowserState,
      issueBatch: async () => { throw authorityNotPromoted('run_submit'); },
      resultDelta: async () => { throw authorityNotPromoted('run_status'); },
      issueEmergency: async () => { throw authorityNotPromoted('emergency_stop'); },
    });
  }

  #assertToolAvailable(name) {
    const tool = String(name || '').trim();
    if (READ_TOOLS.has(tool)) return tool;
    if (BLOCKED_TOOLS.has(tool)) throw authorityNotPromoted(tool);
    throw new Error(`final_fast_control_tool_denied:${tool || 'EMPTY'}`);
  }

  invoke(name, input = {}) {
    const tool = this.#assertToolAvailable(name);
    return this.#runtime.invoke(tool, input);
  }

  callTool(name, input = {}) {
    const tool = this.#assertToolAvailable(name);
    return this.#runtime.callTool(tool, input);
  }

  listTools() {
    return Object.freeze(FINAL_FAST_CONTROL_READ_TOOLS.map((name) => Object.freeze({
      name,
      mutation_authority: false,
      authority_effect: false,
    })));
  }

  setSource(source, now) { return this.#runtime.setSource(source, now); }
  setCapabilityRevision(revision, now) { return this.#runtime.setCapabilityRevision(revision, now); }
  setRepoIndexRevision(revision, options) { return this.#runtime.setRepoIndexRevision(revision, options); }
  upsertCi(row, now) { return this.#runtime.upsertCi(row, now); }
  upsertEvidence(row, now) { return this.#runtime.upsertEvidence(row, now); }
  removeEvidence(id, now) { return this.#runtime.removeEvidence(id, now); }

  snapshot() {
    return Object.freeze({
      schema: FINAL_FAST_CONTROL_BOUNDARY_SCHEMA,
      runtime: this.#runtime.snapshot(),
      available_tools: [...FINAL_FAST_CONTROL_READ_TOOLS],
      blocked_tools: [...FINAL_FAST_CONTROL_BLOCKED_TOOLS],
      mutation_authority_promoted: false,
      result_outbox_promoted: false,
      emergency_issue_promoted: false,
      service_role_required_in_browser: false,
      direct_sql_authority: false,
      second_scheduler: false,
      automatic_effect_retry_allowed: false,
      authority_effect: false,
    });
  }
}
