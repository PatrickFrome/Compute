const MONACO_JS = 'metaengine://shell/ide/editor.js';
const MONACO_CSS = 'metaengine://shell/ide/editor.css';

let root = null;
let apiRef = null;
let monacoPromise = null;
let editorHandle = null;
let changeDisposable = null;
let refs = null;

const state = {
  source: null,
  relative_path: '',
  workspace_fingerprint_sha256: '',
  file_sha256: '',
  saved_text: '',
  text: '',
  dirty: false,
  ambiguous: false,
  write_available: false,
  status: 'IDLE',
  error: null,
};

function node(tag, className = '', text = '') {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text) element.textContent = text;
  return element;
}

function compact(value, max = 44) {
  const out = String(value ?? '');
  return out.length > max ? `${out.slice(0, Math.max(1, max - 1))}…` : out;
}

function errorText(error) {
  return String(error?.message || error || 'unknown_error').slice(0, 240);
}

function ensureStylesheet() {
  if (document.querySelector('link[data-metaengine-monaco="1"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = MONACO_CSS;
  link.dataset.metaengineMonaco = '1';
  document.head.append(link);
}

async function monacoRuntime() {
  if (!monacoPromise) {
    ensureStylesheet();
    monacoPromise = import(MONACO_JS).then((runtime) => {
      const contract = runtime?.MONACO_IDE_CONTRACT;
      if (
        contract?.schema !== 'metaengine.devos.ide.monaco-runtime.v1'
        || contract?.version !== '0.56.0'
        || contract?.esm !== true
        || contract?.amd !== false
        || contract?.remote_assets !== false
        || contract?.network_required !== false
        || contract?.automatic_save !== false
        || contract?.automatic_retry_allowed !== false
        || contract?.authority_effect !== false
        || typeof runtime?.createRepoEditor !== 'function'
      ) throw new Error('devos_ide_monaco_contract_invalid');
      return runtime;
    }).catch((error) => {
      monacoPromise = null;
      throw error;
    });
  }
  return monacoPromise;
}

function captureEditorText() {
  if (!editorHandle) return;
  try { state.text = editorHandle.getValue(); } catch {}
}

function disposeEditor({ capture = true } = {}) {
  if (capture) captureEditorText();
  try { changeDisposable?.dispose?.(); } catch {}
  changeDisposable = null;
  try { editorHandle?.dispose?.(); } catch {}
  editorHandle = null;
}

function statusLabel() {
  if (state.ambiguous) return 'AMBIGUOUS — RECONCILE REQUIRED';
  if (state.error) return 'ERROR';
  if (state.status === 'LOADING') return 'OPENING';
  if (state.status === 'SAVING') return 'SAVING';
  if (state.status === 'RECONCILING') return 'RECONCILING';
  if (!state.relative_path) return 'NO FILE';
  if (state.write_available !== true) return 'READ ONLY SNAPSHOT';
  if (state.dirty) return 'MODIFIED';
  return 'CLEAN';
}

function updateChrome() {
  if (!refs) return;
  refs.status.textContent = statusLabel();
  refs.status.dataset.tone = state.ambiguous || state.error ? 'bad' : state.dirty ? 'warn' : state.relative_path ? 'good' : 'neutral';
  refs.meta.textContent = state.relative_path
    ? `${compact(state.relative_path, 54)} · ${state.file_sha256 ? compact(state.file_sha256, 22) : 'digest unknown'} · ${state.source?.head ? compact(state.source.head, 12) : 'head unknown'}`
    : 'Exact repository HEAD + file digest required before editing.';
  refs.message.textContent = state.error || (
    state.ambiguous
      ? 'The previous save may have taken effect. No retry is allowed until read-only reconciliation.'
      : state.relative_path && state.write_available !== true
        ? 'Packaged provenance snapshot is read-only. Bind a live Git workspace before mutation.'
        : state.dirty
          ? 'Unsaved local edits. Save is an explicit typed repository effect.'
          : state.relative_path
            ? 'Readback verified. Autosave is disabled.'
          : 'Open an existing UTF-8 repository file.'
  );
  refs.save.disabled = !state.relative_path || state.write_available !== true || !state.dirty || state.ambiguous || state.status === 'SAVING' || state.status === 'LOADING';
  refs.reconcile.disabled = !state.relative_path || state.status === 'SAVING' || state.status === 'LOADING' || state.status === 'RECONCILING';
  refs.open.disabled = state.status === 'LOADING' || state.status === 'SAVING' || state.status === 'RECONCILING';
}

function validateRead(receipt) {
  if (
    receipt?.schema !== 'metaengine.development-plane.repo-file-read.v1'
    || receipt?.repository_effect !== false
    || receipt?.automatic_retry_allowed !== false
    || receipt?.authority_effect !== false
    || typeof receipt?.text !== 'string'
    || !/^sha256:[0-9a-f]{64}$/.test(String(receipt?.file_sha256 || ''))
    || !/^sha256:[0-9a-f]{64}$/.test(String(receipt?.workspace_fingerprint_sha256 || ''))
  ) throw new Error('devos_ide_read_receipt_invalid');
  return receipt;
}

function validateSave(receipt) {
  if (
    receipt?.schema !== 'metaengine.development-plane.repo-file-save.v1'
    || !['VERIFIED', 'NO_CHANGE'].includes(String(receipt?.state || ''))
    || receipt?.readback_verified !== true
    || receipt?.automatic_retry_allowed !== false
    || receipt?.authority_effect !== false
    || !/^sha256:[0-9a-f]{64}$/.test(String(receipt?.file_sha256 || ''))
  ) throw new Error('devos_ide_save_receipt_invalid');
  return receipt;
}

async function mountEditor() {
  if (!root || !refs?.editor || !state.relative_path) return;
  const host = refs.editor;
  const token = Symbol('ide-mount');
  host.__metaengineMountToken = token;
  const runtime = await monacoRuntime();
  if (!root?.isConnected || host.__metaengineMountToken !== token) return;
  disposeEditor({ capture: false });
  editorHandle = runtime.createRepoEditor(host, {
    text: state.text,
    relativePath: state.relative_path,
    head: state.source?.head || 'unknown',
    readOnly: state.write_available !== true,
  });
  changeDisposable = editorHandle.onDidChange(() => {
    captureEditorText();
    state.dirty = state.text !== state.saved_text;
    updateChrome();
  });
  editorHandle.focus();
}

function adoptRead(receipt, { preserveText = null, writeAvailable = false } = {}) {
  const diskText = receipt.text;
  const retained = preserveText == null ? diskText : String(preserveText);
  state.source = receipt.source;
  state.relative_path = receipt.relative_path;
  state.workspace_fingerprint_sha256 = receipt.workspace_fingerprint_sha256;
  state.file_sha256 = receipt.file_sha256;
  state.saved_text = diskText;
  state.text = retained;
  state.dirty = retained !== diskText;
  state.ambiguous = false;
  state.write_available = writeAvailable === true;
  state.error = null;
  state.status = state.dirty ? 'CONFLICT_RECONCILED' : 'OPEN';
}

async function openPath() {
  if (!apiRef?.ide) throw new Error('devos_ide_bridge_unavailable');
  if (state.dirty || state.ambiguous) {
    state.error = 'Unsaved or ambiguous edits must be reconciled before opening another file.';
    updateChrome();
    return;
  }
  const relativePath = String(refs?.path?.value || '').trim();
  if (!relativePath) {
    state.error = 'Repository-relative path required.';
    updateChrome();
    return;
  }
  state.status = 'LOADING';
  state.error = null;
  updateChrome();
  try {
    const source = await apiRef.ide.source();
    const receipt = validateRead(await apiRef.ide.read({ source, relative_path: relativePath }));
    adoptRead(receipt, { writeAvailable: source?.write_available === true });
    renderWorkspace();
  } catch (error) {
    state.status = 'IDLE';
    state.error = errorText(error);
    updateChrome();
  }
}

async function saveCurrent() {
  if (!state.relative_path || state.write_available !== true || !state.dirty || state.ambiguous || !editorHandle) return;
  captureEditorText();
  const desired = state.text;
  state.status = 'SAVING';
  state.error = null;
  updateChrome();
  try {
    const receipt = validateSave(await apiRef.ide.save({
      source: state.source,
      workspace_fingerprint_sha256: state.workspace_fingerprint_sha256,
      relative_path: state.relative_path,
      expected_file_sha256: state.file_sha256,
      text: desired,
    }));
    state.file_sha256 = receipt.file_sha256;
    state.saved_text = desired;
    state.text = desired;
    state.dirty = false;
    state.ambiguous = false;
    state.status = receipt.state;
    state.error = null;
  } catch (error) {
    const message = errorText(error);
    state.status = 'ERROR';
    state.error = message;
    state.ambiguous = /ambiguous/i.test(message);
  }
  updateChrome();
}

async function reconcileCurrent() {
  if (!state.relative_path) return;
  captureEditorText();
  const desired = state.text;
  state.status = 'RECONCILING';
  state.error = null;
  updateChrome();
  try {
    const source = await apiRef.ide.source();
    const receipt = validateRead(await apiRef.ide.read({ source, relative_path: state.relative_path }));
    adoptRead(receipt, { preserveText: desired, writeAvailable: source?.write_available === true });
    renderWorkspace();
  } catch (error) {
    state.status = 'ERROR';
    state.error = errorText(error);
    updateChrome();
  }
}

function toolbarButton(label, className = '') {
  const button = node('button', `ideButton ${className}`.trim(), label);
  button.type = 'button';
  return button;
}

function renderWorkspace() {
  if (!root) return;
  disposeEditor();
  root.replaceChildren();

  const shell = node('section', 'ideWorkspace');
  const heading = node('div', 'ideHeading');
  const titleWrap = node('div', 'ideHeadingCopy');
  titleWrap.append(node('strong', '', 'Repository Editor'), node('small', '', 'Monaco 0.56 · exact HEAD · explicit save'));
  const status = node('span', 'ideStatus', '');
  heading.append(titleWrap, status);

  const openBar = node('div', 'ideOpenBar');
  const pathInput = node('input', 'idePathInput');
  pathInput.type = 'text';
  pathInput.autocomplete = 'off';
  pathInput.spellcheck = false;
  pathInput.placeholder = 'apps/metaengine-browser/src/main.mjs';
  pathInput.value = state.relative_path || '';
  const open = toolbarButton('Open');
  openBar.append(pathInput, open);

  const actions = node('div', 'ideActions');
  const save = toolbarButton('Save', 'ideSave');
  const reconcile = toolbarButton('Reconcile');
  const meta = node('div', 'ideMeta', '');
  actions.append(save, reconcile);

  const message = node('div', 'ideMessage', '');
  const editor = node('div', 'ideEditorHost');
  editor.setAttribute('aria-label', 'Repository editor');

  shell.append(heading, openBar, actions, meta, message, editor);
  root.append(shell);
  refs = { status, path: pathInput, open, save, reconcile, meta, message, editor };

  open.onclick = () => { void openPath(); };
  pathInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void openPath();
    }
  });
  save.onclick = () => { void saveCurrent(); };
  reconcile.onclick = () => { void reconcileCurrent(); };

  updateChrome();
  if (state.relative_path) {
    queueMicrotask(() => {
      mountEditor().catch((error) => {
        state.error = errorText(error);
        updateChrome();
      });
    });
  }
}

export async function mountIdeShell(target, api) {
  if (!(target instanceof HTMLElement)) throw new Error('devos_ide_mount_target_required');
  if (!api?.ide || typeof api.ide.source !== 'function' || typeof api.ide.read !== 'function' || typeof api.ide.save !== 'function') {
    throw new Error('devos_ide_bridge_unavailable');
  }
  if (root && root !== target) disposeEditor();
  root = target;
  apiRef = api;
  renderWorkspace();
  return Object.freeze({
    schema: 'metaengine.devos.ide.shell.v1',
    mounted: true,
    autosave: false,
    automatic_retry_allowed: false,
    page_model_authority: false,
    authority_effect: false,
  });
}

export function unmountIdeShell() {
  captureEditorText();
  disposeEditor({ capture: false });
  root = null;
  refs = null;
}

export function saveIdeShell() {
  return saveCurrent();
}

export const DEVOS_IDE_SHELL_CONTRACT = Object.freeze({
  schema: 'metaengine.devos.ide.shell.v1',
  monaco_version: '0.56.0',
  packaged_esm: true,
  remote_assets: false,
  autosave: false,
  ambiguous_save_requires_reconcile: true,
  page_model_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});
