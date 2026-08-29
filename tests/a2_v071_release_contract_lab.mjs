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
assert(manifest.manifest_version === 3, 'extension is not Manifest V3');
assert(Number(manifest.minimum_chrome_version) >= 125, 'minimum Chrome version must retain flat-session support');
assert(typeof manifest.description === 'string' && manifest.description.length <= 132, 'manifest description exceeds Chrome limit');
assert(manifest.incognito === 'not_allowed', 'incognito must remain disabled');
assert(pkg.package_version === manifest.version, 'package version must equal manifest version');
assert(pkg.operator_runtime === manifest.version, 'operator runtime must equal stable manifest version');
assert(!pkg.operator_runtime.includes('-dev'), 'development runtime leaked into final package');
assert(marker.includes('const RUNTIME = "0.7.1"'), 'runtime marker is not stable 0.7.1');
assert(marker.includes('EXTENSION_FINAL_V1'), 'runtime marker is not extension-final');
assert(marker.includes('R_ROADMAP_COMPLETE'), 'runtime marker lost canonical roadmap terminal state');
assert(marker.includes('release_channel: "stable"'), 'runtime marker is not on stable channel');
assert(marker.includes('authority_effect: false'), 'runtime marker must not mint authority');
assert(pkg.files.length === 46, `expected 46 canonical files, got ${pkg.files.length}`);
assert(new Set(pkg.files).size === pkg.files.length, 'runtime package contains duplicate paths');
assert(pkg.files.every((file) => !/-v\d+/i.test(file)), 'versioned runtime filename leaked into canonical package closure');
assert(pkg.policy?.canonical_filenames_only === true, 'canonical filename policy is not enforced');
assert(pkg.policy?.reject_versioned_runtime_files === true, 'versioned runtime rejection is not enforced');
assert(pkg.policy?.reject_unlisted_files === true, 'unlisted file rejection is not enforced');
assert(pkg.files.includes('semantic-perception-compiler.js'), 'generated semantic compiler missing from package closure');
assert(pkg.files.includes('operator-semantic-perception.js'), 'semantic adapter missing from package closure');
assert(pkg.files.includes('operator-typed-click-outcome.js'), 'typed click outcome executor missing from final closure');
assert(pkg.files.includes('supervisor-authority.js'), 'signed supervisor authority missing from final closure');
assert(pkg.generated_files?.['semantic-perception-compiler.js']?.kind === 'classic_semantic_perception_v1', 'semantic generated-file contract missing');
assert(pkg.generated_files?.['semantic-perception-compiler.js']?.source === 'coordination/browser-shared/semantic-perception-compiler.mjs', 'semantic compiler does not use shared source');
assert(!fs.existsSync(path.join(root, 'semantic-perception-compiler.js')), 'generated compiler must not be hand-maintained in source directory');

const compilerImport = entry.indexOf('importScripts("./semantic-perception-compiler.js")');
const adapterImport = entry.indexOf('importScripts("./operator-semantic-perception.js")');
const actionImport = entry.indexOf('importScripts("./operator-semantic-actions.js")');
const typedClickImport = entry.indexOf('importScripts("./operator-typed-click-outcome.js")');
const supervisorAuthorityImport = entry.indexOf('importScripts("./supervisor-authority.js")');
assert(compilerImport > 0 && adapterImport > compilerImport && actionImport > adapterImport, 'semantic compiler/adapter load order invalid');
assert(typedClickImport > actionImport, 'typed click executor must load after semantic actions');
assert(supervisorAuthorityImport > typedClickImport, 'supervisor authority must load after executor definitions');
assert(semanticAdapter.includes('A2_TARGET_REGISTRY') && semanticAdapter.includes('resolveLiveTab'), 'semantic adapter bypasses target registry');
assert(semanticAdapter.includes('A2_DEBUGGER_RUN'), 'semantic adapter bypasses debugger broker');
assert(!semanticAdapter.includes('Runtime.evaluate') && !semanticAdapter.includes('Runtime.enable'), 'semantic adapter uses page Runtime');
assert(!semanticAdapter.includes('document.body') && !semanticAdapter.includes('innerText'), 'semantic adapter reads page body');
assert(builder.includes('classic_semantic_perception_v1') && builder.includes('A2_SEMANTIC_PERCEPTION'), 'builder does not deterministically generate classic semantic compiler');

console.log('A2 v0.7.1 Final Release Contract Lab: PASS', JSON.stringify({
  version: manifest.version,
  runtime: pkg.operator_runtime,
  files: pkg.files.length,
  generated: Object.keys(pkg.generated_files || {}),
  semantic_adapter: true,
  typed_click: true,
  supervisor_authority: true,
  release_channel: 'stable'
}));
