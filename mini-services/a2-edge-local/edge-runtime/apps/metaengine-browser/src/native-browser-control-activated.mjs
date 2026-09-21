import {
  captureSemanticFrame,
  captureTranscript,
  captureViewThumbnail as captureViewThumbnailBase,
  executeSemanticCommand,
  nativeBrowserTargetIdentity,
} from './native-browser-control.mjs';
import { resolveExactWebContentsView } from './browser-webcontents-tab-index.mjs';
import { withTemporaryDetachedCaptureSurface } from './browser-detached-capture-surface.mjs';

export {
  captureSemanticFrame,
  captureTranscript,
  executeSemanticCommand,
  nativeBrowserTargetIdentity,
};

export async function captureViewThumbnail(webContents, options = {}) {
  if (options?.surfaceExpected !== false) {
    return captureViewThumbnailBase(webContents, options);
  }

  const resolveViewImpl = typeof options.resolveViewImpl === 'function'
    ? options.resolveViewImpl
    : resolveExactWebContentsView;
  const exactView = resolveViewImpl(webContents);
  if (exactView?.webContents !== webContents || exactView.getVisible?.() !== false) {
    return captureViewThumbnailBase(webContents, options);
  }

  const withDetachedSurfaceImpl = typeof options.withDetachedSurfaceImpl === 'function'
    ? options.withDetachedSurfaceImpl
    : withTemporaryDetachedCaptureSurface;
  const visibleExactViewFacade = {
    webContents,
    getVisible: () => true,
  };

  return captureViewThumbnailBase(webContents, {
    ...options,
    resolveViewImpl: () => visibleExactViewFacade,
    withDetachedSurfaceImpl: (_facade, task, detachedOptions) => withDetachedSurfaceImpl(
      exactView,
      task,
      detachedOptions,
    ),
  });
}
