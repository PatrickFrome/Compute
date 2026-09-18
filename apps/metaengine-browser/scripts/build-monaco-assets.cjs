'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { build } = require('esbuild');

async function monacoPackageRoot() {
  const resolved = require.resolve('monaco-editor');
  return path.resolve(path.dirname(resolved), '../..');
}

async function buildMonacoAssets({
  appRoot = path.resolve(__dirname, '..'),
  outputDir = path.join(appRoot, 'ui', 'ide-dist'),
} = {}) {
  const entry = path.join(appRoot, 'src', 'ide', 'monaco-entry.mjs');
  const monacoRoot = await monacoPackageRoot();
  const workerEntry = path.join(monacoRoot, 'esm', 'vs', 'editor', 'editor.worker.js');
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

  const entries = await fs.readdir(outputDir, { recursive: true });
  if (!entries.includes('editor.js') || !entries.includes('editor.css') || !entries.includes('editor.worker.js')) {
    throw new Error('monaco_asset_build_incomplete');
  }
  return Object.freeze({
    schema: 'metaengine.devos.ide.monaco-build.v1',
    monaco_version: '0.56.0',
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
