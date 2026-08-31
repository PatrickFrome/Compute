import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.resolve(here, '../src');

function read(name) {
  return fs.readFileSync(path.join(srcRoot, name), 'utf8');
}

test('main owns only restricted fleet composition, never raw transport promotion', () => {
  const main = read('main.mjs');

  assert.match(main, /import \{ createFleetBrowserComposition \} from '\.\/fleet-browser-composition\.mjs';/);
  assert.doesNotMatch(main, /import \{ FleetProvisioner \} from '\.\/fleet-provisioner\.mjs';/);
  assert.doesNotMatch(main, /markTransportProven\s*\(/);
  assert.doesNotMatch(main, /new\s+FleetProvisioner\s*\(/);
  assert.match(main, /fleet\s*=\s*createFleetBrowserComposition\s*\(/);
  assert.match(main, /lookupView:\s*\(tabId\)\s*=>\s*views\.get\(String\(tabId\)\)\s*\|\|\s*null/);
});

test('shell, preload and worker surfaces contain no raw fleet transport promotion entrypoint', () => {
  const surfaces = [
    'preload-shell.cjs',
    'development-plane-worker.cjs',
    'native-supervisor-client.mjs',
  ];

  for (const name of surfaces) {
    const source = read(name);
    assert.doesNotMatch(source, /markTransportProven\s*\(/, `${name} must not call raw transport promotion`);
    assert.doesNotMatch(source, /FleetProvisioner/, `${name} must not import or construct FleetProvisioner`);
  }
});

test('restricted composition remains explicit about zero external authority', () => {
  const composition = read('fleet-browser-composition.mjs');
  assert.match(composition, /raw_transport_promotion_exposed:\s*false/);
  assert.match(composition, /proof_input_surface_exposed:\s*false/);
  assert.match(composition, /renderer_input_authority:\s*false/);
  assert.match(composition, /worker_browser_authority:\s*false/);
});
