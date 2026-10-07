import type { ClientWorkReadiness } from './client-runtime-resource';

const BLOCKERS: Record<string, string> = {
  CODING_BACKEND_NOT_EXECUTABLE: 'Connect a verified isolated coding environment.',
  IMPLEMENTER_ORIGIN_UNVERIFIED: 'An Implementer needs a verified session.',
  INDEPENDENT_VERIFIER_UNAVAILABLE: 'A separate Critic session is required.',
  GUARDIAN_CONTINUITY_NOT_PROVEN: 'Guardian recovery needs current owner and device proof.',
};

export function capabilityLabel(work: ClientWorkReadiness | null | undefined, key: keyof ClientWorkReadiness['capabilities']) {
  const capability = work?.capabilities[key];
  if (!capability) return 'Status unavailable';
  if (capability.ready) return 'Ready';
  return BLOCKERS[capability.reason || ''] || work?.detail || 'Status unavailable';
}
