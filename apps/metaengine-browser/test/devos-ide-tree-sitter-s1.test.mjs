import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { Parser, Language } from 'web-tree-sitter';
import {
  DEVOS_TREE_SITTER_EDIT_CONTRACT,
  minimalWebTreeSitterEdit,
} from '../src/ide/tree-sitter-edit.mjs';

const require = createRequire(import.meta.url);
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, '..');

async function packageRoot(packageName) {
  let cursor = path.dirname(require.resolve(packageName));
  for (let i = 0; i < 8; i += 1) {
    try {
      const meta = JSON.parse(await fs.readFile(path.join(cursor, 'package.json'), 'utf8'));
      if (meta?.name === packageName) return cursor;
    } catch {}
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  throw new Error(`package_root_not_found:${packageName}`);
}

async function source(relative) {
  return fs.readFile(path.join(APP_ROOT, relative), 'utf8');
}

test('Tree-sitter dependencies and worker authority contract are exact and local', async () => {
  const pkg = JSON.parse(await source('package.json'));
  assert.equal(pkg.devDependencies?.['web-tree-sitter'], '0.27.0');
  assert.equal(pkg.devDependencies?.['tree-sitter-javascript'], '0.25.0');
  assert.equal(pkg.dependencies?.['web-tree-sitter'], undefined);
  assert.equal(pkg.dependencies?.['tree-sitter-javascript'], undefined);

  const worker = await source('src/ide/tree-sitter-worker.mjs');
  assert.match(worker, /metaengine:\/\/shell\/ide\/web-tree-sitter\.wasm/);
  assert.match(worker, /metaengine:\/\/shell\/ide\/tree-sitter-javascript\.wasm/);
  assert.match(worker, /tree\.edit\(edit\)/);
  assert.match(worker, /parser\.parse\(nextText, previous\)/);
  assert.match(worker, /worker_isolation: true/);
  assert.match(worker, /network_required: false/);
  assert.match(worker, /arbitrary_eval: false/);
  assert.match(worker, /code_execution_authority: false/);
  assert.match(worker, /browser_actuation_authority: false/);
  assert.match(worker, /automatic_retry_allowed: false/);
  assert.doesNotMatch(worker, /https?:\/\//);
  assert.doesNotMatch(worker, /\beval\s*\(|new Function\s*\(/);
});

test('IDE build copies parser runtime and JavaScript grammar into the existing local asset plane', async () => {
  const builder = await source('scripts/build-monaco-assets.cjs');
  assert.match(builder, /packageRoot\('web-tree-sitter'\)/);
  assert.match(builder, /packageRoot\('tree-sitter-javascript'\)/);
  assert.match(builder, /tree-sitter\.worker\.js/);
  assert.match(builder, /web-tree-sitter\.wasm/);
  assert.match(builder, /tree-sitter-javascript\.wasm/);
  assert.match(builder, /web_tree_sitter_version: '0\.27\.0'/);
  assert.match(builder, /javascript_grammar_version: '0\.25\.0'/);
});

test('incremental edit mapping is bounded, UTF-16 aligned and surrogate-safe', () => {
  assert.equal(DEVOS_TREE_SITTER_EDIT_CONTRACT.index_units, 'JAVASCRIPT_UTF16_CODE_UNITS');
  assert.equal(DEVOS_TREE_SITTER_EDIT_CONTRACT.max_text_bytes, 192 * 1024);
  assert.equal(DEVOS_TREE_SITTER_EDIT_CONTRACT.authority_effect, false);

  const oldText = 'const face = "😀";\nlet value = 1;\n';
  const newText = 'const face = "😀";\nlet value = 200;\n';
  const edit = minimalWebTreeSitterEdit(oldText, newText);
  assert.ok(edit);
  assert.equal(oldText.slice(edit.startIndex, edit.oldEndIndex), '1');
  assert.equal(newText.slice(edit.startIndex, edit.newEndIndex), '200');
  assert.deepEqual(edit.startPosition, { row: 1, column: 12 });
  assert.deepEqual(edit.oldEndPosition, { row: 1, column: 13 });
  assert.deepEqual(edit.newEndPosition, { row: 1, column: 15 });

  const emojiOld = 'let x = "😀";';
  const emojiNew = 'let x = "😁";';
  const emojiEdit = minimalWebTreeSitterEdit(emojiOld, emojiNew);
  assert.ok(emojiEdit);
  assert.equal(
    /[\uDC00-\uDFFF]/.test(emojiOld[emojiEdit.startIndex] || ''),
    false,
    'edit must not begin on a low surrogate',
  );
  assert.equal(
    /[\uD800-\uDBFF]/.test(emojiOld[emojiEdit.oldEndIndex - 1] || ''),
    false,
    'old edit must not end after only a high surrogate',
  );
});

test('web-tree-sitter 0.27 incremental JavaScript parse matches clean parse after Unicode and newline edit', async () => {
  const runtimeRoot = await packageRoot('web-tree-sitter');
  const grammarRoot = await packageRoot('tree-sitter-javascript');
  const runtimeWasm = path.join(runtimeRoot, 'web-tree-sitter.wasm');
  const grammarWasm = path.join(grammarRoot, 'tree-sitter-javascript.wasm');

  await fs.access(runtimeWasm);
  await fs.access(grammarWasm);

  await Parser.init({
    locateFile(name) {
      assert.equal(name, 'web-tree-sitter.wasm');
      return runtimeWasm;
    },
  });
  const language = await Language.load(grammarWasm);
  const parser = new Parser();
  parser.setLanguage(language);

  const oldText = 'const emoji = "😀";\nlet answer = 41;\nconsole.log(answer);\n';
  const newText = 'const emoji = "😀";\nlet answer = 42 +\n  1;\nconsole.log(answer);\n';
  const edit = minimalWebTreeSitterEdit(oldText, newText);
  assert.ok(edit);

  const oldTree = parser.parse(oldText);
  assert.ok(oldTree);
  oldTree.edit(edit);
  const incremental = parser.parse(newText, oldTree);
  const clean = parser.parse(newText);
  assert.ok(incremental);
  assert.ok(clean);
  assert.equal(incremental.rootNode.toString(), clean.rootNode.toString());
  assert.equal(incremental.rootNode.type, 'program');
  assert.equal(incremental.rootNode.hasError, false);

  clean.delete();
  incremental.delete();
  oldTree.delete();
  parser.delete();
  language.delete?.();
});
