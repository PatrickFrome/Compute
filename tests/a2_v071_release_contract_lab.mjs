import fs from 'node:fs';
import path from 'node:path';

function assert(condition, message) { if (!condition) throw new Error(message); }
const root = path.resolve('coordination/chat-control-plane/extension');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'runtime-package-manifest.json'), 'utf8'));
const marker = fs.readFileSync(path.join(root, 'runtime-marker.js'), 'utf8');
const entry = fs.readFileSync(path.join(root, 'background-entry.js'), 'utf8');
const semanticAdapter = fs.readFileSync(path.join(root, 'operator-semantic-perception.js'), 'utf8');
const builder = fs.readFileSync(path.resolve('scripts/a2_build_extension.py'), 'utf8');

assert(manifest.version === '0.7.1', 'manifest version is not 0.7.1');
assert(pkg.package_version === '0.7.1', 'package version is not 0.7.1');
assert(pkg.operator_runtime === '0.7.1-dev.1', 'runtime package marker mismatch');
assert(marker.includes('0.7.1-dev.1') && marker.includes('R4_SEMANTIC_PERCEPTION_COMPILER_V1'), 'runtime marker is not R4');
assert(pkg.files.length === 46, `expected 46 canonical files, got ${pkg.files.length}`);
assert(pkg.files.includes('semantic-perception-compiler.js'), 'generated semantic compiler missing from package closure');
assert(pkg.files.includes('operator-semantic-perception.js'), 'semantic adapter missing from package closure');
assert(pkg.generated_files?.['semantic-perception-compiler.js']?.kind === 'classic_semantic_perception_v1', 'semantic generated-file contract missing');
assert(pkg.generated_files?.['semantic-perception-compiler.js']?.source === 'coordination/browser-shared/semantic-perception-compiler.mjs', 'semantic compiler does not use shared source');
assert(!fs.existsSync(path.join(root, 'semantic-perception-compiler.js')), 'generated compiler must not be hand-maintained in source directory');

const compilerImport = entry.indexOf('importScripts("./semantic-perception-compiler.js")');
const adapterImport = entry.indexOf('importScripts("./operator-semantic-perception.js")');
const actionImport = entry.indexOf('importScripts("./operator-semantic-actions.js")');
assert(compilerImport > 0 && adapterImport > compilerImport && actionImport > adapterImport, 'semantic compiler/adapter load order invalid');
assert(semanticAdapter.includes('A2_TARGET_REGISTRY') && semanticAdapter.includes('resolveLiveTab'), 'semantic adapter bypasses target registry');
assert(semanticAdapter.includes('A2_DEBUGGER_RUN'), 'semantic adapter bypasses debugger broker');
assert(!semanticAdapter.includes('Runtime.evaluate') && !semanticAdapter.includes('Runtime.enable'), 'semantic adapter uses page Runtime');
assert(!semanticAdapter.includes('document.body') && !semanticAdapter.includes('innerText'), 'semantic adapter reads page body');
assert(builder.includes('classic_semantic_perception_v1') && builder.includes('A2_SEMANTIC_PERCEPTION'), 'builder does not deterministically generate classic semantic compiler');

console.log('A2 v0.7.1 Release Contract Lab: PASS', JSON.stringify({
  version: manifest.version,
  runtime: pkg.operator_runtime,
  files: pkg.files.length,
  generated: Object.keys(pkg.generated_files || {}),
  semantic_adapter: true
}));
