'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

async function monacoPackageRoot() {
  const resolved = require.resolve('monaco-editor');
  return path.resolve(path.dirname(resolved), '../..');
}

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

async function buildMonacoAssets({
  appRoot = path.resolve(__dirname, '..'),
  outputDir = path.join(appRoot, 'ui', 'ide-dist'),
} = {}) {
  const entry = path.join(appRoot, 'src', 'ide', 'monaco-entry.mjs');
  const monacoRoot = await monacoPackageRoot();
  const workerEntry = path.join(monacoRoot, 'esm', 'vs', 'editor', 'editor.worker.js');
  const treeSitterEntry = path.join(appRoot, 'src', 'ide', 'tree-sitter-worker.mjs');
  const webTreeSitterRoot = await packageRoot('web-tree-sitter');
  const javascriptGrammarRoot = await packageRoot('tree-sitter-javascript');
  const treeSitterRuntimeWasm = path.join(webTreeSitterRoot, 'tree-sitter.wasm');
  const treeSitterJavaScriptWasm = path.join(javascriptGrammarRoot, 'tree-sitter-javascript.wasm');
  await fs.rm(outputDir, { recursive: true, force: true });
  await fs.mkdir(outputDir, { recursive: true });

  await build({
    entryPoints: [entry],
    outfile: path.join(outputDir, 'editor.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome152'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    loader: { '.ttf': 'file' },
    assetNames: 'assets/[name]-[hash]',
    logLevel: 'warning',
  });

  await build({
    entryPoints: [workerEntry],
    outfile: path.join(outputDir, 'editor.worker.js'),
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: ['chrome152'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
  });

  await build({
    entryPoints: [treeSitterEntry],
    outfile: path.join(outputDir, 'tree-sitter.worker.js'),
    bundle: true,
    format: 'esm',
    platform: 'browser',
    target: ['chrome152'],
    minify: true,
    sourcemap: false,
    legalComments: 'none',
    logLevel: 'warning',
  });

  await Promise.all([
    fs.copyFile(treeSitterRuntimeWasm, path.join(outputDir, 'tree-sitter.wasm')),
    fs.copyFile(treeSitterJavaScriptWasm, path.join(outputDir, 'tree-sitter-javascript.wasm')),
  ]);

  const entries = await fs.readdir(outputDir, { recursive: true });
  if (
    !entries.includes('editor.js')
    || !entries.includes('editor.css')
    || !entries.includes('editor.worker.js')
    || !entries.includes('tree-sitter.worker.js')
    || !entries.includes('tree-sitter.wasm')
    || !entries.includes('tree-sitter-javascript.wasm')
  ) {
    throw new Error('ide_asset_build_incomplete');
  }
  return Object.freeze({
    schema: 'metaengine.devos.ide.monaco-build.v1',
    monaco_version: '0.56.0',
    web_tree_sitter_version: '0.27.0',
    javascript_grammar_version: '0.25.0',
    output_dir: outputDir,
    files: Object.freeze([...entries].sort()),
    remote_assets: false,
    amd_loader: false,
    authority_effect: false,
  });
}

if (require.main === module) {
  buildMonacoAssets()
    .then((receipt) => process.stdout.write(`${JSON.stringify(receipt)}\n`))
    .catch((error) => {
      process.stderr.write(`${String(error?.stack || error)}\n`);
      process.exitCode = 1;
    });
}

module.exports = Object.freeze({ buildMonacoAssets });
