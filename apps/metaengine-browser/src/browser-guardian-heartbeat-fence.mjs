export const GUARDIAN_HEARTBEAT_FENCE_VERSION = '1.0.0';
export const GUARDIAN_HEARTBEAT_CHANNELS = Object.freeze(['startup', 'liveness', 'readiness', 'progress']);

function finiteInt(value, fallback = -1) {
  const n = Number(value);
  return Number.isSafeInteger(n) ? n : fallback;
}

function nonEmpty(value) {
  const out = String(value ?? '').trim();
  return out || null;
}

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) freeze(child);
  }
  return value;
}

function releaseIdentity(release) {
  if (!release || typeof release !== 'object' || Array.isArray(release)) return null;
  const releaseId = nonEmpty(release.release_id);
  const artifactSha256 = nonEmpty(release.artifact_sha256)?.toLowerCase() || null;
  if (!releaseId || !/^[0-9a-f]{64}$/.test(artifactSha256 || '')) return null;
  return freeze({ release_id: releaseId, artifact_sha256: artifactSha256 });
}

function childIdentity(child) {
  if (!child || typeof child !== 'object' || Array.isArray(child)) return null;
  const pid = finiteInt(child.pid, 0);
  const processIncarnationId = nonEmpty(child.process_incarnation_id);
  if (pid < 1 || !processIncarnationId) return null;
  return freeze({ pid, process_incarnation_id: processIncarnationId });
}

function exactBinding(signal, child, release) {
  if (!signal || typeof signal !== 'object' || Array.isArray(signal)) return false;
  return finiteInt(signal.pid, 0) === child.pid
    && nonEmpty(signal.process_incarnation_id) === child.process_incarnation_id
    && nonEmpty(signal.release_id) === release.release_id
    && String(signal.artifact_sha256 || '').toLowerCase() === release.artifact_sha256;
}

/**
 * Pure fail-closed validation for Guardian health signals.
 *
 * Each health dimension has its own monotonically fenced sequence so a fresh PID,
 * liveness pulse, or unrelated channel can never substitute for readiness or useful
 * progress. The durable controller supplies `sequence_fence` from the last accepted
 * sample for the exact child incarnation. This function performs no process, Browser,
 * task, network, filesystem, release, or retry effect.
 */
export function evaluateGuardianHeartbeatFence({
  child,
  release,
  heartbeats,
  sequence_fence = {},
  now_ms = Date.now(),
} = {}) {
  const nowMs = finiteInt(now_ms, -1);
  const exactChild = childIdentity(child);
  const exactRelease = releaseIdentity(release);
  if (nowMs < 0) return freeze({ valid: false, reason: 'CLOCK_INVALID', authority_effect: false });
  if (!exactChild) return freeze({ valid: false, reason: 'CHILD_IDENTITY_INCOMPLETE', authority_effect: false });
  if (!exactRelease) return freeze({ valid: false, reason: 'RELEASE_IDENTITY_INVALID', authority_effect: false });
  if (!heartbeats || typeof heartbeats !== 'object' || Array.isArray(heartbeats)) {
    return freeze({ valid: false, reason: 'SPLIT_HEARTBEATS_REQUIRED', authority_effect: false });
  }

  const accepted = {};
  for (const channel of GUARDIAN_HEARTBEAT_CHANNELS) {
    const signal = heartbeats[channel];
    if (!signal || typeof signal !== 'object' || Array.isArray(signal)) {
      return freeze({ valid: false, reason: 'HEARTBEAT_CHANNEL_MISSING', channel, authority_effect: false });
    }
    if (!exactBinding(signal, exactChild, exactRelease)) {
      return freeze({ valid: false, reason: 'HEARTBEAT_BINDING_MISMATCH', channel, authority_effect: false });
    }

    const sequence = finiteInt(signal.sequence, -1);
    const floor = Math.max(0, finiteInt(sequence_fence?.[channel], 0));
    if (sequence < 1) {
      return freeze({ valid: false, reason: 'HEARTBEAT_SEQUENCE_INVALID', channel, sequence, authority_effect: false });
    }
    if (sequence < floor) {
      return freeze({ valid: false, reason: 'HEARTBEAT_SEQUENCE_REGRESSION', channel, sequence, sequence_floor: floor, authority_effect: false });
    }

    const observedAtMs = finiteInt(signal.observed_at_ms, -1);
    if (observedAtMs < 0 || observedAtMs > nowMs) {
      return freeze({ valid: false, reason: 'HEARTBEAT_TIMESTAMP_INVALID', channel, observed_at_ms: observedAtMs, authority_effect: false });
    }

    accepted[channel] = {
      sequence,
      observed_at_ms: observedAtMs,
      age_ms: nowMs - observedAtMs,
    };
  }

  return freeze({
    valid: true,
    reason: 'EXACT_SPLIT_HEARTBEATS_FENCED',
    process_incarnation_id: exactChild.process_incarnation_id,
    pid: exactChild.pid,
    release_id: exactRelease.release_id,
    artifact_sha256: exactRelease.artifact_sha256,
    channels: accepted,
    authority_effect: false,
  });
}
