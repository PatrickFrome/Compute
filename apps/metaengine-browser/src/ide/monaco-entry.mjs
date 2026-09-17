import * as monaco from 'monaco-editor/editor';
import 'monaco-editor/features/register.all';
import 'monaco-editor/languages/definitions/register.all';

const WORKER_URL = 'metaengine://shell/ide/editor.worker.js';

globalThis.MonacoEnvironment = Object.freeze({
  getWorkerUrl() {
    return WORKER_URL;
  },
});

monaco.editor.defineTheme('metaengine-dark', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0f141c',
    'editor.foreground': '#d7dde8',
    'editorLineNumber.foreground': '#596474',
    'editorLineNumber.activeForeground': '#b7c2d3',
    'editorCursor.foreground': '#6ca6ff',
    'editor.selectionBackground': '#254c7c88',
  },
});

function languageForPath(relativePath) {
  const lower = String(relativePath || '').toLowerCase();
  if (lower.endsWith('.mjs') || lower.endsWith('.cjs') || lower.endsWith('.js')) return 'javascript';
  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) return 'typescript';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.css')) return 'css';
  if (lower.endsWith('.html') || lower.endsWith('.htm')) return 'html';
  if (lower.endsWith('.md')) return 'markdown';
  if (lower.endsWith('.sql')) return 'sql';
  if (lower.endsWith('.py')) return 'python';
  if (lower.endsWith('.rs')) return 'rust';
  if (lower.endsWith('.go')) return 'go';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return 'plaintext';
}

function modelUri(relativePath, head) {
  const cleanPath = String(relativePath || '').split('/').map(encodeURIComponent).join('/');
  const cleanHead = encodeURIComponent(String(head || 'unknown'));
  return monaco.Uri.parse(`metaengine-repo://workspace/${cleanPath}?head=${cleanHead}`);
}

export function createRepoEditor(container, {
  text = '',
  relativePath = 'untitled.txt',
  head = 'unknown',
  readOnly = false,
} = {}) {
  if (!(container instanceof HTMLElement)) throw new Error('monaco_container_required');
  const uri = modelUri(relativePath, head);
  monaco.editor.getModel(uri)?.dispose();
  const model = monaco.editor.createModel(String(text), languageForPath(relativePath), uri);
  const editor = monaco.editor.create(container, {
    model,
    theme: 'metaengine-dark',
    automaticLayout: true,
    readOnly: readOnly === true,
    minimap: { enabled: false },
    fontSize: 12,
    lineHeight: 19,
    tabSize: 2,
    insertSpaces: true,
    renderWhitespace: 'selection',
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    wordWrap: 'off',
    padding: { top: 8, bottom: 8 },
  });
  return Object.freeze({
    getValue: () => model.getValue(),
    focus: () => editor.focus(),
    onDidChange: (listener) => model.onDidChangeContent(listener),
    dispose: () => {
      editor.dispose();
      model.dispose();
    },
    uri: uri.toString(),
    language: model.getLanguageId(),
  });
}

export const MONACO_IDE_CONTRACT = Object.freeze({
  schema: 'metaengine.devos.ide.monaco-runtime.v1',
  version: '0.56.0',
  esm: true,
  amd: false,
  worker_url: WORKER_URL,
  remote_assets: false,
  network_required: false,
  page_model_authority: false,
  automatic_save: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});
