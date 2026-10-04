import { LEGACY_GLM_PLATFORM, isLegacyAgentPlatformUrl } from './browser-agent-platform.mjs';
import { classifyNativeSupervisorCommand } from './native-supervisor-command-lanes.mjs';

// Persisted legacy commands may still be inspected. They cannot acquire fresh
// Browser effects through an explicit tab, a renamed platform, or a new URL.
export function assertActiveInferenceCommandPolicy(command, { target_url = null } = {}) {
  const descriptor = classifyNativeSupervisorCommand(command);
  if (descriptor.read_only) return;
  const platform = String(command?.platform || '').trim().toUpperCase();
  if (platform === LEGACY_GLM_PLATFORM
      || isLegacyAgentPlatformUrl(target_url)
      || isLegacyAgentPlatformUrl(command?.payload?.url)) {
    throw new Error('native_supervisor_legacy_agent_platform_read_only');
  }
}
