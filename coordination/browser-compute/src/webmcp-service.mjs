import { captureWebMcpTools } from './webmcp.mjs';
import { validateContextId, validateProfileId, validateTargetId } from './security.mjs';

function assertRuntime(runtime) {
  if (!runtime || !(runtime.running instanceof Map) || typeof runtime.listTargets !== 'function' || typeof runtime.listContexts !== 'function') {
    throw new Error('webmcp_runtime_invalid');
  }
  return runtime;
}

export class ComputeWebMcpService {
  constructor(runtime) {
    if (!runtime || typeof runtime !== 'object') throw new Error('webmcp_runtime_missing');
    this.runtime = runtime;
  }

  async snapshot({ profileId, targetId } = {}) {
    const runtime = assertRuntime(this.runtime);
    const profile = validateProfileId(profileId);
    const target = validateTargetId(targetId);
    const entry = runtime.running.get(profile);
    if (!entry?.processRef?.isRunning?.() || !entry.processRef.cdp) throw new Error('webmcp_profile_not_running');
    if (!entry.sessionScheduler || !Buffer.isBuffer(entry.perceptionNodeKey) || entry.perceptionNodeKey.length < 32) {
      throw new Error('webmcp_perception_runtime_unavailable');
    }
    const incarnation = entry.processRef.processIncarnationId;
    const targets = await runtime.listTargets(profile, { includeRetired: false });
    const targetRow = targets.find((row) => row?.target_id === target);
    if (!targetRow || targetRow.status !== 'ACTIVE' || targetRow.bound !== true) throw new Error('webmcp_target_not_active');
    const binding = entry.bindings?.get?.(target);
    if (!binding || binding.process_incarnation_id !== incarnation || binding.conversation_epoch !== targetRow.conversation_epoch) {
      throw new Error('webmcp_target_binding_stale');
    }
    const contextId = validateContextId(targetRow.context_id || 'default');
    const contexts = await runtime.listContexts(profile, { includeRetired: false });
    const context = contexts.find((row) => row?.context_id === contextId);
    if (!context || context.status !== 'ACTIVE' || context.bound !== true) throw new Error('webmcp_context_not_active');
    const identity = {
      targetId: target,
      cdpTargetId: binding.cdp_target_id,
      conversationEpoch: targetRow.conversation_epoch,
      processIncarnationId: incarnation
    };
    const envelope = await captureWebMcpTools({
      scheduler: entry.sessionScheduler,
      identity,
      contextId,
      nodeKey: entry.perceptionNodeKey
    });
    if (!entry.processRef.isRunning() || entry.processRef.processIncarnationId !== incarnation) throw new Error('webmcp_capture_stale');
    return envelope;
  }
}
