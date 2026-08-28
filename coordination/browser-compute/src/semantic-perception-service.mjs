import path from 'node:path';
import { readJson, validateProfileId, validateTargetId } from './security.mjs';
import { captureSemanticFrame } from './semantic-perception.mjs';

const TARGETS_FILE = 'targets.json';
const previousFrames = new WeakMap();

function frameCache(runtime) {
  let cache = previousFrames.get(runtime);
  if (!cache) {
    cache = new Map();
    previousFrames.set(runtime, cache);
  }
  return cache;
}

export async function captureRuntimeSemanticPerception(runtime, {
  profileId,
  targetId,
  nodeBudget = 80,
  taskTerms = []
} = {}) {
  const profile = validateProfileId(profileId);
  const target = validateTargetId(targetId);
  const entry = runtime?.running?.get(profile);
  if (!entry?.processRef?.isRunning?.() || !entry.processRef.cdp) throw new Error('profile_not_running');
  const binding = entry.bindings?.get(target);
  if (!binding) throw new Error('target_not_bound');
  if (binding.process_incarnation_id !== entry.processRef.processIncarnationId) throw new Error('target_binding_stale');

  const registry = await readJson(path.join(runtime.profileDir(profile), TARGETS_FILE), { targets: [] });
  const record = Array.isArray(registry?.targets) ? registry.targets.find((row) => row.target_id === target) : null;
  if (!record) throw new Error('target_registry_missing');
  if (record.status !== 'ACTIVE') throw new Error('target_recovery_required');

  const cache = frameCache(runtime);
  const cacheKey = `${profile}:${target}`;
  const semantic = await captureSemanticFrame({
    cdp: entry.processRef.cdp,
    cdpTargetId: binding.cdp_target_id,
    targetId: record.target_id,
    contextId: record.context_id || 'default',
    conversationEpoch: record.conversation_epoch || 1,
    processIncarnationId: entry.processRef.processIncarnationId,
    previousFrame: cache.get(cacheKey) || null,
    nodeBudget,
    taskTerms
  });
  cache.set(cacheKey, semantic);
  return semantic;
}

export function clearRuntimeSemanticCache(runtime, { profileId = null, targetId = null } = {}) {
  const cache = frameCache(runtime);
  if (!profileId) {
    cache.clear();
    return;
  }
  const profile = validateProfileId(profileId);
  if (!targetId) {
    for (const key of [...cache.keys()]) if (key.startsWith(`${profile}:`)) cache.delete(key);
    return;
  }
  cache.delete(`${profile}:${validateTargetId(targetId)}`);
}
