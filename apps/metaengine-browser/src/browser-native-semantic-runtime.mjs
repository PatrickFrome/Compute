import { BrowserNativeSemanticHotPath } from './browser-native-semantic-hot-path.mjs';

const sharedHotPath = new BrowserNativeSemanticHotPath();

export async function captureNativeSemanticRuntime({ dbg, projectTargets }) {
  return sharedHotPath.capture({ dbg, projectTargets });
}

export async function resolveNativeSemanticRuntime({ dbg, role, name, projectTargets }) {
  return sharedHotPath.resolve({ dbg, role, name, projectTargets });
}

export function invalidateNativeSemanticRuntime(webContentsId) {
  sharedHotPath.invalidateWebContents(webContentsId);
}

export function nativeSemanticRuntimeSnapshot() {
  const snapshot = sharedHotPath.snapshot();
  return Object.freeze({
    schema: 'metaengine.browser-native-semantic-runtime.v1',
    hot_path: snapshot,
    shared_capture_resolution_cache: true,
    authority_effect: false,
    scheduler_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
    final_effect_fence_required: true,
  });
}
