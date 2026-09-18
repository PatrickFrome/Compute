import { Parser, Language } from 'web-tree-sitter';
import { minimalWebTreeSitterEdit } from './tree-sitter-edit.mjs';

const REQUEST_SCHEMA = 'metaengine.devos.ide.tree-sitter.request.v1';
const RESULT_SCHEMA = 'metaengine.devos.ide.tree-sitter.result.v1';
const RUNTIME_WASM = 'metaengine://shell/ide/web-tree-sitter.wasm';
const JAVASCRIPT_WASM = 'metaengine://shell/ide/tree-sitter-javascript.wasm';
const MAX_TEXT_BYTES = 192 * 1024;
const UTF8 = new TextEncoder();

let runtimePromise = null;
let parser = null;
let language = null;
let tree = null;
let text = '';
let documentId = null;
let revision = 0;

function clip(value, max = 180) {
  return String(value ?? '').slice(0, max);
}

function assertDocumentId(value) {
  const out = clip(value, 160);
  if (!out || /[\u0000-\u001f\u007f]/.test(out)) throw new Error('tree_sitter_document_id_invalid');
  return out;
}

function assertText(value) {
  if (typeof value !== 'string') throw new Error('tree_sitter_text_invalid');
  if (UTF8.encode(value).byteLength > MAX_TEXT_BYTES) throw new Error('tree_sitter_text_too_large');
  return value;
}

async function ensureRuntime() {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      await Parser.init({
        locateFile(name) {
          if (name === 'web-tree-sitter.wasm') return RUNTIME_WASM;
          throw new Error(`tree_sitter_runtime_asset_unexpected:${clip(name, 80)}`);
        },
      });
      language = await Language.load(JAVASCRIPT_WASM);
      parser = new Parser();
      parser.setLanguage(language);
      return true;
    })().catch((error) => {
      runtimePromise = null;
      throw error;
    });
  }
  await runtimePromise;
}

function deleteTree(value) {
  try { value?.delete?.(); } catch {}
}

function syntaxSummary(value) {
  const root = value?.rootNode;
  return Object.freeze({
    root_type: root?.type || null,
    has_error: root?.hasError === true,
    named_child_count: Number(root?.namedChildCount || 0),
    start_index: Number(root?.startIndex || 0),
    end_index: Number(root?.endIndex || 0),
  });
}

function result(state, extra = {}) {
  return Object.freeze({
    schema: RESULT_SCHEMA,
    state,
    document_id: documentId,
    revision,
    language: 'javascript',
    syntax: tree ? syntaxSummary(tree) : null,
    ...extra,
    page_model_authority: false,
    code_execution_authority: false,
    browser_actuation_authority: false,
    automatic_retry_allowed: false,
    authority_effect: false,
  });
}

async function openDocument(message) {
  await ensureRuntime();
  const nextText = assertText(message.text);
  const nextId = assertDocumentId(message.document_id);
  deleteTree(tree);
  tree = parser.parse(nextText);
  text = nextText;
  documentId = nextId;
  revision = 1;
  return result('OPEN');
}

async function editDocument(message) {
  await ensureRuntime();
  if (!tree || !documentId) throw new Error('tree_sitter_document_not_open');
  if (assertDocumentId(message.document_id) !== documentId) throw new Error('tree_sitter_document_binding_mismatch');
  const expected = Number(message.expected_revision);
  if (!Number.isSafeInteger(expected) || expected !== revision) throw new Error('tree_sitter_revision_mismatch');
  const nextText = assertText(message.text);
  const edit = minimalWebTreeSitterEdit(text, nextText);
  if (!edit) return result('NO_CHANGE');

  tree.edit(edit);
  const previous = tree;
  const nextTree = parser.parse(nextText, previous);
  if (!nextTree) throw new Error('tree_sitter_incremental_parse_failed');
  tree = nextTree;
  text = nextText;
  revision += 1;
  deleteTree(previous);
  return result('UPDATED', { incremental_edit: edit });
}

function closeDocument(message) {
  const requested = assertDocumentId(message.document_id);
  if (documentId && requested !== documentId) throw new Error('tree_sitter_document_binding_mismatch');
  deleteTree(tree);
  tree = null;
  text = '';
  documentId = null;
  revision = 0;
  return result('CLOSED');
}

globalThis.onmessage = async (event) => {
  const message = event?.data;
  const requestId = clip(message?.request_id, 96);
  try {
    if (!message || message.schema !== REQUEST_SCHEMA) throw new Error('tree_sitter_request_schema_invalid');
    let receipt;
    if (message.type === 'OPEN') receipt = await openDocument(message);
    else if (message.type === 'EDIT') receipt = await editDocument(message);
    else if (message.type === 'CLOSE') receipt = closeDocument(message);
    else throw new Error('tree_sitter_request_type_invalid');
    globalThis.postMessage({ request_id: requestId, ok: true, receipt });
  } catch (error) {
    globalThis.postMessage({
      request_id: requestId,
      ok: false,
      error: clip(error?.message || error, 220),
      automatic_retry_allowed: false,
      authority_effect: false,
    });
  }
};

export const DEVOS_TREE_SITTER_WORKER_CONTRACT = Object.freeze({
  schema: 'metaengine.devos.ide.tree-sitter-worker.v1',
  web_tree_sitter_version: '0.27.0',
  javascript_grammar_version: '0.25.0',
  runtime_wasm_url: RUNTIME_WASM,
  javascript_wasm_url: JAVASCRIPT_WASM,
  worker_isolation: true,
  incremental_edit_then_reparse: true,
  network_required: false,
  arbitrary_eval: false,
  page_model_authority: false,
  code_execution_authority: false,
  browser_actuation_authority: false,
  automatic_retry_allowed: false,
  authority_effect: false,
});
