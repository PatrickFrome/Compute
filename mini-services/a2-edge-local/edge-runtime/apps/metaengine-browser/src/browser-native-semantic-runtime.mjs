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
  const hotPath = sharedHotPath.snapshot();
  return Object.freeze({
    ...hotPath,
    schema: 'metaengine.browser-native-semantic-runtime.v1',
    hot_path: hotPath,
    shared_capture_resolution_cache: true,
  });
}
