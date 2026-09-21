import { invalidateNativeSemanticRuntime } from './browser-native-semantic-runtime.mjs';

const boundWebContents = new WeakSet();

function webContentsId(webContents) {
  const id = Number(webContents?.id);
  if (!Number.isSafeInteger(id) || id < 1) throw new Error('native_semantic_lifecycle_webcontents_id_invalid');
  return id;
}

export function bindNativeSemanticRuntimeLifecycle(webContents) {
  if (!webContents || typeof webContents.on !== 'function' || typeof webContents.once !== 'function') {
    throw new Error('native_semantic_lifecycle_webcontents_required');
  }
  if (boundWebContents.has(webContents)) return false;

  const id = webContentsId(webContents);
  const invalidate = () => invalidateNativeSemanticRuntime(id);
  const onNavigation = (_event, _url, _isInPlace, isMainFrame) => {
    if (isMainFrame !== false) invalidate();
  };

  webContents.on('did-start-navigation', onNavigation);
  webContents.on('render-process-gone', invalidate);
  webContents.once('destroyed', () => {
    invalidate();
    webContents.removeListener?.('did-start-navigation', onNavigation);
    webContents.removeListener?.('render-process-gone', invalidate);
    boundWebContents.delete(webContents);
  });
  boundWebContents.add(webContents);
  return true;
}

export function nativeSemanticLifecycleSnapshot() {
  return Object.freeze({
    schema: 'metaengine.browser-native-semantic-lifecycle.v1',
    invalidates_on_main_frame_navigation: true,
    invalidates_on_renderer_loss: true,
    invalidates_on_webcontents_destroyed: true,
    authority_effect: false,
    scheduler_authority: false,
    lease_authority: false,
    effect_execution_authority: false,
    automatic_retry_allowed: false,
  });
}
